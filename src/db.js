'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
PRAGMA foreign_keys = ON;

-- Cada CNPJ é um "espaço de trabalho": todos os usuários com o mesmo CNPJ
-- compartilham fornecedores, produtos e configurações.
CREATE TABLE IF NOT EXISTS companies (
  cnpj          TEXT PRIMARY KEY,
  name          TEXT,
  exchange_rate REAL NOT NULL DEFAULT 5.50,   -- R$ por US$ usado nas estimativas
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  cnpj          TEXT NOT NULL REFERENCES companies(cnpj),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS suppliers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  cnpj        TEXT NOT NULL REFERENCES companies(cnpj),
  name        TEXT NOT NULL,
  card_photo  TEXT NOT NULL,                 -- nome do arquivo em uploads/
  booth       TEXT,
  notes       TEXT,
  created_by  INTEGER REFERENCES users(id),
  updated_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_suppliers_cnpj ON suppliers(cnpj);

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  cnpj        TEXT NOT NULL REFERENCES companies(cnpj),
  name        TEXT NOT NULL,
  photo       TEXT,
  price_brl   REAL,                          -- preço praticado no Brasil (R$)
  notes       TEXT,
  created_by  INTEGER REFERENCES users(id),
  updated_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_products_cnpj ON products(cnpj);

-- Um produto pode ter várias ofertas, uma por fornecedor.
CREATE TABLE IF NOT EXISTS offers (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id          INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  supplier_id         INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  price_usd           REAL NOT NULL,
  moq                 INTEGER,
  incoterm            TEXT,
  nationalization_pct REAL NOT NULL DEFAULT 0,
  UNIQUE (product_id, supplier_id)
);
CREATE INDEX IF NOT EXISTS idx_offers_product ON offers(product_id);
CREATE INDEX IF NOT EXISTS idx_offers_supplier ON offers(supplier_id);
`;

function open(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'cantonfair.db'));
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

// Executa fn dentro de uma transação.
function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { open, tx };
