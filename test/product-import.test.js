'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { buildTemplate, parseProductsXlsx } = require('../src/product-import');

async function sheet(header, values) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Produtos');
  ws.addRow(header);
  ws.addRow(values);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test('modelo do app: cada coluna no seu campo', async () => {
  const r = await parseProductsXlsx(Buffer.from(await buildTemplate(['Forn A'])), [{ id: 1, name: 'Forn A' }]);
  assert.equal(r.rows[0].price, 16.8);
  assert.equal(r.rows[0].price_brl, 129.9);
  assert.ok(r.columns.some((c) => c.field === 'price_brl' && c.header === 'Preço no Brasil (R$)'));
});

test('títulos parecidos: preço no Brasil não vira preço do fornecedor', async () => {
  let r = await parseProductsXlsx(await sheet(['Item', 'Preço (RMB)', 'Preço de venda (R$)'], ['Garrafa', 16.8, 129.9]));
  assert.deepEqual([r.rows[0].price, r.rows[0].currency, r.rows[0].price_brl], [16.8, 'CNY', 129.9]);
  r = await parseProductsXlsx(await sheet(['Descrição', 'Price USD', 'Preço Brasil'], ['Copo', 2.35, 69.9]));
  assert.deepEqual([r.rows[0].price, r.rows[0].currency, r.rows[0].price_brl], [2.35, 'USD', 69.9]);
  r = await parseProductsXlsx(await sheet(['Produto', 'Preço', 'Preço (R$)'], ['Copo', 10, 50]));
  assert.deepEqual([r.rows[0].price, r.rows[0].price_brl], [10, 50]);
});
