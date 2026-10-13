'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const cnpjUtil = require('./cnpj');
const auth = require('./auth');
const { tx } = require('./db');
const { buildRanking, estimateBrl, round2 } = require('./calc');

const MAX_BODY = 12 * 1024 * 1024; // fotos chegam em base64, já reduzidas no navegador
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'];
const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
  '.png': 'image/png',
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function createApp({ db, dataDir, publicDir, cnpjLookup = cnpjUtil.lookup, cnpjOnlineCheck = true, secureCookies = false }) {
  const uploadsDir = path.join(dataDir, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  const loginLimiter = auth.createRateLimiter();

  // ---------- utilidades HTTP ----------

  function send(res, status, body, headers = {}) {
    const payload = body === undefined ? '' : JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(payload);
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { reject(new HttpError(413, 'Arquivo muito grande.')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new HttpError(400, 'JSON inválido.')); }
      });
      req.on('error', reject);
    });
  }

  function parseCookies(req) {
    const out = {};
    for (const part of (req.headers.cookie || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
  }

  function sessionCookie(token, maxAge) {
    return `sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookies ? '; Secure' : ''}`;
  }

  // ---------- validação ----------

  const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

  function num(v, field, { required = false, min = 0, integer = false } = {}) {
    if (v === null || v === undefined || v === '') {
      if (required) throw new HttpError(400, `Informe ${field}.`);
      return null;
    }
    const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
    if (!Number.isFinite(n) || n < min) throw new HttpError(400, `${field} inválido.`);
    if (integer && !Number.isInteger(n)) throw new HttpError(400, `${field} deve ser um número inteiro.`);
    return n;
  }

  function saveImage(dataUrl, cnpj) {
    const m = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!m || !IMAGE_TYPES[m[1]]) throw new HttpError(400, 'Imagem inválida (use JPG, PNG ou WEBP).');
    const dir = path.join(uploadsDir, cnpj);
    fs.mkdirSync(dir, { recursive: true });
    const name = `${crypto.randomBytes(12).toString('hex')}.${IMAGE_TYPES[m[1]]}`;
    fs.writeFileSync(path.join(dir, name), Buffer.from(m[2], 'base64'));
    return name;
  }

  function removeImage(cnpj, name) {
    if (!name) return;
    fs.rm(path.join(uploadsDir, cnpj, path.basename(name)), { force: true }, () => {});
  }

  const photoUrl = (name) => (name ? `/uploads/${name}` : null);

  // ---------- consultas ----------

  function getCompany(cnpj) {
    return db.prepare('SELECT cnpj, name, exchange_rate FROM companies WHERE cnpj = ?').get(cnpj);
  }

  function supplierOut(s) {
    return {
      id: s.id, name: s.name, booth: s.booth, notes: s.notes,
      card_photo: photoUrl(s.card_photo), created_at: s.created_at, updated_at: s.updated_at,
      updated_by_name: s.updated_by_name ?? null, product_count: s.product_count ?? undefined,
    };
  }

  function loadSupplier(cnpj, id) {
    const s = db.prepare(`
      SELECT s.*, u.name AS updated_by_name FROM suppliers s
      LEFT JOIN users u ON u.id = s.updated_by
      WHERE s.id = ? AND s.cnpj = ?`).get(id, cnpj);
    if (!s) throw new HttpError(404, 'Fornecedor não encontrado.');
    return s;
  }

  function loadProduct(cnpj, id) {
    const p = db.prepare(`
      SELECT p.*, u.name AS updated_by_name FROM products p
      LEFT JOIN users u ON u.id = p.updated_by
      WHERE p.id = ? AND p.cnpj = ?`).get(id, cnpj);
    if (!p) throw new HttpError(404, 'Produto não encontrado.');
    return p;
  }

  function offersFor(cnpj, productIds) {
    if (!productIds.length) return [];
    return db.prepare(`
      SELECT o.*, s.name AS supplier_name, s.booth AS supplier_booth
      FROM offers o
      JOIN suppliers s ON s.id = o.supplier_id
      JOIN products p ON p.id = o.product_id
      WHERE p.cnpj = ? AND o.product_id IN (${productIds.map(() => '?').join(',')})
    `).all(cnpj, ...productIds);
  }

  function productOut(p, offers, rate) {
    const opts = offers
      .map((o) => ({
        id: o.id,
        supplier_id: o.supplier_id,
        supplier_name: o.supplier_name,
        supplier_booth: o.supplier_booth,
        price_usd: o.price_usd,
        moq: o.moq,
        incoterm: o.incoterm,
        nationalization_pct: o.nationalization_pct,
        estimated_brl: round2(estimateBrl(o.price_usd, o.nationalization_pct, rate)),
      }))
      .sort((a, b) => a.estimated_brl - b.estimated_brl);
    return {
      id: p.id, name: p.name, notes: p.notes, price_brl: p.price_brl,
      photo: photoUrl(p.photo), offers: opts,
      created_at: p.created_at, updated_at: p.updated_at, updated_by_name: p.updated_by_name ?? null,
    };
  }

  // Normaliza a lista de ofertas enviada pelo cliente e garante que os
  // fornecedores pertencem ao mesmo CNPJ.
  function parseOffers(cnpj, list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    return list.map((o, i) => {
      const supplierId = num(o.supplier_id, `fornecedor da oferta ${i + 1}`, { required: true, integer: true });
      if (seen.has(supplierId)) throw new HttpError(400, 'O mesmo fornecedor foi informado mais de uma vez.');
      seen.add(supplierId);
      loadSupplier(cnpj, supplierId);
      const incoterm = str(o.incoterm, 10).toUpperCase() || null;
      if (incoterm && !INCOTERMS.includes(incoterm)) throw new HttpError(400, `Incoterm inválido: ${incoterm}.`);
      return {
        supplier_id: supplierId,
        price_usd: num(o.price_usd, `preço em US$ da oferta ${i + 1}`, { required: true }),
        moq: num(o.moq, `MOQ da oferta ${i + 1}`, { integer: true }),
        incoterm,
        nationalization_pct: num(o.nationalization_pct, `% de nacionalização da oferta ${i + 1}`) ?? 0,
      };
    });
  }

  function replaceOffers(productId, offers) {
    db.prepare('DELETE FROM offers WHERE product_id = ?').run(productId);
    const ins = db.prepare(`INSERT INTO offers (product_id, supplier_id, price_usd, moq, incoterm, nationalization_pct)
                            VALUES (?, ?, ?, ?, ?, ?)`);
    for (const o of offers) ins.run(productId, o.supplier_id, o.price_usd, o.moq, o.incoterm, o.nationalization_pct);
  }

  // ---------- rotas ----------

  const routes = [];
  const route = (method, pattern, handler, { pub = false } = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, handler, pub });
  };

  // --- autenticação ---

  route('POST', '/api/cnpj/check', async ({ body }) => {
    const cnpj = cnpjUtil.clean(body.cnpj);
    if (!cnpjUtil.isValid(cnpj)) return { valid: false, message: 'CNPJ inválido (dígitos verificadores não conferem).' };
    const existing = getCompany(cnpj);
    if (existing) return { valid: true, name: existing.name, existing: true };
    if (!cnpjOnlineCheck) return { valid: true, name: null };
    const info = await cnpjLookup(cnpj);
    if (info.status === 'not_found') return { valid: false, message: 'CNPJ não encontrado na Receita Federal.' };
    return { valid: true, name: info.name || null, verified_online: info.status === 'found' };
  }, { pub: true });

  route('POST', '/api/register', async ({ body, res }) => {
    const name = str(body.name, 120);
    const email = str(body.email, 200).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    const cnpj = cnpjUtil.clean(body.cnpj);

    if (!name) throw new HttpError(400, 'Informe o nome.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'E-mail inválido.');
    if (password.length < 8) throw new HttpError(400, 'A senha deve ter pelo menos 8 caracteres.');
    if (password.length > 200) throw new HttpError(400, 'Senha muito longa.');
    if (!cnpjUtil.isValid(cnpj)) throw new HttpError(400, 'CNPJ inválido.');
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
      throw new HttpError(409, 'Já existe uma conta com este e-mail.');
    }

    let company = getCompany(cnpj);
    let companyName = company?.name ?? null;
    if (!company && cnpjOnlineCheck) {
      const info = await cnpjLookup(cnpj);
      if (info.status === 'not_found') throw new HttpError(400, 'CNPJ não encontrado na Receita Federal.');
      companyName = info.name || null;
    }

    const passwordHash = auth.hashPassword(password);
    const userId = tx(db, () => {
      if (!getCompany(cnpj)) db.prepare('INSERT INTO companies (cnpj, name) VALUES (?, ?)').run(cnpj, companyName);
      return Number(db.prepare('INSERT INTO users (name, email, password_hash, cnpj) VALUES (?, ?, ?, ?)')
        .run(name, email, passwordHash, cnpj).lastInsertRowid);
    });
    const session = auth.createSession(db, userId);
    res.setHeader('Set-Cookie', sessionCookie(session.token, session.maxAge));
    company = getCompany(cnpj);
    return { status: 201, body: meOut({ id: userId, name, email, cnpj }, company) };
  }, { pub: true });

  route('POST', '/api/login', async ({ body, req, res }) => {
    const email = str(body.email, 200).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    const key = `${req.socket.remoteAddress}|${email}`;
    if (!loginLimiter.hit(key)) throw new HttpError(429, 'Muitas tentativas. Tente novamente em alguns minutos.');
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !auth.verifyPassword(password, user.password_hash)) {
      throw new HttpError(401, 'E-mail ou senha incorretos.');
    }
    loginLimiter.clear(key);
    const session = auth.createSession(db, user.id);
    res.setHeader('Set-Cookie', sessionCookie(session.token, session.maxAge));
    return meOut(user, getCompany(user.cnpj));
  }, { pub: true });

  route('POST', '/api/logout', ({ req, res }) => {
    auth.destroySession(db, parseCookies(req).sid);
    res.setHeader('Set-Cookie', sessionCookie('', 0));
    return { ok: true };
  }, { pub: true });

  function meOut(user, company) {
    const members = db.prepare('SELECT name, email FROM users WHERE cnpj = ? ORDER BY name').all(user.cnpj);
    return {
      user: { id: user.id, name: user.name, email: user.email },
      company: {
        cnpj: company.cnpj, cnpj_formatted: cnpjUtil.format(company.cnpj),
        name: company.name, exchange_rate: company.exchange_rate, members,
      },
    };
  }

  route('GET', '/api/me', ({ user }) => meOut(user, getCompany(user.cnpj)));

  route('PUT', '/api/settings', ({ user, body }) => {
    const rate = num(body.exchange_rate, 'Câmbio', { required: true });
    if (rate <= 0) throw new HttpError(400, 'Câmbio deve ser maior que zero.');
    db.prepare('UPDATE companies SET exchange_rate = ? WHERE cnpj = ?').run(rate, user.cnpj);
    return meOut(user, getCompany(user.cnpj));
  });

  // --- fornecedores ---

  route('GET', '/api/suppliers', ({ user }) => {
    const rows = db.prepare(`
      SELECT s.*, u.name AS updated_by_name,
             (SELECT COUNT(*) FROM offers o WHERE o.supplier_id = s.id) AS product_count
      FROM suppliers s LEFT JOIN users u ON u.id = s.updated_by
      WHERE s.cnpj = ? ORDER BY s.name COLLATE NOCASE`).all(user.cnpj);
    return rows.map(supplierOut);
  });

  route('GET', '/api/suppliers/:id', ({ user, params }) => {
    const s = loadSupplier(user.cnpj, params.id);
    const company = getCompany(user.cnpj);
    const products = db.prepare(`
      SELECT p.id, p.name, p.photo, p.price_brl, o.price_usd, o.moq, o.incoterm, o.nationalization_pct
      FROM offers o JOIN products p ON p.id = o.product_id
      WHERE o.supplier_id = ? AND p.cnpj = ? ORDER BY p.name COLLATE NOCASE`).all(s.id, user.cnpj)
      .map((r) => ({
        ...r, photo: photoUrl(r.photo),
        estimated_brl: round2(estimateBrl(r.price_usd, r.nationalization_pct, company.exchange_rate)),
      }));
    return { ...supplierOut(s), products };
  });

  route('POST', '/api/suppliers', ({ user, body }) => {
    const name = str(body.name, 150);
    if (!name) throw new HttpError(400, 'Informe o nome do fornecedor.');
    if (!body.card_photo) throw new HttpError(400, 'A foto do cartão de visitas é obrigatória.');
    const photo = saveImage(body.card_photo, user.cnpj);
    const id = db.prepare(`INSERT INTO suppliers (cnpj, name, card_photo, booth, notes, created_by, updated_by)
                           VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(user.cnpj, name, photo, str(body.booth, 50) || null, str(body.notes, 2000) || null, user.id, user.id)
      .lastInsertRowid;
    return { status: 201, body: supplierOut(loadSupplier(user.cnpj, Number(id))) };
  });

  route('PUT', '/api/suppliers/:id', ({ user, params, body }) => {
    const s = loadSupplier(user.cnpj, params.id);
    const name = str(body.name, 150);
    if (!name) throw new HttpError(400, 'Informe o nome do fornecedor.');
    let photo = s.card_photo;
    if (body.card_photo && String(body.card_photo).startsWith('data:')) {
      photo = saveImage(body.card_photo, user.cnpj);
      removeImage(user.cnpj, s.card_photo);
    }
    db.prepare(`UPDATE suppliers SET name = ?, card_photo = ?, booth = ?, notes = ?, updated_by = ?,
                updated_at = datetime('now') WHERE id = ?`)
      .run(name, photo, str(body.booth, 50) || null, str(body.notes, 2000) || null, user.id, s.id);
    return supplierOut(loadSupplier(user.cnpj, s.id));
  });

  route('DELETE', '/api/suppliers/:id', ({ user, params }) => {
    const s = loadSupplier(user.cnpj, params.id);
    db.prepare('DELETE FROM suppliers WHERE id = ?').run(s.id);
    removeImage(user.cnpj, s.card_photo);
    return { ok: true };
  });

  // --- produtos ---

  route('GET', '/api/products', ({ user }) => {
    const rate = getCompany(user.cnpj).exchange_rate;
    const products = db.prepare(`
      SELECT p.*, u.name AS updated_by_name FROM products p LEFT JOIN users u ON u.id = p.updated_by
      WHERE p.cnpj = ? ORDER BY p.name COLLATE NOCASE`).all(user.cnpj);
    const offers = offersFor(user.cnpj, products.map((p) => p.id));
    return products.map((p) => productOut(p, offers.filter((o) => o.product_id === p.id), rate));
  });

  route('GET', '/api/products/:id', ({ user, params }) => {
    const p = loadProduct(user.cnpj, params.id);
    return productOut(p, offersFor(user.cnpj, [p.id]), getCompany(user.cnpj).exchange_rate);
  });

  function productFields(body) {
    const name = str(body.name, 150);
    if (!name) throw new HttpError(400, 'Informe o nome do produto.');
    return { name, price_brl: num(body.price_brl, 'Preço no Brasil'), notes: str(body.notes, 2000) || null };
  }

  route('POST', '/api/products', ({ user, body }) => {
    const f = productFields(body);
    const offers = parseOffers(user.cnpj, body.offers);
    const photo = body.photo ? saveImage(body.photo, user.cnpj) : null;
    const id = tx(db, () => {
      const pid = Number(db.prepare(`INSERT INTO products (cnpj, name, photo, price_brl, notes, created_by, updated_by)
                                     VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(user.cnpj, f.name, photo, f.price_brl, f.notes, user.id, user.id).lastInsertRowid);
      replaceOffers(pid, offers);
      return pid;
    });
    const p = loadProduct(user.cnpj, id);
    return { status: 201, body: productOut(p, offersFor(user.cnpj, [id]), getCompany(user.cnpj).exchange_rate) };
  });

  route('PUT', '/api/products/:id', ({ user, params, body }) => {
    const p = loadProduct(user.cnpj, params.id);
    const f = productFields(body);
    const offers = parseOffers(user.cnpj, body.offers);
    let photo = p.photo;
    if (body.photo === null) {
      photo = null;
    } else if (body.photo && String(body.photo).startsWith('data:')) {
      photo = saveImage(body.photo, user.cnpj);
    }
    tx(db, () => {
      db.prepare(`UPDATE products SET name = ?, photo = ?, price_brl = ?, notes = ?, updated_by = ?,
                  updated_at = datetime('now') WHERE id = ?`)
        .run(f.name, photo, f.price_brl, f.notes, user.id, p.id);
      replaceOffers(p.id, offers);
    });
    if (photo !== p.photo) removeImage(user.cnpj, p.photo);
    return productOut(loadProduct(user.cnpj, p.id), offersFor(user.cnpj, [p.id]), getCompany(user.cnpj).exchange_rate);
  });

  route('DELETE', '/api/products/:id', ({ user, params }) => {
    const p = loadProduct(user.cnpj, params.id);
    db.prepare('DELETE FROM products WHERE id = ?').run(p.id);
    removeImage(user.cnpj, p.photo);
    return { ok: true };
  });

  // --- relatório / ranking ---

  route('GET', '/api/ranking', ({ user }) => {
    const rate = getCompany(user.cnpj).exchange_rate;
    const products = db.prepare('SELECT id, name, photo, price_brl FROM products WHERE cnpj = ?').all(user.cnpj);
    const offers = offersFor(user.cnpj, products.map((p) => p.id));
    const items = buildRanking(products, offers, rate).map((r) => ({ ...r, photo: photoUrl(r.photo) }));

    // Resumo por fornecedor: em quantos produtos ele é a melhor opção.
    const suppliers = new Map();
    for (const it of items) {
      if (!it.best) continue;
      const s = suppliers.get(it.best.supplier_id) || {
        supplier_id: it.best.supplier_id, name: it.best.supplier_name, booth: it.best.supplier_booth,
        best_count: 0, advantageous_count: 0, total_saving_brl: 0,
      };
      s.best_count++;
      if (it.advantageous) {
        s.advantageous_count++;
        s.total_saving_brl = round2(s.total_saving_brl + it.saving_brl);
      }
      suppliers.set(s.supplier_id, s);
    }
    const supplierRanking = [...suppliers.values()]
      .sort((a, b) => b.advantageous_count - a.advantageous_count || b.total_saving_brl - a.total_saving_brl);

    return {
      exchange_rate: rate,
      items,
      suppliers: supplierRanking,
      summary: {
        products: items.length,
        compared: items.filter((i) => i.saving_pct !== null).length,
        advantageous: items.filter((i) => i.advantageous).length,
      },
    };
  });

  // ---------- arquivos ----------

  function serveFile(res, file, type, cache) {
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { send(res, 404, { error: 'Não encontrado.' }); return; }
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': cache });
      fs.createReadStream(file).pipe(res);
    });
  }

  function serveUpload(res, user, name) {
    const file = path.join(uploadsDir, user.cnpj, path.basename(name));
    const ext = path.extname(file).slice(1);
    const type = Object.keys(IMAGE_TYPES).find((k) => IMAGE_TYPES[k] === ext);
    if (!type) return send(res, 404, { error: 'Não encontrado.' });
    serveFile(res, file, type, 'private, max-age=86400');
  }

  function serveStatic(res, pathname) {
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    const file = path.normalize(path.join(publicDir, rel));
    if (!file.startsWith(publicDir + path.sep)) return send(res, 404, { error: 'Não encontrado.' });
    const type = STATIC_TYPES[path.extname(file)];
    if (!type || !fs.existsSync(file)) {
      // SPA: qualquer rota desconhecida devolve o index.
      return serveFile(res, path.join(publicDir, 'index.html'), STATIC_TYPES['.html'], 'no-cache');
    }
    serveFile(res, file, type, 'no-cache');
  }

  // ---------- handler principal ----------

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;
    try {
      if (pathname.startsWith('/uploads/')) {
        const user = auth.getSessionUser(db, parseCookies(req).sid);
        if (!user) return send(res, 401, { error: 'Não autenticado.' });
        return serveUpload(res, user, decodeURIComponent(pathname.slice('/uploads/'.length)));
      }
      if (!pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Método não permitido.' });
        return serveStatic(res, pathname);
      }

      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(pathname);
        if (!m) continue;
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        const user = auth.getSessionUser(db, parseCookies(req).sid);
        if (!r.pub && !user) throw new HttpError(401, 'Não autenticado.');
        // Exigir JSON em POST/PUT também protege contra CSRF via formulários de outros sites.
        if ((req.method === 'POST' || req.method === 'PUT') && !/^application\/json\b/.test(req.headers['content-type'] || '')) {
          throw new HttpError(415, 'Envie os dados em JSON.');
        }
        const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readJson(req);
        const out = await r.handler({ req, res, user, params, body, query: url.searchParams });
        if (out && out.status && out.body) return send(res, out.status, out.body);
        return send(res, 200, out);
      }
      throw new HttpError(404, 'Rota não encontrada.');
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      console.error(err);
      if (!res.headersSent) send(res, 500, { error: 'Erro interno.' });
    }
  };
}

module.exports = { createApp, INCOTERMS };
