'use strict';

const path = require('node:path');
const { open } = require('./db');
const { createApp } = require('./app');

// Monta o handler HTTP a partir das variáveis de ambiente (usado pelo
// servidor local e pela função da Vercel).
function appFromEnv({ publicDir } = {}) {
  const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
  const db = open({
    databaseUrl,
    dataDir: path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data')),
  });
  const handler = createApp({
    db,
    publicDir,
    cnpjOnlineCheck: process.env.CNPJ_ONLINE_CHECK !== 'false',
    secureCookies: process.env.SECURE_COOKIES === 'true' || Boolean(process.env.VERCEL),
  });
  return { db, handler };
}

module.exports = { appFromEnv };
