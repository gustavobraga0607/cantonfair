'use strict';

// Leitura de cartões de visita com o Claude (visão + saída estruturada).
// Entende cartões em inglês, chinês e outros idiomas e devolve os campos já
// separados para preencher o cadastro do fornecedor.

// Leituras: Haiku 5.5 (barato e rápido) com o Opus 5.5 de reserva, chamado só quando o Haiku
// recusa, falha ou devolve uma leitura incompleta. OCR_MODEL / OCR_FALLBACK_MODEL trocam os modelos
// sem mudar o código (OCR_FALLBACK_MODEL=none desliga a reserva).
const MODEL = 'claude-haiku-5-5';
const FALLBACK_MODEL = 'claude-opus-5-5';
// O Haiku lê melhor pensando um pouco mais; continua muito mais barato que o Opus.
const effortFor = (model) => (/haiku/.test(model) ? 'high' : 'medium');
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

// Cantos do cartão na foto (para o app recortar o fundo e deixar o cartão em pé).
const POINT = { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } }, required: ['x', 'y'], additionalProperties: false };
const CORNERS_SCHEMA = {
  type: 'object',
  description: 'Os 4 cantos do cartão de visita na foto, em milésimos: x de 0 (borda esquerda da imagem) a 1000 (direita), '
    + 'y de 0 (topo da imagem) a 1000 (base). Os nomes seguem o cartão com o texto principal em pé, lido normalmente — '
    + 'não a imagem: top_left é o canto superior esquerdo do cartão em relação ao texto, mesmo que a foto esteja girada. '
    + 'Marque os cantos do próprio cartão (a borda do papel), não do fundo nem da mão. Com frente e verso, use o lado com o nome da empresa em inglês.',
  properties: { top_left: POINT, top_right: POINT, bottom_right: POINT, bottom_left: POINT },
  required: ['top_left', 'top_right', 'bottom_right', 'bottom_left'],
  additionalProperties: false,
};

const SCHEMA = {
  type: 'object',
  properties: {
    ...Object.fromEntries(Object.entries(FIELDS).map(([k, d]) => [k, k === 'province'
      ? { type: 'string', description: d, enum: ['', ...PROVINCES.map((p) => p.name)] }
      : BOOL_FIELDS.includes(k) ? { type: 'boolean', description: d } : { type: 'string', description: d }])),
    card_corners: CORNERS_SCHEMA,
  },
  required: [...Object.keys(FIELDS), 'card_corners'],
  additionalProperties: false,
};

// Cantos válidos → [[x, y] ×4] em frações (0–1), na ordem superior-esq., superior-dir., inferior-dir., inferior-esq.
// Recusa o que não parece um cartão: fora da imagem, polígono torto/cruzado ou pequeno demais.
function cardCorners(c) {
  const keys = ['top_left', 'top_right', 'bottom_right', 'bottom_left'];
  if (!c || !keys.every((k) => Number.isFinite(c[k]?.x) && Number.isFinite(c[k]?.y))) return null;
  const pts = keys.map((k) => [c[k].x / 1000, c[k].y / 1000]);
  if (pts.some(([x, y]) => x < -0.02 || x > 1.02 || y < -0.02 || y > 1.02)) return null;
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const p = pts.map(([x, y]) => [clamp(x), clamp(y)]);
  // Convexo e sem cruzar: os produtos vetoriais dos 4 lados têm o mesmo sinal.
  const cross = p.map((a, i) => {
    const b = p[(i + 1) % 4]; const d = p[(i + 2) % 4];
    return (b[0] - a[0]) * (d[1] - b[1]) - (b[1] - a[1]) * (d[0] - b[0]);
  });
  if (!(cross.every((v) => v > 0) || cross.every((v) => v < 0))) return null;
  const area = Math.abs(p.reduce((s2, a, i) => { const b = p[(i + 1) % 4]; return s2 + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;
  if (area < 0.04) return null;
  // Proporção de um cartão (mais largo que alto, em relação ao texto): evita recortes absurdos.
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const w = (dist(p[0], p[1]) + dist(p[3], p[2])) / 2;
  const h = (dist(p[0], p[3]) + dist(p[1], p[2])) / 2;
  if (!h || w / h < 0.4 || w / h > 3.5) return null;
  return p.map(([x, y]) => [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000]);
}

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
      max_tokens: 16000,
      output_config: { effort: effortFor(model), format: { type: 'json_schema', schema } },
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
    // Soma com uma chamada anterior (quando a leitura passou para o modelo de reserva).
    const add = (a, b) => (a == null && b == null ? null : (a || 0) + (b || 0));
    Object.assign(meta, {
      model: response.model || model, ms: add(meta.ms, Date.now() - started),
      input_tokens: add(meta.input_tokens, response.usage?.input_tokens), output_tokens: add(meta.output_tokens, response.usage?.output_tokens),
      cost_usd: add(meta.cost_usd, costUsd(model, response.usage)),
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

// Lê com o modelo principal e, se ele recusar, falhar ou a leitura vier fraca, com o de reserva.
async function withFallback({ model, fallbackModel, meta, read, weak }) {
  let first;
  let firstErr;
  try {
    first = await read(model);
    if (!fallbackModel || !weak(first)) return first;
  } catch (err) {
    // Chave inválida ou limite de uso: a reserva teria o mesmo problema.
    if (!fallbackModel || !(err instanceof OcrError) || ![422, 502].includes(err.status)) throw err;
    firstErr = err;
  }
  if (meta) meta.escalated = firstErr ? 'erro' : 'leitura incompleta';
  try {
    return await read(fallbackModel);
  } catch (err) {
    if (first) return first; // a reserva falhou: fica com o que o principal leu
    throw firstErr || err;
  }
}

// Cartão sem empresa ou sem nenhum contato: vale tentar o modelo de reserva.
const weakCard = (c) => !(c.company_name || c.company_name_local) || !(c.phone || c.email || c.wechat || c.whatsapp);

function createCardReader({ client, model = MODEL, fallbackModel = null } = {}) {
  if (!client) return null;

  async function readWith(m, mime, base64, meta) {
    const data = await askVision(client, m, {
      system: SYSTEM, schema: SCHEMA, prompt: 'Extraia os dados deste cartão de visita.', mime, base64, what: 'cartão', meta,
    });
    const out = {};
    for (const k of Object.keys(FIELDS)) {
      out[k] = BOOL_FIELDS.includes(k) ? data[k] === true : typeof data[k] === 'string' ? data[k].trim().slice(0, 500) : '';
    }
    if (!PROVINCES.some((p) => p.name === out.province)) out.province = '';
    out.province = provinceFromAddress(out.address, out.province);
    return { ...preferMessagingPhone(out), corners: cardCorners(data.card_corners) };
  }

  return function readCard(mime, base64, meta) {
    return withFallback({ model, fallbackModel, meta, weak: weakCard, read: (m) => readWith(m, mime, base64, meta) });
  };
}

// ---------- província pelo endereço ----------
// Regra fixa (não depende do modelo): o nome da província escrito no endereço vale mais que a
// leitura; sem ele, usa a leitura; sem leitura, deduz pela cidade (polos comuns de fornecedores).
const CITY_PROVINCE = {
  Zhejiang: ['ningbo', 'yiwu', 'hangzhou', 'wenzhou', 'jinhua', 'yongkang', 'shaoxing', 'huzhou', 'jiaxing', 'cixi', 'yuyao', 'wuyi', 'lishui', 'quzhou', 'zhoushan',
    '宁波', '义乌', '杭州', '温州', '金华', '永康', '绍兴', '湖州', '嘉兴', '慈溪', '余姚', '武义', '丽水', '衢州', '舟山'],
  Guangdong: ['guangzhou', 'shenzhen', 'dongguan', 'foshan', 'shantou', 'zhongshan', 'jiangmen', 'huizhou', 'zhuhai', 'chaozhou', 'jieyang', 'shunde', 'zhaoqing', 'qingyuan',
    '广州', '深圳', '东莞', '佛山', '汕头', '中山', '江门', '惠州', '珠海', '潮州', '揭阳', '顺德', '肇庆', '清远'],
  Fujian: ['xiamen', 'quanzhou', 'fuzhou', 'jinjiang', 'putian', 'zhangzhou', 'shishi', '厦门', '泉州', '福州', '晋江', '莆田', '漳州', '石狮'],
  Jiangsu: ['suzhou', 'wuxi', 'nanjing', 'changzhou', 'nantong', 'yangzhou', 'kunshan', 'danyang', 'xuzhou', 'zhenjiang', 'yancheng',
    '苏州', '无锡', '南京', '常州', '南通', '扬州', '昆山', '丹阳', '徐州', '镇江', '盐城'],
  Shandong: ['qingdao', 'jinan', 'yantai', 'weifang', 'linyi', 'zibo', 'rizhao', 'weihai', '青岛', '济南', '烟台', '潍坊', '临沂', '淄博', '日照', '威海'],
  Hebei: ['shijiazhuang', 'baoding', 'tangshan', 'langfang', 'cangzhou', '石家庄', '保定', '唐山', '廊坊', '沧州'],
  Henan: ['zhengzhou', 'luoyang', '郑州', '洛阳'], Hubei: ['wuhan', '武汉'], Hunan: ['changsha', '长沙'],
  Sichuan: ['chengdu', '成都'], Anhui: ['hefei', 'wuhu', '合肥', '芜湖'], Jiangxi: ['nanchang', 'jingdezhen', '南昌', '景德镇'],
  Liaoning: ['dalian', 'shenyang', '大连', '沈阳'], Shaanxi: ["xi'an", 'xian', '西安'], Guangxi: ['nanning', 'guilin', '南宁', '桂林'],
};
const escRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Nome de rua com nome de cidade ("Shanghai Road", "北京路") não conta como localização.
const STREET = String.raw`\s*(road|rd\.?|street|st\.?|avenue|ave\.?|lu|dadao|boulevard|blvd)\b`;
const wordRe = (w) => (/[a-z]/i.test(w)
  ? new RegExp(`(^|[^a-z])${escRe(w)}(?!${STREET})([^a-z]|$)`, 'i')
  : new RegExp(`${escRe(w)}(?![路街道巷])`));
function provinceFromAddress(address, current = '') {
  const a = String(address || '');
  if (!a) return current;
  const named = PROVINCES.find((p) => wordRe(p.name).test(a) || wordRe(p.local).test(a));
  if (named) return named.name;
  if (current) return current;
  for (const [prov, cities] of Object.entries(CITY_PROVINCE)) {
    if (cities.some((c) => wordRe(c).test(a))) return prov;
  }
  return '';
}

// ---------- produtos pela foto ----------
// Foto do produto, da etiqueta, da embalagem, de uma página de catálogo ou de uma tabela de preços:
// devolve um item por produto visível, já no formato do cadastro.

const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'];
const MAX_PRODUCTS = 40;

const PRODUCT_FIELDS = {
  name: 'Nome curto e descritivo do produto EM PORTUGUÊS (traduza do inglês/chinês), com a especificação que diferencia o item: capacidade, tamanho, material, modelo. Ex.: "Garrafa térmica inox 500 ml".',
  name_original: 'Nome/modelo como aparece na foto (inglês ou chinês), se houver.',
  price: 'Preço unitário como número com ponto decimal, exatamente como aparece, sem converter moeda, ex.: "16.80". Se houver faixas por quantidade, use o preço da menor quantidade. Sem preço = "".',
  currency: 'Moeda do preço: "CNY" para yuan (¥, RMB, CNY, 元, 人民币) ou "USD" para dólar (US$, USD, $, 美元). Se a foto mostrar as duas, use o preço em yuan. Sem preço ou moeda não identificada = "".',
  price_note: 'Faixas de preço por quantidade ou preço em outra moeda, como aparece (ex.: "¥16,80 (500 pcs) / ¥15,20 (2000 pcs)" ou "US$2.35"). Vazio se não houver.',
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
          : k === 'currency' ? { type: 'string', description: d, enum: ['', 'CNY', 'USD'] }
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
Numa tabela ou catálogo, liste cada produto/linha separadamente. Ignore cabeçalhos, totais e itens ilegíveis.
Regras:
1. price recebe o número do preço como está na foto, sem converter, e currency diz a moeda: "CNY" (¥, RMB, CNY, 元, 人民币) ou "USD" (US$, USD, $). Se aparecer preço nas duas moedas, use o de yuan. Moeda que não seja yuan nem dólar (EUR etc.): deixe price e currency vazios e copie em price_note.
2. Condição de preço escrita no cabeçalho da tabela (ex.: "Price terms: FOB Shenzhen") vale para todas as linhas: preencha o incoterm de cada produto.
3. MOQ e quantidades são números inteiros sem separador ("1,000 pcs" → "1000"; "500个" → "500").
4. O nome vai em português, curto, com a medida que diferencia o item (capacidade, potência, tamanho).`;

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

function createProductReader({ client, model = MODEL, fallbackModel = null } = {}) {
  if (!client) return null;

  return function readProducts(mime, base64, meta) {
    // Nenhum produto encontrado: o modelo de reserva tenta de novo.
    return withFallback({ model, fallbackModel, meta, weak: (r) => !r.products.length, read: (m) => readProductsWith(m, mime, base64, meta) });
  };

  async function readProductsWith(model, mime, base64, meta) {
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
        price: toNumber(p.price),
        currency: ['CNY', 'USD'].includes(p.currency) ? p.currency : '',
        price_note: txt(p.price_note),
        moq: toNumber(p.moq, { integer: true }),
        incoterm: INCOTERMS.includes(incoterm) ? incoterm : '',
        units_per_40hq: toNumber(p.units_per_40hq, { integer: true }),
        specs: txt(p.specs, 500),
      };
    }).filter((p) => p.name).map(guardCurrency);
    return { products };
  }
}

// Preço escrito em texto ("¥16,80 (500 pcs) / ¥15,20", "US$ 2.35", "16.8元") → { price, currency }.
// Prefere o yuan quando aparecem as duas moedas; pega o primeiro valor (menor quantidade).
function priceFromText(text) {
  const t = String(text || '');
  const n = (v) => Number(String(v).replace(/,(\d{1,2})$/, '.$1').replace(/,/g, ''));
  const cny = /(?:¥|￥|RMB|CNY|人民币)\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:元|RMB|CNY|yuan)/i.exec(t);
  if (cny) return { price: n(cny[1] || cny[2]), currency: 'CNY' };
  const usd = /(?:US\$|USD|\$|美元)\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:USD|美元)/i.exec(t);
  if (usd) return { price: n(usd[1] || usd[2]), currency: 'USD' };
  return null;
}

// Regras fixas sobre a moeda: preço que o modelo deixou só no texto (price_note) vai para o campo de preço;
// preço sem moeda identificada não entra (o usuário digita); marcado como dólar mas escrito só em yuan vira yuan.
function guardCurrency(p) {
  const note = p.price_note || '';
  if (p.price == null || !p.currency) {
    const found = priceFromText(note);
    if (found && Number.isFinite(found.price) && found.price > 0) return { ...p, ...found };
    if (p.price == null) return { ...p, currency: '' };
    return { ...p, price: null, currency: '' };
  }
  if (p.currency === 'USD' && /¥|￥|rmb|cny|元|人民币/i.test(note) && !/\$|usd|us\$|美元/i.test(note)) {
    const nums = (note.match(/\d+(?:[.,]\d+)?/g) || []).map((x) => Number(x.replace(',', '.')));
    if (nums.includes(p.price)) return { ...p, currency: 'CNY' };
  }
  return p;
}

// Cria o leitor a partir do ambiente (ANTHROPIC_API_KEY). Sem chave, o recurso fica desligado.
// O SDK só é carregado na primeira leitura (deixa a inicialização do servidor mais rápida).
let envClient;
function clientFromEnv() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const real = () => {
    if (!envClient) {
      const { Anthropic } = require('@anthropic-ai/sdk');
      envClient = new Anthropic({ timeout: 90_000, maxRetries: 1 });
    }
    return envClient;
  };
  return { beta: { messages: { create: (...args) => real().beta.messages.create(...args) } } };
}
const envModel = () => process.env.OCR_MODEL || MODEL;
const envFallback = () => {
  const v = process.env.OCR_FALLBACK_MODEL ?? FALLBACK_MODEL;
  return !v || v === 'none' || v === envModel() ? null : v;
};
const cardReaderFromEnv = () => createCardReader({ client: clientFromEnv(), model: envModel(), fallbackModel: envFallback() });
const productReaderFromEnv = () => createProductReader({ client: clientFromEnv(), model: envModel(), fallbackModel: envFallback() });
// Leitores de cada modelo, para o administrador comparar (teste de modelos).
function benchReadersFromEnv() {
  const client = clientFromEnv();
  if (!client) return null;
  const readers = Object.fromEntries(Object.keys(PRICES).map((model) => [model, {
    readCard: createCardReader({ client, model }), readProducts: createProductReader({ client, model }),
  }]));
  // A configuração em uso (modelo principal + reserva), como os usuários a recebem.
  if (envFallback()) {
    readers[CONFIG_ID] = {
      readCard: createCardReader({ client, model: envModel(), fallbackModel: envFallback() }),
      readProducts: createProductReader({ client, model: envModel(), fallbackModel: envFallback() }),
    };
  }
  return readers;
}
const CONFIG_ID = 'config';
const configLabel = () => `${PRICES[envModel()]?.label || envModel()} + ${PRICES[envFallback()]?.label || envFallback()} de reserva`;

module.exports = {
  createCardReader, cardReaderFromEnv, createProductReader, productReaderFromEnv, benchReadersFromEnv, OcrError, FIELDS,
  preferMessagingPhone, toNumber, provinceFromAddress, guardCurrency, cardCorners, priceFromText, PRICES, MODEL, FALLBACK_MODEL, CONFIG_ID, configLabel, envModel, envFallback,
};
