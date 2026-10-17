'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const cnpjUtil = require('./cnpj');
const auth = require('./auth');
const { buildRanking, estimateBrl, round2, round4, freightPerUnit, offerFreight } = require('./calc');
const { OcrError, PRICES, CONFIG_ID, configLabel, envModel } = require('./ocr');
const ocrBench = require('./bench/ocr-bench');
const { fetchCnyBrl } = require('./fx');
const { registerCredits } = require('./credits');
const { parseItineraryXlsx, normalizeDays } = require('./itinerary');
const PROVINCES = require('../public/provinces');

// A Vercel limita o corpo da requisição a 4,5 MB; as fotos são reduzidas no navegador.
const MAX_BODY = 4 * 1024 * 1024;
// Tipo real da imagem pelos primeiros bytes (não confia no que o cliente declara).
function sniffImage(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}
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

// Cabeçalhos de segurança: só scripts do próprio site, mapa da feira em iframe,
// página não pode ser embutida em outros sites.
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self'; frame-src https://365.cantonfair.org.cn; " +
    "worker-src 'self'; manifest-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
};

// Valor devolvido por rotas que já escreveram a resposta (ex.: download de arquivo).
const RAW = Symbol('raw-response');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const now = () => new Date().toISOString();

// background(promise): mantém trabalho rodando depois da resposta (na Vercel usa waitUntil).
function createApp({ db, publicDir, fetchCny = fetchCnyBrl, cnpjLookup = cnpjUtil.lookup, cnpjOnlineCheck = true, secureCookies = false, adminEmails = [], readCard = null, readProducts = null, benchReaders = null, asaas = null, interpret = null, asaasWebhookToken = null, fx = null, background = (p) => p.catch(() => {}) }) {
  const ADMIN_EMAILS = new Set(adminEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const loginLimiter = auth.createRateLimiter();                                     // IP + e-mail
  const emailLimiter = auth.createRateLimiter({ max: 30 });                          // e-mail, de qualquer IP
  const cnpjLimiter = auth.createRateLimiter({ max: 60 });                           // consultas públicas de CNPJ por IP
  const ocrLimiter = auth.createRateLimiter({ max: 60, windowMs: 60 * 60_000 });     // leituras de cartão por usuário/hora
  const clientIp = (req) => String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')
    .split(',')[0].trim();

  // ---------- utilidades HTTP ----------

  function send(res, status, body, headers = {}) {
    const payload = body === undefined ? '' : JSON.stringify(body);
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
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
      if (i <= 0) continue;
      const raw = part.slice(i + 1).trim();
      // Um cookie malformado (ex.: "%E0") de outro site não pode derrubar todas as requisições.
      try { out[part.slice(0, i).trim()] = decodeURIComponent(raw); } catch { out[part.slice(0, i).trim()] = raw; }
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
    const m = /^data:image\/[a-z]+;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    const data = m ? Buffer.from(m[1], 'base64') : null;
    const mime = data && sniffImage(data);
    if (!mime) throw new HttpError(400, 'Imagem inválida (use JPG, PNG ou WEBP).');
    return { mime, data };
  }

  // Miniatura opcional enviada pelo navegador junto com a foto (usada nas listas).
  function parseThumb(dataUrl) {
    if (!dataUrl) return null;
    try { const t = parseImage(dataUrl); return t.data.length <= 200_000 ? t : null; } catch { return null; }
  }

  async function saveImage(q, img, cnpj, thumb = null) {
    const id = crypto.randomBytes(16).toString('hex');
    await q.run('INSERT INTO images (id, cnpj, mime, data, thumb, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, cnpj, img.mime, img.data, thumb?.data ?? null, now()]);
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
      phone_whatsapp: !!Number(s.phone_whatsapp), phone_wechat: !!Number(s.phone_wechat),
      address: s.address ?? null, province: s.province ?? null,
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
  // Frete 40HQ (configuração global, muda raramente): guardado por 60 s em cada instância.
  let freightCache = null;
  async function freight40hq() {
    if (freightCache && Date.now() - freightCache.at < 60_000) return freightCache.value;
    const row = await db.get("SELECT value FROM app_settings WHERE key = 'freight_40hq_usd'");
    freightCache = { value: row?.value != null ? Number(row.value) : 0, at: Date.now() };
    return freightCache.value;
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
    // Todos os fornecedores das ofertas precisam ser da empresa do produto (uma consulta só).
    if (seen.size) {
      const ids = [...seen];
      const found = await db.all(`SELECT id FROM suppliers WHERE cnpj = ? AND id IN (${ids.map(() => '?').join(', ')})`, [cnpj, ...ids]);
      if (found.length !== ids.length) throw new HttpError(404, 'Fornecedor não encontrado.');
    }
    return out;
  }

  async function replaceOffers(q, productId, offers) {
    await q.run('DELETE FROM offers WHERE product_id = ?', [productId]);
    if (!offers.length) return;
    await q.run(`INSERT INTO offers (product_id, supplier_id, price_usd, moq, incoterm, nationalization_pct)
                 VALUES ${offers.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')}`,
      offers.flatMap((o) => [productId, o.supplier_id, o.price_usd, o.moq, o.incoterm, o.nationalization_pct]));
  }

  // ---------- rotas ----------

  const routes = [];
  let lastFxCheck = 0;
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
    const [company, members, companies, fxStatus, settings] = await Promise.all([
      getCompany(user.cnpj),
      db.all('SELECT name, email FROM users WHERE cnpj = ? ORDER BY lower(name)', [user.cnpj]),
      isAdmin(user) ? db.all('SELECT cnpj, name, exchange_rate FROM companies ORDER BY lower(coalesce(name, cnpj))') : undefined,
      fx ? fx.read() : null,
      getSettings(),
    ]);
    return {
      user: {
        id: user.id, name: user.name, email: user.email, role: user.role || 'user', is_admin: isAdmin(user),
        card_photo: photoUrl(user.card_photo),
      },
      company: {
        cnpj: company.cnpj, cnpj_formatted: cnpjUtil.format(company.cnpj),
        name: company.name, exchange_rate: company.exchange_rate, members,
        rate_mode: company.rate_mode, rate_source: company.rate_source, rate_updated_at: company.rate_updated_at,
      },
      fx: fxStatus,
      settings,
      companies: companies?.map((c) => ({ ...c, cnpj_formatted: cnpjUtil.format(c.cnpj) })),
      features: { card_ocr: Boolean(readCard), product_ocr: Boolean(readProducts), interpreter: Boolean(interpret), payments: Boolean(asaas) },
    };
  }

  // --- autenticação ---

  route('POST', '/api/cnpj/check', async ({ body, req }) => {
    if (!cnpjLimiter.hit(clientIp(req))) throw new HttpError(429, 'Muitas consultas. Tente novamente em alguns minutos.');
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

    const passwordHash = await auth.hashPassword(password);
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
    const key = `${clientIp(req)}|${email}`;
    if (!loginLimiter.hit(key) || !emailLimiter.hit(email)) throw new HttpError(429, 'Muitas tentativas. Tente novamente em alguns minutos.');
    const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
    // Sempre calcula o hash (mesmo sem usuário) para o tempo de resposta não revelar e-mails cadastrados.
    if (!(await auth.verifyPassword(password, user?.password_hash)) || !user) {
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
    freightCache = null;
    if (freight !== null && freight > 1_000_000) throw new HttpError(400, 'Valor do frete internacional 40HQ inválido.');
    await db.run(`INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ('freight_40hq_usd', ?, ?, ?)
                  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      [freight === null ? null : String(freight), user.id, now()]);
    return meOut(user);
  });

  // Cartão de visitas do próprio usuário (para mostrar/compartilhar com fornecedores).
  route('PUT', '/api/me/card', async ({ user, body }) => {
    const img = parseImage(body.image);
    const old = (await db.get('SELECT card_photo FROM users WHERE id = ?', [user.id]))?.card_photo;
    const id = await db.tx(async (q) => {
      const photo = await saveImage(q, img, user.cnpj);
      await q.run('UPDATE users SET card_photo = ? WHERE id = ?', [photo, user.id]);
      await removeImage(q, user.cnpj, old);
      return photo;
    });
    return meOut({ ...user, card_photo: id });
  });

  route('DELETE', '/api/me/card', async ({ user }) => {
    const old = (await db.get('SELECT card_photo FROM users WHERE id = ?', [user.id]))?.card_photo;
    await db.tx(async (q) => {
      await q.run('UPDATE users SET card_photo = NULL WHERE id = ?', [user.id]);
      await removeImage(q, user.cnpj, old);
    });
    return meOut({ ...user, card_photo: null });
  });

  // --- administração: usuários e empresas (somente administrador) ---

  function requireAdminUser(user) {
    if (!isAdmin(user)) throw new HttpError(403, 'Apenas administradores podem gerenciar usuários e empresas.');
  }

  // Colunas que registram quem criou/alterou algo; são limpas ao excluir o usuário.
  const USER_REFS = [
    ['suppliers', 'created_by'], ['suppliers', 'updated_by'], ['products', 'created_by'], ['products', 'updated_by'],
    ['itineraries', 'created_by'], ['itineraries', 'updated_by'], ['app_settings', 'updated_by'],
  ];

  route('GET', '/api/admin/users', async ({ user }) => {
    requireAdminUser(user);
    const rows = await db.all(`
      SELECT u.id, u.name, u.email, u.role, u.cnpj, u.created_at, c.name AS company_name
      FROM users u JOIN companies c ON c.cnpj = u.cnpj ORDER BY lower(u.name)`);
    return rows.map((r) => ({
      ...withRole(r), cnpj_formatted: cnpjUtil.format(r.cnpj), is_self: r.id === user.id,
      // Admin definido por ADMIN_EMAILS continua admin mesmo se excluído e recadastrado.
      admin_by_config: ADMIN_EMAILS.has(String(r.email).toLowerCase()),
    }));
  });

  route('GET', '/api/admin/companies', async ({ user }) => {
    requireAdminUser(user);
    const rows = await db.all(`
      SELECT c.cnpj, c.name, c.created_at,
        (SELECT COUNT(*) FROM users u WHERE u.cnpj = c.cnpj) AS users,
        (SELECT COUNT(*) FROM suppliers s WHERE s.cnpj = c.cnpj) AS suppliers,
        (SELECT COUNT(*) FROM products p WHERE p.cnpj = c.cnpj) AS products,
        (SELECT COUNT(*) FROM itineraries i WHERE i.cnpj = c.cnpj) AS itineraries
      FROM companies c ORDER BY lower(coalesce(c.name, c.cnpj))`);
    return rows.map((r) => ({
      cnpj: r.cnpj, cnpj_formatted: cnpjUtil.format(r.cnpj), name: r.name, created_at: r.created_at,
      users: Number(r.users), suppliers: Number(r.suppliers), products: Number(r.products), itineraries: Number(r.itineraries),
    }));
  });

  // Muda a empresa (CNPJ) do usuário. Ele passa a ver os dados da nova empresa na hora.
  route('PUT', '/api/admin/users/:id', async ({ user, params, body }) => {
    requireAdminUser(user);
    const target = await db.get('SELECT id, cnpj, card_photo FROM users WHERE id = ?', [toId(params.id)]);
    if (!target) throw new HttpError(404, 'Usuário não encontrado.');
    const cnpj = cnpjUtil.clean(body.cnpj);
    if (!(await getCompany(cnpj))) throw new HttpError(400, 'Empresa não encontrada.');
    if (cnpj !== target.cnpj) {
      await db.tx(async (q) => {
        await q.run('UPDATE users SET cnpj = ? WHERE id = ?', [cnpj, target.id]);
        // O cartão de visitas pessoal acompanha o usuário.
        if (target.card_photo) await q.run('UPDATE images SET cnpj = ? WHERE id = ?', [cnpj, target.card_photo]);
      });
    }
    return { ok: true };
  });

  route('DELETE', '/api/admin/users/:id', async ({ user, params }) => {
    requireAdminUser(user);
    const target = await db.get('SELECT id, cnpj, card_photo FROM users WHERE id = ?', [toId(params.id)]);
    if (!target) throw new HttpError(404, 'Usuário não encontrado.');
    if (target.id === user.id) throw new HttpError(400, 'Você não pode excluir o seu próprio usuário.');
    await db.tx(async (q) => {
      for (const [table, col] of USER_REFS) await q.run(`UPDATE ${table} SET ${col} = NULL WHERE ${col} = ?`, [target.id]);
      await q.run('DELETE FROM sessions WHERE user_id = ?', [target.id]);
      await q.run('DELETE FROM expenses WHERE user_id = ?', [target.id]);
      await q.run('DELETE FROM users WHERE id = ?', [target.id]);
      await removeImage(q, target.cnpj, target.card_photo);
    });
    return { ok: true };
  });

  // Exclui a empresa e todos os dados dela (fornecedores, produtos, roteiros, fotos).
  // Só é permitido quando não há mais usuários vinculados a ela.
  route('DELETE', '/api/admin/companies/:cnpj', async ({ user, params }) => {
    requireAdminUser(user);
    const cnpj = cnpjUtil.clean(params.cnpj);
    if (!(await getCompany(cnpj))) throw new HttpError(404, 'Empresa não encontrada.');
    const { n } = await db.get('SELECT COUNT(*) AS n FROM users WHERE cnpj = ?', [cnpj]);
    if (Number(n) > 0) {
      throw new HttpError(409, `Esta empresa ainda tem ${n} usuário(s). Exclua ou mude a empresa deles antes de excluir a empresa.`);
    }
    await db.tx(async (q) => {
      await q.run('DELETE FROM offers WHERE product_id IN (SELECT id FROM products WHERE cnpj = ?)', [cnpj]);
      await q.run('DELETE FROM offers WHERE supplier_id IN (SELECT id FROM suppliers WHERE cnpj = ?)', [cnpj]);
      await q.run('DELETE FROM products WHERE cnpj = ?', [cnpj]);
      await q.run('DELETE FROM suppliers WHERE cnpj = ?', [cnpj]);
      await q.run('DELETE FROM itineraries WHERE cnpj = ?', [cnpj]);
      await q.run('DELETE FROM images WHERE cnpj = ?', [cnpj]);
      await q.run('DELETE FROM companies WHERE cnpj = ?', [cnpj]);
    });
    return { ok: true };
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

  // Província: só aceita as da lista (sem diferenciar maiúsculas); vazio = não informada.
  function provinceName(v) {
    const t = str(v, 50);
    if (!t) return null;
    const p = PROVINCES.find((x) => x.name.toLowerCase() === t.toLowerCase() || x.local === t);
    if (!p) throw new HttpError(400, 'Província inválida.');
    return p.name;
  }

  // Campos opcionais do fornecedor.
  function supplierFields(body) {
    return {
      booth: str(body.booth, 50) || null,
      contact_name: str(body.contact_name, 150) || null,
      phone: str(body.phone, 60) || null,
      // WhatsApp/WeChat só valem com telefone preenchido.
      phone_whatsapp: str(body.phone, 60) && body.phone_whatsapp === true ? 1 : 0,
      phone_wechat: str(body.phone, 60) && body.phone_wechat === true ? 1 : 0,
      address: str(body.address, 500) || null,
      province: provinceName(body.province),
      notes: str(body.notes, 2000) || null,
    };
  }

  // Lê a foto do cartão de visita e devolve os campos para preencher o cadastro.
  route('POST', '/api/ocr/card', async ({ body, user }) => {
    if (!readCard) throw new HttpError(503, 'Leitor de cartões não configurado (defina ANTHROPIC_API_KEY na Vercel).');
    if (!ocrLimiter.hit(String(user.id))) throw new HttpError(429, 'Muitas leituras de cartão em pouco tempo. Tente mais tarde.');
    const img = parseImage(body.image);
    try {
      return await readCard(img.mime, img.data.toString('base64'));
    } catch (err) {
      if (err instanceof OcrError) throw new HttpError(err.status, err.message);
      throw err;
    }
  });

  // Lê a foto de um produto, etiqueta, catálogo ou tabela de preços e devolve os produtos encontrados.
  route('POST', '/api/ocr/product', async ({ body, user }) => {
    if (!readProducts) throw new HttpError(503, 'Leitor de fotos não configurado (defina ANTHROPIC_API_KEY na Vercel).');
    if (!ocrLimiter.hit(String(user.id))) throw new HttpError(429, 'Muitas leituras de foto em pouco tempo. Tente mais tarde.');
    const img = parseImage(body.image);
    try {
      return await readProducts(img.mime, img.data.toString('base64'));
    } catch (err) {
      if (err instanceof OcrError) throw new HttpError(err.status, err.message);
      throw err;
    }
  });

  // --- teste de modelos de leitura (administrador) ---
  function requireBench(user) {
    requireAdminUser(user);
    if (!benchReaders) throw new HttpError(503, 'Leitor de fotos não configurado (defina ANTHROPIC_API_KEY na Vercel).');
  }
  // "em uso": a configuração com reserva, ou o modelo único quando não há reserva.
  const benchModels = () => Object.keys(benchReaders || {}).map((id) => ({
    id, label: id === CONFIG_ID ? configLabel() : PRICES[id]?.label || id,
    input: PRICES[id]?.input ?? null, output: PRICES[id]?.output ?? null,
    current: CONFIG_ID in benchReaders ? id === CONFIG_ID : id === envModel(),
  }));
  route('GET', '/api/admin/ocr-bench', async ({ user }) => {
    requireBench(user);
    return { models: benchModels(), samples: ocrBench.sampleList() };
  });
  // Uma foto de teste por vez (cada uma roda em todos os modelos ao mesmo tempo).
  route('POST', '/api/admin/ocr-bench/:id', async ({ user, params }) => {
    requireBench(user);
    const r = await ocrBench.runSample(benchReaders, params.id);
    if (!r) throw new HttpError(404, 'Foto de teste não encontrada.');
    return r;
  });
  // Foto do próprio administrador (cartão ou produto), lida por todos os modelos, lado a lado.
  route('POST', '/api/admin/ocr-compare', async ({ user, body }) => {
    requireBench(user);
    const kind = body.kind === 'product' ? 'product' : 'card';
    const img = parseImage(body.image);
    return { kind, results: await ocrBench.runModels(benchReaders, kind, img.mime, img.data.toString('base64')) };
  });

  // Identificador do cadastro gerado no celular (reenvio sem internet não duplica).
  const clientRef = (v) => (/^[\w-]{8,64}$/.test(String(v ?? '')) ? String(v) : null);
  const findByRef = (table, cnpj, ref) => (ref ? db.get(`SELECT id FROM ${table} WHERE cnpj = ? AND client_ref = ?`, [cnpj, ref]) : null);
  const isUniqueViolation = (err) => err?.code === '23505' || /UNIQUE constraint/i.test(err?.message || '');

  route('POST', '/api/suppliers', async ({ user, body }) => {
    const name = str(body.name, 150);
    if (!name) throw new HttpError(400, 'Informe o nome do fornecedor.');
    const cnpj = await targetCnpj(user, body);
    const ref = clientRef(body.client_ref);
    const dup = await findByRef('suppliers', cnpj, ref);
    if (dup) return supplierOut(await loadSupplier(db, cnpj, dup.id)); // já recebido antes
    const img = body.card_photo ? parseImage(body.card_photo) : null; // foto do cartão é opcional
    const thumb = img ? parseThumb(body.card_photo_thumb) : null;
    const f = supplierFields(body);
    const id = await db.tx(async (q) => {
      const photo = img ? await saveImage(q, img, cnpj, thumb) : null;
      const t = now();
      const row = await q.get(`INSERT INTO suppliers (cnpj, name, card_photo, booth, contact_name, phone, phone_whatsapp, phone_wechat, address, province, notes,
                                                     client_ref, created_by, updated_by, created_at, updated_at)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        [cnpj, name, photo, f.booth, f.contact_name, f.phone, f.phone_whatsapp, f.phone_wechat, f.address, f.province, f.notes, ref, user.id, user.id, t, t]);
      return row.id;
    }).catch(async (err) => {
      const again = isUniqueViolation(err) && await findByRef('suppliers', cnpj, ref);
      if (again) return { existing: again.id };
      throw err;
    });
    if (id?.existing) return supplierOut(await loadSupplier(db, cnpj, id.existing));
    return { status: 201, body: supplierOut(await loadSupplier(db, cnpj, id)) };
  });

  route('PUT', '/api/suppliers/:id', async ({ user, params, body }) => {
    const s = await loadSupplier(db, accessCnpj(user), params.id);
    const name = str(body.name, 150);
    if (!name) throw new HttpError(400, 'Informe o nome do fornecedor.');
    const img = body.card_photo && String(body.card_photo).startsWith('data:') ? parseImage(body.card_photo) : null;
    await db.tx(async (q) => {
      let photo = s.card_photo;
      // Foto nova substitui a antiga; remove_card_photo só tira a foto (os dados ficam).
      const removing = img || body.remove_card_photo === true;
      if (img) photo = await saveImage(q, img, s.cnpj, parseThumb(body.card_photo_thumb));
      else if (removing) photo = null;
      const f = supplierFields(body);
      await q.run(`UPDATE suppliers SET name = ?, card_photo = ?, booth = ?, contact_name = ?, phone = ?, phone_whatsapp = ?, phone_wechat = ?,
                   address = ?, province = ?, notes = ?, updated_by = ?, updated_at = ? WHERE id = ?`,
        [name, photo, f.booth, f.contact_name, f.phone, f.phone_whatsapp, f.phone_wechat, f.address, f.province, f.notes, user.id, now(), s.id]);
      if (removing) await removeImage(q, s.cnpj, s.card_photo);
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
    // Versão leve (só nomes), usada pelos formulários para avisar de produto repetido.
    if (query.get('fields') === 'names') {
      const rows = await db.all(`SELECT p.id, p.name, p.cnpj, (SELECT COUNT(*) FROM offers o WHERE o.product_id = p.id) AS offer_count
        FROM products p WHERE 1 = 1${companyFilter('p', cnpj)} ORDER BY lower(p.name)`, companyParam(cnpj));
      return rows.map((r) => ({ id: r.id, name: r.name, company_cnpj: r.cnpj, offer_count: Number(r.offer_count) }));
    }
    const products = await db.all(`
      SELECT p.*, u.name AS updated_by_name, c.name AS company_name, c.exchange_rate
      FROM products p LEFT JOIN users u ON u.id = p.updated_by
      JOIN companies c ON c.cnpj = p.cnpj
      WHERE 1 = 1${companyFilter('p', cnpj)} ORDER BY lower(p.name)`, companyParam(cnpj));
    const offers = await offersFor(cnpj, products.map((p) => p.id));
    const freight = await freight40hq();
    const byProduct = Map.groupBy(offers, (o) => o.product_id);
    return products.map((p) => productOut(p, byProduct.get(p.id) || [], p.exchange_rate, freight));
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
    const ref = clientRef(body.client_ref);
    const dup = await findByRef('products', cnpj, ref);
    if (dup) return productResponse(cnpj, dup.id); // já recebido antes
    // Fornecedores das ofertas precisam ser da mesma empresa do produto.
    const offers = await parseOffers(cnpj, body.offers);
    const img = body.photo ? parseImage(body.photo) : null;
    const id = await db.tx(async (q) => {
      const photo = img ? await saveImage(q, img, cnpj, parseThumb(body.photo_thumb)) : null;
      const t = now();
      const row = await q.get(`INSERT INTO products (cnpj, name, photo, price_brl, units_per_40hq, notes, client_ref, created_by, updated_by, created_at, updated_at)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        [cnpj, f.name, photo, f.price_brl, f.units_per_40hq, f.notes, ref, user.id, user.id, t, t]);
      await replaceOffers(q, row.id, offers);
      return row.id;
    }).catch(async (err) => {
      const again = isUniqueViolation(err) && await findByRef('products', cnpj, ref);
      if (again) return { existing: again.id };
      throw err;
    });
    if (id?.existing) return productResponse(cnpj, id.existing);
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
      else if (img) photo = await saveImage(q, img, p.cnpj, parseThumb(body.photo_thumb));
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

  registerCredits({
    route, db, HttpError, str, num, now, toId, isAdmin, asaas, interpret, webhookToken: asaasWebhookToken,
    getCompany: (cnpj) => db.get('SELECT * FROM companies WHERE cnpj = ?', [cnpj]),
  });

  // --- controle de viagem (despesas de cada usuário) ---
  // O extrato é pessoal: cada usuário só vê e altera as próprias despesas (o administrador também).

  const EXPENSE_CATEGORIES = ['hospedagem', 'alimentacao', 'transporte', 'passagens', 'feira', 'amostras', 'comunicacao', 'compras', 'outros'];
  const PAYMENTS = ['cartao', 'dinheiro', 'alipay', 'wechat', 'outro'];
  const CURRENCIES = ['CNY', 'BRL', 'USD'];
  const round2x = (n) => Math.round(n * 100) / 100;

  function expenseOut(e) {
    return {
      id: e.id, spent_on: e.spent_on, description: e.description, category: e.category, payment: e.payment ?? null,
      amount: Number(e.amount), currency: e.currency, rate_brl: Number(e.rate_brl), amount_brl: Number(e.amount_brl),
      created_at: e.created_at, updated_at: e.updated_at,
    };
  }

  function expenseFields(body) {
    const description = str(body.description, 200);
    if (!description) throw new HttpError(400, 'Informe a descrição da despesa.');
    const spentOn = str(body.spent_on, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(spentOn) || Number.isNaN(Date.parse(`${spentOn}T00:00:00Z`))) throw new HttpError(400, 'Data inválida.');
    const category = EXPENSE_CATEGORIES.includes(body.category) ? body.category : null;
    if (!category) throw new HttpError(400, 'Escolha a categoria.');
    const payment = body.payment ? (PAYMENTS.includes(body.payment) ? body.payment : null) : null;
    if (body.payment && !payment) throw new HttpError(400, 'Forma de pagamento inválida.');
    const currency = String(body.currency || '').toUpperCase();
    if (!CURRENCIES.includes(currency)) throw new HttpError(400, 'Moeda inválida.');
    const amount = num(body.amount, 'o valor', { required: true });
    if (!(amount > 0) || amount > 1e9) throw new HttpError(400, 'Valor inválido.');
    const rate = currency === 'BRL' ? 1 : num(body.rate_brl, 'o câmbio para reais', { required: true });
    if (!(rate > 0) || rate > 100) throw new HttpError(400, 'Câmbio para reais inválido.');
    return { spent_on: spentOn, description, category, payment, amount: round2x(amount), currency, rate_brl: rate, amount_brl: round2x(amount * rate) };
  }

  async function loadExpense(user, id) {
    const e = await db.get('SELECT * FROM expenses WHERE id = ? AND user_id = ?', [toId(id), user.id]);
    if (!e) throw new HttpError(404, 'Despesa não encontrada.');
    return e;
  }

  route('GET', '/api/expenses', async ({ user }) => {
    const rows = await db.all('SELECT * FROM expenses WHERE user_id = ? ORDER BY spent_on DESC, id DESC', [user.id]);
    return rows.map(expenseOut);
  });

  route('POST', '/api/expenses', async ({ user, body }) => {
    const f = expenseFields(body);
    const ref = clientRef(body.client_ref);
    const findRef = () => (ref ? db.get('SELECT * FROM expenses WHERE user_id = ? AND client_ref = ?', [user.id, ref]) : null);
    const dup = await findRef();
    if (dup) return expenseOut(dup); // já recebido antes (reenvio sem internet)
    const t = now();
    try {
      const row = await db.get(`INSERT INTO expenses (user_id, spent_on, description, category, payment, amount, currency, rate_brl, amount_brl, client_ref, created_at, updated_at)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
        [user.id, f.spent_on, f.description, f.category, f.payment, f.amount, f.currency, f.rate_brl, f.amount_brl, ref, t, t]);
      return { status: 201, body: expenseOut(row) };
    } catch (err) {
      const again = isUniqueViolation(err) && await findRef();
      if (again) return expenseOut(again);
      throw err;
    }
  });

  route('PUT', '/api/expenses/:id', async ({ user, params, body }) => {
    const e = await loadExpense(user, params.id);
    const f = expenseFields(body);
    const row = await db.get(`UPDATE expenses SET spent_on = ?, description = ?, category = ?, payment = ?, amount = ?, currency = ?,
                                rate_brl = ?, amount_brl = ?, updated_at = ? WHERE id = ? RETURNING *`,
      [f.spent_on, f.description, f.category, f.payment, f.amount, f.currency, f.rate_brl, f.amount_brl, now(), e.id]);
    return expenseOut(row);
  });

  route('DELETE', '/api/expenses/:id', async ({ user, params }) => {
    const e = await loadExpense(user, params.id);
    await db.run('DELETE FROM expenses WHERE id = ?', [e.id]);
    return { ok: true };
  });

  // Câmbio sugerido para o lançamento: dólar da empresa e yuan do dia (guardado 1 h).
  let cnyCache = null;
  route('GET', '/api/fx/rates', async ({ user }) => {
    const company = await getCompany(user.cnpj);
    if (!cnyCache || Date.now() - cnyCache.at > 3600_000) {
      const q = await fetchCny().catch(() => null);
      if (q) cnyCache = { ...q, at: Date.now() };
    }
    const usd = Number(company?.exchange_rate) || null;
    return {
      USD: usd, BRL: 1,
      // Sem cotação do yuan: estimativa pelo dólar (1 US$ ≈ 7,2 ¥), avisada na tela.
      CNY: cnyCache?.rate ?? (usd ? Math.round((usd / 7.2) * 10000) / 10000 : null),
      cny_source: cnyCache ? cnyCache.source : 'estimado pelo dólar',
    };
  });

  // --- roteiros de viagem ---

  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  function parseXlsxUpload(dataUrl) {
    const m = /^data:([\w./+-]*);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!m) throw new HttpError(400, 'Envie a planilha do roteiro (.xlsx).');
    const buf = Buffer.from(m[2], 'base64');
    // Todo .xlsx é um arquivo ZIP (começa com "PK").
    if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) throw new HttpError(400, 'Arquivo inválido: envie uma planilha Excel .xlsx (não .xls nem .csv).');
    return buf;
  }

  async function readItinerary(buf) {
    try {
      return await parseItineraryXlsx(buf);
    } catch (err) {
      if (err.status) throw new HttpError(err.status, err.message);
      throw err;
    }
  }

  function requireAdmin(user, message = 'Apenas administradores podem alterar roteiros.') {
    if (!isAdmin(user)) throw new HttpError(403, message);
  }

  function itineraryOut(r, { full = false } = {}) {
    const days = JSON.parse(r.days);
    return {
      id: r.id, title: r.title, company_cnpj: r.cnpj, company_name: r.company_name ?? null,
      start_date: r.start_date, end_date: r.end_date, file_name: r.file_name,
      day_count: days.length, item_count: days.reduce((n, d) => n + d.items.length, 0),
      updated_at: r.updated_at, updated_by_name: r.updated_by_name ?? null,
      ...(full ? { days } : {}),
    };
  }

  async function loadItinerary(user, id) {
    const cnpj = accessCnpj(user);
    const r = await db.get(`
      SELECT i.id, i.cnpj, i.title, i.days, i.start_date, i.end_date, i.file_name, i.updated_at,
             c.name AS company_name, u.name AS updated_by_name
      FROM itineraries i JOIN companies c ON c.cnpj = i.cnpj LEFT JOIN users u ON u.id = i.updated_by
      WHERE i.id = ?${companyFilter('i', cnpj)}`, [toId(id), ...companyParam(cnpj)]);
    if (!r) throw new HttpError(404, 'Roteiro não encontrado.');
    return r;
  }

  route('GET', '/api/itineraries', async ({ user, query }) => {
    const cnpj = listCnpj(user, query);
    const rows = await db.all(`
      SELECT i.id, i.cnpj, i.title, i.days, i.start_date, i.end_date, i.file_name, i.updated_at,
             c.name AS company_name, u.name AS updated_by_name
      FROM itineraries i JOIN companies c ON c.cnpj = i.cnpj LEFT JOIN users u ON u.id = i.updated_by
      WHERE 1 = 1${companyFilter('i', cnpj)}
      ORDER BY coalesce(i.start_date, i.created_at) DESC, i.id DESC`, companyParam(cnpj));
    return rows.map((r) => itineraryOut(r));
  });

  route('GET', '/api/itineraries/:id', async ({ user, params }) => itineraryOut(await loadItinerary(user, params.id), { full: true }));

  route('POST', '/api/itineraries', async ({ user, body }) => {
    requireAdmin(user);
    const cnpj = await targetCnpj(user, body);
    const buf = parseXlsxUpload(body.file);
    const parsed = await readItinerary(buf);
    const title = str(body.title, 120) || parsed.title || str(body.file_name, 120).replace(/\.xlsx$/i, '') || 'Roteiro de viagem';
    const t = now();
    const row = await db.get(`INSERT INTO itineraries (cnpj, title, days, start_date, end_date, file_name, file_data, created_by, updated_by, created_at, updated_at)
                              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      [cnpj, title, JSON.stringify(parsed.days), parsed.start_date, parsed.end_date, str(body.file_name, 200) || 'roteiro.xlsx', buf, user.id, user.id, t, t]);
    return { status: 201, body: itineraryOut(await loadItinerary(user, row.id), { full: true }) };
  });

  // Edição: título, nova planilha (substitui tudo) e/ou dias editados na tela.
  route('PUT', '/api/itineraries/:id', async ({ user, params, body }) => {
    requireAdmin(user);
    const it = await loadItinerary(user, params.id);
    let days = JSON.parse(it.days);
    let fileName = it.file_name;
    let fileData = null;
    if (body.file) {
      fileData = parseXlsxUpload(body.file);
      days = (await readItinerary(fileData)).days;
      fileName = str(body.file_name, 200) || fileName;
    } else if (body.days !== undefined) {
      try { days = normalizeDays(body.days).days; } catch (err) { throw new HttpError(400, err.message); }
    }
    const norm = normalizeDays(days);
    const title = str(body.title, 120) || it.title;
    await db.run(`UPDATE itineraries SET title = ?, days = ?, start_date = ?, end_date = ?, file_name = ?,
                    file_data = coalesce(?, file_data), updated_by = ?, updated_at = ? WHERE id = ?`,
      [title, JSON.stringify(norm.days), norm.start_date, norm.end_date, fileName, fileData, user.id, now(), it.id]);
    return itineraryOut(await loadItinerary(user, it.id), { full: true });
  });

  route('DELETE', '/api/itineraries/:id', async ({ user, params }) => {
    requireAdmin(user);
    const it = await loadItinerary(user, params.id);
    await db.run('DELETE FROM itineraries WHERE id = ?', [it.id]);
    return { ok: true };
  });

  // Download da planilha original — só administradores; usuários veem apenas o roteiro visual.
  route('GET', '/api/itineraries/:id/file', async ({ user, params, res }) => {
    requireAdmin(user, 'Apenas administradores podem baixar a planilha original.');
    const it = await loadItinerary(user, params.id);
    const row = await db.get('SELECT file_data FROM itineraries WHERE id = ?', [it.id]);
    if (!row?.file_data) throw new HttpError(404, 'Planilha não encontrada.');
    const data = Buffer.from(row.file_data);
    const name = (it.file_name || 'roteiro.xlsx').replace(/[^\w.\- ]/g, '_');
    res.writeHead(200, {
      'Content-Type': XLSX_MIME, 'Content-Length': data.length, 'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename="${name}"`,
    });
    res.end(data);
    return RAW;
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

    const own = (cnpj && await getCompany(cnpj)) || await getCompany(user.cnpj);
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

  // /uploads/<id> = foto; /uploads/<id>/thumb = miniatura (ou a foto, se não houver miniatura).
  async function serveUpload(res, user, rest) {
    const [id, variant] = rest.split('/');
    const col = variant === 'thumb' ? 'coalesce(thumb, data)' : 'data';
    const img = /^[0-9a-f]{32}$/.test(id) && (!variant || variant === 'thumb')
      ? await db.get(`SELECT mime, ${col} AS data FROM images WHERE id = ?${isAdmin(user) ? '' : ' AND cnpj = ?'}`,
        isAdmin(user) ? [id] : [id, user.cnpj])
      : null;
    if (!img) return send(res, 404, { error: 'Não encontrado.' });
    const data = Buffer.from(img.data);
    // Miniaturas são sempre JPEG; a foto mantém o tipo original.
    if (variant === 'thumb' && sniffImage(data)) img.mime = sniffImage(data);
    // O id é único por foto, então pode ficar em cache indefinidamente.
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': img.mime, 'Content-Length': data.length, 'Cache-Control': 'private, max-age=31536000, immutable' });
    res.end(data);
  }

  function serveFile(res, file, type) {
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { send(res, 404, { error: 'Não encontrado.' }); return; }
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
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
        // Mantém a cotação do dia atualizada sem atrasar a resposta (busca em segundo plano;
        // usa cache de 30 min). Só espera se ainda não existe nenhuma cotação.
        // Confere no máximo uma vez por minuto por instância e sem segurar a resposta.
        if (user && fx && req.method === 'GET' && Date.now() - lastFxCheck > 60_000) {
          lastFxCheck = Date.now();
          background(fx.refreshInBackground(background).catch((err) => console.error(err)));
        }
        // Exigir JSON em POST/PUT também protege contra CSRF via formulários de outros sites.
        if ((req.method === 'POST' || req.method === 'PUT') && !/^application\/json\b/.test(req.headers['content-type'] || '')) {
          throw new HttpError(415, 'Envie os dados em JSON.');
        }
        const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await readJson(req);
        const out = await r.handler({ req, res, user, params, body, query: url.searchParams });
        if (out === RAW) return;
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

module.exports = { createApp, INCOTERMS, SECURITY_HEADERS };
