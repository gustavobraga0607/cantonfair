'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const cnpjUtil = require('./cnpj');
const auth = require('./auth');
const { buildRanking, estimateBrl, round2, round4, freightPerUnit, offerFreight } = require('./calc');
const { OcrError } = require('./ocr');

// A Vercel limita o corpo da requisição a 4,5 MB; as fotos são reduzidas no navegador.
const MAX_BODY = 4 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
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

const now = () => new Date().toISOString();

function createApp({ db, publicDir, cnpjLookup = cnpjUtil.lookup, cnpjOnlineCheck = true, secureCookies = false, adminEmails = [], readCard = null, fx = null }) {
  const ADMIN_EMAILS = new Set(adminEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
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

  // ---------- imagens (guardadas no banco) ----------

  function parseImage(dataUrl) {
    const m = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!m || !IMAGE_TYPES.includes(m[1])) throw new HttpError(400, 'Imagem inválida (use JPG, PNG ou WEBP).');
    return { mime: m[1], data: Buffer.from(m[2], 'base64') };
  }

  async function saveImage(q, img, cnpj) {
    const id = crypto.randomBytes(16).toString('hex');
    await q.run('INSERT INTO images (id, cnpj, mime, data, created_at) VALUES (?, ?, ?, ?, ?)', [id, cnpj, img.mime, img.data, now()]);
    return id;
  }

  async function removeImage(q, cnpj, id) {
    if (id) await q.run('DELETE FROM images WHERE id = ? AND cnpj = ?', [id, cnpj]);
  }

  const photoUrl = (id) => (id ? `/uploads/${id}` : null);

  // ---------- consultas ----------

  const getCompany = (cnpj) => db.get('SELECT cnpj, name, exchange_rate, rate_mode, rate_source, rate_updated_at FROM companies WHERE cnpj = ?', [cnpj]);

  // ---------- permissões ----------
  // Usuário comum: enxerga apenas o próprio CNPJ.
  // Administrador: enxerga e edita fornecedores e produtos de todas as empresas.
  const isAdmin = (user) => user.role === 'admin';

  // CNPJ a que o usuário está restrito ao acessar um item por id (null = qualquer um).
  const accessCnpj = (user) => (isAdmin(user) ? null : user.cnpj);

  // CNPJ usado nas listagens: o admin escolhe com ?company=<cnpj> ou ?company=all.
  function listCnpj(user, query) {
    if (!isAdmin(user)) return user.cnpj;
    const c = query.get('company');
    return !c || c === 'all' ? null : cnpjUtil.clean(c);
  }

  // Empresa em que um novo cadastro é criado (o admin pode escolher outra).
  async function targetCnpj(user, body) {
    if (!isAdmin(user) || !body.company) return user.cnpj;
    const c = cnpjUtil.clean(body.company);
    if (!(await getCompany(c))) throw new HttpError(400, 'Empresa não encontrada.');
    return c;
  }

  const companyFilter = (alias, cnpj) => (cnpj ? ` AND ${alias}.cnpj = ?` : '');
  const companyParam = (cnpj) => (cnpj ? [cnpj] : []);

  function supplierOut(s) {
    return {
      id: s.id, name: s.name, booth: s.booth, notes: s.notes,
      contact_name: s.contact_name ?? null, phone: s.phone ?? null,
      company_cnpj: s.cnpj, company_name: s.company_name ?? null,
      card_photo: photoUrl(s.card_photo), created_at: s.created_at, updated_at: s.updated_at,
      updated_by_name: s.updated_by_name ?? null,
      product_count: s.product_count == null ? undefined : Number(s.product_count),
    };
  }

  // cnpj null = sem restrição de empresa (administrador).
  async function loadSupplier(q, cnpj, id) {
    const s = await q.get(`
      SELECT s.*, u.name AS updated_by_name, c.name AS company_name FROM suppliers s
      LEFT JOIN users u ON u.id = s.updated_by
      JOIN companies c ON c.cnpj = s.cnpj
      WHERE s.id = ?${companyFilter('s', cnpj)}`, [toId(id), ...companyParam(cnpj)]);
    if (!s) throw new HttpError(404, 'Fornecedor não encontrado.');
    return s;
  }

  async function loadProduct(cnpj, id) {
    const p = await db.get(`
      SELECT p.*, u.name AS updated_by_name, c.name AS company_name, c.exchange_rate FROM products p
      LEFT JOIN users u ON u.id = p.updated_by
      JOIN companies c ON c.cnpj = p.cnpj
      WHERE p.id = ?${companyFilter('p', cnpj)}`, [toId(id), ...companyParam(cnpj)]);
    if (!p) throw new HttpError(404, 'Produto não encontrado.');
    return p;
  }

  function toId(v) {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0 || n > 2147483647) throw new HttpError(404, 'Não encontrado.');
    return n;
  }

  async function offersFor(cnpj, productIds) {
    if (!productIds.length) return [];
    return db.all(`
      SELECT o.*, s.name AS supplier_name, s.booth AS supplier_booth
      FROM offers o
      JOIN suppliers s ON s.id = o.supplier_id
      JOIN products p ON p.id = o.product_id
      WHERE o.product_id IN (${productIds.map(() => '?').join(',')})${companyFilter('p', cnpj)}
    `, [...productIds, ...companyParam(cnpj)]);
  }

  // Frete internacional do container 40HQ (US$), definido pelo administrador.
  async function freight40hq() {
    const row = await db.get("SELECT value FROM app_settings WHERE key = 'freight_40hq_usd'");
    return row?.value != null ? Number(row.value) : 0;
  }

  function productOut(p, offers, rate, freight = 0) {
    const perUnit = freightPerUnit(freight, p.units_per_40hq);
    const opts = offers
      .map((o) => ({ ...o, freight: offerFreight(o.incoterm, perUnit) }))
      .map((o) => ({
        id: o.id,
        supplier_id: o.supplier_id,
        supplier_name: o.supplier_name,
        supplier_booth: o.supplier_booth,
        price_usd: o.price_usd,
        moq: o.moq,
        incoterm: o.incoterm,
        nationalization_pct: o.nationalization_pct,
        freight_usd: round4(o.freight),
        estimated_brl: round2(estimateBrl(o.price_usd, o.nationalization_pct, rate, o.freight)),
      }))
      .sort((a, b) => a.estimated_brl - b.estimated_brl);
    return {
      id: p.id, name: p.name, notes: p.notes, price_brl: p.price_brl, units_per_40hq: p.units_per_40hq ?? null,
      photo: photoUrl(p.photo), offers: opts,
      company_cnpj: p.cnpj, company_name: p.company_name ?? null, exchange_rate: rate,
      created_at: p.created_at, updated_at: p.updated_at, updated_by_name: p.updated_by_name ?? null,
    };
  }

  async function productResponse(cnpj, id) {
    const p = await loadProduct(cnpj, id);
    return productOut(p, await offersFor(p.cnpj, [p.id]), p.exchange_rate, await freight40hq());
  }

  // Normaliza a lista de ofertas enviada pelo cliente e garante que os
  // fornecedores pertencem ao mesmo CNPJ.
  async function parseOffers(cnpj, list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    for (const [i, o] of list.entries()) {
      const supplierId = num(o.supplier_id, `fornecedor da oferta ${i + 1}`, { required: true, integer: true });
      if (seen.has(supplierId)) throw new HttpError(400, 'O mesmo fornecedor foi informado mais de uma vez.');
      seen.add(supplierId);
      await loadSupplier(db, cnpj, supplierId);
      const incoterm = str(o.incoterm, 10).toUpperCase() || null;
      if (incoterm && !INCOTERMS.includes(incoterm)) throw new HttpError(400, `Incoterm inválido: ${incoterm}.`);
      out.push({
        supplier_id: supplierId,
        price_usd: num(o.price_usd, `preço em US$ da oferta ${i + 1}`, { required: true }),
        moq: num(o.moq, `MOQ da oferta ${i + 1}`, { integer: true }),
        incoterm,
        nationalization_pct: num(o.nationalization_pct, `% de nacionalização da oferta ${i + 1}`) ?? 0,
      });
    }
    return out;
  }

  async function replaceOffers(q, productId, offers) {
    await q.run('DELETE FROM offers WHERE product_id = ?', [productId]);
    for (const o of offers) {
      await q.run(`INSERT INTO offers (product_id, supplier_id, price_usd, moq, incoterm, nationalization_pct)
                   VALUES (?, ?, ?, ?, ?, ?)`, [productId, o.supplier_id, o.price_usd, o.moq, o.incoterm, o.nationalization_pct]);
    }
  }

  // ---------- rotas ----------

  const routes = [];
  const route = (method, pattern, handler, { pub = false } = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, handler, pub });
  };

  // Papel efetivo: o definido no banco ou "admin" para e-mails em ADMIN_EMAILS.
  function withRole(user) {
    return { ...user, role: ADMIN_EMAILS.has(String(user.email).toLowerCase()) ? 'admin' : (user.role || 'user') };
  }

  // Grava no banco o papel de administrador dos e-mails configurados.
  async function syncRole(user) {
    const u = withRole(user);
    if (u.role !== (user.role || 'user')) await db.run('UPDATE users SET role = ? WHERE id = ?', [u.role, u.id]);
    return u;
  }

  async function getSettings() {
    const row = await db.get(`SELECT s.value, s.updated_at, u.name AS updated_by_name FROM app_settings s
                              LEFT JOIN users u ON u.id = s.updated_by WHERE s.key = 'freight_40hq_usd'`);
    return {
      freight_40hq_usd: row?.value != null ? Number(row.value) : null,
      freight_updated_at: row?.updated_at ?? null,
      freight_updated_by: row?.updated_by_name ?? null,
    };
  }

  async function meOut(user) {
    const [company, members] = await Promise.all([
      getCompany(user.cnpj),
      db.all('SELECT name, email FROM users WHERE cnpj = ? ORDER BY lower(name)', [user.cnpj]),
    ]);
    const companies = isAdmin(user)
      ? await db.all('SELECT cnpj, name, exchange_rate FROM companies ORDER BY lower(coalesce(name, cnpj))')
      : undefined;
    return {
      user: { id: user.id, name: user.name, email: user.email, role: user.role || 'user', is_admin: isAdmin(user) },
      company: {
        cnpj: company.cnpj, cnpj_formatted: cnpjUtil.format(company.cnpj),
        name: company.name, exchange_rate: company.exchange_rate, members,
        rate_mode: company.rate_mode, rate_source: company.rate_source, rate_updated_at: company.rate_updated_at,
      },
      fx: fx ? await fx.read() : null,
      settings: await getSettings(),
      companies: companies?.map((c) => ({ ...c, cnpj_formatted: cnpjUtil.format(c.cnpj) })),
      features: { card_ocr: Boolean(readCard) },
    };
  }

  // --- autenticação ---

  route('POST', '/api/cnpj/check', async ({ body }) => {
    const cnpj = cnpjUtil.clean(body.cnpj);
    if (!cnpjUtil.isValid(cnpj)) return { valid: false, message: 'CNPJ inválido (dígitos verificadores não conferem).' };
    const existing = await getCompany(cnpj);
    if (existing) return { valid: true, name: existing.name, existing: true };
    if (!cnpjOnlineCheck) return { valid: true, name: null };
    const info = await cnpjLookup(cnpj);
    if (info.status === 'not_found') return { valid: false, message: 'CNPJ não encontrado na Receita Federal.' };
    return { valid: true, name: info.name || null, verified_online: info.status === 'found', source: info.source || null };
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
    if (await db.get('SELECT 1 AS x FROM users WHERE email = ?', [email])) {
      throw new HttpError(409, 'Já existe uma conta com este e-mail.');
    }

    const existing = await getCompany(cnpj);
    let companyName = existing?.name ?? null;
    if (!existing && cnpjOnlineCheck) {
      const info = await cnpjLookup(cnpj);
      if (info.status === 'not_found') throw new HttpError(400, 'CNPJ não encontrado na Receita Federal.');
      companyName = info.name || null;
    }

    const passwordHash = auth.hashPassword(password);
    const role = withRole({ email }).role;
    // Empresa nova já começa com a cotação do dia (ou 5,50 se as APIs estiverem fora).
    const quote = !existing && fx ? await fx.ensureFresh().catch(() => null) : null;
    let userId;
    try {
      userId = await db.tx(async (q) => {
        await q.run(`INSERT INTO companies (cnpj, name, exchange_rate, rate_source, rate_updated_at, created_at)
                     VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (cnpj) DO NOTHING`,
          [cnpj, companyName, quote?.rate ?? 5.5, quote?.rate ? quote.source : null, quote?.rate ? quote.quoted_at : null, now()]);
        const row = await q.get('INSERT INTO users (name, email, password_hash, cnpj, role, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
          [name, email, passwordHash, cnpj, role, now()]);
        return row.id;
      });
    } catch (err) {
      if (/unique|duplicate/i.test(err.message)) throw new HttpError(409, 'Já existe uma conta com este e-mail.');
      throw err;
    }
    const session = await auth.createSession(db, userId);
    res.setHeader('Set-Cookie', sessionCookie(session.token, session.maxAge));
    return { status: 201, body: await meOut({ id: userId, name, email, cnpj, role }) };
  }, { pub: true });

  route('POST', '/api/login', async ({ body, req, res }) => {
    const email = str(body.email, 200).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    const key = `${ip}|${email}`;
    if (!loginLimiter.hit(key)) throw new HttpError(429, 'Muitas tentativas. Tente novamente em alguns minutos.');
    const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
    if (!user || !auth.verifyPassword(password, user.password_hash)) {
      throw new HttpError(401, 'E-mail ou senha incorretos.');
    }
    loginLimiter.clear(key);
    const session = await auth.createSession(db, user.id);
    res.setHeader('Set-Cookie', sessionCookie(session.token, session.maxAge));
    return meOut(await syncRole(user));
  }, { pub: true });

  route('POST', '/api/logout', async ({ req, res }) => {
    await auth.destroySession(db, parseCookies(req).sid);
    res.setHeader('Set-Cookie', sessionCookie('', 0));
    return { ok: true };
  }, { pub: true });

  route('GET', '/api/me', async ({ user }) => meOut(await syncRole(user)));

  // Câmbio: { mode: 'auto' } volta para a cotação do dia; { exchange_rate } fixa um valor manual.
  route('PUT', '/api/settings', async ({ user, body }) => {
    if (body.mode === 'auto') {
      if (!fx) throw new HttpError(400, 'Cotação automática desativada neste servidor.');
      const q = await fx.ensureFresh();
      if (q.rate) {
        await db.run(`UPDATE companies SET rate_mode = 'auto', exchange_rate = ?, rate_source = ?, rate_updated_at = ? WHERE cnpj = ?`,
          [q.rate, q.source, q.quoted_at, user.cnpj]);
      } else {
        await db.run(`UPDATE companies SET rate_mode = 'auto' WHERE cnpj = ?`, [user.cnpj]);
      }
      return meOut(user);
    }
    const rate = num(body.exchange_rate, 'Câmbio', { required: true });
    if (rate <= 0 || rate > 100) throw new HttpError(400, 'Câmbio inválido.');
    await db.run(`UPDATE companies SET exchange_rate = ?, rate_mode = 'manual', rate_source = 'Manual', rate_updated_at = ? WHERE cnpj = ?`,
      [rate, now(), user.cnpj]);
    return meOut(user);
  });

  // Configurações gerais (somente administrador): frete internacional do container 40HQ.
  route('PUT', '/api/admin/settings', async ({ user, body }) => {
    if (!isAdmin(user)) throw new HttpError(403, 'Apenas administradores podem alterar esta configuração.');
    const freight = num(body.freight_40hq_usd, 'Valor do frete internacional 40HQ');
    if (freight !== null && freight > 1_000_000) throw new HttpError(400, 'Valor do frete internacional 40HQ inválido.');
    await db.run(`INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ('freight_40hq_usd', ?, ?, ?)
                  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      [freight === null ? null : String(freight), user.id, now()]);
    return meOut(user);
  });

  // Força a busca da cotação agora (botão "Atualizar agora").
  route('POST', '/api/fx/refresh', async ({ user }) => {
    if (!fx) throw new HttpError(400, 'Cotação automática desativada neste servidor.');
    await fx.ensureFresh({ force: true });
    return meOut(user);
  });

  // --- fornecedores ---

  route('GET', '/api/suppliers', async ({ user, query }) => {
    const cnpj = listCnpj(user, query);
    const rows = await db.all(`
      SELECT s.*, u.name AS updated_by_name, c.name AS company_name,
             (SELECT COUNT(*) FROM offers o WHERE o.supplier_id = s.id) AS product_count
      FROM suppliers s LEFT JOIN users u ON u.id = s.updated_by
      JOIN companies c ON c.cnpj = s.cnpj
      WHERE 1 = 1${companyFilter('s', cnpj)} ORDER BY lower(s.name)`, companyParam(cnpj));
    return rows.map(supplierOut);
  });

  route('GET', '/api/suppliers/:id', async ({ user, params }) => {
    const s = await loadSupplier(db, accessCnpj(user), params.id);
    const company = await getCompany(s.cnpj);
    const freight = await freight40hq();
    const products = (await db.all(`
      SELECT p.id, p.name, p.photo, p.price_brl, p.units_per_40hq, o.price_usd, o.moq, o.incoterm, o.nationalization_pct
      FROM offers o JOIN products p ON p.id = o.product_id
      WHERE o.supplier_id = ? AND p.cnpj = ? ORDER BY lower(p.name)`, [s.id, s.cnpj]))
      .map((r) => ({
        ...r, photo: photoUrl(r.photo),
        estimated_brl: round2(estimateBrl(r.price_usd, r.nationalization_pct, company.exchange_rate,
          offerFreight(r.incoterm, freightPerUnit(freight, r.units_per_40hq)))),
      }));
    return { ...supplierOut(s), products };
  });

  // Campos opcionais do fornecedor.
  function supplierFields(body) {
    return {
      booth: str(body.booth, 50) || null,
      contact_name: str(body.contact_name, 150) || null,
      phone: str(body.phone, 60) || null,
      notes: str(body.notes, 2000) || null,
    };
  }

  // Lê a foto do cartão de visita e devolve os campos para preencher o cadastro.
  route('POST', '/api/ocr/card', async ({ body }) => {
    if (!readCard) throw new HttpError(503, 'Leitor de cartões não configurado (defina ANTHROPIC_API_KEY na Vercel).');
    const img = parseImage(body.image);
    try {
      return await readCard(img.mime, img.data.toString('base64'));
    } catch (err) {
      if (err instanceof OcrError) throw new HttpError(err.status, err.message);
      throw err;
    }
  });

  route('POST', '/api/suppliers', async ({ user, body }) => {
    const name = str(body.name, 150);
    if (!name) throw new HttpError(400, 'Informe o nome do fornecedor.');
    if (!body.card_photo) throw new HttpError(400, 'A foto do cartão de visitas é obrigatória.');
    const cnpj = await targetCnpj(user, body);
    const img = parseImage(body.card_photo);
    const id = await db.tx(async (q) => {
      const photo = await saveImage(q, img, cnpj);
      const t = now();
      const f = supplierFields(body);
      const row = await q.get(`INSERT INTO suppliers (cnpj, name, card_photo, booth, contact_name, phone, notes, created_by, updated_by, created_at, updated_at)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        [cnpj, name, photo, f.booth, f.contact_name, f.phone, f.notes, user.id, user.id, t, t]);
      return row.id;
    });
    return { status: 201, body: supplierOut(await loadSupplier(db, cnpj, id)) };
  });

  route('PUT', '/api/suppliers/:id', async ({ user, params, body }) => {
    const s = await loadSupplier(db, accessCnpj(user), params.id);
    const name = str(body.name, 150);
    if (!name) throw new HttpError(400, 'Informe o nome do fornecedor.');
    const img = body.card_photo && String(body.card_photo).startsWith('data:') ? parseImage(body.card_photo) : null;
    await db.tx(async (q) => {
      let photo = s.card_photo;
      if (img) photo = await saveImage(q, img, s.cnpj);
      const f = supplierFields(body);
      await q.run(`UPDATE suppliers SET name = ?, card_photo = ?, booth = ?, contact_name = ?, phone = ?, notes = ?, updated_by = ?, updated_at = ?
                   WHERE id = ?`, [name, photo, f.booth, f.contact_name, f.phone, f.notes, user.id, now(), s.id]);
      if (img) await removeImage(q, s.cnpj, s.card_photo);
    });
    return supplierOut(await loadSupplier(db, s.cnpj, s.id));
  });

  route('DELETE', '/api/suppliers/:id', async ({ user, params }) => {
    const s = await loadSupplier(db, accessCnpj(user), params.id);
    await db.tx(async (q) => {
      await q.run('DELETE FROM suppliers WHERE id = ?', [s.id]);
      await removeImage(q, s.cnpj, s.card_photo);
    });
    return { ok: true };
  });

  // --- produtos ---

  route('GET', '/api/products', async ({ user, query }) => {
    const cnpj = listCnpj(user, query);
    const products = await db.all(`
      SELECT p.*, u.name AS updated_by_name, c.name AS company_name, c.exchange_rate
      FROM products p LEFT JOIN users u ON u.id = p.updated_by
      JOIN companies c ON c.cnpj = p.cnpj
      WHERE 1 = 1${companyFilter('p', cnpj)} ORDER BY lower(p.name)`, companyParam(cnpj));
    const offers = await offersFor(cnpj, products.map((p) => p.id));
    const freight = await freight40hq();
    return products.map((p) => productOut(p, offers.filter((o) => o.product_id === p.id), p.exchange_rate, freight));
  });

  route('GET', '/api/products/:id', ({ user, params }) => productResponse(accessCnpj(user), params.id));

  function productFields(body) {
    const name = str(body.name, 150);
    if (!name) throw new HttpError(400, 'Informe o nome do produto.');
    const units = num(body.units_per_40hq, 'Unidades por container 40HQ', { integer: true });
    if (units !== null && (units < 1 || units > 100_000_000)) throw new HttpError(400, 'Unidades por container 40HQ inválido.');
    return { name, price_brl: num(body.price_brl, 'Preço no Brasil'), units_per_40hq: units, notes: str(body.notes, 2000) || null };
  }

  route('POST', '/api/products', async ({ user, body }) => {
    const f = productFields(body);
    const cnpj = await targetCnpj(user, body);
    // Fornecedores das ofertas precisam ser da mesma empresa do produto.
    const offers = await parseOffers(cnpj, body.offers);
    const img = body.photo ? parseImage(body.photo) : null;
    const id = await db.tx(async (q) => {
      const photo = img ? await saveImage(q, img, cnpj) : null;
      const t = now();
      const row = await q.get(`INSERT INTO products (cnpj, name, photo, price_brl, units_per_40hq, notes, created_by, updated_by, created_at, updated_at)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        [cnpj, f.name, photo, f.price_brl, f.units_per_40hq, f.notes, user.id, user.id, t, t]);
      await replaceOffers(q, row.id, offers);
      return row.id;
    });
    return { status: 201, body: await productResponse(cnpj, id) };
  });

  route('PUT', '/api/products/:id', async ({ user, params, body }) => {
    const p = await loadProduct(accessCnpj(user), params.id);
    const f = productFields(body);
    const offers = await parseOffers(p.cnpj, body.offers);
    const img = body.photo && String(body.photo).startsWith('data:') ? parseImage(body.photo) : null;
    await db.tx(async (q) => {
      let photo = p.photo;
      if (body.photo === null) photo = null;
      else if (img) photo = await saveImage(q, img, p.cnpj);
      await q.run(`UPDATE products SET name = ?, photo = ?, price_brl = ?, units_per_40hq = ?, notes = ?, updated_by = ?, updated_at = ?
                   WHERE id = ?`, [f.name, photo, f.price_brl, f.units_per_40hq, f.notes, user.id, now(), p.id]);
      await replaceOffers(q, p.id, offers);
      if (photo !== p.photo) await removeImage(q, p.cnpj, p.photo);
    });
    return productResponse(p.cnpj, p.id);
  });

  route('DELETE', '/api/products/:id', async ({ user, params }) => {
    const p = await loadProduct(accessCnpj(user), params.id);
    await db.tx(async (q) => {
      await q.run('DELETE FROM products WHERE id = ?', [p.id]);
      await removeImage(q, p.cnpj, p.photo);
    });
    return { ok: true };
  });

  // --- relatório / ranking ---

  route('GET', '/api/ranking', async ({ user, query }) => {
    const cnpj = listCnpj(user, query);
    const products = await db.all(`
      SELECT p.id, p.cnpj, p.name, p.photo, p.price_brl, p.units_per_40hq, c.name AS company_name, c.exchange_rate
      FROM products p JOIN companies c ON c.cnpj = p.cnpj
      WHERE 1 = 1${companyFilter('p', cnpj)}`, companyParam(cnpj));
    const offers = await offersFor(cnpj, products.map((p) => p.id));
    const freight = await freight40hq();

    // Cada empresa tem seu próprio câmbio: calcula por empresa e junta o resultado.
    const byCompany = new Map();
    for (const p of products) {
      if (!byCompany.has(p.cnpj)) byCompany.set(p.cnpj, []);
      byCompany.get(p.cnpj).push(p);
    }
    const items = [];
    for (const list of byCompany.values()) {
      const ids = new Set(list.map((p) => p.id));
      const ranked = buildRanking(list, offers.filter((o) => ids.has(o.product_id)), list[0].exchange_rate, freight);
      const meta = new Map(list.map((p) => [p.id, p]));
      for (const r of ranked) {
        items.push({ ...r, photo: photoUrl(r.photo), company_cnpj: meta.get(r.product_id).cnpj, company_name: meta.get(r.product_id).company_name });
      }
    }
    items.sort((a, b) => {
      if (a.saving_pct === null && b.saving_pct === null) return a.name.localeCompare(b.name);
      if (a.saving_pct === null) return 1;
      if (b.saving_pct === null) return -1;
      return b.saving_pct - a.saving_pct;
    });

    // Resumo por fornecedor: em quantos produtos ele é a melhor opção.
    const suppliers = new Map();
    for (const it of items) {
      if (!it.best) continue;
      const s = suppliers.get(it.best.supplier_id) || {
        supplier_id: it.best.supplier_id, name: it.best.supplier_name, booth: it.best.supplier_booth,
        company_cnpj: it.company_cnpj, company_name: it.company_name,
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

    const own = await getCompany(cnpj || user.cnpj);
    return {
      exchange_rate: own.exchange_rate,
      company: cnpj ? { cnpj, name: own.name } : null,
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

  async function serveUpload(res, user, id) {
    const img = /^[0-9a-f]{32}$/.test(id)
      ? await db.get(`SELECT mime, data FROM images WHERE id = ?${isAdmin(user) ? '' : ' AND cnpj = ?'}`,
        isAdmin(user) ? [id] : [id, user.cnpj])
      : null;
    if (!img) return send(res, 404, { error: 'Não encontrado.' });
    const data = Buffer.from(img.data);
    // O id é único por foto, então pode ficar em cache indefinidamente.
    res.writeHead(200, { 'Content-Type': img.mime, 'Content-Length': data.length, 'Cache-Control': 'private, max-age=31536000, immutable' });
    res.end(data);
  }

  function serveFile(res, file, type) {
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { send(res, 404, { error: 'Não encontrado.' }); return; }
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
      fs.createReadStream(file).pipe(res);
    });
  }

  function serveStatic(res, pathname) {
    if (!publicDir) return send(res, 404, { error: 'Não encontrado.' });
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
    const file = path.normalize(path.join(publicDir, rel));
    if (!file.startsWith(publicDir + path.sep)) return send(res, 404, { error: 'Não encontrado.' });
    const type = STATIC_TYPES[path.extname(file)];
    if (!type || !fs.existsSync(file)) {
      // SPA: qualquer rota desconhecida devolve o index.
      return serveFile(res, path.join(publicDir, 'index.html'), STATIC_TYPES['.html']);
    }
    serveFile(res, file, type);
  }

  // ---------- handler principal ----------

  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    // Na Vercel as rotas chegam reescritas para a função com o caminho original em ?__p=
    const pathname = url.searchParams.get('__p') || url.pathname;
    try {
      if (pathname.startsWith('/uploads/')) {
        const sessionUser = await auth.getSessionUser(db, parseCookies(req).sid);
        if (!sessionUser) return send(res, 401, { error: 'Não autenticado.' });
        const user = withRole(sessionUser);
        return await serveUpload(res, user, pathname.slice('/uploads/'.length));
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
        const sessionUser = await auth.getSessionUser(db, parseCookies(req).sid);
        if (!r.pub && !sessionUser) throw new HttpError(401, 'Não autenticado.');
        const user = sessionUser && withRole(sessionUser);
        // Mantém a cotação do dia atualizada (usa cache; busca nas APIs no máximo a cada 30 min).
        if (user && fx && req.method === 'GET') await fx.ensureFresh().catch((err) => console.error(err));
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
