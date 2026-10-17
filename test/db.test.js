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

test('limpeza do sourcing removido: apaga tabelas e contas de operador', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cf-src-'));
  const raw = new DatabaseSync(path.join(dir, 'cantonfair.db'));
  raw.exec(`CREATE TABLE companies (cnpj TEXT PRIMARY KEY, name TEXT, exchange_rate REAL NOT NULL DEFAULT 5.5, rate_mode TEXT NOT NULL DEFAULT 'auto', rate_source TEXT, rate_updated_at TEXT, created_at TEXT NOT NULL);
    CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, cnpj TEXT NOT NULL REFERENCES companies(cnpj), role TEXT NOT NULL DEFAULT 'user', card_photo TEXT, created_at TEXT NOT NULL);
    CREATE TABLE sourcing_ops (id INTEGER PRIMARY KEY, operator_id INTEGER REFERENCES users(id));
    CREATE TABLE sourcing_messages (id INTEGER PRIMARY KEY, op_id INTEGER REFERENCES sourcing_ops(id));
    INSERT INTO companies (cnpj, created_at) VALUES ('11222333000181', 'x');
    INSERT INTO users (name, email, password_hash, cnpj, role, created_at) VALUES ('Admin', 'a@x.com', 'h', '11222333000181', 'admin', 'x'), ('Lin', 'lin@cn.com', 'h', '11222333000181', 'operator', 'x');
    INSERT INTO sourcing_ops (id, operator_id) VALUES (1, 2); INSERT INTO sourcing_messages (id, op_id) VALUES (1, 1);`);
  raw.close();
  const db = open({ dataDir: dir });
  assert.deepEqual((await db.all('SELECT email FROM users')).map((u) => u.email), ['a@x.com']);
  assert.equal((await db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'sourcing%'")).length, 0);
  await db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
