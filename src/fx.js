'use strict';

// Cotação do dólar (USD → BRL), usando a taxa de VENDA (o que o importador paga).
// Fontes tentadas em ordem; se todas falharem, o app mantém o último valor e
// o usuário pode informar o câmbio manualmente.

const pad = (n) => String(n).padStart(2, '0');
const bcbDate = (d) => `${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${d.getFullYear()}`;

const SOURCES = [
  {
    // PTAX oficial do Banco Central (dias úteis, publicada à tarde). Pega a mais recente dos últimos 10 dias.
    name: 'PTAX Banco Central',
    url: () => {
      const end = new Date();
      const start = new Date(end.getTime() - 10 * 86400_000);
      return 'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)' +
        `?@dataInicial='${bcbDate(start)}'&@dataFinalCotacao='${bcbDate(end)}'&$format=json&$orderby=dataHoraCotacao%20desc&$top=1`;
    },
    parse: (d) => {
      const v = d.value?.[0];
      return v && { rate: Number(v.cotacaoVenda), quoted_at: new Date(v.dataHoraCotacao.replace(' ', 'T').slice(0, 19) + '-03:00').toISOString() };
    },
  },
  {
    name: 'AwesomeAPI',
    url: () => 'https://economia.awesomeapi.com.br/json/last/USD-BRL',
    parse: (d) => d.USDBRL && { rate: Number(d.USDBRL.ask), quoted_at: new Date(Number(d.USDBRL.timestamp) * 1000).toISOString() },
  },
  {
    name: 'ExchangeRate-API',
    url: () => 'https://open.er-api.com/v6/latest/USD',
    parse: (d) => d.result === 'success' && { rate: Number(d.rates?.BRL), quoted_at: new Date(d.time_last_update_unix * 1000).toISOString() },
  },
];

async function fetchUsdBrl({ fetchImpl = globalThis.fetch, sources = SOURCES, timeoutMs = 4000 } = {}) {
  const errors = [];
  for (const s of sources) {
    try {
      const res = await fetchImpl(s.url(), { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json', 'User-Agent': 'MissaoChinaBRTrading/1.0' } });
      if (!res.ok) { errors.push(`${s.name}: HTTP ${res.status}`); continue; }
      const q = s.parse(await res.json());
      // Faixa de sanidade para não aplicar um valor absurdo.
      if (!q || !Number.isFinite(q.rate) || q.rate < 1 || q.rate > 20) { errors.push(`${s.name}: resposta inválida`); continue; }
      return { rate: Math.round(q.rate * 10000) / 10000, source: s.name, quoted_at: q.quoted_at };
    } catch (err) {
      errors.push(`${s.name}: ${err.name === 'TimeoutError' ? 'tempo esgotado' : err.message}`);
    }
  }
  const err = new Error(errors.join('; '));
  err.fxErrors = errors;
  throw err;
}

const FRESH_MS = 30 * 60_000;     // reaproveita a cotação por 30 min
const RETRY_MS = 5 * 60_000;      // após falha, espera 5 min para tentar de novo

// Guarda a última cotação no banco (compartilhada entre as instâncias da Vercel)
// e aplica o valor às empresas em modo automático.
function createFxService({ db, fetchQuote = fetchUsdBrl, now = () => Date.now() }) {
  let inflight = null;

  const read = () => db.get('SELECT * FROM fx_quotes WHERE pair = ?', ['USD-BRL']);

  async function refresh() {
    const t = new Date(now()).toISOString();
    try {
      const q = await fetchQuote();
      await db.run(`INSERT INTO fx_quotes (pair, rate, source, quoted_at, fetched_at, error, error_at)
                    VALUES ('USD-BRL', ?, ?, ?, ?, NULL, NULL)
                    ON CONFLICT (pair) DO UPDATE SET rate = excluded.rate, source = excluded.source,
                      quoted_at = excluded.quoted_at, fetched_at = excluded.fetched_at, error = NULL, error_at = NULL`,
        [q.rate, q.source, q.quoted_at, t]);
      await db.run(`UPDATE companies SET exchange_rate = ?, rate_source = ?, rate_updated_at = ? WHERE rate_mode = 'auto'`,
        [q.rate, q.source, q.quoted_at]);
    } catch (err) {
      console.warn('Cotação do dólar indisponível:', err.message);
      await db.run(`INSERT INTO fx_quotes (pair, error, error_at) VALUES ('USD-BRL', ?, ?)
                    ON CONFLICT (pair) DO UPDATE SET error = excluded.error, error_at = excluded.error_at`,
        [err.message.slice(0, 500), t]);
    }
    return read();
  }

  // Atualiza se a cotação estiver velha (no máximo uma busca por vez nesta instância).
  async function ensureFresh({ force = false } = {}) {
    const row = await read();
    const age = (iso) => (iso ? now() - new Date(iso).getTime() : Infinity);
    const stale = force || age(row?.fetched_at) > FRESH_MS;
    const cooling = !force && age(row?.error_at) < RETRY_MS && age(row?.error_at) < age(row?.fetched_at);
    if (!stale || cooling) return status(row);
    inflight ??= refresh().finally(() => { inflight = null; });
    return status(await inflight);
  }

  function status(row) {
    const failed = Boolean(row?.error_at) && (!row.fetched_at || row.error_at > row.fetched_at);
    return {
      ok: Boolean(row?.rate) && !failed,
      rate: row?.rate ?? null,
      source: row?.source ?? null,
      quoted_at: row?.quoted_at ?? null,
      fetched_at: row?.fetched_at ?? null,
      error: failed ? 'Não foi possível obter a cotação automática agora.' : null,
    };
  }

  // Para o caminho das requisições: se já existe uma cotação, devolve na hora e atualiza
  // em segundo plano (background mantém o trabalho vivo após a resposta). Só espera
  // quando ainda não há nenhuma cotação.
  async function refreshInBackground(background = (p) => p) {
    const row = await read();
    if (!row?.rate) return ensureFresh();
    const age = (iso) => (iso ? now() - new Date(iso).getTime() : Infinity);
    const stale = age(row.fetched_at) > FRESH_MS;
    const cooling = age(row.error_at) < RETRY_MS && age(row.error_at) < age(row.fetched_at);
    if (stale && !cooling) background(ensureFresh().catch((err) => console.error('Cotação:', err.message)));
    return status(row);
  }

  return { ensureFresh, refreshInBackground, read: async () => status(await read()) };
}

// Yuan → real (para o controle de despesas da viagem). Guardado 1 h em memória.
async function fetchCnyBrl({ fetchImpl = globalThis.fetch, timeoutMs = 4000 } = {}) {
  const sources = [
    { name: 'AwesomeAPI', url: 'https://economia.awesomeapi.com.br/json/last/CNY-BRL', parse: (d) => Number(d.CNYBRL?.ask) },
    { name: 'ExchangeRate-API', url: 'https://open.er-api.com/v6/latest/CNY', parse: (d) => Number(d.rates?.BRL) },
  ];
  for (const s of sources) {
    try {
      const res = await fetchImpl(s.url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json', 'User-Agent': 'MissaoChinaBRTrading/1.0' } });
      if (!res.ok) continue;
      const rate = s.parse(await res.json());
      if (Number.isFinite(rate) && rate > 0.1 && rate < 5) return { rate: Math.round(rate * 10000) / 10000, source: s.name };
    } catch { /* tenta a próxima fonte */ }
  }
  return null;
}

module.exports = { fetchUsdBrl, fetchCnyBrl, createFxService, SOURCES };
