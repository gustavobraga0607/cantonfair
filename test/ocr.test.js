'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCardReader, createProductReader, FIELDS, preferMessagingPhone, toNumber } = require('../src/ocr');

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
  assert.equal(p.model, 'claude-opus-5-5');
  assert.equal(p.output_config.format.type, 'json_schema');
  assert.equal(p.output_config.format.schema.additionalProperties, false);
  assert.equal(p.fallbacks, 'default');
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
    { name: ' Garrafa térmica inox 500 ml ', name_original: 'Vacuum flask 500ml', price_usd: 'US$ 2,35', price_note: '', moq: '1.000', incoterm: 'fob', units_per_40hq: '12000', specs: 'Inox 304' },
    { name: 'Copo 350 ml', name_original: '', price_usd: '', price_note: '¥16,80', moq: '', incoterm: 'XYZ', units_per_40hq: 'n/a', specs: '' },
    { name: '', name_original: '', price_usd: '1', price_note: '', moq: '', incoterm: '', units_per_40hq: '', specs: '' },
  ] };
  const read = createProductReader({
    client: fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(json) }] }, calls),
  });
  const { products } = await read('image/jpeg', 'QUJD');
  assert.equal(products.length, 2);
  assert.deepEqual(products[0], {
    name: 'Garrafa térmica inox 500 ml', name_original: 'Vacuum flask 500ml', price_usd: 2.35, price_note: '', moq: 1000,
    incoterm: 'FOB', units_per_40hq: 12000, specs: 'Inox 304',
  });
  assert.equal(products[1].price_usd, null, 'preço em RMB não vira dólar');
  assert.equal(products[1].price_note, '¥16,80');
  assert.equal(products[1].incoterm, '');
  assert.equal(products[1].units_per_40hq, null);
  const schema = calls[0].output_config.format.schema;
  assert.equal(schema.properties.products.type, 'array');
  assert.ok(schema.properties.products.items.properties.incoterm.enum.includes('FOB'));
  assert.equal(calls[0].fallbacks, 'default');
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
    { name: 'Copo térmico inox 350 ml', price_usd: null, price_note: '¥16.80', moq: 500 },
    { name: 'Garrafa térmica 1 L', price_usd: null, price_note: '¥32.00', moq: 300 },
    { name: 'Marmita inox', price_usd: null, price_note: '¥22.00', moq: 500 },
    { name: 'Copo infantil 200 ml', price_usd: null, price_note: '¥9.50', moq: 1000 },
  ] };
  r = scoreProducts(rmb.expected, good);
  assert.equal(r.points, r.total);
  // converter yuan em dólar é erro
  r = scoreProducts(rmb.expected, { products: good.products.map((p) => ({ ...p, price_usd: 2.3 })) });
  assert.equal(r.misses.filter((m) => m.includes('preço US$')).length, 4);
  for (const s of samples) assert.ok(s.data.length > 1000 && s.expected, s.id);
});
