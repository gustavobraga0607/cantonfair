'use strict';

// Intérprete por voz (Microsoft Azure): fala → texto → tradução → voz.
// O celular só conversa com o nosso servidor (que chama a Azure), então o bloqueio de
// serviços estrangeiros na China não atinge a tradução — basta o nosso domínio estar acessível.
//
// Variáveis de ambiente:
//   AZURE_SPEECH_KEY, AZURE_SPEECH_REGION        (recurso "Speech" ou "Azure AI services")
//   AZURE_TRANSLATOR_KEY, AZURE_TRANSLATOR_REGION (opcionais; sem elas usa as da Speech —
//                                                 funciona com chave de "Azure AI services")

const LANGS = {
  pt: { stt: 'pt-BR', translator: 'pt', tts: 'pt-BR', voice: 'pt-BR-FranciscaNeural', label: 'Português' },
  zh: { stt: 'zh-CN', translator: 'zh-Hans', tts: 'zh-CN', voice: 'zh-CN-XiaoxiaoNeural', label: '中文' },
  en: { stt: 'en-US', translator: 'en', tts: 'en-US', voice: 'en-US-JennyNeural', label: 'English' },
};
// A Azure aceita até 60 s por gravação neste modo (frase a frase).
const MAX_SECONDS = 60;

class InterpreterError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// WAV PCM 16 bits (gerado no celular): devolve a duração em segundos ou null se não for WAV válido.
function wavInfo(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
  let off = 12;
  let fmt = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      fmt = { format: buf.readUInt16LE(off + 8), channels: buf.readUInt16LE(off + 10), rate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    } else if (id === 'data' && fmt) {
      if (fmt.format !== 1 || fmt.bits !== 16) return null;
      const bytes = Math.min(size, buf.length - off - 8);
      return { ...fmt, seconds: bytes / (fmt.rate * fmt.channels * 2) };
    }
    off += 8 + size + (size % 2);
  }
  return null;
}

const xmlEsc = (t) => String(t).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

function createAzureInterpreter({ speechKey, speechRegion, translatorKey, translatorRegion, fetchImpl = globalThis.fetch } = {}) {
  if (!speechKey || !speechRegion) return null;
  const tKey = translatorKey || speechKey;
  const tRegion = translatorRegion || speechRegion;

  async function call(what, url, init) {
    let res;
    try {
      res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(20_000) });
    } catch (err) {
      console.error(`Intérprete (${what}):`, err.message);
      throw new InterpreterError(502, 'Tradutor indisponível agora. Tente de novo.');
    }
    if (!res.ok) {
      console.error(`Intérprete (${what}): HTTP ${res.status}`, (await res.text().catch(() => '')).slice(0, 300));
      if (res.status === 401 || res.status === 403) throw new InterpreterError(503, 'Tradutor com chave da Azure inválida.');
      if (res.status === 429) throw new InterpreterError(429, 'Tradutor ocupado. Tente de novo em instantes.');
      throw new InterpreterError(502, 'Tradutor indisponível agora. Tente de novo.');
    }
    return res;
  }

  // Fala → texto (reconhecimento de áudio curto).
  async function recognize(wav, lang) {
    const url = `https://${speechRegion}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${LANGS[lang].stt}&format=simple`;
    const res = await call('fala', url, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': speechKey, 'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000', Accept: 'application/json' },
      body: wav,
    });
    const data = await res.json();
    if (data.RecognitionStatus !== 'Success' || !data.DisplayText) return '';
    return data.DisplayText;
  }

  async function translate(text, from, to) {
    const url = `https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=${LANGS[from].translator}&to=${LANGS[to].translator}`;
    const res = await call('tradução', url, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': tKey, 'Ocp-Apim-Subscription-Region': tRegion, 'Content-Type': 'application/json' },
      body: JSON.stringify([{ Text: text }]),
    });
    const data = await res.json();
    return data?.[0]?.translations?.[0]?.text || '';
  }

  // Texto → voz (MP3).
  async function speak(text, lang) {
    const l = LANGS[lang];
    const ssml = `<speak version='1.0' xml:lang='${l.tts}'><voice name='${l.voice}'>${xmlEsc(text)}</voice></speak>`;
    const res = await call('voz', `https://${speechRegion}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': speechKey, 'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3', 'User-Agent': 'MissaoChina',
      },
      body: ssml,
    });
    return Buffer.from(await res.arrayBuffer());
  }

  async function interpret(wav, from, to) {
    const source = await recognize(wav, from);
    if (!source) return { source: '', translated: '', audio: null };
    const translated = await translate(source, from, to);
    const audio = translated ? await speak(translated, to) : null;
    return { source, translated, audio };
  }

  // Diagnóstico: confere as chaves sem gravar áudio (token da Speech + tradução de uma palavra).
  interpret.check = async () => {
    // Só mostra a região se parecer nome de região (ex.: southeastasia) — nunca ecoa algo que possa ser chave.
    const shown = (r) => (/^[a-z0-9]{2,24}$/.test(r) ? r : 'inválida (não parece nome de região)');
    const out = { speech: false, translator: false, speech_region: shown(speechRegion), translator_region: shown(tRegion) };
    try {
      await call('token', `https://${speechRegion}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
        method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': speechKey, 'Content-Length': '0' },
      });
      out.speech = true;
    } catch (err) { out.speech_error = err.message; }
    try {
      out.translator = (await translate('olá', 'pt', 'zh')).length > 0;
    } catch (err) { out.translator_error = err.message; }
    // Voz: sintetiza uma palavra em cada idioma (custo desprezível).
    for (const lang of Object.keys(LANGS)) {
      try { out[`voice_${lang}`] = (await speak(lang === 'zh' ? '你好' : 'ok', lang)).length > 1000; } catch (err) { out[`voice_${lang}`] = false; out.voice_error = err.message; }
    }
    return out;
  };
  return interpret;
}

function interpreterFromEnv(env = process.env) {
  return createAzureInterpreter({
    speechKey: env.AZURE_SPEECH_KEY, speechRegion: env.AZURE_SPEECH_REGION,
    translatorKey: env.AZURE_TRANSLATOR_KEY, translatorRegion: env.AZURE_TRANSLATOR_REGION,
  });
}

module.exports = { createAzureInterpreter, interpreterFromEnv, wavInfo, InterpreterError, LANGS, MAX_SECONDS };
