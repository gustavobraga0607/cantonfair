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

// Consulta a existência do CNPJ na Receita Federal via BrasilAPI.
// Retorna { status: 'found', name } | { status: 'not_found' } | { status: 'unavailable' }.
async function lookup(value, { timeoutMs = 6000, fetchImpl = globalThis.fetch } = {}) {
  const cnpj = clean(value);
  const base = process.env.CNPJ_API_URL || 'https://brasilapi.com.br/api/cnpj/v1/';
  try {
    const res = await fetchImpl(base + cnpj, { signal: AbortSignal.timeout(timeoutMs) });
    if (res.status === 404 || res.status === 400) return { status: 'not_found' };
    if (!res.ok) return { status: 'unavailable' };
    const data = await res.json();
    return {
      status: 'found',
      name: data.razao_social || data.nome_fantasia || null,
      situation: data.descricao_situacao_cadastral || null,
    };
  } catch {
    return { status: 'unavailable' };
  }
}

module.exports = { clean, isValid, format, lookup };
