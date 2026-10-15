'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { open } = require('../src/db');

test('SQLite antigo: foto do cartão do fornecedor deixa de ser obrigatória sem perder dados', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-mig-'));
  // Banco criado pela versão atual, depois "envelhecido" para a coluna antiga NOT NULL.
  const db = open({ dataDir: dir });
  await db.run("INSERT INTO companies (cnpj, name, exchange_rate, created_at) VALUES ('11222333000181', 'A', 5, 'x')");
  await db.run("INSERT INTO suppliers (cnpj, name, card_photo, phone, created_at, updated_at) VALUES ('11222333000181', 'Forn', 'img1', '+86 1', 'x', 'x')");
  await db.close();
  const raw = new DatabaseSync(path.join(dir, 'cantonfair.db'));
  raw.exec('PRAGMA writable_schema = ON');
  raw.exec("UPDATE sqlite_master SET sql = replace(sql, 'card_photo  TEXT,', 'card_photo  TEXT NOT NULL,') WHERE name = 'suppliers'");
  raw.exec('PRAGMA writable_schema = OFF');
  raw.close();
  const check = new DatabaseSync(path.join(dir, 'cantonfair.db'));
  assert.equal(check.prepare('PRAGMA table_info(suppliers)').all().find((c) => c.name === 'card_photo').notnull, 1, 'simulação do banco antigo');
  check.close();

  const db2 = open({ dataDir: dir });
  const sup = await db2.get('SELECT * FROM suppliers');
  assert.equal(sup.name, 'Forn');
  assert.equal(sup.card_photo, 'img1');
  assert.equal(sup.phone, '+86 1');
  await db2.run("INSERT INTO suppliers (cnpj, name, created_at, updated_at) VALUES ('11222333000181', 'Sem foto', 'x', 'x')");
  assert.equal((await db2.all('SELECT id FROM suppliers')).length, 2);
  const fk = await db2.all('PRAGMA foreign_key_list(offers)');
  assert.ok(fk.some((f) => f.table === 'suppliers'), 'ofertas continuam ligadas a suppliers');
  assert.ok((await db2.all('PRAGMA index_list(suppliers)')).some((i) => i.name === 'idx_suppliers_cnpj'));
  await db2.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
