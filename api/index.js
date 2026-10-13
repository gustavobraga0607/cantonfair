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
    // Comum em deploys de Preview: a integração do Neon costuma liberar a variável só para Production.
    const env = process.env.VERCEL_ENV || 'desconhecido';
    const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
    return json(res, 503, {
      error: env === 'production'
        ? 'Banco de dados não configurado: conecte um Postgres (Neon) ao projeto na Vercel e faça Redeploy.'
        : `Este é um endereço de teste (${env}) da Vercel, sem acesso ao banco de dados. ` +
          (host ? `Use o endereço oficial: https://${host}` : 'Use o endereço de produção do app.'),
      vercel_env: env,
    });
  }

  // Diagnóstico sem expor segredos: diz qual variável foi usada e se o banco responde.
  if (pathname === '/api/health') {
    try {
      await db.get('SELECT 1 AS ok');
      const fx = await db.get("SELECT rate, source, quoted_at, fetched_at, error_at FROM fx_quotes WHERE pair = 'USD-BRL'").catch(() => null);
      return json(res, 200, { ok: true, database: 'postgres', env: dbVar, card_ocr: Boolean(process.env.ANTHROPIC_API_KEY), fx: fx ?? null });
    } catch (err) {
      console.error(err);
      return json(res, 503, { ok: false, database: 'postgres', env: dbVar, error: err.code || err.message });
    }
  }

  return handler(req, res);
};
