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
  exchange_rate {{REAL}} NOT NULL DEFAULT 5.5,   -- R$ por US$ (preços em dólar e frete)
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
  card_photo    TEXT,                           -- cartão de visitas do próprio usuário (id em images)
  created_at    TEXT NOT NULL
);

-- Configurações gerais do sistema, definidas pelo administrador.
CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_by  INTEGER REFERENCES users(id),
  updated_at  TEXT
);

-- Roteiros de viagem (enviados em Excel pelo administrador, um ou mais por CNPJ).
CREATE TABLE IF NOT EXISTS itineraries (
  id          {{ID}},
  cnpj        TEXT NOT NULL REFERENCES companies(cnpj),
  title       TEXT NOT NULL,
  days        TEXT NOT NULL,                    -- JSON com os dias e atividades
  start_date  TEXT,
  end_date    TEXT,
  file_name   TEXT,
  file_data   {{BLOB}},                          -- planilha original
  created_by  INTEGER REFERENCES users(id),
  updated_by  INTEGER REFERENCES users(id),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_itineraries_cnpj ON itineraries(cnpj);

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
  thumb       {{BLOB}},                          -- miniatura JPEG para as listas
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS suppliers (
  id          {{ID}},
  cnpj        TEXT NOT NULL REFERENCES companies(cnpj),
  name        TEXT NOT NULL,
  card_photo  TEXT,                             -- id em images (opcional)
  booth       TEXT,
  contact_name TEXT,
  phone       TEXT,
  phone_whatsapp INTEGER NOT NULL DEFAULT 0,   -- o telefone é WhatsApp
  phone_wechat   INTEGER NOT NULL DEFAULT 0,   -- o telefone é WeChat
  address     TEXT,
  province    TEXT,
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

-- Fotos de um produto por fornecedor (várias por oferta). As imagens ficam em images.
CREATE TABLE IF NOT EXISTS offer_photos (
  id          {{ID}},
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  image_id    TEXT NOT NULL,
  created_by  INTEGER,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_offer_photos_product ON offer_photos(product_id);
CREATE INDEX IF NOT EXISTS idx_offer_photos_supplier ON offer_photos(supplier_id);

-- Controle de viagem: despesas de cada usuário (extrato pessoal).
CREATE TABLE IF NOT EXISTS expenses (
  id          {{ID}},
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  spent_on    TEXT NOT NULL,                    -- data (AAAA-MM-DD)
  description TEXT NOT NULL,
  category    TEXT NOT NULL,
  payment     TEXT,
  amount      {{REAL}} NOT NULL,                -- valor na moeda paga
  currency    TEXT NOT NULL,                    -- CNY, BRL ou USD
  rate_brl    {{REAL}} NOT NULL,                -- R$ por unidade da moeda no dia do lançamento
  amount_brl  {{REAL}} NOT NULL,
  client_ref  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_expenses_user ON expenses(user_id, spent_on);
CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_client_ref ON expenses(user_id, client_ref);

-- Créditos do intérprete (por empresa): extrato de entradas (compra, cortesia) e saídas (uso), em segundos.
CREATE TABLE IF NOT EXISTS credit_ledger (
  id          {{ID}},
  cnpj        TEXT NOT NULL REFERENCES companies(cnpj),
  user_id     INTEGER REFERENCES users(id),
  seconds     INTEGER NOT NULL,                 -- positivo = entrada; negativo = uso
  kind        TEXT NOT NULL,                    -- purchase | grant | usage | refund
  payment_id  INTEGER,
  note        TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_cnpj ON credit_ledger(cnpj, id);

-- Compras de créditos pelo Asaas (Pix ou cartão).
CREATE TABLE IF NOT EXISTS credit_payments (
  id               {{ID}},
  cnpj             TEXT NOT NULL REFERENCES companies(cnpj),
  user_id          INTEGER REFERENCES users(id),
  package_id       TEXT NOT NULL,
  minutes          INTEGER NOT NULL,
  value            {{REAL}} NOT NULL,           -- R$
  method           TEXT NOT NULL,               -- pix | card
  asaas_id         TEXT,
  status           TEXT NOT NULL,               -- PENDING | CONFIRMED | RECEIVED | REFUNDED | ...
  invoice_url      TEXT,
  pix_payload      TEXT,
  pix_image        TEXT,
  pix_expires_at   TEXT,
  credited_at      TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_payments_asaas ON credit_payments(asaas_id);
CREATE INDEX IF NOT EXISTS idx_credit_payments_cnpj ON credit_payments(cnpj);
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
  // Câmbio do yuan (R$ por ¥), usado nos preços em RMB.
  ['companies', 'cny_rate', '{{REAL}}'],
  // Moeda do preço da oferta (a coluna price_usd guarda o preço nessa moeda). Ofertas antigas eram em US$.
  ['offers', 'currency', "TEXT NOT NULL DEFAULT 'USD'"],
  ['suppliers', 'contact_name', 'TEXT'],
  ['suppliers', 'phone', 'TEXT'],
  ['suppliers', 'phone_whatsapp', 'INTEGER NOT NULL DEFAULT 0'],
  ['suppliers', 'phone_wechat', 'INTEGER NOT NULL DEFAULT 0'],
  ['suppliers', 'address', 'TEXT'],
  ['suppliers', 'province', 'TEXT'],
  ['products', 'units_per_40hq', 'INTEGER'],
  ['users', 'card_photo', 'TEXT'],
  ['images', 'thumb', '{{BLOB}}'],
  // Identificador gerado no celular: reenviar um cadastro (sem internet, toque duplo) não duplica.
  ['suppliers', 'client_ref', 'TEXT'],
  ['products', 'client_ref', 'TEXT'],
  ['companies', 'asaas_customer_id', 'TEXT'],
];
// Colunas que deixaram de ser obrigatórias (bancos existentes também mudam).
const DROPPED_NOT_NULL = [
  ['suppliers', 'card_photo'],
];
// Limpeza do módulo de sourcing (removido): tabelas e contas de operador da China. Sem o módulo,
// um operador viraria usuário comum da empresa do administrador, então a conta é apagada.
const CLEANUP_SQL = [
  'DROP TABLE IF EXISTS sourcing_messages',
  'DROP TABLE IF EXISTS sourcing_entries',
  'DROP TABLE IF EXISTS sourcing_files',
  'DROP TABLE IF EXISTS sourcing_ops',
  "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE role = 'operator')",
  "DELETE FROM expenses WHERE user_id IN (SELECT id FROM users WHERE role = 'operator')",
  "DELETE FROM users WHERE role = 'operator'",
  // Cortesia única: R$ 10 em minutos do intérprete (20 min no pacote de R$ 29/60 min) para a
  // empresa dos administradores já cadastrados. A nota impede que seja creditado duas vezes.
  `INSERT INTO credit_ledger (cnpj, user_id, seconds, kind, note, created_at)
   SELECT u.cnpj, MIN(u.id), 1200, 'grant', 'Cortesia de R$ 10 (20 min) para o administrador', '2026-10-17T12:00:00.000Z'
   FROM users u
   WHERE u.role = 'admin' AND u.created_at < '2026-10-18'
     AND NOT EXISTS (SELECT 1 FROM credit_ledger l WHERE l.cnpj = u.cnpj AND l.note = 'Cortesia de R$ 10 (20 min) para o administrador')
   GROUP BY u.cnpj`,
];

// Índices criados depois (bancos existentes também recebem).
const ADDED_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_users_cnpj ON users(cnpj)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_client_ref ON suppliers(cnpj, client_ref)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_products_client_ref ON products(cnpj, client_ref)',
];
const typed = (driver, sql) => sql.replace(/\{\{(\w+)\}\}/g, (_, k) => TYPES[driver][k]);

const clean = (params) => params.map((p) => (p === undefined ? null : p));

// O SQLite não muda restrições de coluna: recria a tabela com a definição atual do esquema
// e copia os dados (as demais tabelas continuam apontando para ela pelo nome).
function rebuildSqliteTable(conn, table) {
  const schema = schemaFor('sqlite');
  const create = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\);`))[0];
  const indexes = schema.match(new RegExp(`CREATE INDEX IF NOT EXISTS \\w+ ON ${table}\\([^)]*\\);`, 'g')) || [];
  conn.exec(`DROP TABLE IF EXISTS ${table}_new`);
  conn.exec(create.replace(`EXISTS ${table} (`, `EXISTS ${table}_new (`));
  // Copia as colunas que existem nas duas (as acrescentadas depois voltam em ADDED_COLUMNS).
  const newCols = new Set(conn.prepare(`PRAGMA table_info(${table}_new)`).all().map((c) => c.name));
  const cols = conn.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name).filter((c) => newCols.has(c)).join(', ');
  conn.exec(`DROP TABLE ${table}_new`);
  conn.exec('PRAGMA foreign_keys = OFF');
  conn.exec('BEGIN');
  try {
    // Procedimento recomendado pelo SQLite: cria a nova, copia, apaga a antiga e renomeia a nova
    // (renomear a antiga faria as chaves estrangeiras das outras tabelas seguirem o nome antigo).
    conn.exec(create.replace(`EXISTS ${table} (`, `EXISTS ${table}_new (`));
    conn.exec(`INSERT INTO ${table}_new (${cols}) SELECT ${cols} FROM ${table}`);
    conn.exec(`DROP TABLE ${table}`);
    conn.exec(`ALTER TABLE ${table}_new RENAME TO ${table}`);
    for (const sql of indexes) conn.exec(sql);
    conn.exec('COMMIT');
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  } finally {
    conn.exec('PRAGMA foreign_keys = ON');
  }
}

function sqlite(dataDir) {
  const fs = require('node:fs');
  const path = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(dataDir, { recursive: true });
  const conn = new DatabaseSync(path.join(dataDir, 'cantonfair.db'));
  conn.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  conn.exec(schemaFor('sqlite'));
  // Antes das colunas novas: a tabela recriada segue o esquema base.
  for (const [table, column] of DROPPED_NOT_NULL) {
    if (conn.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column && c.notnull)) {
      rebuildSqliteTable(conn, table);
    }
  }
  for (const [table, column, type] of ADDED_COLUMNS) {
    if (!conn.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)) {
      conn.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${typed('sqlite', type)}`);
    }
  }
  for (const sql of ADDED_INDEXES) conn.exec(sql);
  for (const sql of CLEANUP_SQL) conn.exec(sql);

  let txQueue = Promise.resolve();
  const q = {
    driver: 'sqlite',
    async all(sql, params = []) { return conn.prepare(sql).all(...clean(params)); },
    async get(sql, params = []) { return conn.prepare(sql).get(...clean(params)); },
    async run(sql, params = []) { return conn.prepare(sql).run(...clean(params)); },
  };
  return {
    ...q,
    // Uma conexão só: transações em fila, para duas requisições não abrirem BEGIN ao mesmo tempo.
    tx(fn) {
      const run = txQueue.then(async () => {
        conn.exec('BEGIN');
        try {
          const out = await fn(q);
          conn.exec('COMMIT');
          return out;
        } catch (err) {
          conn.exec('ROLLBACK');
          throw err;
        }
      });
      txQueue = run.catch(() => {});
      return run;
    },
    async close() { conn.close(); },
  };
}

function postgres(connectionString) {
  const { Pool } = require('pg');
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString) || /host=\//.test(connectionString);
  const pool = new Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX) || 6,
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
  // Esquema + migrações num único comando: uma ida ao banco só na primeira requisição
  // de cada instância (deixa o "cold start" na Vercel mais rápido).
  const migrate = () => pool.query([
    schemaFor('postgres'),
    ...ADDED_COLUMNS.map(([table, column, type]) => `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${typed('postgres', type)};`),
    ...DROPPED_NOT_NULL.map(([table, column]) => `ALTER TABLE ${table} ALTER COLUMN ${column} DROP NOT NULL;`),
    ...ADDED_INDEXES.map((sql) => `${sql};`),
    ...CLEANUP_SQL.map((sql) => `${sql};`),
  ].join('\n'));
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
