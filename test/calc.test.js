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

test('frete por unidade entra no estimado, exceto quando o Incoterm já inclui o frete', () => {
  const { freightPerUnit, offerFreight } = require('../src/calc');
  assert.equal(freightPerUnit(3500, 10000), 0.35);
  assert.equal(freightPerUnit(3500, null), 0, 'sem unidades, sem frete');
  assert.equal(freightPerUnit(0, 1000), 0);
  assert.equal(offerFreight('FOB', 0.35), 0.35);
  assert.equal(offerFreight('EXW', 0.35), 0.35);
  assert.equal(offerFreight(null, 0.35), 0.35);
  assert.equal(offerFreight('CIF', 0.35), 0);
  assert.equal(offerFreight('ddp', 0.35), 0);
  // (10 + 0,5) × 1,8 × 5 = 94,5
  assert.equal(Math.round(estimateBrl(10, 80, 5, 0.5) * 100) / 100, 94.5);

  // ranking: FOB mais barato no papel perde para CIF quando o frete é somado
  const products = [{ id: 1, name: 'P', price_brl: 100, units_per_40hq: 1000 }];
  const offers = [
    { product_id: 1, supplier_id: 1, supplier_name: 'FOB', incoterm: 'FOB', price_usd: 10, nationalization_pct: 0 },
    { product_id: 1, supplier_id: 2, supplier_name: 'CIF', incoterm: 'CIF', price_usd: 11, nationalization_pct: 0 },
  ];
  const [r] = buildRanking(products, offers, 5, 3000); // frete 3/un.
  assert.equal(r.best.supplier_name, 'CIF');
  assert.equal(r.best.estimated_brl, 55);
  assert.equal(r.options[1].estimated_brl, 65);
  assert.equal(r.options[1].freight_usd, 3);
});
