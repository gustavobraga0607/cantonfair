'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCardReader, FIELDS } = require('../src/ocr');

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
