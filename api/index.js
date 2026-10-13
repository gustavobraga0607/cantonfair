'use strict';

// Função serverless da Vercel: atende /api/* e /uploads/*.
// Os arquivos de public/ são servidos diretamente pela CDN da Vercel.
const { appFromEnv } = require('../src/config');

if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
  throw new Error('Configure um banco Postgres (DATABASE_URL ou POSTGRES_URL) nas variáveis de ambiente da Vercel.');
}

const { handler } = appFromEnv();

module.exports = handler;
