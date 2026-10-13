'use strict';

// Camada de banco com duas implementações e a mesma interface assíncrona:
//  - Postgres (produção / Vercel): usado quando DATABASE_URL ou POSTGRES_URL está definido.
//  - SQLite embutido do Node (desenvolvimento local), sem nenhuma configuração.
// As consultas usam "?" como marcador; no Postgres são convertidos para $1, $2...

const SCHEMA = `
-- Cada CNPJ é um "espaço de trabalho": todos os usuários com o mesmo CNPJ
-- compartilham fornecedores, produtos, fotos e configurações.
CREATE TABLE IF NOT EXISTS companies (
  cnpj          TEXT PRIMARY KEY,
  name          TEXT,
  exchange_rate {{REAL}} NOT NULL DEFAULT 5.5,   -- R$ por US$ usado nas estimativas
  rate_mode     TEXT NOT NULL DEFAULT 'auto',   -- 'auto' (cotação do dia) | 'manual'
  rate_source   TEXT,                           -- de onde veio o câmbio atual
  rate_updated_at TEXT,
  created_at    TEXT NOT NULL
);

-- Última cotação obtida das APIs (compartilhada por todas as empresas).
CREATE TABLE IF NOT EXISTS fx_quotes (
  pair        TEXT PRIMARY KEY,
  rate        {{REAL}},
  source      TEXT,
  quoted_at   TEXT,
  fetched_at  TEXT,
  error       TEXT,
  error_at    TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id            {{ID}},
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,           -- sempre gravado em minúsculas
  password_hash TEXT NOT NULL,
  cnpj          TEXT NOT NULL REFERENCES companies(cnpj),
  role          TEXT NOT NULL DEFAULT 'user',   -- 'user' | 'admin'
  created_at    TEXT NOT NULL
);

-- Configurações gerais do sistema, definidas pelo administrador.
CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_by  INTEGER REFERENCES users(id),
  updated_at  TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  {{BIGINT}} NOT NULL
);

-- Fotos ficam no banco (a Vercel não tem disco persistente).
CREATE TABLE IF NOT EXISTS images (
  id          TEXT PRIMARY KEY,
  cnpj        TEXT NOT NULL REFERENCES companies(cnpj),
  mime        TEXT NOT NULL,
  data        {{BLOB}} NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS suppliers (
  id          {{ID}},
  cnpj        TEXT NOT NULL REFERENCES companies(cnpj),
  name        TEXT NOT NULL,
  card_photo  TEXT NOT NULL,                    -- id em images
  booth       TEXT,
  contact_name TEXT,
  phone       TEXT,
  notes       TEXT,
  created_by  INTEGER REFERENCES users(id),
  updated_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_suppliers_cnpj ON suppliers(cnpj);

CREATE TABLE IF NOT EXISTS products (
  id          {{ID}},
  cnpj        TEXT NOT NULL REFERENCES companies(cnpj),
  name        TEXT NOT NULL,
  photo       TEXT,                             -- id em images
  price_brl   {{REAL}},                         -- preço praticado no Brasil (R$)
  units_per_40hq INTEGER,                       -- unidades que cabem num container 40HQ
  notes       TEXT,
  created_by  INTEGER REFERENCES users(id),
  updated_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_cnpj ON products(cnpj);

-- Um produto pode ter várias ofertas, uma por fornecedor.
CREATE TABLE IF NOT EXISTS offers (
  id                  {{ID}},
  product_id          INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  supplier_id         INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  price_usd           {{REAL}} NOT NULL,
  moq                 INTEGER,
  incoterm            TEXT,
  nationalization_pct {{REAL}} NOT NULL DEFAULT 0,
  UNIQUE (product_id, supplier_id)
);
CREATE INDEX IF NOT EXISTS idx_offers_product ON offers(product_id);
CREATE INDEX IF NOT EXISTS idx_offers_supplier ON offers(supplier_id);
`;

const TYPES = {
  sqlite: { ID: 'INTEGER PRIMARY KEY AUTOINCREMENT', REAL: 'REAL', BIGINT: 'INTEGER', BLOB: 'BLOB' },
  postgres: { ID: 'SERIAL PRIMARY KEY', REAL: 'DOUBLE PRECISION', BIGINT: 'BIGINT', BLOB: 'BYTEA' },
};
const schemaFor = (driver) => SCHEMA.replace(/\{\{(\w+)\}\}/g, (_, k) => TYPES[driver][k]);
// Colunas acrescentadas depois da primeira versão (bancos existentes são atualizados).
const ADDED_COLUMNS = [
  ['users', 'role', "TEXT NOT NULL DEFAULT 'user'"],
  ['companies', 'rate_mode', "TEXT NOT NULL DEFAULT 'auto'"],
  ['companies', 'rate_source', 'TEXT'],
  ['companies', 'rate_updated_at', 'TEXT'],
  ['suppliers', 'contact_name', 'TEXT'],
  ['suppliers', 'phone', 'TEXT'],
  ['products', 'units_per_40hq', 'INTEGER'],
];

const clean = (params) => params.map((p) => (p === undefined ? null : p));

function sqlite(dataDir) {
  const fs = require('node:fs');
  const path = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(dataDir, { recursive: true });
  const conn = new DatabaseSync(path.join(dataDir, 'cantonfair.db'));
  conn.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  conn.exec(schemaFor('sqlite'));
  for (const [table, column, type] of ADDED_COLUMNS) {
    if (!conn.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)) {
      conn.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    }
  }

  const q = {
    driver: 'sqlite',
    async all(sql, params = []) { return conn.prepare(sql).all(...clean(params)); },
    async get(sql, params = []) { return conn.prepare(sql).get(...clean(params)); },
    async run(sql, params = []) { return conn.prepare(sql).run(...clean(params)); },
  };
  return {
    ...q,
    // As chamadas ao SQLite são síncronas, então nenhuma outra requisição
    // consegue intercalar comandos dentro da transação.
    async tx(fn) {
      conn.exec('BEGIN');
      try {
        const out = await fn(q);
        conn.exec('COMMIT');
        return out;
      } catch (err) {
        conn.exec('ROLLBACK');
        throw err;
      }
    },
    async close() { conn.close(); },
  };
}

function postgres(connectionString) {
  const { Pool } = require('pg');
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString) || /host=\//.test(connectionString);
  const pool = new Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX) || 3,
    ssl: local || /sslmode=disable/.test(connectionString) ? false : { rejectUnauthorized: false },
  });
  const toPg = (sql) => { let i = 0; return sql.replace(/\?/g, () => `$${++i}`); };
  const wrap = (c) => ({
    driver: 'postgres',
    async all(sql, params = []) { return (await c.query(toPg(sql), clean(params))).rows; },
    async get(sql, params = []) { return (await c.query(toPg(sql), clean(params))).rows[0]; },
    async run(sql, params = []) { const r = await c.query(toPg(sql), clean(params)); return { changes: r.rowCount }; },
  });

  let ready;
  const migrate = async () => {
    await pool.query(schemaFor('postgres'));
    for (const [table, column, type] of ADDED_COLUMNS) {
      await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${type}`);
    }
  };
  const init = () => (ready ??= migrate().catch((err) => { ready = null; throw err; }));
  const base = wrap(pool);
  const withInit = (m) => async (...a) => { await init(); return base[m](...a); };

  return {
    driver: 'postgres',
    all: withInit('all'),
    get: withInit('get'),
    run: withInit('run'),
    async tx(fn) {
      await init();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(wrap(client));
        await client.query('COMMIT');
        return out;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    async close() { await pool.end(); },
  };
}

function open({ databaseUrl, dataDir } = {}) {
  return databaseUrl ? postgres(databaseUrl) : sqlite(dataDir);
}

module.exports = { open };
