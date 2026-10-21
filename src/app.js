'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const cnpjUtil = require('./cnpj');
const auth = require('./auth');
const { buildRanking, estimateBrl, round2, round4, freightPerUnit, offerFreight, offerUnits } = require('./calc');
const { buildTemplate, parseProductsXlsx } = require('./product-import');
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
  '.webp': 'image/webp',
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
function createApp({ db, publicDir, fetchCny = fetchCnyBrl, cnpjLookup = cnpjUtil.lookup, cnpjOnlineCheck = true, secureCookies = false, adminEmails = [], readCard = null, readCorners = null, readProducts = null, benchReaders = null, asaas = null, interpret = null, asaasWebhookToken = null, fx = null, background = (p) => p.catch(() => {}) }) {
  const ADMIN_EMAILS = new Set(adminEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  const loginLimiter = auth.createRateLimiter();                                     // IP + e-mail
  const emailLimiter = auth.createRateLimiter({ max: 30 });                          // e-mail, de qualquer IP
  const cnpjLimiter = auth.createRateLimiter({ max: 60 });                           // consultas públicas de CNPJ por IP
  const ocrLimiter = auth.createRateLimiter({ max: 60, windowMs: 60 * 60_000 });     // leituras de cartão por usuário/hora
  const cornerLimiter = auth.createRateLimiter({ max: 200, windowMs: 60 * 60_000 }); // cantos do cartão (consulta leve)
  const clientIp = (req) => String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '')
    .split(',')[0].trim();

  // ---------- utilidades HTTP ----------

  function send(res, status, body, headers = {}) {
    const payload = body === undefined ? '' : JSON.stringify(body);
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(payload);
  }

  // Envio "pacote" do app: [4 bytes = tamanho do JSON][JSON][fotos em binário]. As fotos chegam
  // sem a conversão em texto (base64 aumenta 33%) e viram data URLs aqui, como se viessem no JSON.
  const BUNDLE_TYPE = 'application/vnd.missao.bundle';
  const isBundle = (req) => String(req.headers['content-type'] || '').startsWith(BUNDLE_TYPE);
  function parseBundle(buf) {
    const len = buf.readUInt32LE(0);
    const json = JSON.parse(buf.subarray(4, 4 + len).toString('utf8'));
    const bins = Array.isArray(json.__bins) ? json.__bins : [];
    delete json.__bins;
    let at = 4 + len;
    const parts = bins.map(([mime, size]) => {
      if (!/^image\/(jpeg|png|webp)$/.test(mime) || !Number.isInteger(size) || size < 0 || at + size > buf.length) throw new Error('pacote');
      const part = `data:${mime};base64,${buf.subarray(at, at + size).toString('base64')}`;
      at += size;
      return part;
    });
    const fill = (v) => {
      if (typeof v === 'string') { const m = /^\u0000bin:(\d+)$/.exec(v); return m ? parts[Number(m[1])] ?? null : v; }
      if (Array.isArray(v)) return v.map(fill);
      if (v && typeof v === 'object') { for (const k of Object.keys(v)) v[k] = fill(v[k]); return v; }
      return v;
    };
    return fill(json);
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      let tooBig = false;
      req.on('data', (c) => {
        if (tooBig) return; // descarta o resto (sem fechar a conexão, para o 413 chegar ao app)
        size += c.length;
        if (size > MAX_BODY) { tooBig = true; chunks.length = 0; reject(new HttpError(413, 'Arquivo muito grande.')); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (tooBig) return;
        if (!chunks.length) return resolve({});
        let v;
        try { v = isBundle(req) ? parseBundle(Buffer.concat(chunks)) : JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { return reject(new HttpError(400, 'JSON inválido.')); }
        if (v === null || typeof v !== 'object' || Array.isArray(v)) return reject(new HttpError(400, 'JSON inválido.'));
        resolve(v);
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

  // Link assinado da foto (/uploads/<id>/<assinatura>): abre sem consultar a sessão e pode ficar
  // guardado na CDN da Vercel. Só recebe o link quem tem acesso ao cadastro.
  let uploadKey = null;
  async function ensureUploadKey() {
    if (uploadKey) return;
    if (process.env.UPLOAD_URL_SECRET) { uploadKey = process.env.UPLOAD_URL_SECRET; return; }
    await db.run("INSERT INTO app_settings (key, value, updated_at) VALUES ('upload_url_secret', ?, ?) ON CONFLICT (key) DO NOTHING",
      [crypto.randomBytes(32).toString('hex'), now()]);
    uploadKey = (await db.get("SELECT value FROM app_settings WHERE key = 'upload_url_secret'")).value;
  }
  const uploadSig = (id) => crypto.createHmac('sha256', uploadKey).update(id).digest('base64url').slice(0, 22);
  const photoUrl = (id) => (id ? `/uploads/${id}/${uploadSig(id)}` : null);

  // Sessão lembrada por alguns segundos em cada instância: evita uma ida ao banco por requisição.
  // Quem aguarda aprovação não fica no cache (a aprovação vale na hora).
  const SESSION_TTL = 20_000;
  const sessionCache = new Map();
  async function sessionUserOf(req) {
    const sid = parseCookies(req).sid;
    if (!sid) return null;
    const hit = sessionCache.get(sid);
    if (hit && Date.now() - hit.at < SESSION_TTL) return hit.user;
    const user = await auth.getSessionUser(db, sid);
    if (sessionCache.size > 2000) sessionCache.clear();
    if (user && user.status !== 'pending') sessionCache.set(sid, { user, at: Date.now() });
    else sessionCache.delete(sid);
    return user;
  }
  // Mudanças no usuário (excluir, mudar de empresa, novo cartão) esquecem as sessões dele.
  const forgetUser = (userId) => { for (const [k, v] of sessionCache) if (v.user.id === userId) sessionCache.delete(k); };

  // Fotos por fornecedor: apaga as linhas e as imagens (o ON DELETE CASCADE só apagaria as linhas).
  async function removeOfferPhotos(q, cnpj, where, params) {
    const rows = await q.all(`SELECT id, image_id FROM offer_photos WHERE ${where}`, params);
    if (!rows.length) return;
    await q.run(`DELETE FROM offer_photos WHERE id IN (${rows.map(() => '?').join(',')})`, rows.map((r) => r.id));
    for (const r of rows) await removeImage(q, cnpj, r.image_id);
  }
  const MAX_OFFER_PHOTOS = 12;
  // Foto das listas: a principal do produto ou, sem ela, a primeira foto de fornecedor.
  const listPhotoSql = (alias) => `COALESCE(${alias}.photo, (SELECT op.image_id FROM offer_photos op WHERE op.product_id = ${alias}.id ORDER BY op.id LIMIT 1))`;

  // ---------- consultas ----------

  const getCompany = (cnpj) => db.get('SELECT cnpj, name, exchange_rate, cny_rate, rate_mode, rate_source, rate_updated_at FROM companies WHERE cnpj = ?', [cnpj]);
  // Câmbios da empresa: R$ por ¥ (preços em RMB) e R$ por US$ (preços em dólar e frete).
  // Sem cotação do yuan ainda: estimada pelo dólar (1 US$ ≈ 7,2 ¥) até a próxima atualização.
  const ratesOf = (c) => ({ USD: Number(c.exchange_rate), CNY: Number(c.cny_rate) || round4(Number(c.exchange_rate) / 7.2) });
  const CURRENCIES_OFFER = ['CNY', 'USD'];

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
      card_photo: photoUrl(s.card_photo), card_photo_adjusted: Boolean(s.card_photo_original), card_photo_original: photoUrl(s.card_photo_original), created_at: s.created_at, updated_at: s.updated_at,
      updated_by_name: s.updated_by_name ?? null,
      product_count: s.product_count == null ? undefined : Number(s.product_count),
    };
  }

  // cnpj null = sem restrição de empresa (administrador).
  async function loadSupplier(q, cnpj, id) {
    const s = await q.get(`
      SELECT s.*, u.name AS updated_by_name, c.name AS company_name, c.exchange_rate, c.cny_rate FROM suppliers s
      LEFT JOIN users u ON u.id = s.updated_by
      JOIN companies c ON c.cnpj = s.cnpj
      WHERE s.id = ?${companyFilter('s', cnpj)}`, [toId(id), ...companyParam(cnpj)]);
    if (!s) throw new HttpError(404, 'Fornecedor não encontrado.');
    return s;
  }

  async function loadProduct(cnpj, id) {
    const p = await db.get(`
      SELECT p.*, u.name AS updated_by_name, c.name AS company_name, c.exchange_rate, c.cny_rate FROM products p
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
    const rows = await db.all(`
      SELECT o.*, s.name AS supplier_name, s.booth AS supplier_booth
      FROM offers o
      JOIN suppliers s ON s.id = o.supplier_id
      JOIN products p ON p.id = o.product_id
      WHERE o.product_id IN (${productIds.map(() => '?').join(',')})${companyFilter('p', cnpj)}
    `, [...productIds, ...companyParam(cnpj)]);
    // A coluna price_usd guarda o preço na moeda da oferta (currency).
    return rows.map(({ price_usd: price, ...o }) => ({ ...o, price: Number(price), currency: o.currency || 'USD' }));
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

  function productOut(p, offers, rates, freight = 0, photos = null) {
    const opts = offers
      .map((o) => ({ ...o, units: offerUnits(o, p.units_per_40hq), freight: offerFreight(o.incoterm, freightPerUnit(freight, offerUnits(o, p.units_per_40hq))) }))
      .map((o) => ({
        id: o.id,
        supplier_id: o.supplier_id,
        supplier_name: o.supplier_name,
        supplier_booth: o.supplier_booth,
        price: o.price,
        currency: o.currency,
        moq: o.moq,
        incoterm: o.incoterm,
        nationalization_pct: o.nationalization_pct,
        units_per_box: o.units_per_box ?? null, boxes_per_40hq: o.boxes_per_40hq ?? null, units_per_40hq: o.units ?? null,
        freight_usd: round4(o.freight),
        estimated_brl: round2(estimateBrl(o.price, o.currency, o.nationalization_pct, rates, o.freight)),
        ...(photos ? { photos: photos.filter((ph) => ph.supplier_id === o.supplier_id).map((ph) => ({ id: ph.id, url: photoUrl(ph.image_id) })) } : {}),
      }))
      .sort((a, b) => a.estimated_brl - b.estimated_brl);
    return {
      id: p.id, name: p.name, notes: p.notes, price_brl: p.price_brl, units_per_40hq: p.units_per_40hq ?? null,
      units_per_box: p.units_per_box ?? null, boxes_per_40hq: p.boxes_per_40hq ?? null,
      photo: photoUrl(p.photo), list_photo: photoUrl(p.list_photo ?? p.photo), offers: opts,
      company_cnpj: p.cnpj, company_name: p.company_name ?? null, exchange_rate: rates.USD, cny_rate: rates.CNY,
      created_at: p.created_at, updated_at: p.updated_at, updated_by_name: p.updated_by_name ?? null,
    };
  }

  async function productResponse(cnpj, id) {
    const p = await loadProduct(cnpj, id);
    const [photos, offers, freight] = await Promise.all([
      db.all('SELECT id, supplier_id, image_id FROM offer_photos WHERE product_id = ? ORDER BY id', [p.id]),
      offersFor(p.cnpj, [p.id]),
      freight40hq(),
    ]);
    return productOut(p, offers, ratesOf(p), freight, photos);
  }

  // Normaliza a lista de ofertas enviada pelo cliente e garante que os
  // fornecedores pertencem ao mesmo CNPJ.
  async function parseOffers(cnpj, list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    for (const [i, o] of list.entries()) {
      if (!o || typeof o !== 'object') throw new HttpError(400, `Oferta ${i + 1} inválida.`);
      const supplierId = num(o.supplier_id, `fornecedor da oferta ${i + 1}`, { required: true, integer: true });
      if (seen.has(supplierId)) throw new HttpError(400, 'O mesmo fornecedor foi informado mais de uma vez.');
      seen.add(supplierId);
      const incoterm = str(o.incoterm, 10).toUpperCase() || null;
      if (incoterm && !INCOTERMS.includes(incoterm)) throw new HttpError(400, `Incoterm inválido: ${incoterm}.`);
      // Preço em RMB (padrão) ou US$. Cadastros antigos guardados no celular ainda mandam price_usd.
      const legacy = o.price === undefined && o.price_usd !== undefined;
      const currency = legacy ? 'USD' : String(o.currency || 'CNY').toUpperCase();
      if (!CURRENCIES_OFFER.includes(currency)) throw new HttpError(400, `Moeda inválida na oferta ${i + 1}.`);
      // Embalagem deste fornecedor. Sem os campos no envio (app antigo, oferta pela tela do fornecedor),
      // a gravação mantém a que já estava cadastrada (keepPack).
      const sentPack = o.units_per_box !== undefined || o.boxes_per_40hq !== undefined;
      const perBox = sentPack ? num(o.units_per_box, `Qtd por caixa da oferta ${i + 1}`, { integer: true }) : null;
      const boxes = sentPack ? num(o.boxes_per_40hq, `Caixas por container da oferta ${i + 1}`, { integer: true }) : null;
      if ((perBox !== null && (perBox < 1 || perBox > 10_000_000)) || (boxes !== null && (boxes < 1 || boxes > 10_000_000))) {
        throw new HttpError(400, `Oferta ${i + 1}: embalagem inválida.`);
      }
      out.push({
        supplier_id: supplierId,
        price: num(legacy ? o.price_usd : o.price, `preço da oferta ${i + 1}`, { required: true }),
        currency,
        moq: num(o.moq, `MOQ da oferta ${i + 1}`, { integer: true }),
        incoterm,
        nationalization_pct: num(o.nationalization_pct, `% de nacionalização da oferta ${i + 1}`) ?? 0,
        units_per_box: perBox, boxes_per_40hq: boxes, keepPack: !sentPack,
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
    // Ofertas sem embalagem no envio mantêm a que estava gravada para o mesmo fornecedor.
    if (offers.some((o) => o.keepPack)) {
      const old = new Map((await q.all('SELECT supplier_id, units_per_box, boxes_per_40hq FROM offers WHERE product_id = ?', [productId]))
        .map((r) => [Number(r.supplier_id), r]));
      offers = offers.map((o) => (o.keepPack && old.has(o.supplier_id)
        ? { ...o, units_per_box: old.get(o.supplier_id).units_per_box, boxes_per_40hq: old.get(o.supplier_id).boxes_per_40hq } : o));
    }
    await q.run('DELETE FROM offers WHERE product_id = ?', [productId]);
    if (!offers.length) return;
    await q.run(`INSERT INTO offers (product_id, supplier_id, price_usd, currency, moq, incoterm, nationalization_pct, units_per_box, boxes_per_40hq)
                 VALUES ${offers.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
      offers.flatMap((o) => [productId, o.supplier_id, o.price, o.currency, o.moq, o.incoterm, o.nationalization_pct, o.units_per_box ?? null, o.boxes_per_40hq ?? null]));
  }

  // ---------- rotas ----------

  const routes = [];
  let lastFxCheck = 0;
  const route = (method, pattern, handler, { pub = false } = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, handler, pub });
  };

  // Papel efetivo: "admin" só para e-mails em ADMIN_EMAILS (tirar o e-mail da lista tira o acesso).
  function withRole(user) {
    return { ...user, role: ADMIN_EMAILS.has(String(user.email).toLowerCase()) ? 'admin' : 'user' };
  }

  // Grava no banco o papel atual (informativo; quem decide é ADMIN_EMAILS).
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
    // Aguardando aprovação: só o necessário para a tela de espera (nada dos dados da empresa).
    if (user.status === 'pending') {
      const company = await getCompany(user.cnpj);
      return {
        user: { id: user.id, name: user.name, email: user.email, role: 'user', is_admin: false, pending: true, card_photo: null },
        company: { cnpj: company.cnpj, cnpj_formatted: cnpjUtil.format(company.cnpj), name: company.name, members: [] },
        pending: true, features: {}, settings: {},
      };
    }
    const [company, members, companies, fxStatus, settings] = await Promise.all([
      getCompany(user.cnpj),
      db.all("SELECT id, name, email, status FROM users WHERE cnpj = ? ORDER BY lower(name)", [user.cnpj]),
      isAdmin(user) ? db.all('SELECT cnpj, name, exchange_rate, cny_rate FROM companies ORDER BY lower(coalesce(name, cnpj))') : undefined,
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
        name: company.name, exchange_rate: company.exchange_rate, cny_rate: ratesOf(company).CNY, cny_estimated: !company.cny_rate, members,
        rate_mode: company.rate_mode, rate_source: company.rate_source, rate_updated_at: company.rate_updated_at,
      },
      // Pedidos para entrar na empresa (qualquer pessoa da equipe aprova ou recusa).
      join_requests: members.filter((m) => m.status === 'pending').map((m) => ({ id: m.id, name: m.name, email: m.email })),
      fx: fxStatus,
      settings,
      companies: companies?.map((c) => ({ ...c, cny_rate: ratesOf(c).CNY, cnpj_formatted: cnpjUtil.format(c.cnpj) })),
      features: { card_ocr: Boolean(readCard), card_crop: Boolean(readCorners), product_ocr: Boolean(readProducts), interpreter: Boolean(interpret), payments: Boolean(asaas) },
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
    // Empresa que já tem equipe: o novo usuário espera alguém dela aprovar (o CNPJ é público).
    const team = existing ? await db.get("SELECT COUNT(*) AS n FROM users WHERE cnpj = ? AND status = 'active'", [cnpj]) : null;
    const status = role !== 'admin' && Number(team?.n || 0) > 0 ? 'pending' : 'active';
    // Empresa nova já começa com a cotação do dia (ou 5,50 se as APIs estiverem fora).
    const quote = !existing && fx ? await fx.ensureFresh().catch(() => null) : null;
    let userId;
    try {
      userId = await db.tx(async (q) => {
        await q.run(`INSERT INTO companies (cnpj, name, exchange_rate, cny_rate, rate_source, rate_updated_at, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (cnpj) DO NOTHING`,
          [cnpj, companyName, quote?.rate ?? 5.5, quote?.cny_rate ?? null, quote?.rate ? quote.source : null, quote?.rate ? quote.quoted_at : null, now()]);
        const row = await q.get('INSERT INTO users (name, email, password_hash, cnpj, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
          [name, email, passwordHash, cnpj, role, status, now()]);
        return row.id;
      });
    } catch (err) {
      if (/unique|duplicate/i.test(err.message)) throw new HttpError(409, 'Já existe uma conta com este e-mail.');
      throw err;
    }
    const session = await auth.createSession(db, userId);
    res.setHeader('Set-Cookie', sessionCookie(session.token, session.maxAge));
    return { status: 201, body: await meOut({ id: userId, name, email, cnpj, role, status }) };
  }, { pub: true });

  route('POST', '/api/login', async ({ body, req, res }) => {
    const email = str(body.email, 200).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    const key = `${clientIp(req)}|${email}`;
    if (!loginLimiter.hit(key)) throw new HttpError(429, 'Muitas tentativas. Tente novamente em alguns minutos.');
    const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
    // Sempre calcula o hash (mesmo sem usuário) para o tempo de resposta não revelar e-mails cadastrados.
    const ok = (await auth.verifyPassword(password, user?.password_hash)) && user;
    // Limite por e-mail (de qualquer IP): conta só erros, e a senha certa sempre entra.
    if (!ok) {
      if (!emailLimiter.hit(email)) throw new HttpError(429, 'Muitas tentativas. Tente novamente em alguns minutos.');
      throw new HttpError(401, 'E-mail ou senha incorretos.');
    }
    loginLimiter.clear(key);
    const session = await auth.createSession(db, user.id);
    res.setHeader('Set-Cookie', sessionCookie(session.token, session.maxAge));
    return meOut(await syncRole(user));
  }, { pub: true });

  route('POST', '/api/logout', async ({ req, res }) => {
    sessionCache.delete(parseCookies(req).sid);
    await auth.destroySession(db, parseCookies(req).sid);
    res.setHeader('Set-Cookie', sessionCookie('', 0));
    return { ok: true };
  }, { pub: true });

  route('GET', '/api/me', async ({ user }) => meOut(await syncRole(user)));

  // Pedido para entrar na empresa: aprovado ou recusado por alguém da equipe (ou pelo administrador).
  async function joinRequest(user, id) {
    const target = await db.get("SELECT id, cnpj FROM users WHERE id = ? AND status = 'pending'", [toId(id)]);
    if (!target || (!isAdmin(user) && target.cnpj !== user.cnpj)) throw new HttpError(404, 'Pedido não encontrado (talvez já respondido).');
    return target;
  }
  route('POST', '/api/company/requests/:id/approve', async ({ user, params }) => {
    const target = await joinRequest(user, params.id);
    await db.run("UPDATE users SET status = 'active' WHERE id = ?", [target.id]);
    return { ok: true };
  });
  route('DELETE', '/api/company/requests/:id', async ({ user, params }) => {
    const target = await joinRequest(user, params.id);
    await db.tx(async (q) => {
      await q.run('DELETE FROM sessions WHERE user_id = ?', [target.id]);
      await q.run("DELETE FROM users WHERE id = ? AND status = 'pending'", [target.id]);
    });
    return { ok: true };
  });

  // Câmbio: { mode: 'auto' } volta para a cotação do dia; { exchange_rate } fixa um valor manual.
  route('PUT', '/api/settings', async ({ user, body }) => {
    if (body.mode === 'auto') {
      if (!fx) throw new HttpError(400, 'Cotação automática desativada neste servidor.');
      const q = await fx.ensureFresh();
      if (q.rate) {
        await db.run(`UPDATE companies SET rate_mode = 'auto', exchange_rate = ?, cny_rate = COALESCE(?, cny_rate), rate_source = ?, rate_updated_at = ? WHERE cnpj = ?`,
          [q.rate, q.cny_rate ?? null, q.source, q.quoted_at, user.cnpj]);
      } else {
        await db.run(`UPDATE companies SET rate_mode = 'auto' WHERE cnpj = ?`, [user.cnpj]);
      }
      return meOut(user);
    }
    const company = await getCompany(user.cnpj);
    const rate = body.exchange_rate === undefined ? company.exchange_rate : num(body.exchange_rate, 'Câmbio do dólar', { required: true });
    if (rate <= 0 || rate > 100) throw new HttpError(400, 'Câmbio do dólar inválido.');
    const cny = body.cny_rate === undefined ? ratesOf(company).CNY : num(body.cny_rate, 'Câmbio do yuan', { required: true });
    if (cny <= 0 || cny > 20) throw new HttpError(400, 'Câmbio do yuan inválido.');
    await db.run(`UPDATE companies SET exchange_rate = ?, cny_rate = ?, rate_mode = 'manual', rate_source = 'Manual', rate_updated_at = ? WHERE cnpj = ?`,
      [rate, cny, now(), user.cnpj]);
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
    forgetUser(user.id);
    return meOut({ ...user, card_photo: id });
  });

  route('DELETE', '/api/me/card', async ({ user }) => {
    const old = (await db.get('SELECT card_photo FROM users WHERE id = ?', [user.id]))?.card_photo;
    await db.tx(async (q) => {
      await q.run('UPDATE users SET card_photo = NULL WHERE id = ?', [user.id]);
      await removeImage(q, user.cnpj, old);
    });
    forgetUser(user.id);
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
    ['credit_ledger', 'user_id'], ['credit_payments', 'user_id'],
  ];

  route('GET', '/api/admin/users', async ({ user }) => {
    requireAdminUser(user);
    const rows = await db.all(`
      SELECT u.id, u.name, u.email, u.role, u.status, u.cnpj, u.created_at, c.name AS company_name
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
        forgetUser(target.id);
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
      forgetUser(target.id);
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
      await q.run('DELETE FROM offer_photos WHERE product_id IN (SELECT id FROM products WHERE cnpj = ?)', [cnpj]);
      await q.run('DELETE FROM offer_photos WHERE supplier_id IN (SELECT id FROM suppliers WHERE cnpj = ?)', [cnpj]);
      await q.run('DELETE FROM offers WHERE product_id IN (SELECT id FROM products WHERE cnpj = ?)', [cnpj]);
      await q.run('DELETE FROM offers WHERE supplier_id IN (SELECT id FROM suppliers WHERE cnpj = ?)', [cnpj]);
      await q.run('DELETE FROM products WHERE cnpj = ?', [cnpj]);
      await q.run('DELETE FROM suppliers WHERE cnpj = ?', [cnpj]);
      await q.run('DELETE FROM itineraries WHERE cnpj = ?', [cnpj]);
      await q.run('DELETE FROM credit_ledger WHERE cnpj = ?', [cnpj]);
      await q.run('DELETE FROM credit_payments WHERE cnpj = ?', [cnpj]);
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
    // Em quantos produtos cada fornecedor tem o menor preço estimado (para o cartão da lista).
    const products = await db.all(`SELECT p.id, p.units_per_40hq, c.exchange_rate, c.cny_rate FROM products p JOIN companies c ON c.cnpj = p.cnpj
      WHERE 1 = 1${companyFilter('p', cnpj)}`, companyParam(cnpj));
    const bestCount = new Map();
    if (products.length) {
      const freight = await freight40hq();
      const byProduct = Map.groupBy(await offersFor(cnpj, products.map((x) => x.id)), (o) => o.product_id);
      for (const pr of products) {
        let best = null;
        for (const o of byProduct.get(pr.id) || []) {
          const est = estimateBrl(o.price, o.currency, o.nationalization_pct, ratesOf(pr), offerFreight(o.incoterm, freightPerUnit(freight, offerUnits(o, pr.units_per_40hq))));
          if (!best || est < best.est) best = { est, sid: o.supplier_id };
        }
        if (best) bestCount.set(best.sid, (bestCount.get(best.sid) || 0) + 1);
      }
    }
    return rows.map((r) => ({ ...supplierOut(r), best_count: bestCount.get(r.id) || 0 }));
  });

  route('GET', '/api/suppliers/:id', async ({ user, params }) => {
    // Consultas independentes em paralelo (cada ida ao banco conta no celular).
    const [s, freight] = await Promise.all([loadSupplier(db, accessCnpj(user), params.id), freight40hq()]);
    // Mesmo formato do cartão da tela do produto: preço deste fornecedor, estimado, se é o melhor e as fotos dele.
    const rows = await db.all(`
      SELECT p.id, p.name, p.price_brl, p.units_per_40hq, ${listPhotoSql('p')} AS cover
      FROM offers o JOIN products p ON p.id = o.product_id
      WHERE o.supplier_id = ? AND p.cnpj = ? ORDER BY lower(p.name)`, [s.id, s.cnpj]);
    const ids = rows.map((r) => r.id);
    const rates = ratesOf(s);
    const [offers, photos] = ids.length ? await Promise.all([
      offersFor(s.cnpj, ids),
      db.all(`SELECT id, product_id, image_id FROM offer_photos
        WHERE supplier_id = ? AND product_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`, [s.id, ...ids]),
    ]) : [[], []];
    const products = rows.map((r) => {
      const opts = offers.filter((o) => o.product_id === r.id).map((o) => {
        const fr = offerFreight(o.incoterm, freightPerUnit(freight, offerUnits(o, r.units_per_40hq)));
        return { ...o, freight: fr, est: round2(estimateBrl(o.price, o.currency, o.nationalization_pct, rates, fr)) };
      });
      const mine = opts.find((o) => o.supplier_id === s.id);
      const ph = photos.filter((x) => x.product_id === r.id);
      return {
        id: r.id, name: r.name, price_brl: r.price_brl, units_per_40hq: r.units_per_40hq ?? null,
        price: mine.price, currency: mine.currency, moq: mine.moq, incoterm: mine.incoterm, nationalization_pct: mine.nationalization_pct,
        units_per_box: mine.units_per_box ?? null, boxes_per_40hq: mine.boxes_per_40hq ?? null, units_per_40hq: offerUnits(mine, r.units_per_40hq),
        freight_usd: round4(mine.freight), estimated_brl: mine.est,
        is_best: mine.est === Math.min(...opts.map((o) => o.est)), offer_count: opts.length,
        photo: photoUrl(ph[0]?.image_id ?? r.cover), photo_count: ph.length,
        photos: ph.map((x) => ({ id: x.id, url: photoUrl(x.image_id) })),
      };
    });
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

  // Cantos do cartão (para endireitar e recortar a foto no celular): consulta rápida, separada da leitura dos dados.
  route('POST', '/api/ocr/card-corners', async ({ body, user }) => {
    if (!readCorners) throw new HttpError(503, 'Leitor de cartões não configurado (defina ANTHROPIC_API_KEY na Vercel).');
    if (!cornerLimiter.hit(String(user.id))) throw new HttpError(429, 'Muitos ajustes de cartão em pouco tempo. Tente mais tarde.');
    const img = parseImage(body.image);
    try {
      return await readCorners(img.mime, img.data.toString('base64'));
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
      if (removing) {
        await removeImage(q, s.cnpj, s.card_photo);
        // A foto original (antes do ajuste automático) deixa de valer junto.
        if (s.card_photo_original) {
          await q.run('UPDATE suppliers SET card_photo_original = NULL WHERE id = ?', [s.id]);
          await removeImage(q, s.cnpj, s.card_photo_original);
        }
      }
    });
    return supplierOut(await loadSupplier(db, s.cnpj, s.id));
  });

  // Cartão endireitado/recortado no celular: troca a foto e guarda a original para poder desfazer.
  route('PUT', '/api/suppliers/:id/card-photo', async ({ user, params, body }) => {
    const s = await loadSupplier(db, accessCnpj(user), params.id);
    if (!s.card_photo) throw new HttpError(400, 'Este fornecedor não tem foto do cartão.');
    const img = parseImage(body.photo);
    await db.tx(async (q) => {
      const id = await saveImage(q, img, s.cnpj, parseThumb(body.photo_thumb));
      const original = s.card_photo_original || s.card_photo;
      await q.run('UPDATE suppliers SET card_photo = ?, card_photo_original = ? WHERE id = ?', [id, original, s.id]);
      // Ajustado de novo: a versão ajustada anterior sai (a original continua guardada).
      if (s.card_photo_original) await removeImage(q, s.cnpj, s.card_photo);
    });
    return supplierOut(await loadSupplier(db, s.cnpj, s.id));
  });

  route('POST', '/api/suppliers/:id/card-photo/restore', async ({ user, params }) => {
    const s = await loadSupplier(db, accessCnpj(user), params.id);
    if (!s.card_photo_original) throw new HttpError(400, 'Não há foto original guardada.');
    await db.tx(async (q) => {
      await q.run('UPDATE suppliers SET card_photo = ?, card_photo_original = NULL WHERE id = ?', [s.card_photo_original, s.id]);
      await removeImage(q, s.cnpj, s.card_photo);
    });
    return supplierOut(await loadSupplier(db, s.cnpj, s.id));
  });

  route('DELETE', '/api/suppliers/:id', async ({ user, params }) => {
    const s = await loadSupplier(db, accessCnpj(user), params.id);
    await db.tx(async (q) => {
      await removeOfferPhotos(q, s.cnpj, 'supplier_id = ?', [s.id]);
      await q.run('DELETE FROM suppliers WHERE id = ?', [s.id]);
      await removeImage(q, s.cnpj, s.card_photo);
      await removeImage(q, s.cnpj, s.card_photo_original);
    });
    return { ok: true };
  });

  // --- produtos ---

  // Planilha Excel: modelo (com a lista de fornecedores da empresa) e leitura das linhas para conferência.
  route('GET', '/api/products/import-template', async ({ user, query, res }) => {
    const cnpj = isAdmin(user) && query.get('company') ? cnpjUtil.clean(query.get('company')) : user.cnpj;
    const names = (await db.all('SELECT name FROM suppliers WHERE cnpj = ? ORDER BY lower(name)', [cnpj])).map((r) => r.name);
    const data = Buffer.from(await buildTemplate(names));
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Length': data.length,
      'Cache-Control': 'private, no-store', 'Content-Disposition': 'attachment; filename="modelo-produtos.xlsx"',
    });
    res.end(data);
    return RAW;
  });

  route('POST', '/api/products/import/parse', async ({ user, body }) => {
    const cnpj = await targetCnpj(user, body);
    const buf = parseXlsxUpload(body.file);
    const suppliers = await db.all('SELECT id, name FROM suppliers WHERE cnpj = ?', [cnpj]);
    try {
      return await parseProductsXlsx(buf, suppliers);
    } catch (err) {
      console.error('Planilha de produtos:', err.message);
      throw new HttpError(400, 'Não consegui ler esta planilha. Salve como .xlsx (Excel) e tente de novo.');
    }
  });

  route('GET', '/api/products', async ({ user, query }) => {
    const cnpj = listCnpj(user, query);
    // Versão leve (só nomes), usada pelos formulários para avisar de produto repetido.
    if (query.get('fields') === 'names') {
      const rows = await db.all(`SELECT p.id, p.name, p.cnpj, (SELECT COUNT(*) FROM offers o WHERE o.product_id = p.id) AS offer_count
        FROM products p WHERE 1 = 1${companyFilter('p', cnpj)} ORDER BY lower(p.name)`, companyParam(cnpj));
      return rows.map((r) => ({ id: r.id, name: r.name, company_cnpj: r.cnpj, offer_count: Number(r.offer_count) }));
    }
    const products = await db.all(`
      SELECT p.*, ${listPhotoSql('p')} AS list_photo, u.name AS updated_by_name, c.name AS company_name, c.exchange_rate, c.cny_rate
      FROM products p LEFT JOIN users u ON u.id = p.updated_by
      JOIN companies c ON c.cnpj = p.cnpj
      WHERE 1 = 1${companyFilter('p', cnpj)} ORDER BY lower(p.name)`, companyParam(cnpj));
    const offers = await offersFor(cnpj, products.map((p) => p.id));
    const freight = await freight40hq();
    const byProduct = Map.groupBy(offers, (o) => o.product_id);
    return products.map((p) => productOut(p, byProduct.get(p.id) || [], ratesOf(p), freight));
  });

  route('GET', '/api/products/:id', ({ user, params }) => productResponse(accessCnpj(user), params.id));

  // current: produto já salvo (na edição). Sem os campos de caixa no envio, mantém os do cadastro
  // enquanto o total por container não mudar (ex.: oferta adicionada pela tela do fornecedor).
  function productFields(body, current = null) {
    const name = str(body.name, 150);
    if (!name) throw new HttpError(400, 'Informe o nome do produto.');
    let units = num(body.units_per_40hq, 'Unidades por container 40HQ', { integer: true });
    const sent = body.units_per_box !== undefined || body.boxes_per_40hq !== undefined;
    let perBox = sent ? num(body.units_per_box, 'Qtd por caixa', { integer: true }) : current?.units_per_box ?? null;
    let boxes = sent ? num(body.boxes_per_40hq, 'Caixas por container', { integer: true }) : current?.boxes_per_40hq ?? null;
    for (const [v, label] of [[perBox, 'Qtd por caixa'], [boxes, 'Caixas por container']]) {
      if (v !== null && (v < 1 || v > 10_000_000)) throw new HttpError(400, `${label} inválido.`);
    }
    // As duas preenchidas: total = Qtd por caixa × Caixas por container. Só uma: guarda, sem total (frete).
    if (perBox && boxes) units = perBox * boxes;
    else if (sent && (perBox || boxes)) units = body.units_per_40hq !== undefined ? units : current?.units_per_40hq ?? null;
    else if (!sent && current && units !== current.units_per_40hq) { perBox = null; boxes = null; }
    if (units !== null && (units < 1 || units > 100_000_000)) throw new HttpError(400, 'Unidades por container 40HQ inválido.');
    return { name, price_brl: num(body.price_brl, 'Preço no Brasil'), units_per_40hq: units, units_per_box: perBox, boxes_per_40hq: boxes, notes: str(body.notes, 2000) || null };
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
      const row = await q.get(`INSERT INTO products (cnpj, name, photo, price_brl, units_per_40hq, units_per_box, boxes_per_40hq, notes, client_ref, created_by, updated_by, created_at, updated_at)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        [cnpj, f.name, photo, f.price_brl, f.units_per_40hq, f.units_per_box, f.boxes_per_40hq, f.notes, ref, user.id, user.id, t, t]);
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
    const f = productFields(body, p);
    const offers = await parseOffers(p.cnpj, body.offers);
    const img = body.photo && String(body.photo).startsWith('data:') ? parseImage(body.photo) : null;
    await db.tx(async (q) => {
      let photo = p.photo;
      if (body.photo === null) photo = null;
      else if (img) photo = await saveImage(q, img, p.cnpj, parseThumb(body.photo_thumb));
      await q.run(`UPDATE products SET name = ?, photo = ?, price_brl = ?, units_per_40hq = ?, units_per_box = ?, boxes_per_40hq = ?, notes = ?, updated_by = ?, updated_at = ?
                   WHERE id = ?`, [f.name, photo, f.price_brl, f.units_per_40hq, f.units_per_box, f.boxes_per_40hq, f.notes, user.id, now(), p.id]);
      await replaceOffers(q, p.id, offers);
      // Fornecedor tirado do produto: as fotos dele neste produto saem junto.
      const keep = offers.map((o) => o.supplier_id);
      await removeOfferPhotos(q, p.cnpj, `product_id = ?${keep.length ? ` AND supplier_id NOT IN (${keep.map(() => '?').join(',')})` : ''}`, [p.id, ...keep]);
      if (photo !== p.photo) await removeImage(q, p.cnpj, p.photo);
    });
    return productResponse(p.cnpj, p.id);
  });

  route('DELETE', '/api/products/:id', async ({ user, params }) => {
    const p = await loadProduct(accessCnpj(user), params.id);
    await db.tx(async (q) => {
      await removeOfferPhotos(q, p.cnpj, 'product_id = ?', [p.id]);
      await q.run('DELETE FROM products WHERE id = ?', [p.id]);
      await removeImage(q, p.cnpj, p.photo);
    });
    return { ok: true };
  });

  // Exclui vários produtos escolhidos na lista (só os que o usuário pode acessar).
  route('POST', '/api/products/delete-many', async ({ user, body }) => {
    const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : [];
    if (!ids.length) throw new HttpError(400, 'Nenhum produto escolhido.');
    if (ids.length > 500) throw new HttpError(400, 'Escolha no máximo 500 produtos por vez.');
    const cnpj = accessCnpj(user);
    const rows = await db.all(`SELECT id, cnpj, photo FROM products p WHERE p.id IN (${ids.map(() => '?').join(',')})${companyFilter('p', cnpj)}`,
      [...ids, ...companyParam(cnpj)]);
    await db.tx(async (q) => {
      for (const p of rows) {
        await removeOfferPhotos(q, p.cnpj, 'product_id = ?', [p.id]);
        await q.run('DELETE FROM products WHERE id = ?', [p.id]);
        await removeImage(q, p.cnpj, p.photo);
      }
    });
    return { deleted: rows.length };
  });

  // Exclui de uma vez os produtos que o próprio usuário cadastrou (para recomeçar um teste).
  // { dry: true } só conta. Exige confirm: 'EXCLUIR'.
  route('POST', '/api/products/delete-mine', async ({ user, body }) => {
    const cnpj = accessCnpj(user);
    const rows = await db.all(`SELECT id, cnpj, photo FROM products p WHERE p.created_by = ?${companyFilter('p', cnpj)}`, [user.id, ...companyParam(cnpj)]);
    if (body.dry) return { count: rows.length };
    if (body.confirm !== 'EXCLUIR') throw new HttpError(400, 'Confirme digitando EXCLUIR.');
    await db.tx(async (q) => {
      for (const p of rows) {
        await removeOfferPhotos(q, p.cnpj, 'product_id = ?', [p.id]);
        await q.run('DELETE FROM products WHERE id = ?', [p.id]);
        await removeImage(q, p.cnpj, p.photo);
      }
    });
    return { deleted: rows.length };
  });

  // Fotos do produto por fornecedor (cada oferta tem a sua galeria).
  route('POST', '/api/products/:id/photos', async ({ user, params, body }) => {
    const p = await loadProduct(accessCnpj(user), params.id);
    const supplierId = num(body.supplier_id, 'fornecedor', { required: true, integer: true });
    if (!(await db.get('SELECT 1 AS ok FROM offers WHERE product_id = ? AND supplier_id = ?', [p.id, supplierId]))) {
      throw new HttpError(400, 'Este fornecedor não está vinculado ao produto.');
    }
    const { n } = await db.get('SELECT COUNT(*) AS n FROM offer_photos WHERE product_id = ? AND supplier_id = ?', [p.id, supplierId]);
    if (Number(n) >= MAX_OFFER_PHOTOS) throw new HttpError(400, `Limite de ${MAX_OFFER_PHOTOS} fotos por fornecedor neste produto.`);
    const img = parseImage(body.photo);
    await db.tx(async (q) => {
      const imageId = await saveImage(q, img, p.cnpj, parseThumb(body.photo_thumb));
      await q.run('INSERT INTO offer_photos (product_id, supplier_id, image_id, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
        [p.id, supplierId, imageId, user.id, now()]);
    });
    return { status: 201, body: await productResponse(p.cnpj, p.id) };
  });

  route('DELETE', '/api/products/:id/photos/:photoId', async ({ user, params }) => {
    const p = await loadProduct(accessCnpj(user), params.id);
    await db.tx((q) => removeOfferPhotos(q, p.cnpj, 'id = ? AND product_id = ?', [toId(params.photoId), p.id]));
    return productResponse(p.cnpj, p.id);
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
    // Câmbio manual da empresa vale também para as despesas; senão, a cotação do dia.
    const manual = company?.rate_mode === 'manual' && company.cny_rate;
    return {
      USD: usd, BRL: 1,
      // Sem cotação do yuan: estimativa pelo dólar (1 US$ ≈ 7,2 ¥), avisada na tela.
      CNY: manual ? Number(company.cny_rate) : cnyCache?.rate ?? (company?.cny_rate ? Number(company.cny_rate) : usd ? round4(usd / 7.2) : null),
      cny_source: manual ? 'câmbio manual da empresa' : cnyCache ? cnyCache.source : company?.cny_rate ? 'última cotação' : 'estimado pelo dólar',
    };
  });

  // --- roteiros de viagem ---

  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  function parseXlsxUpload(dataUrl) {
    const m = /^data:([\w./+-]*);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!m) throw new HttpError(400, 'Envie a planilha em Excel (.xlsx).');
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
      SELECT p.id, p.cnpj, p.name, ${listPhotoSql('p')} AS photo, p.price_brl, p.units_per_40hq, c.name AS company_name, c.exchange_rate, c.cny_rate
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
      const ranked = buildRanking(list, offers.filter((o) => ids.has(o.product_id)), ratesOf(list[0]), freight);
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
      cny_rate: ratesOf(own).CNY,
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

  // /uploads/<id>/<assinatura>[/thumb]: link assinado (público, guardado na CDN).
  // /uploads/<id>[/thumb]: links antigos, conferindo a sessão.
  function signedUpload(rest) {
    const [id, sig, variant, extra] = rest.split('/');
    if (!sig || sig === 'thumb' || extra !== undefined || (variant && variant !== 'thumb')) return null;
    const good = Buffer.from(uploadSig(id));
    const got = Buffer.from(sig);
    return good.length === got.length && crypto.timingSafeEqual(good, got) ? { id, variant } : false;
  }
  async function serveUpload(res, user, rest, signed = null) {
    const [id, variant] = signed ? [signed.id, signed.variant] : rest.split('/');
    const col = variant === 'thumb' ? 'coalesce(thumb, data)' : 'data';
    const open = signed || isAdmin(user);
    const img = /^[0-9a-f]{32}$/.test(id) && (!variant || variant === 'thumb')
      ? await db.get(`SELECT mime, ${col} AS data FROM images WHERE id = ?${open ? '' : ' AND cnpj = ?'}`, open ? [id] : [id, user.cnpj])
      : null;
    if (!img) return send(res, 404, { error: 'Não encontrado.' });
    const data = Buffer.from(img.data);
    // Miniaturas são sempre JPEG; a foto mantém o tipo original.
    if (variant === 'thumb' && sniffImage(data)) img.mime = sniffImage(data);
    // O id é único por foto, então pode ficar em cache indefinidamente.
    const cache = signed ? 'public, max-age=31536000, s-maxage=31536000, immutable' : 'private, max-age=31536000, immutable';
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': img.mime, 'Content-Length': data.length, 'Cache-Control': cache });
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
      if (pathname.startsWith('/uploads/') || pathname.startsWith('/api/')) await ensureUploadKey();
      if (pathname.startsWith('/uploads/')) {
        const rest = pathname.slice('/uploads/'.length);
        const signed = signedUpload(rest);
        if (signed === false) return send(res, 404, { error: 'Não encontrado.' });
        if (signed) return await serveUpload(res, null, rest, signed);
        const sessionUser = await sessionUserOf(req);
        if (!sessionUser || sessionUser.status === 'pending') return send(res, 401, { error: 'Não autenticado.' });
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
        let params;
        try { params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])); }
        catch { throw new HttpError(404, 'Não encontrado.'); }
        const sessionUser = await sessionUserOf(req);
        if (!r.pub && !sessionUser) throw new HttpError(401, 'Não autenticado.');
        const user = sessionUser && withRole(sessionUser);
        // Aguardando aprovação: só vê a própria situação e pode sair.
        if (user?.status === 'pending' && !r.pub && !(req.method === 'GET' && pathname === '/api/me') && pathname !== '/api/logout') {
          throw new HttpError(403, 'Seu acesso à empresa ainda aguarda a aprovação de alguém da equipe.');
        }
        // Mantém a cotação do dia atualizada sem atrasar a resposta (busca em segundo plano;
        // usa cache de 30 min). Só espera se ainda não existe nenhuma cotação.
        // Confere no máximo uma vez por minuto por instância e sem segurar a resposta.
        if (user && fx && req.method === 'GET' && Date.now() - lastFxCheck > 60_000) {
          lastFxCheck = Date.now();
          background(fx.refreshInBackground(background).catch((err) => console.error(err)));
        }
        // Exigir JSON em POST/PUT também protege contra CSRF via formulários de outros sites.
        if ((req.method === 'POST' || req.method === 'PUT') && !/^application\/json\b/.test(req.headers['content-type'] || '') && !isBundle(req)) {
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
