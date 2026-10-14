'use strict';

// Validação de CNPJ.
// Suporta o formato numérico tradicional e o novo CNPJ alfanumérico
// (IN RFB nº 2.229/2024, emitido a partir de julho/2026): as 12 primeiras
// posições podem conter letras A-Z e os 2 dígitos verificadores são numéricos.
// O valor de cada caractere é (código ASCII - 48), o que mantém o cálculo
// idêntico ao tradicional para dígitos.

const WEIGHTS_1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const WEIGHTS_2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

function clean(value) {
  return String(value || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

function checkDigit(base, weights) {
  let sum = 0;
  for (let i = 0; i < weights.length; i++) {
    sum += (base.charCodeAt(i) - 48) * weights[i];
  }
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

function isValid(value) {
  const cnpj = clean(value);
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(cnpj)) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false; // 00000000000000, 11111111111111...
  const d1 = checkDigit(cnpj.slice(0, 12), WEIGHTS_1);
  const d2 = checkDigit(cnpj.slice(0, 12) + d1, WEIGHTS_2);
  return cnpj.endsWith(`${d1}${d2}`);
}

function format(value) {
  const c = clean(value);
  if (c.length !== 14) return c;
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}

// Fontes públicas de consulta à base da Receita Federal, tentadas em ordem.
// Se uma estiver fora do ar ou bloquear a requisição, passa para a próxima.
const SOURCES = [
  { name: 'brasilapi', url: (c) => `https://brasilapi.com.br/api/cnpj/v1/${c}`, name_of: (d) => d.razao_social || d.nome_fantasia },
  { name: 'minhareceita', url: (c) => `https://minhareceita.org/${c}`, name_of: (d) => d.razao_social || d.nome_fantasia },
  { name: 'cnpjws', url: (c) => `https://publica.cnpj.ws/cnpj/${c}`, name_of: (d) => d.razao_social || d.estabelecimento?.nome_fantasia },
];

async function querySource(source, cnpj, { timeoutMs, fetchImpl }) {
  try {
    const res = await fetchImpl(source.url(cnpj), {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json', 'User-Agent': 'MissaoChinaBRTrading/1.0 (+https://vercel.app)' },
    });
    if (res.status === 404) return { status: 'not_found', source: source.name };
    if (!res.ok) {
      console.warn(`CNPJ: ${source.name} respondeu ${res.status}`);
      return { status: 'unavailable', source: source.name };
    }
    const data = await res.json();
    return { status: 'found', source: source.name, name: source.name_of(data) || null };
  } catch (err) {
    console.warn(`CNPJ: falha ao consultar ${source.name}: ${err.message}`);
    return { status: 'unavailable', source: source.name };
  }
}

// Consulta a existência do CNPJ na Receita Federal.
// Retorna { status: 'found', name, source } | { status: 'not_found', source } | { status: 'unavailable' }.
async function lookup(value, { timeoutMs = 5000, fetchImpl = globalThis.fetch, sources = SOURCES } = {}) {
  const cnpj = clean(value);
  const custom = process.env.CNPJ_API_URL;
  const list = custom ? [{ name: 'custom', url: (c) => custom + c, name_of: (d) => d.razao_social || d.nome }] : sources;
  for (const source of list) {
    const r = await querySource(source, cnpj, { timeoutMs, fetchImpl });
    if (r.status !== 'unavailable') return r;
  }
  return { status: 'unavailable' };
}

module.exports = { clean, isValid, format, lookup };
