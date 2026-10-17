'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { open } = require('../src/db');
const { createApp } = require('../src/app');
const { createFxService } = require('../src/fx');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// Por padrão os testes usam SQLite; defina TEST_DATABASE_URL para rodar contra Postgres.
async function setup({ adminEmails = [], readCard = null, readProducts = null, benchReaders = null, asaas = null, interpret = null, asaasWebhookToken = null, fxQuote = null } = {}) {
  let db;
  if (process.env.TEST_DATABASE_URL) {
    db = open({ databaseUrl: process.env.TEST_DATABASE_URL });
    await db.run('DROP TABLE IF EXISTS credit_ledger, credit_payments, expenses, offers, products, suppliers, images, sessions, itineraries, app_settings, users, companies, fx_quotes CASCADE')
      .catch(() => {});
    await db.close();
    db = open({ databaseUrl: process.env.TEST_DATABASE_URL });
  } else {
    db = open({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'cantonfair-')) });
  }
  const lookup = async (c) => (c === '33000167000101' ? { status: 'not_found' } : { status: 'found', name: 'EMPRESA TESTE LTDA' });
  const server = http.createServer(createApp({ db, publicDir: path.join(__dirname, '..', 'public'), cnpjLookup: lookup, adminEmails, readCard, readProducts, benchReaders, asaas, interpret, asaasWebhookToken, fetchCny: async () => ({ rate: 0.71, source: 'teste' }),
    fx: fxQuote ? createFxService({ db, fetchQuote: fxQuote }) : null }));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: async () => { await new Promise((r) => server.close(r)); await db.close(); } };
}

function client(base) {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, body: ct.includes('json') ? await res.json() : await res.text() };
  };
}

test('fluxo completo: cadastro, CNPJ compartilhado, fornecedores, produtos e ranking', async (t) => {
  const { base, close } = await setup();
  t.after(close);
  const ana = client(base);
  const bruno = client(base);
  const outra = client(base);

  // validações de cadastro
  let r = await ana('POST', '/api/register', { name: 'Ana', email: 'ana@x.com', password: '12345678', cnpj: '11.222.333/0001-82' });
  assert.equal(r.status, 400);
  r = await ana('POST', '/api/register', { name: 'Ana', email: 'ana@x.com', password: '12345678', cnpj: '33.000.167/0001-01' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Receita/);
  r = await ana('POST', '/api/register', { name: 'Ana', email: 'ana@x.com', password: '123', cnpj: '11.222.333/0001-81' });
  assert.equal(r.status, 400);

  r = await ana('POST', '/api/register', { name: 'Ana', email: 'ana@x.com', password: '12345678', cnpj: '11.222.333/0001-81' });
  assert.equal(r.status, 201);
  assert.equal(r.body.company.name, 'EMPRESA TESTE LTDA');

  r = await bruno('POST', '/api/register', { name: 'Bruno', email: 'ANA@x.com', password: '12345678', cnpj: '11222333000181' });
  assert.equal(r.status, 409);
  r = await bruno('POST', '/api/register', { name: 'Bruno', email: 'bruno@x.com', password: '12345678', cnpj: '11222333000181' });
  assert.equal(r.status, 201);
  assert.equal(r.body.company.members.length, 2);

  r = await outra('POST', '/api/register', { name: 'Carla', email: 'carla@y.com', password: '12345678', cnpj: '12.ABC.345/01DE-35' });
  assert.equal(r.status, 201);

  // não autenticado
  r = await client(base)('GET', '/api/products');
  assert.equal(r.status, 401);

  // login
  const ana2 = client(base);
  r = await ana2('POST', '/api/login', { email: 'ana@x.com', password: 'errada00' });
  assert.equal(r.status, 401);
  r = await ana2('POST', '/api/login', { email: 'Ana@X.com', password: '12345678' });
  assert.equal(r.status, 200);

  // fornecedor exige nome; a foto do cartão é opcional
  assert.equal((await ana('POST', '/api/suppliers', { card_photo: PNG })).status, 400);
  r = await ana('POST', '/api/suppliers', { name: 'Sem foto' });
  assert.equal(r.status, 201);
  assert.equal(r.body.card_photo, null);
  r = await ana('PUT', `/api/suppliers/${r.body.id}`, { name: 'Sem foto', card_photo: PNG });
  assert.match(r.body.card_photo, /^\/uploads\//, 'foto pode ser adicionada depois');
  const oldPhoto = r.body.card_photo;
  r = await ana('PUT', `/api/suppliers/${r.body.id}`, { name: 'Sem foto', booth: '1.1 A1', remove_card_photo: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.card_photo, null, 'foto excluída');
  assert.equal(r.body.name, 'Sem foto', 'dados continuam');
  assert.equal(r.body.booth, '1.1 A1');
  assert.equal((await ana('GET', oldPhoto)).status, 404, 'imagem apagada do banco');
  assert.equal((await ana('DELETE', `/api/suppliers/${r.body.id}`)).status, 200);
  r = await ana('POST', '/api/suppliers', { name: 'Shenzhen A', booth: '11.2 C23', card_photo: PNG });
  assert.equal(r.status, 201);
  const supA = r.body;
  r = await bruno('POST', '/api/suppliers', { name: 'Ningbo B', card_photo: PNG });
  const supB = r.body;

  // foto acessível pela equipe, não por outra empresa
  assert.equal((await bruno('GET', supA.card_photo)).status, 200);
  assert.equal((await outra('GET', supA.card_photo)).status, 404);

  // a outra empresa não vê nem usa fornecedores da primeira
  r = await outra('GET', '/api/suppliers');
  assert.equal(r.body.length, 0);
  r = await outra('POST', '/api/products', { name: 'X', offers: [{ supplier_id: supA.id, price_usd: 1 }] });
  assert.equal(r.status, 404);

  // produto com dois fornecedores
  r = await ana('POST', '/api/products', {
    name: 'Garrafa térmica', price_brl: 120, photo: PNG,
    offers: [
      { supplier_id: supA.id, price_usd: 5, moq: 500, incoterm: 'FOB', nationalization_pct: 100 }, // 5*2*5.5 = 55
      { supplier_id: supB.id, price_usd: 4, moq: 1000, incoterm: 'EXW', nationalization_pct: 120 }, // 4*2.2*5.5 = 48.4
    ],
  });
  assert.equal(r.status, 201);
  const prod = r.body;
  assert.equal(prod.offers[0].supplier_name, 'Ningbo B');
  assert.equal(prod.offers[0].estimated_brl, 48.4);

  r = await ana('POST', '/api/products', { name: 'Caro', price_brl: 10, offers: [{ supplier_id: supA.id, price_usd: 10, nationalization_pct: 50 }] });
  assert.equal(r.status, 201);
  r = await ana('POST', '/api/products', { name: 'Dup', offers: [{ supplier_id: supA.id, price_usd: 1 }, { supplier_id: supA.id, price_usd: 2 }] });
  assert.equal(r.status, 400);
  r = await ana('POST', '/api/products', { name: 'Inc', offers: [{ supplier_id: supA.id, price_usd: 1, incoterm: 'XYZ' }] });
  assert.equal(r.status, 400);

  // Bruno vê e edita o produto criado pela Ana
  r = await bruno('GET', '/api/products');
  assert.equal(r.body.length, 2);
  r = await bruno('PUT', `/api/products/${prod.id}`, {
    name: 'Garrafa térmica 500ml', price_brl: 120,
    offers: [{ supplier_id: supA.id, price_usd: 3, nationalization_pct: 100 }],
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.updated_by_name, 'Bruno');
  assert.equal(r.body.offers.length, 1);
  assert.ok(r.body.photo, 'foto mantida quando não enviada');

  // outra empresa não acessa
  assert.equal((await outra('GET', `/api/products/${prod.id}`)).status, 404);
  assert.equal((await outra('PUT', `/api/products/${prod.id}`, { name: 'hack' })).status, 404);

  // câmbio compartilhado e ranking
  r = await bruno('PUT', '/api/settings', { exchange_rate: 5 });
  assert.equal(r.body.company.exchange_rate, 5);
  r = await ana('GET', '/api/ranking');
  assert.equal(r.status, 200);
  assert.equal(r.body.exchange_rate, 5);
  assert.equal(r.body.items[0].name, 'Garrafa térmica 500ml'); // 30 vs 120 → 75%
  assert.equal(r.body.items[0].best.estimated_brl, 30);
  assert.equal(r.body.items[0].saving_pct, 75);
  assert.equal(r.body.items[1].advantageous, false); // 75 vs 10
  assert.equal(r.body.summary.advantageous, 1);
  assert.equal(r.body.suppliers[0].name, 'Shenzhen A');

  // excluir fornecedor remove as ofertas
  r = await ana('DELETE', `/api/suppliers/${supA.id}`);
  assert.equal(r.status, 200);
  r = await ana('GET', `/api/products/${prod.id}`);
  assert.equal(r.body.offers.length, 0);

  // caminho reescrito pela Vercel (?__p=)
  r = await ana('GET', '/api/index?__p=' + encodeURIComponent('/api/products/' + prod.id));
  assert.equal(r.status, 200);
  assert.equal(r.body.id, prod.id);

  // logout
  await ana('POST', '/api/logout', {});
  assert.equal((await ana('GET', '/api/me')).status, 401);

  // POST sem JSON é rejeitado (proteção CSRF)
  const raw = await fetch(base + '/api/login', { method: 'POST', body: 'email=a', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.equal(raw.status, 415);
});

test('serve a interface', async (t) => {
  const { base, close } = await setup();
  t.after(close);
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Missão China/);
  assert.equal((await fetch(base + '/../package.json')).status, 200); // cai no index (SPA), não expõe o arquivo
  assert.doesNotMatch(await (await fetch(base + '/%2e%2e/package.json')).text(), /"scripts"/);
});

test('administrador vê e edita fornecedores e produtos de todas as empresas', async (t) => {
  const { base, close } = await setup({ adminEmails: ['chefe@br.com'] });
  t.after(close);
  const a = client(base);
  const b = client(base);
  const admin = client(base);

  let r = await a('POST', '/api/register', { name: 'A', email: 'a@x.com', password: '12345678', cnpj: '11222333000181' });
  assert.equal(r.body.user.is_admin, false);
  await b('POST', '/api/register', { name: 'B', email: 'b@y.com', password: '12345678', cnpj: '12ABC34501DE35' });
  r = await admin('POST', '/api/register', { name: 'Chefe', email: 'Chefe@BR.com', password: '12345678', cnpj: '33000167000101'.replace('33000167000101', '11444777000161') });
  assert.equal(r.status, 201);
  assert.equal(r.body.user.role, 'admin');
  assert.equal(r.body.companies.length, 3);

  const supA = (await a('POST', '/api/suppliers', { name: 'Forn A', card_photo: PNG })).body;
  const supB = (await b('POST', '/api/suppliers', { name: 'Forn B', card_photo: PNG })).body;
  const prodA = (await a('POST', '/api/products', { name: 'Prod A', price_brl: 100, offers: [{ supplier_id: supA.id, price_usd: 2, nationalization_pct: 50 }] })).body;

  // usuários comuns continuam isolados
  assert.equal((await b('GET', `/api/products/${prodA.id}`)).status, 404);
  assert.equal((await b('GET', '/api/suppliers')).body.length, 1);
  assert.equal((await b('GET', '/api/suppliers?company=all')).body.length, 1, 'usuário comum ignora ?company');
  assert.equal((await b('GET', supA.card_photo)).status, 404);

  // admin enxerga tudo, ou filtra por empresa
  r = await admin('GET', '/api/suppliers?company=all');
  assert.deepEqual(r.body.map((s) => s.name).sort(), ['Forn A', 'Forn B']);
  assert.ok(r.body.every((s) => s.company_cnpj));
  r = await admin('GET', '/api/suppliers?company=12.ABC.345/01DE-35');
  assert.deepEqual(r.body.map((s) => s.name), ['Forn B']);
  assert.equal((await admin('GET', supA.card_photo)).status, 200);

  // admin edita produto de outra empresa, usando fornecedores daquela empresa
  r = await admin('PUT', `/api/products/${prodA.id}`, { name: 'Prod A (revisado)', price_brl: 100, offers: [{ supplier_id: supA.id, price_usd: 1, nationalization_pct: 50 }] });
  assert.equal(r.status, 200);
  assert.equal(r.body.updated_by_name, 'Chefe');
  assert.equal(r.body.company_cnpj, '11222333000181');
  r = await admin('PUT', `/api/products/${prodA.id}`, { name: 'Misturado', offers: [{ supplier_id: supB.id, price_usd: 1 }] });
  assert.equal(r.status, 404, 'não mistura fornecedor de outra empresa');
  assert.equal((await a('GET', `/api/products/${prodA.id}`)).body.name, 'Prod A (revisado)');

  // admin edita fornecedor de outra empresa e cria cadastro em nome dela
  r = await admin('PUT', `/api/suppliers/${supB.id}`, { name: 'Forn B editado' });
  assert.equal(r.status, 200);
  r = await admin('POST', '/api/suppliers', { name: 'Novo em B', card_photo: PNG, company: '12ABC34501DE35' });
  assert.equal(r.status, 201);
  assert.equal((await b('GET', '/api/suppliers')).body.length, 2);
  r = await admin('POST', '/api/suppliers', { name: 'X', card_photo: PNG, company: '99999999000191' });
  assert.equal(r.status, 400);

  // ranking geral e por empresa
  r = await admin('GET', '/api/ranking?company=all');
  assert.equal(r.body.items.length, 1);
  assert.equal(r.body.items[0].company_cnpj, '11222333000181');
  r = await admin('GET', '/api/ranking?company=12ABC34501DE35');
  assert.equal(r.body.items.length, 0);

  // admin exclui produto de outra empresa
  assert.equal((await admin('DELETE', `/api/products/${prodA.id}`)).status, 200);
  assert.equal((await a('GET', '/api/products')).body.length, 0);
});

test('fornecedor com telefone e contato; leitura de cartão', async (t) => {
  const seen = [];
  const readCard = async (mime, b64) => { seen.push([mime, b64.length]); return { company_name: 'ACME Ltd', phone: '+86 1', contact_name: 'Lily' }; };
  const { base, close } = await setup({ readCard });
  t.after(close);
  const a = client(base);
  let r = await a('POST', '/api/register', { name: 'A', email: 'a@x.com', password: '12345678', cnpj: '11222333000181' });
  assert.equal(r.body.features.card_ocr, true);

  assert.equal((await client(base)('POST', '/api/ocr/card', { image: PNG })).status, 401);
  r = await a('POST', '/api/ocr/card', { image: 'data:text/plain;base64,AAAA' });
  assert.equal(r.status, 400);
  r = await a('POST', '/api/ocr/card', { image: PNG });
  assert.equal(r.status, 200);
  assert.equal(r.body.company_name, 'ACME Ltd');
  assert.equal(seen[0][0], 'image/png');

  r = await a('POST', '/api/suppliers', { name: 'ACME', card_photo: PNG, contact_name: ' Lily Chen ', phone: '+86 138 0000 1111' });
  assert.equal(r.status, 201);
  assert.equal(r.body.contact_name, 'Lily Chen');
  assert.equal(r.body.phone, '+86 138 0000 1111');
  const supId = r.body.id;
  assert.equal(r.body.phone_whatsapp, false);
  r = await a('PUT', `/api/suppliers/${supId}`, { name: 'ACME', phone: '+86 138 0000 1111', phone_whatsapp: true, phone_wechat: true });
  assert.equal(r.body.phone_whatsapp, true);
  assert.equal(r.body.phone_wechat, true);
  r = await a('PUT', `/api/suppliers/${supId}`, { name: 'ACME', phone: '', phone_whatsapp: true });
  assert.equal(r.body.phone_whatsapp, false, 'sem telefone não há WhatsApp');
  assert.equal(r.body.address, null);
  assert.equal(r.body.province, null);
  r = await a('PUT', `/api/suppliers/${supId}`, { name: 'ACME', address: ' No. 88 Jiangnan Rd, Ningbo ', province: 'zhejiang' });
  assert.equal(r.body.address, 'No. 88 Jiangnan Rd, Ningbo');
  assert.equal(r.body.province, 'Zhejiang', 'província normalizada pelo nome da lista');
  assert.equal((await a('PUT', `/api/suppliers/${supId}`, { name: 'ACME', province: 'São Paulo' })).status, 400);
  assert.equal((await a('GET', `/api/suppliers/${supId}`)).body.province, 'Zhejiang', 'erro não altera o cadastro');
  r = await a('PUT', `/api/suppliers/${supId}`, { name: 'ACME', phone: '' });
  assert.equal(r.body.phone, null);
  assert.equal(r.body.contact_name, null);
  assert.equal(r.body.province, null);
});

test('produtos pela foto e reenvio sem duplicar (client_ref)', async (t) => {
  const readProducts = async () => ({ products: [{ name: 'Garrafa 500 ml', price_usd: 2.35, moq: 1000, incoterm: 'FOB' }] });
  const { base, close } = await setup({ readProducts });
  t.after(close);
  const a = client(base);
  const b = client(base);
  let r = await a('POST', '/api/register', { name: 'A', email: 'a@x.com', password: '12345678', cnpj: '11222333000181' });
  assert.equal(r.body.features.product_ocr, true);
  await b('POST', '/api/register', { name: 'B', email: 'b@y.com', password: '12345678', cnpj: '11444777000161' });

  assert.equal((await client(base)('POST', '/api/ocr/product', { image: PNG })).status, 401);
  assert.equal((await a('POST', '/api/ocr/product', { image: 'data:text/plain;base64,AAAA' })).status, 400);
  r = await a('POST', '/api/ocr/product', { image: PNG });
  assert.equal(r.status, 200);
  assert.equal(r.body.products[0].name, 'Garrafa 500 ml');

  // fornecedor e produto enviados duas vezes (sem internet, toque duplo) não duplicam
  const ref = 'ref-abc-12345678';
  r = await a('POST', '/api/suppliers', { name: 'S', client_ref: ref });
  assert.equal(r.status, 201);
  const sup = r.body;
  r = await a('POST', '/api/suppliers', { name: 'S', client_ref: ref });
  assert.equal(r.status, 200);
  assert.equal(r.body.id, sup.id);
  const prod = { name: 'Garrafa', client_ref: 'prod-ref-1234567', offers: [{ supplier_id: sup.id, price_usd: 2 }] };
  const p1 = await a('POST', '/api/products', prod);
  assert.equal(p1.status, 201);
  const p2 = await a('POST', '/api/products', prod);
  assert.equal(p2.status, 200);
  assert.equal(p2.body.id, p1.body.id);
  assert.equal((await a('GET', '/api/products')).body.length, 1);
  // o mesmo identificador em outra empresa é outro cadastro
  r = await b('POST', '/api/suppliers', { name: 'S', client_ref: ref });
  assert.equal(r.status, 201);
  assert.notEqual(r.body.id, sup.id);
  // identificador inválido é ignorado (cadastra normalmente)
  assert.equal((await a('POST', '/api/suppliers', { name: 'T', client_ref: 'x' })).status, 201);
  assert.equal((await a('POST', '/api/suppliers', { name: 'T', client_ref: 'x' })).status, 201);
});

test('teste de modelos de leitura: só administrador; roda as fotos em todos os modelos', async (t) => {
  const fake = (good) => ({
    readCard: async (m, b, meta) => { Object.assign(meta, { ms: 5, cost_usd: good ? 0.04 : 0.001 }); return good ? { company_name: 'Hairun', contact_name: 'Lily Chen', phone: '+86 138 0574 2266', phone_whatsapp: true, phone_wechat: false, booth: '11.2 C23', province: 'Zhejiang', email: 'lily@hairun-hw.com', wechat: 'lilychen_nb' } : { company_name: 'Hairun' }; },
    readProducts: async () => { throw new Error('falhou'); },
  });
  const cfg = { readCard: async (m, b, meta) => { Object.assign(meta, { model: 'claude-opus-5-5', escalated: 'leitura incompleta', cost_usd: 0.05 }); return fake(true).readCard(m, b, {}); }, readProducts: async () => ({ products: [] }) };
  const { base, close } = await setup({ adminEmails: ['chefe@br.com'], benchReaders: { 'claude-opus-5-5': fake(true), 'claude-haiku-5-5': fake(false), config: cfg } });
  t.after(close);
  const a = client(base);
  const admin = client(base);
  await a('POST', '/api/register', { name: 'A', email: 'a@x.com', password: '12345678', cnpj: '11222333000181' });
  await admin('POST', '/api/register', { name: 'Chefe', email: 'chefe@br.com', password: '12345678', cnpj: '12ABC34501DE35' });
  assert.equal((await a('GET', '/api/admin/ocr-bench')).status, 403);
  let r = await admin('GET', '/api/admin/ocr-bench');
  assert.equal(r.body.models.length, 3);
  assert.ok(r.body.models.find((m) => m.id === 'config').current, 'a configuração com reserva é a em uso');
  assert.match(r.body.models.find((m) => m.id === 'config').label, /Haiku 5.5 \+ Opus 5.5 de reserva/);
  assert.equal(r.body.samples.length, 6);
  r = await admin('POST', '/api/admin/ocr-bench/card-bilingual', {});
  const [opus, haiku, config] = r.body.results;
  assert.equal(config.model, 'config', 'o id da coluna não é trocado pelo modelo que respondeu');
  assert.equal(config.served_by, 'claude-opus-5-5');
  assert.equal(config.escalated, 'leitura incompleta');
  assert.equal(opus.points, opus.total);
  assert.ok(haiku.points < haiku.total);
  assert.equal(haiku.cost_usd, 0.001);
  r = await admin('POST', '/api/admin/ocr-bench/price-table', {});
  assert.ok(r.body.results.filter((x) => x.model !== 'config').every((x) => x.error && x.points === 0 && x.total > 0));
  assert.equal((await admin('POST', '/api/admin/ocr-bench/nao-existe', {})).status, 404);
  r = await admin('POST', '/api/admin/ocr-compare', { kind: 'card', image: PNG });
  assert.equal(r.body.results.length, 3);
  assert.equal((await a('POST', '/api/admin/ocr-compare', { kind: 'card', image: PNG })).status, 403);
});

test('revisão 2: cookie malformado, lista leve de nomes e fornecedor de outra empresa na oferta', async (t) => {
  const { base, close } = await setup();
  t.after(close);
  const a = client(base);
  const b = client(base);
  await a('POST', '/api/register', { name: 'A', email: 'a@x.com', password: '12345678', cnpj: '11222333000181' });
  await b('POST', '/api/register', { name: 'B', email: 'b@y.com', password: '12345678', cnpj: '11444777000161' });
  // cookie inválido de outro site não derruba a API
  const bad = await fetch(`${base}/api/me`, { headers: { Cookie: 'x=%E0%A4%A; sid=nada' } });
  assert.equal(bad.status, 401);
  const sA = (await a('POST', '/api/suppliers', { name: 'SA' })).body;
  const sA2 = (await a('POST', '/api/suppliers', { name: 'SA2' })).body;
  const sB = (await b('POST', '/api/suppliers', { name: 'SB' })).body;
  // oferta com fornecedor de outra empresa é recusada
  assert.equal((await a('POST', '/api/products', { name: 'X', offers: [{ supplier_id: sB.id, price_usd: 1 }] })).status, 404);
  let r = await a('POST', '/api/products', { name: 'Garrafa', offers: [{ supplier_id: sA.id, price_usd: 2 }, { supplier_id: sA2.id, price_usd: 1.5, moq: 100 }] });
  assert.equal(r.status, 201);
  assert.equal(r.body.offers.length, 2, 'várias ofertas gravadas de uma vez');
  assert.equal(r.body.offers[0].supplier_id, sA2.id, 'melhor preço primeiro');
  r = await a('GET', '/api/products?fields=names');
  assert.deepEqual(r.body, [{ id: r.body[0].id, name: 'Garrafa', company_cnpj: '11222333000181', offer_count: 2 }]);
  assert.equal((await b('GET', '/api/products?fields=names')).body.length, 0, 'só os da própria empresa');
});

test('controle de viagem: cada usuário tem o próprio extrato, com conversão para reais', async (t) => {
  const { base, close } = await setup({ adminEmails: ['chefe@br.com'] });
  t.after(close);
  const a = client(base);
  const colega = client(base);
  const admin = client(base);
  await a('POST', '/api/register', { name: 'A', email: 'a@x.com', password: '12345678', cnpj: '11222333000181' });
  await colega('POST', '/api/register', { name: 'C', email: 'c@x.com', password: '12345678', cnpj: '11222333000181' });
  await admin('POST', '/api/register', { name: 'Chefe', email: 'chefe@br.com', password: '12345678', cnpj: '12ABC34501DE35' });
  assert.equal((await client(base)('GET', '/api/expenses')).status, 401);

  let r = await a('GET', '/api/fx/rates');
  assert.equal(r.body.CNY, 0.71);
  assert.equal(r.body.BRL, 1);

  // validações
  assert.equal((await a('POST', '/api/expenses', { description: 'Táxi', spent_on: '2026-10-16', category: 'transporte', currency: 'CNY', amount: 50 })).status, 400, 'yuan sem câmbio');
  assert.equal((await a('POST', '/api/expenses', { description: 'Táxi', spent_on: '16/10/2026', category: 'transporte', currency: 'BRL', amount: 50 })).status, 400);
  assert.equal((await a('POST', '/api/expenses', { description: 'Táxi', spent_on: '2026-10-16', category: 'xyz', currency: 'BRL', amount: 50 })).status, 400);
  assert.equal((await a('POST', '/api/expenses', { description: 'Táxi', spent_on: '2026-10-16', category: 'transporte', currency: 'BRL', amount: -5 })).status, 400);

  r = await a('POST', '/api/expenses', { description: 'Táxi para a feira', spent_on: '2026-10-16', category: 'transporte', payment: 'wechat', currency: 'CNY', amount: 58.5, rate_brl: 0.71, client_ref: 'exp-ref-12345678' });
  assert.equal(r.status, 201);
  assert.equal(r.body.amount_brl, 41.54);
  const id = r.body.id;
  // reenvio (sem internet) não duplica
  r = await a('POST', '/api/expenses', { description: 'Táxi para a feira', spent_on: '2026-10-16', category: 'transporte', payment: 'wechat', currency: 'CNY', amount: 58.5, rate_brl: 0.71, client_ref: 'exp-ref-12345678' });
  assert.equal(r.status, 200);
  assert.equal(r.body.id, id);
  r = await a('POST', '/api/expenses', { description: 'Hotel', spent_on: '2026-10-15', category: 'hospedagem', currency: 'BRL', amount: 800, rate_brl: 999 });
  assert.equal(r.body.rate_brl, 1, 'real não tem câmbio');
  assert.equal(r.body.amount_brl, 800);

  r = await a('GET', '/api/expenses');
  assert.deepEqual(r.body.map((e) => e.description), ['Táxi para a feira', 'Hotel'], 'mais recente primeiro');

  // outra pessoa da mesma empresa e o administrador não veem nem alteram
  assert.equal((await colega('GET', '/api/expenses')).body.length, 0);
  assert.equal((await admin('GET', '/api/expenses')).body.length, 0);
  assert.equal((await colega('PUT', `/api/expenses/${id}`, { description: 'x', spent_on: '2026-10-16', category: 'outros', currency: 'BRL', amount: 1 })).status, 404);
  assert.equal((await admin('DELETE', `/api/expenses/${id}`)).status, 404);

  r = await a('PUT', `/api/expenses/${id}`, { description: 'Táxi', spent_on: '2026-10-16', category: 'transporte', currency: 'USD', amount: 10, rate_brl: 5.5 });
  assert.equal(r.body.amount_brl, 55);
  assert.equal(r.body.payment, null);
  assert.equal((await a('DELETE', `/api/expenses/${id}`)).status, 200);
  assert.equal((await a('GET', '/api/expenses')).body.length, 1);

  // excluir o usuário apaga o extrato dele
  const users = (await admin('GET', '/api/admin/users')).body;
  assert.equal((await admin('DELETE', `/api/admin/users/${users.find((u) => u.email === 'a@x.com').id}`)).status, 200);
});

// WAV PCM 16 bits, mono, 16 kHz, com a duração pedida.
function wav(seconds) {
  const data = Buffer.alloc(Math.round(seconds * 16000) * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24); h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return 'data:audio/wav;base64,' + Buffer.concat([h, data]).toString('base64');
}

test('créditos do intérprete: compra pelo Asaas (Pix), webhook, uso cobrado por segundo e cortesia', async (t) => {
  const remote = {}; // cobranças "no Asaas"
  const calls = [];
  const asaas = {
    sandbox: true,
    createCustomer: async (c) => { calls.push(['customer', c]); return { id: 'cus_1' }; },
    createPayment: async (p) => { calls.push(['payment', p]); const id = `pay_${Object.keys(remote).length + 1}`; remote[id] = { id, status: 'PENDING', invoiceUrl: `https://asaas/i/${id}` }; return remote[id]; },
    getPayment: async (id) => remote[id],
    pixQrCode: async () => ({ payload: '00020126PIXCOPIAECOLA', encodedImage: 'iVBORw0KGgo=', expirationDate: '2026-10-20 23:59:59' }),
  };
  const interpret = async (audio, from, to) => (audio.length > 50000
    ? { source: 'Qual o preço?', translated: '价格是多少？', audio: Buffer.from('mp3') } : { source: '', translated: '', audio: null });
  const { base, close } = await setup({ adminEmails: ['chefe@br.com'], asaas, interpret, asaasWebhookToken: 'tok-123' });
  t.after(close);
  const a = client(base);
  const b = client(base);
  const admin = client(base);
  let r = await a('POST', '/api/register', { name: 'A', email: 'a@x.com', password: '12345678', cnpj: '11222333000181' });
  assert.equal(r.body.features.interpreter, true);
  assert.equal(r.body.features.payments, true);
  await b('POST', '/api/register', { name: 'B', email: 'b@y.com', password: '12345678', cnpj: '11444777000161' });
  await admin('POST', '/api/register', { name: 'Chefe', email: 'chefe@br.com', password: '12345678', cnpj: '12ABC34501DE35' });

  r = await a('GET', '/api/credits');
  assert.equal(r.body.balance_seconds, 0);
  assert.deepEqual(r.body.packages.map((p) => p.minutes), [60, 180]);

  // sem saldo, o intérprete não traduz
  r = await a('POST', '/api/interpreter', { from: 'pt', to: 'zh', audio: wav(3.2) });
  assert.equal(r.status, 402);

  // compra por Pix
  assert.equal((await a('POST', '/api/credits/checkout', { package_id: 'nao-existe' })).status, 400);
  r = await a('POST', '/api/credits/checkout', { package_id: 'p60', method: 'pix' });
  assert.equal(r.status, 201);
  assert.equal(r.body.pix.payload, '00020126PIXCOPIAECOLA');
  assert.equal(r.body.paid, false);
  const payId = r.body.id;
  assert.deepEqual(calls[0], ['customer', { name: 'EMPRESA TESTE LTDA', cpfCnpj: '11222333000181', email: 'a@x.com' }]);
  assert.equal(calls[1][1].billingType, 'PIX');
  assert.equal(calls[1][1].value, 29);
  // outra empresa não vê o pagamento
  assert.equal((await b('GET', `/api/credits/payments/${payId}`)).status, 404);

  // webhook com token errado é recusado
  const hook = (token, body) => fetch(`${base}/api/asaas/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'asaas-access-token': token }, body: JSON.stringify(body) });
  assert.equal((await hook('errado', { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } })).status, 401);
  // webhook "pago" mas o Asaas ainda diz PENDING: não credita (o app confere na API)
  assert.equal((await hook('tok-123', { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } })).status, 200);
  assert.equal((await a('GET', '/api/credits')).body.balance_seconds, 0);
  // pago de verdade: credita uma vez, mesmo com webhooks repetidos
  remote.pay_1.status = 'RECEIVED';
  for (let i = 0; i < 3; i++) assert.equal((await hook('tok-123', { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_1' } })).status, 200);
  assert.equal((await a('GET', '/api/credits')).body.balance_seconds, 3600);
  r = await a('GET', `/api/credits/payments/${payId}`);
  assert.equal(r.body.paid, true);
  assert.equal(r.body.balance_seconds, 3600);
  // cobrança de outro sistema é ignorada
  assert.equal((await hook('tok-123', { event: 'PAYMENT_RECEIVED', payment: { id: 'pay_x' } })).status, 200);

  // cartão: sem webhook, a própria consulta da tela confirma
  r = await a('POST', '/api/credits/checkout', { package_id: 'p180', method: 'card' });
  assert.equal(r.body.invoice_url, 'https://asaas/i/pay_2');
  assert.equal(calls.filter((c) => c[0] === 'customer').length, 1, 'cliente do Asaas criado uma vez por empresa');
  remote.pay_2.status = 'CONFIRMED';
  r = await a('GET', `/api/credits/payments/${r.body.id}`);
  assert.equal(r.body.paid, true);
  assert.equal(r.body.balance_seconds, 3600 + 180 * 60);

  // uso: cobra os segundos do áudio (arredonda para cima); fala não reconhecida não cobra
  r = await a('POST', '/api/interpreter', { from: 'pt', to: 'zh', audio: wav(3.2) });
  assert.equal(r.status, 200);
  assert.equal(r.body.translated, '价格是多少？');
  assert.match(r.body.audio, /^data:audio\/mpeg;base64,/);
  assert.equal(r.body.charged_seconds, 4);
  assert.equal(r.body.balance_seconds, 3600 + 10800 - 4);
  r = await a('POST', '/api/interpreter', { from: 'pt', to: 'zh', audio: wav(1) });
  assert.equal(r.body.charged_seconds, 0);
  assert.equal((await a('POST', '/api/interpreter', { from: 'pt', to: 'pt', audio: wav(1) })).status, 400);
  assert.equal((await a('POST', '/api/interpreter', { from: 'pt', to: 'zh', audio: 'data:audio/wav;base64,AAAA' })).status, 400);
  assert.equal((await a('POST', '/api/interpreter', { from: 'pt', to: 'zh', audio: wav(65) })).status, 400, 'máximo 60 s por vez');

  // estorno retira os créditos daquela compra
  remote.pay_1.status = 'REFUNDED';
  await hook('tok-123', { event: 'PAYMENT_REFUNDED', payment: { id: 'pay_1' } });
  r = await a('GET', '/api/credits');
  assert.equal(r.body.balance_seconds, 10800 - 4);
  assert.deepEqual(r.body.ledger.map((l) => l.kind), ['refund', 'usage', 'purchase', 'purchase']);

  // administrador: cortesia, pacotes e visão geral
  assert.equal((await a('POST', '/api/admin/credits/grant', { cnpj: '11444777000161', minutes: 30 })).status, 403);
  r = await admin('POST', '/api/admin/credits/grant', { cnpj: '11444777000161', minutes: 30, note: 'Teste grátis' });
  assert.equal(r.body.balance_seconds, 1800);
  assert.equal((await b('GET', '/api/credits')).body.ledger[0].note, 'Teste grátis');
  assert.equal((await admin('PUT', '/api/admin/credits/packages', { packages: [{ minutes: 30, price: 0 }] })).status, 400);
  r = await admin('PUT', '/api/admin/credits/packages', { packages: [{ minutes: 30, price: 15 }, { minutes: 120, price: 49.9 }] });
  assert.deepEqual(r.body.packages.map((p) => p.id), ['p30', 'p120']);
  assert.deepEqual((await a('GET', '/api/credits')).body.packages.map((p) => p.price), [15, 49.9]);
  r = await admin('GET', '/api/admin/credits');
  const ca = r.body.companies.find((c) => c.cnpj === '11222333000181');
  assert.equal(ca.used_seconds, 4);
  assert.equal(ca.paid, 29 + 79);
  assert.equal(r.body.webhook_configured, true);
});

test('leitor de cartões desligado sem chave de API', async (t) => {
  const { base, close } = await setup();
  t.after(close);
  const a = client(base);
  const r = await a('POST', '/api/register', { name: 'A', email: 'a@x.com', password: '12345678', cnpj: '11222333000181' });
  assert.equal(r.body.features.card_ocr, false);
  const o = await a('POST', '/api/ocr/card', { image: PNG });
  assert.equal(o.status, 503);
  assert.match(o.body.error, /ANTHROPIC_API_KEY/);
});

test('câmbio automático com opção manual quando a API falha', async (t) => {
  let up = true;
  const fxQuote = async () => { if (!up) throw new Error('fora do ar'); return { rate: 4.99, source: 'PTAX Banco Central', quoted_at: '2026-10-09T16:07:30.000Z' }; };
  const { base, close } = await setup({ fxQuote });
  t.after(close);
  const a = client(base);
  let r = await a('POST', '/api/register', { name: 'A', email: 'a@x.com', password: '12345678', cnpj: '11222333000181' });
  assert.equal(r.body.company.exchange_rate, 4.99, 'empresa nova já nasce com a cotação do dia');
  assert.equal(r.body.company.rate_mode, 'auto');
  assert.equal(r.body.fx.ok, true);

  // usuário fixa valor manual
  r = await a('PUT', '/api/settings', { exchange_rate: '5,25' });
  assert.equal(r.body.company.exchange_rate, 5.25);
  assert.equal(r.body.company.rate_mode, 'manual');

  // API fora: "atualizar agora" informa a falha e mantém o valor manual
  up = false;
  r = await a('POST', '/api/fx/refresh', {});
  assert.equal(r.status, 200);
  assert.equal(r.body.fx.ok, false);
  assert.equal(r.body.company.exchange_rate, 5.25);

  // volta para automático quando a API volta
  up = true;
  await a('POST', '/api/fx/refresh', {});
  r = await a('PUT', '/api/settings', { mode: 'auto' });
  assert.equal(r.body.company.rate_mode, 'auto');
  assert.equal(r.body.company.exchange_rate, 4.99);
  assert.equal(r.body.company.rate_source, 'PTAX Banco Central');
  assert.equal((await a('PUT', '/api/settings', { exchange_rate: 0 })).status, 400);
});

test('unidades por container 40HQ no produto e frete 40HQ definido pelo administrador', async (t) => {
  const { base, close } = await setup({ adminEmails: ['chefe@br.com'] });
  t.after(close);
  const a = client(base);
  const admin = client(base);
  let r = await a('POST', '/api/register', { name: 'A', email: 'a@x.com', password: '12345678', cnpj: '11222333000181' });
  assert.equal(r.body.settings.freight_40hq_usd, null);
  await admin('POST', '/api/register', { name: 'Chefe', email: 'chefe@br.com', password: '12345678', cnpj: '11444777000161' });

  const sup = (await a('POST', '/api/suppliers', { name: 'S', card_photo: PNG })).body;
  r = await a('POST', '/api/products', { name: 'P', units_per_40hq: '12000', offers: [{ supplier_id: sup.id, price_usd: 1 }] });
  assert.equal(r.status, 201);
  assert.equal(r.body.units_per_40hq, 12000);
  assert.equal((await a('POST', '/api/products', { name: 'X', units_per_40hq: 1.5 })).status, 400);
  assert.equal((await a('POST', '/api/products', { name: 'X', units_per_40hq: 0 })).status, 400);
  r = await a('PUT', `/api/products/${r.body.id}`, { name: 'P', units_per_40hq: null, offers: [] });
  assert.equal(r.body.units_per_40hq, null);

  // só o administrador altera o frete
  assert.equal((await a('PUT', '/api/admin/settings', { freight_40hq_usd: 100 })).status, 403);
  r = await admin('PUT', '/api/admin/settings', { freight_40hq_usd: '3500,50' });
  assert.equal(r.status, 200);
  assert.equal(r.body.settings.freight_40hq_usd, 3500.5);
  assert.equal(r.body.settings.freight_updated_by, 'Chefe');
  r = await a('GET', '/api/me');
  assert.equal(r.body.settings.freight_40hq_usd, 3500.5, 'todos os usuários enxergam o valor');
  assert.equal((await admin('PUT', '/api/admin/settings', { freight_40hq_usd: -1 })).status, 400);
});

test('frete 40HQ entra no preço estimado dos produtos e no ranking', async (t) => {
  const { base, close } = await setup({ adminEmails: ['chefe@br.com'] });
  t.after(close);
  const a = client(base);
  const admin = client(base);
  await a('POST', '/api/register', { name: 'A', email: 'a@x.com', password: '12345678', cnpj: '11222333000181' });
  await admin('POST', '/api/register', { name: 'Chefe', email: 'chefe@br.com', password: '12345678', cnpj: '11444777000161' });
  await a('PUT', '/api/settings', { exchange_rate: 5 });
  const sup = (await a('POST', '/api/suppliers', { name: 'S', card_photo: PNG })).body;
  const sup2 = (await a('POST', '/api/suppliers', { name: 'T', card_photo: PNG })).body;
  let r = await a('POST', '/api/products', { name: 'P', price_brl: 100, units_per_40hq: 1000, offers: [
    { supplier_id: sup.id, price_usd: 10, incoterm: 'FOB', nationalization_pct: 100 },
    { supplier_id: sup2.id, price_usd: 11, incoterm: 'CIF', nationalization_pct: 100 },
  ] });
  const id = r.body.id;
  assert.equal(r.body.offers[0].estimated_brl, 100, 'sem frete definido: 10 × 2 × 5');

  await admin('PUT', '/api/admin/settings', { freight_40hq_usd: 2000 }); // 2 US$/un.
  r = await a('GET', `/api/products/${id}`);
  const fob = r.body.offers.find((o) => o.incoterm === 'FOB');
  const cif = r.body.offers.find((o) => o.incoterm === 'CIF');
  assert.equal(fob.freight_usd, 2);
  assert.equal(fob.estimated_brl, 120, '(10 + 2) × 2 × 5');
  assert.equal(cif.freight_usd, 0);
  assert.equal(cif.estimated_brl, 110, 'CIF já inclui frete');
  assert.equal(r.body.offers[0].incoterm, 'CIF', 'CIF passa a ser o melhor');

  r = await a('GET', '/api/ranking');
  assert.equal(r.body.items[0].best.supplier_name, 'T');
  assert.equal(r.body.items[0].best.estimated_brl, 110);
  r = await a('GET', `/api/suppliers/${sup.id}`);
  assert.equal(r.body.products[0].estimated_brl, 120);
  r = await a('GET', '/api/products');
  assert.equal(r.body[0].offers[1].estimated_brl, 120);
});

test('roteiro: administrador envia Excel por CNPJ, edita e exclui; usuários só veem o da sua empresa', async (t) => {
  const { base, close } = await setup({ adminEmails: ['chefe@br.com'] });
  t.after(close);
  const xlsx = 'data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,' +
    fs.readFileSync(path.join(__dirname, 'fixtures', 'roteiro-exemplo.xlsx')).toString('base64');
  const a = client(base);
  const b = client(base);
  const admin = client(base);
  await a('POST', '/api/register', { name: 'A', email: 'a@x.com', password: '12345678', cnpj: '11222333000181' });
  await b('POST', '/api/register', { name: 'B', email: 'b@y.com', password: '12345678', cnpj: '11444777000161' });
  await admin('POST', '/api/register', { name: 'Chefe', email: 'chefe@br.com', password: '12345678', cnpj: '12ABC34501DE35' });

  // só admin envia
  assert.equal((await a('POST', '/api/itineraries', { file: xlsx })).status, 403);
  let r = await admin('POST', '/api/itineraries', { file: 'data:text/csv;base64,YSxi', company: '11222333000181' });
  assert.equal(r.status, 400);
  r = await admin('POST', '/api/itineraries', { file: xlsx, file_name: 'Roteiro Out 2026.xlsx', company: '11222333000181' });
  assert.equal(r.status, 201);
  const id = r.body.id;
  assert.equal(r.body.title, 'ROTEIRO CHINA – OUTUBRO 2026', 'título vem do topo da planilha');
  assert.equal(r.body.company_cnpj, '11222333000181');
  assert.equal(r.body.days.length, 4);
  assert.equal(r.body.start_date, '2026-10-15');

  // A vê; B não
  r = await a('GET', '/api/itineraries');
  assert.equal(r.body.length, 1);
  assert.equal(r.body[0].item_count, 5);
  assert.equal((await a('GET', `/api/itineraries/${id}`)).body.days[0].items[0].time, '07:30');
  assert.equal((await b('GET', '/api/itineraries')).body.length, 0);
  assert.equal((await b('GET', `/api/itineraries/${id}`)).status, 404);

  // planilha original: só o administrador baixa; usuários veem apenas o roteiro visual
  const dl = await fetch(`${base}/api/itineraries/${id}/file`, { headers: { Cookie: '' } });
  assert.equal(dl.status, 401);
  assert.equal((await a('GET', `/api/itineraries/${id}/file`)).status, 403);
  assert.equal((await b('GET', `/api/itineraries/${id}/file`)).status, 403);
  r = await admin('GET', `/api/itineraries/${id}/file`);
  assert.equal(r.status, 200);

  // A não edita nem exclui
  assert.equal((await a('PUT', `/api/itineraries/${id}`, { title: 'x' })).status, 403);
  assert.equal((await a('DELETE', `/api/itineraries/${id}`)).status, 403);

  // admin edita título e uma atividade
  const full = (await admin('GET', `/api/itineraries/${id}`)).body;
  full.days[0].items[0].activity = 'Chegada – voo EK362 (atrasado)';
  full.days.push({ date: '2026-10-19', items: [{ time: '18:00', activity: 'Voo de volta' }] });
  r = await admin('PUT', `/api/itineraries/${id}`, { title: 'Viagem China', days: full.days });
  assert.equal(r.status, 200);
  assert.equal(r.body.title, 'Viagem China');
  assert.equal(r.body.end_date, '2026-10-19');
  assert.equal((await a('GET', `/api/itineraries/${id}`)).body.days[0].items[0].activity, 'Chegada – voo EK362 (atrasado)');

  // admin substitui pela planilha e filtra por empresa
  r = await admin('PUT', `/api/itineraries/${id}`, { file: xlsx, file_name: 'novo.xlsx' });
  assert.equal(r.body.days.length, 4);
  assert.equal((await admin('GET', '/api/itineraries?company=11444777000161')).body.length, 0);
  assert.equal((await admin('GET', '/api/itineraries?company=all')).body.length, 1);

  // admin exclui
  assert.equal((await admin('DELETE', `/api/itineraries/${id}`)).status, 200);
  assert.equal((await a('GET', '/api/itineraries')).body.length, 0);
});

test('cartão de visitas do próprio usuário: salvar, trocar, remover; cada usuário tem o seu', async (t) => {
  const { base, close } = await setup();
  t.after(close);
  const a = client(base);
  const a2 = client(base);
  const b = client(base);
  let r = await a('POST', '/api/register', { name: 'A', email: 'a@x.com', password: '12345678', cnpj: '11222333000181' });
  assert.equal(r.body.user.card_photo, null);
  await a2('POST', '/api/register', { name: 'A2', email: 'a2@x.com', password: '12345678', cnpj: '11222333000181' });
  await b('POST', '/api/register', { name: 'B', email: 'b@y.com', password: '12345678', cnpj: '11444777000161' });

  assert.equal((await a('PUT', '/api/me/card', { image: 'data:text/plain;base64,AAAA' })).status, 400);
  r = await a('PUT', '/api/me/card', { image: PNG });
  assert.equal(r.status, 200);
  const first = r.body.user.card_photo;
  assert.match(first, /^\/uploads\/[0-9a-f]{32}$/);
  assert.equal((await a('GET', '/api/me')).body.user.card_photo, first, 'persiste');
  assert.equal((await a2('GET', '/api/me')).body.user.card_photo, null, 'colega do mesmo CNPJ não herda o cartão');
  assert.equal((await a('GET', first)).status, 200);
  assert.equal((await b('GET', first)).status, 404, 'outra empresa não acessa a imagem');

  r = await a('PUT', '/api/me/card', { image: PNG });
  assert.notEqual(r.body.user.card_photo, first);
  assert.equal((await a('GET', first)).status, 404, 'foto antiga é apagada ao trocar');

  // login devolve o cartão
  const again = client(base);
  r = await again('POST', '/api/login', { email: 'a@x.com', password: '12345678' });
  assert.equal(r.body.user.card_photo, (await a('GET', '/api/me')).body.user.card_photo);

  r = await a('DELETE', '/api/me/card');
  assert.equal(r.body.user.card_photo, null);
});

test('revisão: imagem falsa recusada, miniaturas, ranking com empresa inexistente, cabeçalhos de segurança', async (t) => {
  const { base, close } = await setup({ adminEmails: ['chefe@br.com'] });
  t.after(close);
  const admin = client(base);
  await admin('POST', '/api/register', { name: 'Chefe', email: 'chefe@br.com', password: '12345678', cnpj: '11222333000181' });

  // conteúdo que não é imagem, mesmo declarado como PNG
  const fake = 'data:image/png;base64,' + Buffer.from('<html><script>alert(1)</script></html>').toString('base64');
  assert.equal((await admin('POST', '/api/suppliers', { name: 'X', card_photo: fake })).status, 400);

  // foto + miniatura; sem miniatura, /thumb devolve a foto
  let r = await admin('POST', '/api/suppliers', { name: 'S', card_photo: PNG, card_photo_thumb: PNG });
  assert.equal(r.status, 201);
  let res = await fetch(base + r.body.card_photo + '/thumb', { headers: { Cookie: '' } });
  assert.equal(res.status, 401, 'miniatura também exige login');
  const withCookie = await admin('GET', r.body.card_photo + '/thumb');
  assert.equal(withCookie.status, 200);
  r = await admin('POST', '/api/suppliers', { name: 'T', card_photo: PNG });
  assert.equal((await admin('GET', r.body.card_photo + '/thumb')).status, 200);
  assert.equal((await admin('GET', r.body.card_photo + '/outra')).status, 404);

  // ranking filtrado por empresa que não existe não quebra
  r = await admin('GET', '/api/ranking?company=99999999000191');
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 0);

  // cabeçalhos de segurança
  res = await fetch(base + '/');
  assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

test('revisão: login não revela e-mails cadastrados e tem limite de tentativas', async (t) => {
  const { base, close } = await setup();
  t.after(close);
  const a = client(base);
  await a('POST', '/api/register', { name: 'A', email: 'a@x.com', password: '12345678', cnpj: '11222333000181' });
  const time = async (email) => { const t0 = performance.now(); await client(base)('POST', '/api/login', { email, password: 'errada000' }); return performance.now() - t0; };
  const missing = await time('ninguem@x.com');
  const existing = await time('a@x.com');
  assert.ok(missing > existing * 0.4, `tempo parecido para e-mail inexistente (${missing.toFixed(0)}ms) e existente (${existing.toFixed(0)}ms)`);
  const c = client(base);
  let last;
  for (let i = 0; i < 11; i++) last = await c('POST', '/api/login', { email: 'a@x.com', password: 'errada000' });
  assert.equal(last.status, 429);
});

test('administração: listar, mudar empresa e excluir usuários; excluir empresa só sem usuários', async (t) => {
  const { base, close } = await setup({ adminEmails: ['chefe@br.com'] });
  t.after(close);
  const admin = client(base);
  const a = client(base);
  const b = client(base);
  await admin('POST', '/api/register', { name: 'Chefe', email: 'chefe@br.com', password: '12345678', cnpj: '11444777000161' });
  let r = await a('POST', '/api/register', { name: 'Ana', email: 'ana@x.com', password: '12345678', cnpj: '11222333000181' });
  await b('POST', '/api/register', { name: 'Bia', email: 'bia@x.com', password: '12345678', cnpj: '11222333000181' });
  await a('PUT', '/api/me/card', { image: PNG });
  const sup = (await a('POST', '/api/suppliers', { name: 'S', card_photo: PNG })).body;
  await a('POST', '/api/products', { name: 'P', offers: [{ supplier_id: sup.id, price_usd: 1 }] });

  // só admin
  assert.equal((await a('GET', '/api/admin/users')).status, 403);
  assert.equal((await a('GET', '/api/admin/companies')).status, 403);
  assert.equal((await a('DELETE', '/api/admin/companies/11444777000161')).status, 403);

  let users = (await admin('GET', '/api/admin/users')).body;
  assert.deepEqual(users.map((u) => u.name), ['Ana', 'Bia', 'Chefe']);
  assert.equal(users.find((u) => u.name === 'Chefe').is_self, true);
  let companies = (await admin('GET', '/api/admin/companies')).body;
  const casa = companies.find((c) => c.cnpj === '11222333000181');
  assert.deepEqual([casa.users, casa.suppliers, casa.products], [2, 1, 1]);

  // empresa com usuários não pode ser excluída
  r = await admin('DELETE', '/api/admin/companies/11222333000181');
  assert.equal(r.status, 409);
  assert.match(r.body.error, /2 usuário/);

  // admin não exclui a si mesmo
  const me = users.find((u) => u.is_self);
  assert.equal((await admin('DELETE', `/api/admin/users/${me.id}`)).status, 400);

  // mudar Ana de empresa: passa a ver a empresa nova e mantém o cartão pessoal
  const ana = users.find((u) => u.name === 'Ana');
  assert.equal((await admin('PUT', `/api/admin/users/${ana.id}`, { cnpj: '99999999000191' })).status, 400);
  assert.equal((await admin('PUT', `/api/admin/users/${ana.id}`, { cnpj: '11.444.777/0001-61' })).status, 200);
  r = await a('GET', '/api/me');
  assert.equal(r.body.company.cnpj, '11444777000161');
  assert.equal((await a('GET', r.body.user.card_photo)).status, 200, 'cartão continua acessível');
  assert.equal((await a('GET', '/api/products')).body.length, 0, 'não vê mais os dados da empresa antiga');

  // excluir Bia (que criou registros? não) e Ana (criou fornecedor/produto: referências são limpas)
  const bia = users.find((u) => u.name === 'Bia');
  assert.equal((await admin('DELETE', `/api/admin/users/${bia.id}`)).status, 200);
  assert.equal((await b('GET', '/api/me')).status, 401, 'sessão da usuária excluída deixa de valer');
  assert.equal((await admin('DELETE', `/api/admin/users/${ana.id}`)).status, 200);
  assert.equal((await admin('GET', '/api/products?company=11222333000181')).body[0].updated_by_name, null);

  // agora a empresa sem usuários pode ser excluída, com todos os dados
  r = await admin('DELETE', '/api/admin/companies/11222333000181');
  assert.equal(r.status, 200);
  companies = (await admin('GET', '/api/admin/companies')).body;
  assert.deepEqual(companies.map((c) => c.cnpj), ['11444777000161']);
  assert.equal((await admin('GET', '/api/products?company=all')).body.length, 0);
  assert.equal((await admin('GET', sup.card_photo)).status, 404, 'fotos da empresa apagadas');
  assert.equal((await admin('DELETE', '/api/admin/companies/11222333000181')).status, 404);
});
