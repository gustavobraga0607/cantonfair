'use strict';

// Leitura de cartões de visita com o Claude (visão + saída estruturada).
// Entende cartões em inglês, chinês e outros idiomas e devolve os campos já
// separados para preencher o cadastro do fornecedor.

// Modelo usado nas leituras; pode ser trocado pela variável OCR_MODEL (ex.: claude-haiku-5-5).
const MODEL = 'claude-opus-5-5';
// Preço por milhão de tokens (US$, entrada/saída) — usado para estimar o custo de cada leitura.
const PRICES = {
  'claude-opus-5-5': { input: 4, output: 20, label: 'Opus 5.5' },
  'claude-sonnet-5-5': { input: 2, output: 10, label: 'Sonnet 5.5' },
  'claude-haiku-5-5': { input: 0.10, output: 0.50, label: 'Haiku 5.5' },
};
// A troca automática de modelo em caso de recusa não existe no Haiku.
const supportsFallback = (model) => /^claude-(opus|sonnet|fable)-/.test(model);
const costUsd = (model, usage) => {
  const p = PRICES[model];
  return p && usage ? ((usage.input_tokens || 0) * p.input + (usage.output_tokens || 0) * p.output) / 1e6 : null;
};
const PROVINCES = require('../public/provinces');

const FIELDS = {
  company_name: 'Nome da empresa, preferencialmente em inglês/alfabeto latino como aparece no cartão.',
  company_name_local: 'Nome da empresa em chinês (ou outro alfabeto), se houver.',
  contact_name: 'Nome da pessoa de contato, com cargo entre parênteses se houver (ex.: "Lily Chen (Sales Manager)").',
  phone: 'Telefone principal, em formato internacional (ex.: "+86 138 1234 5678"). Se houver mais de um telefone, escolha SEMPRE o que for WhatsApp ou WeChat (indicado por ícone, rótulo "WhatsApp"/"WeChat"/"微信"/"WA", ou por ser o mesmo número do WeChat/WhatsApp); se nenhum for, prefira o celular.',
  phone_whatsapp: 'true se o cartão indica que o telefone principal é WhatsApp (ícone ou rótulo junto ao número, ou mesmo número do WhatsApp). Senão, false.',
  phone_wechat: 'true se o cartão indica que o telefone principal é WeChat (ícone ou rótulo 微信/WeChat junto ao número, ou WeChat ID igual ao número). Senão, false.',
  other_phones: 'Demais telefones/fax, separados por "; ".',
  email: 'E-mail(s), separados por "; ".',
  website: 'Site(s), separados por "; ".',
  wechat: 'WeChat ID, se houver.',
  whatsapp: 'WhatsApp, se diferente do telefone principal.',
  booth: 'Número do stand na Feira de Cantão, se aparecer (ex.: "11.2 C23").',
  address: 'Endereço da empresa/fábrica, completo, como aparece no cartão (prefira a versão em inglês/pinyin; se só houver em chinês, transcreva em chinês).',
  province: 'Província chinesa do endereço, escolhida da lista. Pode deduzir pela cidade do endereço (ex.: Ningbo → Zhejiang, Foshan → Guangdong). Sem endereço ou cidade = string vazia.',
  products: 'Produtos ou ramo de atuação mencionados no cartão.',
};

const BOOL_FIELDS = ['phone_whatsapp', 'phone_wechat'];

const SCHEMA = {
  type: 'object',
  properties: Object.fromEntries(Object.entries(FIELDS).map(([k, d]) => [k, k === 'province'
    ? { type: 'string', description: d, enum: ['', ...PROVINCES.map((p) => p.name)] }
    : BOOL_FIELDS.includes(k) ? { type: 'boolean', description: d } : { type: 'string', description: d }])),
  required: Object.keys(FIELDS),
  additionalProperties: false,
};

const SYSTEM = `Você extrai dados de fotos de cartões de visita de fornecedores, tiradas por compradores brasileiros na Feira de Cantão (China).
Transcreva exatamente o que está escrito; não invente nem complete dados ausentes. Campo sem informação = string vazia.
Cartões podem ter frente e verso, textos em chinês e inglês, QR codes e anotações à mão (como o número do stand): considere tudo que for legível.`;

const digits = (v) => String(v || '').replace(/\D/g, '');
const isPhone = (v) => /^[+\d][\d\s()-]{6,}$/.test(String(v || '').trim()) && digits(v).length >= 8;

// Com mais de um telefone no cartão, o salvo é sempre o de WhatsApp ou WeChat (é por onde os
// fornecedores chineses respondem). Confere o que o modelo escolheu com os campos WhatsApp/WeChat.
function preferMessagingPhone(card) {
  const out = { ...card };
  const same = (a, b) => digits(a) && digits(a).slice(-8) === digits(b).slice(-8);
  if (isPhone(out.whatsapp) && !same(out.phone, out.whatsapp) && !out.phone_wechat) {
    if (out.phone) out.other_phones = [out.phone, out.other_phones].filter(Boolean).join('; ');
    out.phone = out.whatsapp;
    out.phone_whatsapp = true;
  } else if (isPhone(out.wechat) && !same(out.phone, out.wechat) && !out.phone_whatsapp) {
    if (out.phone) out.other_phones = [out.phone, out.other_phones].filter(Boolean).join('; ');
    out.phone = out.wechat.trim();
    out.phone_wechat = true;
  }
  if (same(out.phone, out.whatsapp)) out.phone_whatsapp = true;
  if (same(out.phone, out.wechat)) out.phone_wechat = true;
  if (!out.phone) { out.phone_whatsapp = false; out.phone_wechat = false; }
  return out;
}

class OcrError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Envia a foto ao Claude com saída estruturada e devolve o JSON lido.
// meta (opcional) recebe modelo, tempo, tokens e custo estimado da leitura.
async function askVision(client, model, { system, schema, prompt, mime, base64, what, meta }) {
  let response;
  const started = Date.now();
  try {
    response = await client.beta.messages.create({
      model,
      max_tokens: 8000,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
      // Se o modelo recusar por política, a API tenta automaticamente o modelo recomendado.
      ...(supportsFallback(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
      system,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } },
          { type: 'text', text: prompt },
        ],
      }],
    });
  } catch (err) {
    console.error(`OCR (${what}): falha na API do Claude:`, err.status ?? '', err.message);
    if (err.status === 401 || err.status === 403) throw new OcrError(503, 'Leitor de fotos com chave de API inválida.');
    if (err.status === 429) throw new OcrError(429, 'Leitor de fotos ocupado. Tente novamente em instantes.');
    throw new OcrError(502, 'Não foi possível ler a foto agora. Preencha manualmente ou tente de novo.');
  }
  if (meta) {
    Object.assign(meta, {
      model: response.model || model, ms: Date.now() - started,
      input_tokens: response.usage?.input_tokens ?? null, output_tokens: response.usage?.output_tokens ?? null,
      cost_usd: costUsd(model, response.usage),
    });
  }
  if (response.stop_reason === 'refusal') {
    throw new OcrError(422, 'Não foi possível ler esta foto. Preencha os campos manualmente.');
  }
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try { return JSON.parse(text); } catch {
    throw new OcrError(502, 'Resposta inesperada do leitor de fotos. Preencha manualmente.');
  }
}

function createCardReader({ client, model = MODEL } = {}) {
  if (!client) return null;

  return async function readCard(mime, base64, meta) {
    const data = await askVision(client, model, {
      system: SYSTEM, schema: SCHEMA, prompt: 'Extraia os dados deste cartão de visita.', mime, base64, what: 'cartão', meta,
    });
    const out = {};
    for (const k of Object.keys(FIELDS)) {
      out[k] = BOOL_FIELDS.includes(k) ? data[k] === true : typeof data[k] === 'string' ? data[k].trim().slice(0, 500) : '';
    }
    if (!PROVINCES.some((p) => p.name === out.province)) out.province = '';
    return preferMessagingPhone(out);
  };
}

// ---------- produtos pela foto ----------
// Foto do produto, da etiqueta, da embalagem, de uma página de catálogo ou de uma tabela de preços:
// devolve um item por produto visível, já no formato do cadastro.

const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'];
const MAX_PRODUCTS = 40;

const PRODUCT_FIELDS = {
  name: 'Nome curto e descritivo do produto EM PORTUGUÊS (traduza do inglês/chinês), com a especificação que diferencia o item: capacidade, tamanho, material, modelo. Ex.: "Garrafa térmica inox 500 ml".',
  name_original: 'Nome/modelo como aparece na foto (inglês ou chinês), se houver.',
  price_usd: 'Preço unitário em dólar (US$/USD) como número com ponto decimal, ex.: "2.35". Se houver faixas por quantidade, use o preço da menor quantidade. Se o preço estiver em outra moeda (RMB/CNY/¥, EUR), deixe vazio e informe em price_note. Sem preço = "".',
  price_note: 'Preço em outra moeda ou faixas de preço por quantidade, como aparece (ex.: "¥16,80" ou "US$2.35 (1000 pcs) / US$2.10 (5000 pcs)"). Vazio se não houver.',
  moq: 'Quantidade mínima de pedido (MOQ) como número inteiro, ex.: "1000". Sem MOQ = "".',
  incoterm: 'Incoterm do preço, se indicado (FOB, EXW, CIF…). Sem indicação = "".',
  units_per_40hq: 'Unidades por container 40HQ como número inteiro, se informado. Sem informação = "".',
  specs: 'Outras informações úteis em uma linha: material, dimensões, peso, cores, embalagem/caixa master, código do item.',
};

const PRODUCT_SCHEMA = {
  type: 'object',
  properties: {
    products: {
      type: 'array',
      description: 'Um item por produto visível na foto (na foto de um único produto, um item só).',
      items: {
        type: 'object',
        properties: Object.fromEntries(Object.entries(PRODUCT_FIELDS).map(([k, d]) => [k, k === 'incoterm'
          ? { type: 'string', description: d, enum: ['', ...INCOTERMS] }
          : { type: 'string', description: d }])),
        required: Object.keys(PRODUCT_FIELDS),
        additionalProperties: false,
      },
    },
  },
  required: ['products'],
  additionalProperties: false,
};

const PRODUCT_SYSTEM = `Você ajuda compradores brasileiros na Feira de Cantão (China) a cadastrar produtos a partir de fotos tiradas no estande.
A foto pode ser do próprio produto, de uma etiqueta, embalagem, página de catálogo ou tabela de preços (em inglês, chinês ou outro idioma).
Transcreva preços, quantidades e códigos exatamente como aparecem; não invente nem estime valores ausentes (campo sem informação = string vazia).
Numa tabela ou catálogo, liste cada produto/linha separadamente. Ignore cabeçalhos, totais e itens ilegíveis.`;

// "2,35" / "US$ 2.35" / "1.000" → número; vazio ou inválido → null.
function toNumber(v, { integer = false } = {}) {
  let t = String(v ?? '').replace(/[^\d.,-]/g, '');
  if (!t) return null;
  if (t.includes(',') && t.includes('.')) t = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  else if (t.includes(',')) t = /,\d{3}$/.test(t) && integer ? t.replace(/,/g, '') : t.replace(',', '.');
  else if (integer && /\.\d{3}$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return null;
  return integer ? (Number.isInteger(n) ? n : null) : Math.round(n * 10000) / 10000;
}

function createProductReader({ client, model = MODEL } = {}) {
  if (!client) return null;

  return async function readProducts(mime, base64, meta) {
    const data = await askVision(client, model, {
      system: PRODUCT_SYSTEM, schema: PRODUCT_SCHEMA, mime, base64, what: 'produto', meta,
      prompt: 'Liste os produtos desta foto com os dados para o cadastro.',
    });
    const list = Array.isArray(data.products) ? data.products : [];
    const txt = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    const products = list.slice(0, MAX_PRODUCTS).map((p) => {
      const incoterm = txt(p.incoterm, 10).toUpperCase();
      return {
        name: txt(p.name, 150),
        name_original: txt(p.name_original, 150),
        price_usd: toNumber(p.price_usd),
        price_note: txt(p.price_note),
        moq: toNumber(p.moq, { integer: true }),
        incoterm: INCOTERMS.includes(incoterm) ? incoterm : '',
        units_per_40hq: toNumber(p.units_per_40hq, { integer: true }),
        specs: txt(p.specs, 500),
      };
    }).filter((p) => p.name);
    return { products };
  };
}

// Cria o leitor a partir do ambiente (ANTHROPIC_API_KEY). Sem chave, o recurso fica desligado.
let envClient;
function clientFromEnv() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const { Anthropic } = require('@anthropic-ai/sdk');
  return (envClient ??= new Anthropic({ timeout: 90_000, maxRetries: 1 }));
}
const envModel = () => process.env.OCR_MODEL || MODEL;
const cardReaderFromEnv = () => createCardReader({ client: clientFromEnv(), model: envModel() });
const productReaderFromEnv = () => createProductReader({ client: clientFromEnv(), model: envModel() });
// Leitores de cada modelo, para o administrador comparar (teste de modelos).
function benchReadersFromEnv() {
  const client = clientFromEnv();
  if (!client) return null;
  return Object.fromEntries(Object.keys(PRICES).map((model) => [model, {
    readCard: createCardReader({ client, model }), readProducts: createProductReader({ client, model }),
  }]));
}

module.exports = {
  createCardReader, cardReaderFromEnv, createProductReader, productReaderFromEnv, benchReadersFromEnv, OcrError, FIELDS,
  preferMessagingPhone, toNumber, PRICES, MODEL,
};
