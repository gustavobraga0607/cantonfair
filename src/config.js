'use strict';

const path = require('node:path');
const { open } = require('./db');
const { createApp } = require('./app');
const { cardReaderFromEnv } = require('./ocr');
const { createFxService } = require('./fx');

// Administradores: veem e editam fornecedores e produtos de todas as empresas.
// Pode ser substituído pela variável ADMIN_EMAILS (e-mails separados por vírgula).
const DEFAULT_ADMIN_EMAILS = 'gustavo.braga0607@gmail.com';

// Procura a URL do Postgres. A integração Neon da Vercel cria DATABASE_URL/POSTGRES_URL,
// mas pode usar um prefixo personalizado (ex.: STORAGE_DATABASE_URL).
function findDatabaseUrl(env = process.env) {
  for (const name of ['DATABASE_URL', 'POSTGRES_URL']) {
    if (env[name]) return { name, url: env[name] };
  }
  const name = Object.keys(env).sort().find((k) => /_(DATABASE_URL|POSTGRES_URL)$/.test(k) && env[k]);
  return name ? { name, url: env[name] } : null;
}

// Monta o handler HTTP a partir das variáveis de ambiente (usado pelo
// servidor local e pela função da Vercel).
function appFromEnv({ publicDir, requirePostgres = false } = {}) {
  const found = findDatabaseUrl();
  if (!found && requirePostgres) return { db: null, handler: null, dbVar: null };
  const db = open({
    databaseUrl: found?.url,
    dataDir: path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data')),
  });
  const handler = createApp({
    db,
    publicDir,
    cnpjOnlineCheck: process.env.CNPJ_ONLINE_CHECK !== 'false',
    secureCookies: process.env.SECURE_COOKIES === 'true' || Boolean(process.env.VERCEL),
    adminEmails: (process.env.ADMIN_EMAILS ?? DEFAULT_ADMIN_EMAILS).split(','),
    readCard: cardReaderFromEnv(),
    fx: process.env.FX_AUTO === 'false' ? null : createFxService({ db }),
  });
  return { db, handler, dbVar: found?.name ?? null };
}

module.exports = { appFromEnv, findDatabaseUrl };
