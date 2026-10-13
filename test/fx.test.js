'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { open } = require('../src/db');
const { fetchUsdBrl, createFxService, SOURCES } = require('../src/fx');

const json = (status, body) => ({ status, ok: status < 300, json: async () => body });

test('lê PTAX do Banco Central e cai para as outras fontes quando falha', async () => {
  const ptax = { value: [{ cotacaoCompra: 4.98, cotacaoVenda: 4.9892, dataHoraCotacao: '2026-10-09 13:07:30.746' }] };
  let q = await fetchUsdBrl({ fetchImpl: async () => json(200, ptax) });
  assert.deepEqual(q, { rate: 4.9892, source: 'PTAX Banco Central', quoted_at: '2026-10-09T16:07:30.000Z' });

  const awesome = { USDBRL: { bid: '5.40', ask: '5.41', timestamp: '1791849451' } };
  q = await fetchUsdBrl({ fetchImpl: async (url) => (url.includes('bcb') ? json(500, {}) : json(200, awesome)) });
  assert.equal(q.source, 'AwesomeAPI');
  assert.equal(q.rate, 5.41, 'usa a taxa de venda');

  const er = { result: 'success', rates: { BRL: 5.3 }, time_last_update_unix: 1791849451 };
  q = await fetchUsdBrl({ fetchImpl: async (url) => (url.includes('er-api') ? json(200, er) : json(429, {})) });
  assert.equal(q.source, 'ExchangeRate-API');

  await assert.rejects(fetchUsdBrl({ fetchImpl: async () => { throw new Error('offline'); } }), /offline/);
  await assert.rejects(fetchUsdBrl({ fetchImpl: async () => json(200, { result: 'success', rates: { BRL: 9999 } }) }), /inválida/);
  assert.equal(SOURCES.length, 3);
});

test('serviço guarda a cotação, aplica às empresas automáticas e respeita as manuais', async () => {
  const db = open({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'fx-')) });
  const t0 = Date.parse('2026-10-13T12:00:00Z');
  let clock = t0;
  let calls = 0;
  let next = { rate: 5.1, source: 'PTAX Banco Central', quoted_at: '2026-10-13T16:00:00.000Z' };
  const fetchQuote = async () => { calls++; if (next instanceof Error) throw next; return next; };
  const fx = createFxService({ db, fetchQuote, now: () => clock });

  await db.run("INSERT INTO companies (cnpj, name, created_at) VALUES ('A', 'auto', 'x')");
  await db.run("INSERT INTO companies (cnpj, name, rate_mode, exchange_rate, created_at) VALUES ('M', 'manual', 'manual', 6, 'x')");

  let s = await fx.ensureFresh();
  assert.equal(s.ok, true);
  assert.equal(s.rate, 5.1);
  assert.equal((await db.get("SELECT exchange_rate FROM companies WHERE cnpj = 'A'")).exchange_rate, 5.1);
  assert.equal((await db.get("SELECT exchange_rate FROM companies WHERE cnpj = 'M'")).exchange_rate, 6, 'manual não muda');

  // dentro de 30 min usa o cache
  clock += 10 * 60_000;
  await fx.ensureFresh();
  assert.equal(calls, 1);

  // falha: mantém o último valor e informa erro; não tenta de novo por 5 min
  clock += 25 * 60_000;
  next = new Error('fora do ar');
  s = await fx.ensureFresh();
  assert.equal(calls, 2);
  assert.equal(s.ok, false);
  assert.equal(s.rate, 5.1);
  assert.match(s.error, /cotação automática/);
  clock += 60_000;
  await fx.ensureFresh();
  assert.equal(calls, 2, 'espera antes de tentar de novo');
  // "Atualizar agora" força nova tentativa
  next = { rate: 5.2, source: 'AwesomeAPI', quoted_at: '2026-10-13T16:40:00.000Z' };
  s = await fx.ensureFresh({ force: true });
  assert.equal(s.ok, true);
  assert.equal(s.rate, 5.2);
  assert.equal((await db.get("SELECT exchange_rate, rate_source FROM companies WHERE cnpj = 'A'")).rate_source, 'AwesomeAPI');
  await db.close();
});
