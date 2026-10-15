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
async function setup({ adminEmails = [], readCard = null, fxQuote = null } = {}) {
  let db;
  if (process.env.TEST_DATABASE_URL) {
    db = open({ databaseUrl: process.env.TEST_DATABASE_URL });
    await db.run('DROP TABLE IF EXISTS offers, products, suppliers, images, sessions, itineraries, app_settings, users, companies, fx_quotes CASCADE')
      .catch(() => {});
    await db.close();
    db = open({ databaseUrl: process.env.TEST_DATABASE_URL });
  } else {
    db = open({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'cantonfair-')) });
  }
  const lookup = async (c) => (c === '33000167000101' ? { status: 'not_found' } : { status: 'found', name: 'EMPRESA TESTE LTDA' });
  const server = http.createServer(createApp({ db, publicDir: path.join(__dirname, '..', 'public'), cnpjLookup: lookup, adminEmails, readCard,
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

  // fornecedor exige nome e foto do cartão
  r = await ana('POST', '/api/suppliers', { name: 'Sem foto' });
  assert.equal(r.status, 400);
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
