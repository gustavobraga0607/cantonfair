'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { estimateBrl, buildRanking } = require('../src/calc');

test('preço estimado = US$ × (1 + %) × câmbio', () => {
  assert.equal(estimateBrl(10, 80, 5), 90);
  assert.equal(estimateBrl(10, 0, 5), 50);
});

test('ranking escolhe o fornecedor mais barato e ordena pela economia', () => {
  const products = [
    { id: 1, name: 'Caneca', price_brl: 100 },
    { id: 2, name: 'Mochila', price_brl: 50 },
    { id: 3, name: 'Sem preço BR', price_brl: null },
  ];
  const offers = [
    { product_id: 1, supplier_id: 10, supplier_name: 'A', price_usd: 10, nationalization_pct: 100 }, // 100
    { product_id: 1, supplier_id: 11, supplier_name: 'B', price_usd: 5, nationalization_pct: 100 },  // 50
    { product_id: 2, supplier_id: 10, supplier_name: 'A', price_usd: 4, nationalization_pct: 50 },   // 30
    { product_id: 3, supplier_id: 10, supplier_name: 'A', price_usd: 1, nationalization_pct: 0 },
  ];
  const r = buildRanking(products, offers, 5);
  assert.deepEqual(r.map((x) => x.product_id), [1, 2, 3]);
  assert.equal(r[0].best.supplier_name, 'B');
  assert.equal(r[0].saving_pct, 50);
  assert.equal(r[1].saving_pct, 40);
  assert.equal(r[2].saving_pct, null);
  assert.equal(r[2].advantageous, false);
});
