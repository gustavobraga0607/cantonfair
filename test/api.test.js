'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { open } = require('../src/db');
const { createApp } = require('../src/app');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// Por padrão os testes usam SQLite; defina TEST_DATABASE_URL para rodar contra Postgres.
async function setup() {
  let db;
  if (process.env.TEST_DATABASE_URL) {
    db = open({ databaseUrl: process.env.TEST_DATABASE_URL });
    await db.run('DROP TABLE IF EXISTS offers, products, suppliers, images, sessions, users, companies CASCADE')
      .catch(() => {});
    await db.close();
    db = open({ databaseUrl: process.env.TEST_DATABASE_URL });
  } else {
    db = open({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'cantonfair-')) });
  }
  const lookup = async (c) => (c === '33000167000101' ? { status: 'not_found' } : { status: 'found', name: 'EMPRESA TESTE LTDA' });
  const server = http.createServer(createApp({ db, publicDir: path.join(__dirname, '..', 'public'), cnpjLookup: lookup }));
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
  assert.match(await r.text(), /Canton Fair Buyer/);
  assert.equal((await fetch(base + '/../package.json')).status, 200); // cai no index (SPA), não expõe o arquivo
  assert.doesNotMatch(await (await fetch(base + '/%2e%2e/package.json')).text(), /"scripts"/);
});
