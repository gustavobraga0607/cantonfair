'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCardReader, createProductReader, FIELDS, preferMessagingPhone, toNumber, provinceFromAddress, guardCurrency, priceFromText, cardCorners, createCornerReader } = require('../src/ocr');

function fakeClient(response, calls = []) {
  return { beta: { messages: { create: async (params) => { calls.push(params); if (response instanceof Error) throw response; return response; } } } };
}

test('envia a imagem com saída estruturada e devolve os campos do cartão', async () => {
  const calls = [];
  const json = { company_name: ' Ningbo Home Co., Ltd. ', contact_name: 'Lily Chen (Sales)', phone: '+86 138 0000 1111',
    address: 'No. 88 Jiangnan Rd, Ningbo', province: 'Zhejiang' };
  const read = createCardReader({
    client: fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(json) }] }, calls),
  });
  const out = await read('image/jpeg', 'QUJD');
  assert.equal(out.company_name, 'Ningbo Home Co., Ltd.');
  assert.equal(out.phone, '+86 138 0000 1111');
  assert.equal(out.wechat, '', 'campos ausentes viram string vazia');
  assert.equal(out.address, 'No. 88 Jiangnan Rd, Ningbo');
  assert.equal(out.province, 'Zhejiang');
  assert.deepEqual(Object.keys(out).sort(), Object.keys(FIELDS).sort());

  const p = calls[0];
  assert.equal(p.model, 'claude-haiku-5-5', 'Haiku é o modelo principal');
  assert.equal(p.output_config.effort, 'high');
  assert.equal(p.fallbacks, undefined, 'o Haiku não aceita troca automática do servidor');
  assert.equal(p.output_config.format.type, 'json_schema');
  assert.equal(p.output_config.format.schema.additionalProperties, false);
  assert.equal(p.output_config.format.schema.properties.phone_whatsapp.type, 'boolean');
  assert.equal(out.phone_whatsapp, false);
  const prov = p.output_config.format.schema.properties.province;
  assert.ok(prov.enum.includes('') && prov.enum.includes('Guangdong'), 'província vem de uma lista fechada');
  assert.deepEqual(p.messages[0].content[0].source, { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' });
});

test('trata recusa e erros da API com mensagens amigáveis', async () => {
  const refused = createCardReader({ client: fakeClient({ stop_reason: 'refusal', content: [] }) });
  await assert.rejects(refused('image/png', 'x'), (e) => e.status === 422);
  const limited = createCardReader({ client: fakeClient(Object.assign(new Error('rate'), { status: 429 })) });
  await assert.rejects(limited('image/png', 'x'), (e) => e.status === 429);
  const broken = createCardReader({ client: fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'não é json' }] }) });
  await assert.rejects(broken('image/png', 'x'), (e) => e.status === 502);
  assert.equal(createCardReader({}), null, 'sem cliente o leitor fica desligado');
});

test('com mais de um telefone, salva sempre o de WhatsApp ou WeChat', () => {
  const base = { phone: '', phone_whatsapp: false, phone_wechat: false, whatsapp: '', wechat: '', other_phones: '' };
  // o modelo pegou o fixo, mas o cartão tem WhatsApp
  let r = preferMessagingPhone({ ...base, phone: '+86 574 8888 1234', whatsapp: '+86 138 0574 2266' });
  assert.equal(r.phone, '+86 138 0574 2266');
  assert.equal(r.phone_whatsapp, true);
  assert.match(r.other_phones, /8888 1234/, 'o outro número não se perde');
  // WeChat ID que é um número de telefone
  r = preferMessagingPhone({ ...base, phone: '+86 574 8888 1234', wechat: '13805742266' });
  assert.equal(r.phone, '13805742266');
  assert.equal(r.phone_wechat, true);
  // WeChat ID que não é telefone não troca nada
  r = preferMessagingPhone({ ...base, phone: '+86 138 0574 2266', wechat: 'lilychen_nb' });
  assert.equal(r.phone, '+86 138 0574 2266');
  assert.equal(r.phone_wechat, false);
  // mesmo número em formatos diferentes marca os dois ícones
  r = preferMessagingPhone({ ...base, phone: '+86 138 0574 2266', whatsapp: '8613805742266', wechat: '138-0574-2266' });
  assert.equal(r.phone, '+86 138 0574 2266');
  assert.equal(r.phone_whatsapp, true);
  assert.equal(r.phone_wechat, true);
  // sem telefone, sem ícones
  r = preferMessagingPhone({ ...base, phone_whatsapp: true });
  assert.equal(r.phone_whatsapp, false);
});

test('produtos pela foto: lista fechada de Incoterm, números normalizados e itens sem nome descartados', async () => {
  const calls = [];
  const json = { products: [
    { name: ' Garrafa térmica inox 500 ml ', name_original: 'Vacuum flask 500ml', price: 'US$ 2,35', currency: 'USD', price_note: '', moq: '1.000', incoterm: 'fob', units_per_40hq: '12000', specs: 'Inox 304' },
    { name: 'Copo 350 ml', name_original: '', price: '16,80', currency: 'CNY', price_note: '', moq: '', incoterm: 'XYZ', units_per_40hq: 'n/a', specs: '' },
    { name: 'Prato', name_original: '', price: '3', currency: 'EUR', price_note: '€3', moq: '', incoterm: '', units_per_40hq: '', specs: '' },
    { name: '', name_original: '', price: '1', currency: 'USD', price_note: '', moq: '', incoterm: '', units_per_40hq: '', specs: '' },
  ] };
  const read = createProductReader({
    client: fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(json) }] }, calls),
  });
  const { products } = await read('image/jpeg', 'QUJD');
  assert.equal(products.length, 3);
  assert.deepEqual(products[0], {
    name: 'Garrafa térmica inox 500 ml', name_original: 'Vacuum flask 500ml', price: 2.35, currency: 'USD', price_note: '', moq: 1000,
    incoterm: 'FOB', units_per_box: null, boxes_per_40hq: null, units_per_40hq: 12000, specs: 'Inox 304',
  });
  assert.equal(products[1].price, 16.8, 'preço em yuan fica em yuan');
  assert.equal(products[1].currency, 'CNY');
  assert.equal(products[2].price, null, 'moeda que não é yuan nem dólar não entra');
  assert.equal(products[1].incoterm, '');
  assert.equal(products[1].units_per_40hq, null);
  const schema = calls[0].output_config.format.schema;
  assert.equal(schema.properties.products.type, 'array');
  assert.ok(schema.properties.products.items.properties.incoterm.enum.includes('FOB'));
  assert.equal(calls[0].model, 'claude-haiku-5-5');
  assert.equal(createProductReader({}), null);
});

test('toNumber entende formatos brasileiro e americano', () => {
  assert.equal(toNumber('1.234,50'), 1234.5);
  assert.equal(toNumber('1,234.50'), 1234.5);
  assert.equal(toNumber('1,000', { integer: true }), 1000);
  assert.equal(toNumber('2.5', { integer: true }), null);
  assert.equal(toNumber(''), null);
  assert.equal(toNumber('0'), null);
});

test('teste de modelos: gabarito pontua leitura perfeita com 100% e aponta os erros', () => {
  const { samples, scoreCard, scoreProducts } = require('../src/bench/ocr-bench');
  const card = samples.find((s) => s.id === 'card-bilingual');
  const perfect = {
    company_name: 'NINGBO HAIRUN HOUSEWARE CO., LTD.', company_name_local: '宁波海润家居用品有限公司', contact_name: 'Lily Chen (Sales Manager)',
    phone: '+86 138 0574 2266', phone_whatsapp: true, phone_wechat: false, booth: 'Booth 11.2 C23', province: 'Zhejiang',
    email: 'lily@hairun-hw.com', wechat: 'lilychen_nb',
  };
  let r = scoreCard(card.expected, perfect);
  assert.equal(r.points, r.total);
  r = scoreCard(card.expected, { ...perfect, phone: '+86 574 8765 4321', phone_whatsapp: false, province: '' });
  assert.deepEqual(r.misses, ['telefone (WhatsApp/WeChat)', 'marca WhatsApp', 'província']);

  const rmb = samples.find((s) => s.id === 'price-rmb');
  const good = { products: [
    { name: 'Copo térmico inox 350 ml', price: 16.8, currency: 'CNY', moq: 500 },
    { name: 'Garrafa térmica 1 L', price: 32, currency: 'CNY', moq: 300 },
    { name: 'Marmita inox', price: 22, currency: 'CNY', moq: 500 },
    { name: 'Copo infantil 200 ml', price: 9.5, currency: 'CNY', moq: 1000 },
  ] };
  r = scoreProducts(rmb.expected, good);
  assert.equal(r.points, r.total);
  // marcar o preço em yuan como dólar é erro
  r = scoreProducts(rmb.expected, { products: good.products.map((p) => ({ ...p, currency: 'USD' })) });
  assert.equal(r.misses.filter((m) => m.includes('preço e moeda')).length, 4);
  for (const s of samples) assert.ok(s.data.length > 1000 && s.expected, s.id);
});

// Cliente falso que responde por modelo.
function byModel(map, calls = []) {
  return { beta: { messages: { create: async (params) => {
    calls.push(params);
    const r = map[params.model];
    if (r instanceof Error) throw r;
    return { usage: { input_tokens: 1000, output_tokens: 500 }, ...r };
  } } } };
}
const ok = (obj) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(obj) }] });

test('Haiku com Opus de reserva: só chama o Opus quando o Haiku recusa, falha ou lê pouco', async () => {
  const good = { company_name: 'ACME', phone: '+86 138 0000 1111', address: 'Yiwu City' };
  // Haiku leu bem: o Opus não é chamado
  let calls = [];
  let read = createCardReader({ client: byModel({ 'claude-haiku-5-5': ok(good) }, calls), fallbackModel: 'claude-opus-5-5' });
  let meta = {};
  let out = await read('image/png', 'x', meta);
  assert.equal(out.company_name, 'ACME');
  assert.equal(out.province, 'Zhejiang', 'província deduzida pela cidade');
  assert.deepEqual(calls.map((c) => c.model), ['claude-haiku-5-5']);
  assert.equal(meta.escalated, undefined);
  assert.ok(Math.abs(meta.cost_usd - (1000 * 0.10 + 500 * 0.50) / 1e6) < 1e-12);

  // Haiku recusou: Opus lê, com a troca automática do servidor ligada nele
  calls = [];
  read = createCardReader({ client: byModel({ 'claude-haiku-5-5': { stop_reason: 'refusal', content: [] }, 'claude-opus-5-5': ok(good) }, calls), fallbackModel: 'claude-opus-5-5' });
  meta = {};
  out = await read('image/png', 'x', meta);
  assert.equal(out.company_name, 'ACME');
  assert.deepEqual(calls.map((c) => c.model), ['claude-haiku-5-5', 'claude-opus-5-5']);
  assert.equal(calls[1].fallbacks, 'default');
  assert.equal(meta.escalated, 'erro');
  assert.ok(meta.cost_usd > (1000 * 4 + 500 * 20) / 1e6, 'custo soma as duas leituras');

  // leitura fraca (sem empresa) vai para o Opus
  calls = [];
  read = createCardReader({ client: byModel({ 'claude-haiku-5-5': ok({ phone: '1' }), 'claude-opus-5-5': ok(good) }, calls), fallbackModel: 'claude-opus-5-5' });
  meta = {};
  out = await read('image/png', 'x', meta);
  assert.equal(out.company_name, 'ACME');
  assert.equal(meta.escalated, 'leitura incompleta');

  // Opus também falhou: fica com o que o Haiku leu
  read = createCardReader({ client: byModel({ 'claude-haiku-5-5': ok({ phone: '1' }), 'claude-opus-5-5': Object.assign(new Error('x'), { status: 500 }) }), fallbackModel: 'claude-opus-5-5' });
  out = await read('image/png', 'x', {});
  assert.equal(out.phone, '1');

  // chave inválida não tenta o Opus (teria o mesmo problema)
  calls = [];
  read = createCardReader({ client: byModel({ 'claude-haiku-5-5': Object.assign(new Error('auth'), { status: 401 }) }, calls), fallbackModel: 'claude-opus-5-5' });
  await assert.rejects(read('image/png', 'x', {}), (e) => e.status === 503);
  assert.equal(calls.length, 1);

  // produtos: nenhum item encontrado vai para o Opus
  calls = [];
  const p = createProductReader({ client: byModel({ 'claude-haiku-5-5': ok({ products: [] }), 'claude-opus-5-5': ok({ products: [{ name: 'Copo', price: '1.2', currency: 'CNY', price_note: '', moq: '', incoterm: '', units_per_40hq: '', specs: '', name_original: '' }] }) }, calls), fallbackModel: 'claude-opus-5-5' });
  const r = await p('image/png', 'x', {});
  assert.equal(r.products.length, 1);
  assert.equal(calls.length, 2);
});

test('regras fixas: província pelo endereço e preço em yuan não vira dólar', () => {
  assert.equal(provinceFromAddress('No. 88 Jiangnan Road, Ningbo, Zhejiang, China', ''), 'Zhejiang');
  assert.equal(provinceFromAddress('广东省佛山市顺德区北滘镇工业大道18号', ''), 'Guangdong');
  assert.equal(provinceFromAddress('Room 301, No. 5 Futian Road, Yiwu City', ''), 'Zhejiang');
  assert.equal(provinceFromAddress('Yiwu City, Zhejiang', 'Guangdong'), 'Zhejiang', 'província escrita no endereço vale mais que a leitura');
  assert.equal(provinceFromAddress('No. 1 Shanghai Rd, Ningbo', ''), 'Zhejiang', 'rua com nome de cidade não conta');
  assert.equal(provinceFromAddress('宁波市北京路8号', ''), 'Zhejiang');
  assert.equal(provinceFromAddress('Unknown street 5', 'Fujian'), 'Fujian', 'sem pista no endereço, fica a leitura');
  assert.equal(guardCurrency({ price: 16.8, currency: 'USD', price_note: '¥16.80' }).currency, 'CNY', 'escrito só em yuan não é dólar');
  assert.equal(guardCurrency({ price: 2.35, currency: 'USD', price_note: 'US$2.35 (1000 pcs) / ¥17' }).currency, 'USD');
  assert.equal(guardCurrency({ price: 2.35, currency: 'USD', price_note: '' }).currency, 'USD');
  assert.equal(guardCurrency({ price: 2.35, currency: '', price_note: '' }).price, null, 'sem moeda o preço não entra');
});

test('preço deixado só no texto vai para o campo de preço, com a moeda', () => {
  assert.deepEqual(priceFromText('¥16,80 (500 pcs) / ¥15,20 (2000 pcs)'), { price: 16.8, currency: 'CNY' });
  assert.deepEqual(priceFromText('16.8元'), { price: 16.8, currency: 'CNY' });
  assert.deepEqual(priceFromText('US$ 2.35'), { price: 2.35, currency: 'USD' });
  assert.deepEqual(priceFromText('RMB 1,280'), { price: 1280, currency: 'CNY' });
  assert.equal(priceFromText('sob consulta'), null);
  const p = guardCurrency({ price: null, currency: '', price_note: '¥16,80 (500 pcs)' });
  assert.equal(p.price, 16.8);
  assert.equal(p.currency, 'CNY');
});

test('cantos do cartão: válidos viram frações; tortos, cruzados ou pequenos são recusados', () => {
  const q = (tl, tr, br, bl) => ({ top_left: { x: tl[0], y: tl[1] }, top_right: { x: tr[0], y: tr[1] }, bottom_right: { x: br[0], y: br[1] }, bottom_left: { x: bl[0], y: bl[1] } });
  assert.deepEqual(cardCorners(q([100, 200], [900, 250], [880, 700], [120, 680])), [[0.1, 0.2], [0.9, 0.25], [0.88, 0.7], [0.12, 0.68]]);
  // foto girada 90°: o canto superior esquerdo do cartão fica embaixo à esquerda da imagem
  assert.ok(cardCorners(q([150, 900], [150, 100], [600, 100], [600, 900])));
  assert.equal(cardCorners(q([100, 200], [880, 700], [900, 250], [120, 680])), null, 'cantos cruzados');
  assert.equal(cardCorners(q([100, 100], [200, 100], [200, 150], [100, 150])), null, 'pequeno demais');
  assert.equal(cardCorners(q([100, 100], [1300, 100], [1300, 600], [100, 600])), null, 'fora da imagem');
  assert.equal(cardCorners(null), null);
});

test('cantos do cartão: consulta leve (esforço mínimo) separada da leitura dos dados', async () => {
  const calls = [];
  const corners = { top_left: { x: 100, y: 200 }, top_right: { x: 900, y: 250 }, bottom_right: { x: 880, y: 700 }, bottom_left: { x: 120, y: 680 } };
  const read = createCornerReader({ client: fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ card_corners: corners }) }] }, calls) });
  const r = await read('image/jpeg', 'QUJD');
  assert.deepEqual(r.corners, [[0.1, 0.2], [0.9, 0.25], [0.88, 0.7], [0.12, 0.68]]);
  assert.equal(calls[0].output_config.effort, 'low');
  assert.equal(calls[0].max_tokens, 2000);
  assert.deepEqual(Object.keys(calls[0].output_config.format.schema.properties), ['card_corners']);
});
