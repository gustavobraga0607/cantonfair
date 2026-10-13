'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const cnpj = require('../src/cnpj');

test('aceita CNPJs numéricos válidos, com ou sem máscara', () => {
  assert.equal(cnpj.isValid('11.222.333/0001-81'), true);
  assert.equal(cnpj.isValid('11222333000181'), true);
  assert.equal(cnpj.isValid('33.000.167/0001-01'), true); // Petrobras
});

test('rejeita dígitos verificadores errados, tamanho errado e sequências repetidas', () => {
  assert.equal(cnpj.isValid('11.222.333/0001-82'), false);
  assert.equal(cnpj.isValid('1122233300018'), false);
  assert.equal(cnpj.isValid('00000000000000'), false);
  assert.equal(cnpj.isValid('11111111111111'), false);
  assert.equal(cnpj.isValid(''), false);
  assert.equal(cnpj.isValid(null), false);
});

test('aceita o novo CNPJ alfanumérico (exemplo oficial da Receita)', () => {
  assert.equal(cnpj.isValid('12.ABC.345/01DE-35'), true);
  assert.equal(cnpj.isValid('12abc34501de35'), true);
  assert.equal(cnpj.isValid('12.ABC.345/01DE-36'), false);
  assert.equal(cnpj.isValid('12.ABC.345/01DE-3A'), false); // DV sempre numérico
});

test('formata CNPJ', () => {
  assert.equal(cnpj.format('11222333000181'), '11.222.333/0001-81');
});

test('lookup interpreta respostas e passa para a próxima fonte quando uma falha', async () => {
  const mk = (status, json) => async () => ({ status, ok: status < 300, json: async () => json });
  assert.equal((await cnpj.lookup('11222333000181', { fetchImpl: mk(404) })).status, 'not_found');
  assert.equal((await cnpj.lookup('11222333000181', { fetchImpl: mk(500) })).status, 'unavailable');
  const found = await cnpj.lookup('11222333000181', { fetchImpl: mk(200, { razao_social: 'ACME LTDA' }) });
  assert.equal(found.status, 'found');
  assert.equal(found.name, 'ACME LTDA');
  const offline = await cnpj.lookup('11222333000181', { fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(offline.status, 'unavailable');

  // primeira fonte bloqueada (403), segunda responde
  const calls = [];
  const fallback = await cnpj.lookup('11222333000181', {
    fetchImpl: async (url) => {
      calls.push(url);
      return calls.length === 1 ? { status: 403, ok: false } : { status: 200, ok: true, json: async () => ({ razao_social: 'X SA' }) };
    },
  });
  assert.equal(fallback.status, 'found');
  assert.equal(fallback.source, 'minhareceita');
  assert.equal(calls.length, 2);
});
