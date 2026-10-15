'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCardReader, FIELDS, preferMessagingPhone } = require('../src/ocr');

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
