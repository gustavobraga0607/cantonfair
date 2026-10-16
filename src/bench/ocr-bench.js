'use strict';

// Teste de modelos de leitura: roda fotos sintéticas com gabarito em cada modelo e mede
// acerto, custo e tempo. Só o administrador usa (área Administração).

// Fotos com gabarito (~270 KB): carregadas só quando o administrador abre o teste.
let cached;
const allSamples = () => (cached ??= require('./ocr-samples.json').samples);

const norm = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const digits = (v) => String(v ?? '').replace(/\D/g, '');
const has = (value, pattern) => new RegExp(pattern, 'i').test(norm(value)) || new RegExp(pattern, 'i').test(String(value ?? ''));

// Cartão: um ponto por campo do gabarito.
function scoreCard(exp, out) {
  const checks = {
    'empresa': () => has(`${out.company_name} ${out.company_name_local}`, exp.company),
    'contato': () => has(out.contact_name, exp.contact),
    'telefone (WhatsApp/WeChat)': () => digits(out.phone).slice(-8) === exp.phone8,
    'marca WhatsApp': () => !!out.phone_whatsapp === exp.phone_whatsapp,
    'marca WeChat': () => !!out.phone_wechat === exp.phone_wechat,
    ...(exp.booth ? { 'stand': () => norm(out.booth).replace(/^booth /, '').includes(exp.booth) } : {}),
    'província': () => out.province === exp.province,
    ...(exp.email ? { 'e-mail': () => norm(out.email).includes(exp.email) } : {}),
    ...(exp.wechat ? { 'WeChat ID': () => norm(out.wechat).includes(exp.wechat) } : {}),
  };
  return tally(checks);
}

// Produtos: quantidade de itens + campos de cada item esperado (pareado pelo preço/ordem).
function scoreProducts(exp, out) {
  const list = out.products || [];
  const checks = { 'quantidade de produtos': () => list.length === exp.count };
  const used = new Set();
  exp.items.forEach((e, i) => {
    let j = list.findIndex((p, k) => !used.has(k) && e.price_usd != null && p.price_usd === e.price_usd);
    if (j < 0) j = list.findIndex((p, k) => !used.has(k) && k >= i);
    if (j >= 0) used.add(j);
    const p = j >= 0 ? list[j] : {};
    const n = `item ${i + 1}`;
    checks[`${n}: nome em português`] = () => has(p.name, e.name);
    checks[`${n}: preço US$`] = () => (e.price_usd == null ? p.price_usd == null : p.price_usd === e.price_usd);
    if (e.price_note) checks[`${n}: preço em yuan nas observações`] = () => String(p.price_note || '').includes(e.price_note);
    checks[`${n}: MOQ`] = () => p.moq === e.moq;
    if (e.incoterm) checks[`${n}: Incoterm`] = () => p.incoterm === e.incoterm;
    if (e.units_per_40hq) checks[`${n}: unidades/40HQ`] = () => p.units_per_40hq === e.units_per_40hq;
  });
  return tally(checks);
}

function tally(checks) {
  const misses = [];
  let points = 0;
  for (const [name, fn] of Object.entries(checks)) {
    let ok = false;
    try { ok = fn(); } catch { ok = false; }
    if (ok) points++; else misses.push(name);
  }
  return { points, total: Object.keys(checks).length, misses };
}

const sampleList = () => allSamples().map(({ id, kind, label, mime, data }) => ({ id, kind, label, image: `data:${mime};base64,${data}` }));

// Roda uma foto em todos os modelos ao mesmo tempo.
async function runModels(readers, kind, mime, base64, score) {
  return Promise.all(Object.entries(readers).map(async ([model, r]) => {
    const meta = {};
    try {
      const out = kind === 'card' ? await r.readCard(mime, base64, meta) : await r.readProducts(mime, base64, meta);
      return { ...meta, model, served_by: meta.model ?? null, output: out, ...(score ? score(out) : {}) };
    } catch (err) {
      return { ...meta, model, served_by: meta.model ?? null, error: err.message, ...(score ? { points: 0, total: null, misses: ['erro na leitura'] } : {}) };
    }
  }));
}

async function runSample(readers, id) {
  const s = allSamples().find((x) => x.id === id);
  if (!s) return null;
  const score = (out) => (s.kind === 'card' ? scoreCard(s.expected, out) : scoreProducts(s.expected, out));
  const results = await runModels(readers, s.kind, s.mime, s.data, score);
  // total do gabarito vale também para quem deu erro
  const total = score(s.kind === 'card' ? {} : { products: [] }).total;
  for (const r of results) if (r.total == null) r.total = total;
  return { id: s.id, label: s.label, kind: s.kind, results };
}

module.exports = { sampleList, runSample, runModels, scoreCard, scoreProducts, get samples() { return allSamples(); } };
