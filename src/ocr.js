'use strict';

// Leitura de cartões de visita com o Claude (visão + saída estruturada).
// Entende cartões em inglês, chinês e outros idiomas e devolve os campos já
// separados para preencher o cadastro do fornecedor.

const MODEL = 'claude-opus-5-5';

const FIELDS = {
  company_name: 'Nome da empresa, preferencialmente em inglês/alfabeto latino como aparece no cartão.',
  company_name_local: 'Nome da empresa em chinês (ou outro alfabeto), se houver.',
  contact_name: 'Nome da pessoa de contato, com cargo entre parênteses se houver (ex.: "Lily Chen (Sales Manager)").',
  phone: 'Telefone principal: prefira celular/WhatsApp. Formato internacional, ex.: "+86 138 1234 5678".',
  other_phones: 'Demais telefones/fax, separados por "; ".',
  email: 'E-mail(s), separados por "; ".',
  website: 'Site(s), separados por "; ".',
  wechat: 'WeChat ID, se houver.',
  whatsapp: 'WhatsApp, se diferente do telefone principal.',
  booth: 'Número do stand na Feira de Cantão, se aparecer (ex.: "11.2 C23").',
  address: 'Endereço da empresa/fábrica.',
  products: 'Produtos ou ramo de atuação mencionados no cartão.',
};

const SCHEMA = {
  type: 'object',
  properties: Object.fromEntries(Object.entries(FIELDS).map(([k, d]) => [k, { type: 'string', description: d }])),
  required: Object.keys(FIELDS),
  additionalProperties: false,
};

const SYSTEM = `Você extrai dados de fotos de cartões de visita de fornecedores, tiradas por compradores brasileiros na Feira de Cantão (China).
Transcreva exatamente o que está escrito; não invente nem complete dados ausentes. Campo sem informação = string vazia.
Cartões podem ter frente e verso, textos em chinês e inglês, QR codes e anotações à mão (como o número do stand): considere tudo que for legível.`;

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
    for (const k of Object.keys(FIELDS)) out[k] = typeof data[k] === 'string' ? data[k].trim().slice(0, 500) : '';
    return out;
  };
}

// Cria o leitor a partir do ambiente (ANTHROPIC_API_KEY). Sem chave, o recurso fica desligado.
function cardReaderFromEnv() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const { Anthropic } = require('@anthropic-ai/sdk');
  return createCardReader({ client: new Anthropic({ timeout: 60_000, maxRetries: 1 }) });
}

module.exports = { createCardReader, cardReaderFromEnv, OcrError, FIELDS };
