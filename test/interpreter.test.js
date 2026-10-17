'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAzureInterpreter, wavInfo } = require('../src/interpreter');

function wavBuf(seconds, rate = 16000) {
  const data = Buffer.alloc(Math.round(seconds * rate) * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

test('duração do WAV', () => {
  assert.equal(wavInfo(wavBuf(2.5)).seconds, 2.5);
  assert.equal(wavInfo(Buffer.from('não é wav')), null);
});

test('Azure: fala → texto → tradução → voz, com idiomas e vozes certos', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('stt.speech')) return new Response(JSON.stringify({ RecognitionStatus: 'Success', DisplayText: 'Qual o preço & prazo?' }));
    if (url.includes('translator')) return new Response(JSON.stringify([{ translations: [{ text: '价格和交期是多少？', to: 'zh-Hans' }] }]));
    return new Response(Buffer.from('mp3-bytes'));
  };
  const interpret = createAzureInterpreter({ speechKey: 'k', speechRegion: 'southeastasia', fetchImpl });
  const out = await interpret(wavBuf(1), 'pt', 'zh');
  assert.equal(out.source, 'Qual o preço & prazo?');
  assert.equal(out.translated, '价格和交期是多少？');
  assert.equal(out.audio.toString(), 'mp3-bytes');
  assert.match(calls[0].url, /^https:\/\/southeastasia\.stt\.speech\.microsoft\.com\/.*language=pt-BR/);
  assert.match(calls[1].url, /from=pt&to=zh-Hans/);
  assert.equal(calls[1].init.headers['Ocp-Apim-Subscription-Region'], 'southeastasia');
  assert.match(calls[2].init.body, /zh-CN-XiaoxiaoNeural/);

  // nada reconhecido: não traduz nem gera voz
  const silent = createAzureInterpreter({ speechKey: 'k', speechRegion: 'r', fetchImpl: async () => new Response(JSON.stringify({ RecognitionStatus: 'NoMatch' })) });
  assert.deepEqual(await silent(wavBuf(1), 'zh', 'pt'), { source: '', translated: '', audio: null });
  // chave inválida vira erro claro
  const bad = createAzureInterpreter({ speechKey: 'k', speechRegion: 'r', fetchImpl: async () => new Response('no', { status: 401 }) });
  await assert.rejects(bad(wavBuf(1), 'pt', 'en'), (e) => e.status === 503);
  assert.equal(createAzureInterpreter({}), null);
});
