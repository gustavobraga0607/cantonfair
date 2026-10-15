'use strict';

// Leitura de cartões de visita com o Claude (visão + saída estruturada).
// Entende cartões em inglês, chinês e outros idiomas e devolve os campos já
// separados para preencher o cadastro do fornecedor.

const MODEL = 'claude-opus-5-5';
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

function createCardReader({ client, model = MODEL } = {}) {
  if (!client) return null;

  return async function readCard(mime, base64) {
    let response;
    try {
      response = await client.beta.messages.create({
        model,
        max_tokens: 4000,
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
        // Se o modelo recusar por política, a API tenta automaticamente o modelo recomendado.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: SYSTEM,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } },
            { type: 'text', text: 'Extraia os dados deste cartão de visita.' },
          ],
        }],
      });
    } catch (err) {
      console.error('OCR: falha na API do Claude:', err.status ?? '', err.message);
      if (err.status === 401 || err.status === 403) throw new OcrError(503, 'Leitor de cartões com chave de API inválida.');
      if (err.status === 429) throw new OcrError(429, 'Leitor de cartões ocupado. Tente novamente em instantes.');
      throw new OcrError(502, 'Não foi possível ler o cartão agora. Preencha manualmente ou tente de novo.');
    }

    if (response.stop_reason === 'refusal') {
      throw new OcrError(422, 'Não foi possível ler este cartão. Preencha os campos manualmente.');
    }
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    let data;
    try { data = JSON.parse(text); } catch {
      throw new OcrError(502, 'Resposta inesperada do leitor de cartões. Preencha manualmente.');
    }
    const out = {};
    for (const k of Object.keys(FIELDS)) {
      out[k] = BOOL_FIELDS.includes(k) ? data[k] === true : typeof data[k] === 'string' ? data[k].trim().slice(0, 500) : '';
    }
    if (!PROVINCES.some((p) => p.name === out.province)) out.province = '';
    return preferMessagingPhone(out);
  };
}

// Cria o leitor a partir do ambiente (ANTHROPIC_API_KEY). Sem chave, o recurso fica desligado.
function cardReaderFromEnv() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const { Anthropic } = require('@anthropic-ai/sdk');
  return createCardReader({ client: new Anthropic({ timeout: 60_000, maxRetries: 1 }) });
}

module.exports = { createCardReader, cardReaderFromEnv, OcrError, FIELDS, preferMessagingPhone };
