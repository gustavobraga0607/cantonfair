'use strict';

// Função serverless da Vercel: atende /api/* e /uploads/*.
// Os arquivos de public/ são servidos diretamente pela CDN da Vercel.
const { appFromEnv } = require('../src/config');

const { db, handler, dbVar } = appFromEnv({ requirePostgres: true });

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

module.exports = async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.searchParams.get('__p') || url.pathname;

  if (!handler) {
    return json(res, 503, {
      error: 'Banco de dados não configurado: conecte um Postgres (Neon) ao projeto na Vercel e faça Redeploy.',
    });
  }

  // Diagnóstico sem expor segredos: diz qual variável foi usada e se o banco responde.
  if (pathname === '/api/health') {
    try {
      await db.get('SELECT 1 AS ok');
      return json(res, 200, { ok: true, database: 'postgres', env: dbVar });
    } catch (err) {
      console.error(err);
      return json(res, 503, { ok: false, database: 'postgres', env: dbVar, error: err.code || err.message });
    }
  }

  return handler(req, res);
};
