'use strict';

// Função serverless da Vercel: atende /api/* e /uploads/*.
// Os arquivos de public/ são servidos diretamente pela CDN da Vercel.
const { appFromEnv, adminEmailsFromEnv } = require('../src/config');
const auth = require('../src/auth');

const { db, handler, fx, dbVar } = appFromEnv({ requirePostgres: true });
const { asaasFromEnv } = require('../src/asaas');
const { interpreterFromEnv } = require('../src/interpreter');

// /api/health?check=1 testa de verdade as chaves do Asaas e da Azure (resultado guardado por 5 min).
// Só para administradores logados (as chamadas custam e as mensagens de erro são internas).
let checkCache = null;
let checkRunning = null;
async function isAdminRequest(req) {
  const sid = /(?:^|;\s*)sid=([^;]+)/.exec(req.headers.cookie || '')?.[1];
  let token = sid;
  try { token = sid && decodeURIComponent(sid); } catch { /* usa como veio */ }
  const user = await auth.getSessionUser(db, token).catch(() => null);
  return Boolean(user && adminEmailsFromEnv().includes(String(user.email).toLowerCase()));
}
function checkIntegrations() {
  if (checkCache && Date.now() - checkCache.at < 5 * 60_000) return checkCache.result;
  return (checkRunning ??= runChecks().finally(() => { checkRunning = null; }));
}
async function runChecks() {
  const asaas = asaasFromEnv();
  const interpret = interpreterFromEnv();
  const result = {
    asaas: asaas ? { configured: true, env: asaas.sandbox ? 'sandbox' : 'production' } : { configured: false },
    asaas_webhook_token: Boolean(process.env.ASAAS_WEBHOOK_TOKEN),
    interpreter: interpret ? { configured: true } : { configured: false },
  };
  if (asaas) {
    try { await asaas.ping(); result.asaas.key_ok = true; } catch (err) { result.asaas.key_ok = false; result.asaas.error = err.message; }
  }
  if (interpret) Object.assign(result.interpreter, await interpret.check());
  checkCache = { at: Date.now(), result };
  return result;
}
// Região do Neon tirada do endereço do banco (ex.: ep-xxx.sa-east-1.aws.neon.tech → sa-east-1).
const dbRegion = (() => {
  try {
    const { findDatabaseUrl } = require('../src/config');
    const host = new URL(findDatabaseUrl()?.url || '').hostname;
    return host.match(/\.([a-z]{2}-[a-z]+-\d)\./)?.[1] || null;
  } catch { return null; }
})();

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
      // Tempo de uma consulta já com a conexão aberta e região do banco (sem expor o endereço).
      const t0 = Date.now();
      await db.get('SELECT 1 AS ok');
      const dbMs = Date.now() - t0;
      const quote = fx ? await fx.ensureFresh().catch((err) => ({ ok: false, error: err.message })) : null;
      return json(res, 200, {
        ok: true, database: 'postgres', env: dbVar, card_ocr: Boolean(process.env.ANTHROPIC_API_KEY), fx: quote,
        db_ms: dbMs, db_region: dbRegion, fn_region: process.env.VERCEL_REGION || null,
        payments: Boolean(process.env.ASAAS_API_KEY),
        interpreter: Boolean(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION),
        ...(url.searchParams.get('check')
          ? { integrations: (await isAdminRequest(req)) ? await checkIntegrations() : 'entre no app como administrador para ver' }
          : {}),
      });
    } catch (err) {
      console.error(err);
      return json(res, 503, { ok: false, database: 'postgres', env: dbVar, error: err.code || err.message });
    }
  }

  return handler(req, res);
};
