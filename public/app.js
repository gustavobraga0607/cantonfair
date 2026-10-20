'use strict';

// ===================== utilidades =====================

const $app = document.getElementById('app');
const state = { me: null, suppliers: null };
// Fotos já lidas no formulário de produto, passadas à tela de cadastro em lote.
let scanHandoff = null;
const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'];

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (n) => (n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const usd = (n) => (n == null ? '—' : 'US$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }));
const pct = (n) => (n == null ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + '%');
// thousands: campos de quantidade/valor em reais, onde "12.000" é doze mil (não 12).
const parseNum = (v, { thousands = false } = {}) => {
  if (v == null || String(v).trim() === '') return null;
  let t = String(v).trim().replace(/\s/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.'); // formato brasileiro 1.234,56
  else if (thousands && /^[1-9]\d{0,2}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
// Estimado no Brasil (R$) = (US$ + frete por unidade) × (1 + % nacionalização) × câmbio.
// Arredonda para centavos igual ao servidor, para o valor do formulário bater com o salvo.
// Preço do fornecedor em RMB (padrão) ou US$; frete por unidade sempre em US$.
// rates = { CNY: R$ por ¥, USD: R$ por US$ }.
const estimate = (price, currency, nat, rates, freightUsd = 0) => Math.round(
  (price * (currency === 'USD' ? rates.USD : rates.CNY) + (freightUsd || 0) * rates.USD) * (1 + (nat || 0) / 100) * 100) / 100;
const ratesOf = (x) => ({ USD: Number(x.exchange_rate), CNY: Number(x.cny_rate) || Number(x.exchange_rate) / 7.2 });
const CUR_LABEL = { CNY: '¥', USD: 'US$' };
// Preço escrito em texto ("¥16,80 (500 pcs)", "US$ 2.35", "16.8元") → { price, currency }; prefere o yuan.
function priceFromText(text) {
  const t = String(text || '');
  const n = (v) => Number(String(v).replace(/,(\d{1,2})$/, '.$1').replace(/,/g, ''));
  const cny = /(?:¥|￥|RMB|CNY|人民币)\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:元|RMB|CNY|yuan)/i.exec(t);
  if (cny) return { price: n(cny[1] || cny[2]), currency: 'CNY' };
  const usd = /(?:US\$|USD|\$|美元)\s*(\d+(?:[.,]\d+)?)|(\d+(?:[.,]\d+)?)\s*(?:USD|美元)/i.exec(t);
  return usd ? { price: n(usd[1] || usd[2]), currency: 'USD' } : null;
}
const priceIn = (n, cur) => (n == null ? '—' : `${CUR_LABEL[cur] || '¥'} ${Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`);
const curSelect = (cur) => `<select data-k="currency" class="cur-select" aria-label="Moeda">
  <option value="CNY"${cur === 'USD' ? '' : ' selected'}>¥ RMB (yuan)</option><option value="USD"${cur === 'USD' ? ' selected' : ''}>US$ (dólar)</option></select>`;
// Incoterms em que o preço já inclui o frete internacional (não soma o frete de novo).
const FREIGHT_INCLUDED = ['CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'];
const offerFreight = (incoterm, perUnit) => (FREIGHT_INCLUDED.includes(String(incoterm || '').toUpperCase()) ? 0 : perUnit || 0);
// Bandeiras (SVG, para aparecerem iguais em qualquer aparelho — emoji de bandeira vira "CN"/"BR" no Windows).
const FLAG_CN = '<svg class="flag" viewBox="0 0 30 20" role="img" aria-label="China"><rect width="30" height="20" fill="#EE1C25"/><polygon fill="#FFDE00" points="5.00,2.00 5.67,4.07 7.85,4.07 6.09,5.35 6.76,7.43 5.00,6.15 3.24,7.43 3.91,5.35 2.15,4.07 4.33,4.07"/><polygon fill="#FFDE00" points="9.14,2.51 9.62,1.97 9.25,1.34 9.91,1.63 10.39,1.08 10.33,1.80 11.00,2.09 10.29,2.25 10.22,2.97 9.85,2.35"/><polygon fill="#FFDE00" points="11.01,4.14 11.66,3.82 11.56,3.10 12.07,3.62 12.72,3.30 12.38,3.95 12.88,4.47 12.17,4.34 11.83,4.99 11.73,4.27"/><polygon fill="#FFDE00" points="11.04,6.73 11.76,6.70 11.96,6.00 12.21,6.68 12.94,6.66 12.37,7.10 12.62,7.79 12.01,7.38 11.44,7.83 11.64,7.13"/><polygon fill="#FFDE00" points="9.22,8.38 9.90,8.63 10.35,8.06 10.32,8.79 11.00,9.05 10.30,9.24 10.26,9.96 9.87,9.36 9.16,9.55 9.62,8.98"/></svg>';
const FLAG_BR = '<svg class="flag" viewBox="0 0 30 20" role="img" aria-label="Brasil"><rect width="30" height="20" fill="#009C3B"/><polygon fill="#FFDF00" points="15,2.2 27.6,10 15,17.8 2.4,10"/><circle cx="15" cy="10" r="4.3" fill="#002776"/><path d="M10.9 8.9a4.3 4.3 0 0 1 8.1 2.2" stroke="#fff" stroke-width=".8" fill="none"/></svg>';
// Ícones de linha fina (traço na cor do texto) — usados no lugar de emojis.
const ICON_PATHS = {
  alert: '<path d="M12 4 2.5 20h19z"/><path d="M12 10v4.5M12 17.5v.01"/>',
  bag: '<path d="M5 8h14l-1 13H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  bed: '<path d="M3 5v14M3 15h18M21 19v-6a3 3 0 0 0-3-3h-8v5"/><circle cx="6.5" cy="11.5" r="1.5"/>',
  building: '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M9 7h.01M15 7h.01M9 11h.01M15 11h.01M9 15h.01M15 15h.01M10 21v-3h4v3"/>',
  bus: '<rect x="4" y="3" width="16" height="15" rx="2"/><path d="M4 7h16M4 12h16M8 18v2M16 18v2M8 15h.01M16 15h.01"/>',
  camera: '<path d="M3 8.5A2 2 0 0 1 5 6.5h2l2-2.5h6l2 2.5h2a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/>',
  car: '<path d="M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11"/><rect x="3" y="11" width="18" height="6" rx="2"/><path d="M6 17v2M18 17v2M7 14h.01M17 14h.01"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19M6 15h4"/>',
  cash: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  contact: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16a3 3 0 0 1 6 0M15 10h3M15 14h3"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  factory: '<path d="M3 21V10l5 3v-3l5 3v-3l5 3V4h3v17z"/><path d="M7 17h2M12 17h2"/>',
  flask: '<path d="M9 3h6M10 3v6L4.5 19a1.5 1.5 0 0 0 1.3 2h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3M7 15h10"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13M12 8C10 8 7.5 7 8 5s3.5-.5 4 3c.5-3.5 3.5-5 4-3s-2 3-4 3"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.5"/><path d="m21 16-5-5-9 9"/>',
  landmark: '<path d="M3 21h18M4 10h16M12 3 3 8h18zM6 10v8M10 10v8M14 10v8M18 10v8"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>',
  note: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  package: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  phone: '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18h2"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
  receipt: '<path d="M5 3h14v18l-2.3-1.5L14.3 21 12 19.5 9.7 21l-2.4-1.5L5 21z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.6L20 8.5M20 4v4.5h-4.5"/>',
  share: '<path d="M12 15V3M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
  ship: '<path d="M3 15h18l-2 5H5z"/><path d="M6 15V9h12v6M12 4v5M9 6.5h6"/>',
  sparkles: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.6 1.9 1.9.6-1.9.6L19 20l-.6-1.9-1.9-.6 1.9-.6z"/>',
  speaker: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  train: '<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 10h14M9 21l1.5-4M15 21l-1.5-4M9 13.5h.01M15 13.5h.01"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6.5 6.5 0 0 1 3.5 6"/>',
  utensils: '<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 21V3c-2 1-3 3.5-3 6.5V13h3"/>',
  van: '<path d="M3 6h11l4 4h3v7H3z"/><path d="M14 6v4h4"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
  walk: '<circle cx="13" cy="4.5" r="1.5"/><path d="m10 21 2-6 3 3v3M8 12l2-3.5 3-1.5 2 3 3 1M12 15l1-7"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  leaf: '<path d="M5 19c0-8 5-14 15-15-1 10-7 15-15 15z"/><path d="m5 19 8-8"/>',
  navigation: '<path d="M3 11 21 3l-8 18-2-8z"/>',
  locate: '<circle cx="12" cy="12" r="7"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="2"/>',
  map: '<path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z"/><path d="M9 4v13.5M15 6.5V20"/>',
  wifiOff: '<path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01M3 3l18 18"/>',
};
const ic = (name) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[name]}</svg>`;
const FLAG_US = '<svg class="flag" viewBox="0 0 30 20" role="img" aria-label="Estados Unidos"><rect width="30" height="20" fill="#fff"/><path d="M0 0h30v1.54H0zm0 3.08h30v1.54H0zm0 3.08h30V7.7H0zm0 3.08h30v1.54H0zm0 3.08h30v1.54H0zm0 3.08h30v1.54H0zm0 3.08h30V20H0z" fill="#B22234"/><rect width="12" height="10.77" fill="#3C3B6E"/></svg>';
const FORMULA = 'Estimado = (preço × câmbio da moeda + frete por unidade × câmbio do dólar) × (1 + % nacionalização)';
const ratesText = (x) => `¥1 = R$ ${fmtRate(ratesOf(x).CNY)} · US$1 = R$ ${fmtRate(ratesOf(x).USD)}`;
const dateBr = (s) => (s ? new Date(s).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');

function formatCnpj(v) {
  const c = String(v).toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 14);
  const parts = [c.slice(0, 2), c.slice(2, 5), c.slice(5, 8), c.slice(8, 12), c.slice(12)];
  let out = parts[0];
  if (parts[1]) out += '.' + parts[1];
  if (parts[2]) out += '.' + parts[2];
  if (parts[3]) out += '/' + parts[3];
  if (parts[4]) out += '-' + parts[4];
  return out;
}

let offlineNoticeShown = false;
// Apaga os dados e fotos salvos pelo service worker (ao sair, entrar ou expirar a sessão).
const clearOfflineData = () => navigator.serviceWorker?.controller?.postMessage('logout');
// Falha de rede (sem sinal): o cadastro pode ir para a fila do celular.
class OfflineError extends Error {}
// Navegação atual: se o usuário trocar de tela enquanto uma consulta (GET) está a caminho,
// a resposta atrasada é descartada em vez de sobrescrever a tela nova.
let navSeq = 0;
class StaleNavigation extends Error {}

// timeout (ms): sinal fraco na feira costuma deixar o envio "pendurado"; passado o tempo,
// a chamada falha como sem internet (o cadastro vai para a fila e o client_ref evita duplicar).
// fresh: recusa a cópia salva pelo service worker (dado velho não pode virar base de uma gravação).
async function api(path, { method = 'GET', body, background = false, timeout = 0, fresh = false } = {}) {
  const nav = navSeq;
  let res;
  const ctrl = timeout ? new AbortController() : null;
  const timer = ctrl && setTimeout(() => ctrl.abort(), timeout);
  try {
    res = await fetch(path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
      signal: ctrl?.signal,
    });
  } catch {
    throw new OfflineError('Sem conexão com a internet. Tente de novo quando o sinal voltar.');
  } finally {
    clearTimeout(timer);
  }
  // Sem internet e nada salvo no celular para esta consulta (resposta do service worker).
  if (res.headers.get('X-Offline') && (!res.ok || fresh)) {
    throw new OfflineError('Sem conexão com a internet e sem dados salvos neste celular.');
  }
  // Resposta salva pelo service worker (sem internet): avisa uma vez.
  if (res.headers.get('X-Offline') && res.ok && !offlineNoticeShown) {
    offlineNoticeShown = true;
    setTimeout(() => toast('Sem conexão: mostrando os últimos dados salvos.'), 300);
  } else if (!res.headers.get('X-Offline')) {
    offlineNoticeShown = false;
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/api/login')) {
    if (state.me) clearOfflineData(); // sessão expirou: dados da empresa não ficam no celular
    state.me = null;
    if (background) throw new Error(data.error || 'Sessão expirada.');
    location.hash = '#/login';
    throw new Error(data.error || 'Sessão expirada.');
  }
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  if (method === 'GET' && !background && nav !== navSeq) throw new StaleNavigation();
  return data;
}

// ===================== cadastros sem internet =====================
// Sem sinal na feira, fornecedores e produtos novos ficam guardados no celular (IndexedDB) e são
// enviados sozinhos quando a conexão volta. Cada cadastro leva um client_ref: se o envio chegar
// duas vezes ao servidor, ele não duplica.

const newRef = () => (crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
const OUTBOX_STORE = 'outbox';
let outboxConn;
function outboxDb() {
  return (outboxConn ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('missao-china', 1);
    req.onupgradeneeded = () => req.result.createObjectStore(OUTBOX_STORE, { keyPath: 'ref' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((err) => { outboxConn = null; throw err; }));
}
async function outboxTx(mode, fn) {
  const db = await outboxDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, mode);
    const req = fn(tx.objectStore(OUTBOX_STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
// Itens do usuário logado, na ordem em que foram criados.
async function outboxAll() {
  if (!state.me) return [];
  try {
    const items = await outboxTx('readonly', (st) => st.getAll());
    return items.filter((i) => i.user_id === state.me.user.id && i.kind !== 'map').sort((a, b) => a.created_at.localeCompare(b.created_at));
  } catch { return []; }
}
// Id provisório (negativo) de fornecedor da fila → id real, guardado depois do envio. Assim um
// produto salvo depois (com o formulário ainda aberto com o id antigo) também é resolvido.
async function tempIdMap() {
  try {
    const items = await outboxTx('readonly', (st) => st.getAll());
    return new Map(items.filter((i) => i.kind === 'map').map((i) => [i.temp_id, i.real_id]));
  } catch { return new Map(); }
}
// Troca ids provisórios pelos reais; devolve true se ainda sobrar algum provisório.
function resolveTempIds(kind, body, map) {
  const fix = (o) => (o.supplier_id < 0 && map.has(o.supplier_id) ? { ...o, supplier_id: map.get(o.supplier_id) } : o);
  if (kind === 'product') body.offers = (body.offers || []).map(fix);
  if (kind === 'offer') body.offer = fix(body.offer);
  const offers = kind === 'product' ? body.offers : kind === 'offer' ? [body.offer] : [];
  return offers.some((o) => o.supplier_id < 0);
}
const outboxPut = (item) => outboxTx('readwrite', (st) => st.put(item));
const outboxDelete = (ref) => outboxTx('readwrite', (st) => st.delete(ref));

const OUTBOX_PATHS = { supplier: '/api/suppliers', product: '/api/products', expense: '/api/expenses' };
const OUTBOX_KIND = { supplier: 'Fornecedor', product: 'Produto', offer: 'Oferta', expense: 'Despesa' };

// Cria no servidor; sem internet, guarda na fila e devolve { queued }.
async function createOrQueue(kind, body, label) {
  // Produto de um fornecedor que ainda está na fila: vai para a fila logo atrás dele.
  if (resolveTempIds(kind, body, await tempIdMap())) {
    const queued = await queueItem({ kind, body, label }, new Error('Não foi possível guardar o cadastro neste celular.'));
    if (navigator.onLine) flushOutbox();
    return { queued };
  }
  try {
    return { saved: await api(OUTBOX_PATHS[kind], { method: 'POST', body, timeout: navigator.onLine ? 25_000 : 1 }) };
  } catch (err) {
    if (!(err instanceof OfflineError)) throw err;
    return { queued: await queueItem({ kind, body, label }, err) };
  }
}
// Acrescenta a oferta de um fornecedor a um produto que já existe (substitui a oferta anterior dele).
async function addOfferToProduct(productId, offer, { units, background = false } = {}) {
  const p = await api(`/api/products/${productId}`, { background: true, fresh: true, timeout: 25_000 });
  const offers = p.offers.filter((o) => o.supplier_id !== offer.supplier_id).map((o) => ({
    supplier_id: o.supplier_id, price: o.price, currency: o.currency, moq: o.moq, incoterm: o.incoterm, nationalization_pct: o.nationalization_pct,
  }));
  offers.push(offer);
  return api(`/api/products/${productId}`, {
    method: 'PUT', background, timeout: 25_000,
    body: { name: p.name, price_brl: p.price_brl, units_per_40hq: p.units_per_40hq ?? units ?? null, notes: p.notes, offers },
  });
}
async function addOfferOrQueue(productId, offer, label, opts = {}) {
  const body = { product_id: productId, offer, units: opts.units ?? null };
  if (resolveTempIds('offer', body, await tempIdMap())) {
    const queued = await queueItem({ kind: 'offer', body, label }, new Error('Não foi possível guardar o cadastro neste celular.'));
    if (navigator.onLine) flushOutbox();
    return { queued };
  }
  offer = body.offer;
  try {
    return { saved: await addOfferToProduct(productId, offer, opts) };
  } catch (err) {
    if (!(err instanceof OfflineError)) throw err;
    return { queued: await queueItem({ kind: 'offer', body: { product_id: productId, offer, units: opts.units ?? null }, label }, err) };
  }
}
async function queueItem({ kind, body, label }, originalError) {
  const item = {
    ref: body.client_ref || newRef(), kind, body, label, user_id: state.me.user.id, created_at: new Date().toISOString(),
  };
  if (kind === 'supplier') item.temp_id = -Date.now(); // id provisório (negativo) para usar nos produtos
  try { await outboxPut(item); } catch { throw originalError; } // sem armazenamento: mantém o erro de rede
  refreshOutboxBar();
  return item;
}

// Fornecedores e produtos ainda na fila, no formato das listas do app.
async function pendingSuppliers(company) {
  return (await outboxAll()).filter((i) => i.kind === 'supplier' && (!company || company === 'all' || (i.body.company || ownCnpj()) === company))
    .map((i) => ({
      id: i.temp_id, name: i.body.name, booth: i.body.booth || null, contact_name: i.body.contact_name || null, phone: i.body.phone || null,
      province: i.body.province || null, address: i.body.address || null, card_photo: null, product_count: 0,
      company_cnpj: i.body.company || ownCnpj(), pending: true, error: i.error || null,
    }));
}
async function pendingProducts(company) {
  return (await outboxAll()).filter((i) => i.kind === 'product' && (!company || company === 'all' || (i.body.company || ownCnpj()) === company))
    .map((i) => ({ id: null, ref: i.ref, name: i.body.name, offers: [], company_cnpj: i.body.company || ownCnpj(), pending: true, error: i.error || null }));
}

let flushing = false;
async function flushOutbox() {
  if (flushing || !state.me) return;
  flushing = true;
  let sent = 0;
  try {
    for (const { ref } of await outboxAll()) {
      // Relê o item: o envio de um fornecedor pode ter atualizado os itens que dependem dele.
      const item = await outboxTx('readonly', (st) => st.get(ref)).catch(() => null);
      if (!item) continue;
      try {
        if (resolveTempIds(item.kind, item.body, await tempIdMap())) {
          const waiting = (await outboxAll()).some((i) => i.kind === 'supplier'
            && (item.kind === 'offer' ? [item.body.offer] : item.body.offers).some((o) => o.supplier_id === i.temp_id));
          throw new Error(waiting ? 'O fornecedor deste cadastro ainda não foi enviado.'
            : 'O fornecedor deste cadastro foi descartado da fila. Descarte este item e cadastre de novo.');
        }
        if (item.kind === 'offer') {
          await addOfferToProduct(item.body.product_id, item.body.offer, { units: item.body.units, background: true });
        } else {
          const saved = await api(OUTBOX_PATHS[item.kind], { method: 'POST', body: item.body, background: true, timeout: 25_000 });
          if (item.kind === 'supplier') {
            await outboxPut({ ref: `map:${item.temp_id}`, kind: 'map', temp_id: item.temp_id, real_id: saved.id,
              user_id: item.user_id, created_at: new Date().toISOString() });
          }
        }
        await outboxDelete(item.ref);
        sent++;
      } catch (err) {
        if (err instanceof OfflineError || !state.me) break; // sem sinal ou sessão expirada: tenta depois
        await outboxPut({ ...item, error: err.message });
      }
    }
    // Mapas de ids com mais de 30 dias não servem mais.
    const old = Date.now() - 30 * 86400_000;
    const items = await outboxTx('readonly', (st) => st.getAll()).catch(() => []);
    for (const i of items) if (i.kind === 'map' && Date.parse(i.created_at) < old) await outboxDelete(i.ref).catch(() => {});
  } finally {
    flushing = false;
  }
  await refreshOutboxBar();
  if (sent) {
    state.suppliers = null;
    toast(`${sent} cadastro(s) feito(s) sem internet foram enviados.`);
    // Atualiza a tela atual, a não ser que o usuário esteja preenchendo um formulário.
    if (!/\/(new|edit|scan)\b/.test(location.hash)) router();
  }
}

async function refreshOutboxBar() {
  const bar = document.getElementById('outbox-bar');
  if (!bar) return;
  const items = await outboxAll();
  const errors = items.filter((i) => i.error).length;
  bar.hidden = !items.length || location.hash.startsWith('#/outbox');
  bar.classList.toggle('warn', errors > 0);
  bar.innerHTML = errors
    ? `${ic('alert')} ${errors} cadastro(s) com problema · ${items.length} na fila <b>Ver</b>`
    : `${ic('clock')} ${items.length} cadastro(s) aguardando internet para enviar <b>Ver</b>`;
}

window.addEventListener('online', () => flushOutbox());
document.addEventListener('visibilitychange', () => { if (!document.hidden && navigator.onLine) flushOutbox(); });
setInterval(() => { if (navigator.onLine) outboxAll().then((i) => i.length && flushOutbox()); }, 30_000);

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}
document.getElementById('toast').addEventListener('click', (e) => { e.currentTarget.hidden = true; });

// Foto em tela cheia (cartões, fotos de produto).
// rotateToFit: com o celular em pé e a imagem deitada (ex.: cartão de visitas),
// gira a imagem 90° para ela ocupar a tela inteira.
// O botão "voltar" do celular/navegador fecha a tela cheia em vez de trocar a página
// por baixo dela: ao abrir, uma entrada é adicionada ao histórico.
const lightbox = document.getElementById('lightbox');

function openLightbox(src, { rotateToFit = false } = {}) {
  const img = lightbox.querySelector('img');
  lightbox.classList.remove('rotated');
  img.onload = () => {
    const portrait = window.innerHeight > window.innerWidth;
    lightbox.classList.toggle('rotated', rotateToFit && portrait && img.naturalWidth > img.naturalHeight);
  };
  img.src = src;
  if (!lightbox.hidden) return;
  lightbox.hidden = false;
  history.pushState({ lightbox: true }, '');
}

// fromHistory: fechamento causado pelo "voltar" (a entrada do histórico já saiu).
function closeLightbox({ fromHistory = false } = {}) {
  if (lightbox.hidden) return;
  lightbox.hidden = true;
  if (!fromHistory && history.state?.lightbox) history.back();
}

lightbox.addEventListener('click', () => closeLightbox());
window.addEventListener('popstate', () => closeLightbox({ fromHistory: true }));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });

// Reduz a foto no navegador antes do envio (economiza dados móveis na feira).
function resizeImage(file, maxSize = 1280, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Formato de imagem não suportado.'));
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Miniatura JPEG (para listas), gerada a partir da foto já reduzida.
function makeThumb(dataUrl, size = 240) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onerror = () => resolve(null);
    img.onload = () => {
      const scale = Math.min(1, size / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.75));
    };
    img.src = dataUrl;
  });
}
const thumbUrl = (url) => (url ? `${url}/thumb` : null);
const thumbImg = (url, fallback = ic('package')) => (url
  ? `<img class="thumb" src="${esc(thumbUrl(url))}" alt="" loading="lazy" decoding="async" width="64" height="64">`
  : `<div class="thumb">${fallback}</div>`);

// Liga um <label class="photo-input"> com <input type=file> a uma prévia.
function bindPhotoInput(root, onChange, { maxSize, quality } = {}) {
  // Dois campos: um abre a câmera, o outro a galeria do celular.
  root.querySelectorAll('input[type=file]').forEach((input) => input.addEventListener('change', async () => {
    const file = input.files[0];
    input.value = ''; // permite escolher a mesma foto de novo
    if (!file) return;
    try {
      const dataUrl = await resizeImage(file, maxSize, quality);
      root.querySelector('.photo-preview').innerHTML = `<img src="${dataUrl}" alt="Prévia">`;
      onChange(dataUrl);
    } catch (err) {
      toast(/heic|heif/i.test(file.type + file.name)
        ? 'Este celular não abriu a foto HEIC. Tire a foto pela câmera ou salve-a como JPG.'
        : err.message);
    }
  }));
}

function photoInputHtml(current, placeholder) {
  return `
    <div class="photo-input">
      <div class="photo-preview" style="width:100%">${current
        ? `<img src="${esc(current)}" alt="Foto atual">`
        : `<div style="padding:24px">${ic('camera')}<br>${esc(placeholder)}</div>`}</div>
    </div>
    <div class="photo-buttons">
      <label class="btn photo-camera">${ic('camera')} Câmera<input type="file" accept="image/*" capture="environment"></label>
      <label class="btn photo-gallery">${ic('image')} Galeria<input type="file" accept="image/*"></label>
    </div>`;
}

// form: telas de cadastro escondem a barra de abas (no celular ela sobe com o
// teclado e cobre os campos) e usam uma barra fixa com o botão Salvar.
function setChrome({ title, back = null, tab = null, auth = false, form = false, fab = false, map = false }) {
  document.getElementById('map-view').hidden = !map;
  document.body.classList.toggle('map-mode', map);
  document.title = title ? `${title} · Missão China` : 'Missão China by BR Trading';
  document.getElementById('topbar').hidden = auth;
  document.getElementById('tabbar').hidden = auth || form;
  document.body.classList.toggle('has-tabs', !auth && !form);
  document.body.classList.toggle('has-fab', fab);
  document.getElementById('page-title').textContent = title || 'Missão China';
  document.getElementById('home-logo').hidden = Boolean(back);
  const backBtn = document.getElementById('back-btn');
  backBtn.hidden = !back;
  backBtn.onclick = () => { location.hash = back; };
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  const chip = document.getElementById('rate-chip');
  chip.innerHTML = state.me
    ? `${fxFailing() ? ic('alert') + ' ' : ''}¥1 = R$${fmtRate(ratesOf(state.me.company).CNY)}${state.me.company.rate_mode === 'manual' ? ' <small>manual</small>' : ''}`
    : '';
  chip.classList.toggle('warn', fxFailing());
  chip.title = fxFailing() ? 'Cotação automática indisponível — toque para ajustar' : 'Câmbio usado nas estimativas — toque para ajustar';
  chip.onclick = () => { location.hash = '#/account?cambio'; };
  chip.hidden = !state.me;
  // Atalho para o intérprete ao lado da cotação (destacado quando já está nele).
  const interp = document.getElementById('interp-btn');
  interp.hidden = !state.me;
  interp.classList.toggle('active', location.hash.startsWith('#/interpreter'));
}

const loading = () => { $app.innerHTML = '<div class="spinner">Carregando…</div>'; };

// Inclui os fornecedores cadastrados sem internet (ainda na fila), com id provisório negativo.
// Sem internet e sem lista salva no celular: devolve só os da fila (marcado com .offline).
async function getSuppliers(company) {
  const [list, pending] = await Promise.all([
    api('/api/suppliers' + (company ? `?company=${encodeURIComponent(company)}` : scopeQS()))
      .catch((err) => { if (err instanceof OfflineError) return Object.assign([], { offline: true }); throw err; }),
    pendingSuppliers(company || (isAdmin() ? getScope() : null)),
  ]);
  return Object.assign([...pending, ...list], { offline: Boolean(list.offline) });
}
const offlineNote = (what) => `<div class="ocr-status err" style="margin-bottom:12px">${ic('wifiOff')} Sem internet e sem ${what} salvos neste celular.
  Você pode cadastrar mesmo assim: fica guardado aqui e é enviado quando a conexão voltar.</div>`;
const pendingTag = (x) => (x.pending ? `<span class="badge ${x.error ? 'bad' : 'pending'}">${x.error ? ic('alert') + ' erro no envio' : ic('clock') + ' aguardando internet'}</span>` : '');

// ===================== administrador =====================
// O administrador vê fornecedores e produtos de todas as empresas e pode
// filtrar por empresa (a escolha fica salva neste navegador).

const isAdmin = () => Boolean(state.me?.user?.is_admin);
const ownCnpj = () => state.me?.company?.cnpj;

function getScope() {
  if (!isAdmin()) return null;
  let v = 'all';
  try { v = localStorage.getItem('cfb.scope') || 'all'; } catch { /* sem armazenamento local */ }
  return v === 'all' || companyInfo(v) ? v : 'all';
}
function setScope(v) {
  try { localStorage.setItem('cfb.scope', v); } catch { /* sem armazenamento local */ }
}
const scopeQS = () => (isAdmin() ? `?company=${encodeURIComponent(getScope())}` : '');

function companyInfo(cnpj) {
  return state.me?.companies?.find((c) => c.cnpj === cnpj) || null;
}
function companyLabel(cnpj) {
  const c = companyInfo(cnpj);
  return c ? c.name || c.cnpj_formatted : cnpj;
}
// Etiqueta da empresa, exibida só para o administrador.
function companyTag(cnpj) {
  return isAdmin() && cnpj ? `<span class="badge company" title="Empresa">${ic('building')} ${esc(companyLabel(cnpj))}</span>` : '';
}

function companyOptions(selected, { all = false } = {}) {
  return (all ? `<option value="all" ${selected === 'all' ? 'selected' : ''}>Todas as empresas</option>` : '') +
    (state.me.companies || []).map((c) => `<option value="${esc(c.cnpj)}" ${c.cnpj === selected ? 'selected' : ''}>
      ${esc(c.name || 'Sem nome')} — ${esc(c.cnpj_formatted)}${c.cnpj === ownCnpj() ? ' (sua)' : ''}</option>`).join('');
}

// Barra de filtro por empresa no topo das listas (só administrador).
function scopeBarHtml() {
  if (!isAdmin()) return '';
  return `<div class="scope-bar"><span class="badge admin">ADMIN</span>
    <select id="scope" aria-label="Empresa">${companyOptions(getScope(), { all: true })}</select></div>`;
}
function bindScopeBar() {
  document.getElementById('scope')?.addEventListener('change', (e) => { setScope(e.target.value); router(); });
}

// Empresa padrão para novos cadastros do administrador.
const defaultCompany = () => (getScope() && getScope() !== 'all' ? getScope() : ownCnpj());

// ===================== autenticação =====================

function viewLogin() {
  setChrome({ auth: true });
  $app.innerHTML = `
    <div class="auth">
      <div class="brand">
        <img class="brand-logo" src="/brand/logo.png" alt="BR Trading — Importação e Exportação">
        <h1>Missão China</h1>
        <p class="brand-by">by BR Trading</p>
        <p>Apoio ao comprador na Feira de Cantão</p>
      </div>
      <form class="card stack" id="login-form" novalidate>
        <div><label for="email">E-mail</label><input id="email" name="email" type="email" autocomplete="email" required></div>
        <div><label for="password">Senha</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
        <div class="error-box" id="err" hidden></div>
        <button class="btn primary block" type="submit">Entrar</button>
      </form>
      <p class="switch">Não tem conta? <a href="#/register">Cadastre-se</a></p>
    </div>`;
  const form = document.getElementById('login-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      clearOfflineData(); // outra conta pode ter usado este celular
      state.me = await api('/api/login', { method: 'POST', body: { email: form.email.value, password: form.password.value } });
      location.hash = '#/ranking';
    } catch (err) {
      const box = document.getElementById('err');
      box.textContent = err.message;
      box.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });
}

function viewRegister() {
  setChrome({ auth: true });
  $app.innerHTML = `
    <div class="auth">
      <div class="brand">
        <img class="brand-logo" src="/brand/logo.png" alt="BR Trading — Importação e Exportação">
        <h1>Criar conta</h1>
        <p>Usuários com o mesmo CNPJ compartilham fornecedores e produtos.</p>
      </div>
      <form class="card stack" id="reg-form" novalidate>
        <div><label for="name">Nome <span class="req">*</span></label><input id="name" name="name" autocomplete="name" required></div>
        <div><label for="email">E-mail <span class="req">*</span></label><input id="email" name="email" type="email" autocomplete="email" required></div>
        <div><label for="password">Senha <span class="req">*</span></label><input id="password" name="password" type="password" autocomplete="new-password" minlength="8" required>
          <div class="hint">Mínimo de 8 caracteres.</div></div>
        <div><label for="cnpj">CNPJ <span class="req">*</span></label>
          <input id="cnpj" name="cnpj" inputmode="text" autocapitalize="characters" placeholder="00.000.000/0000-00" required>
          <div class="hint" id="cnpj-hint">O CNPJ é validado na Receita Federal.</div></div>
        <div class="error-box" id="err" hidden></div>
        <button class="btn primary block" type="submit">Cadastrar</button>
      </form>
      <p class="switch">Já tem conta? <a href="#/login">Entrar</a></p>
    </div>`;
  const form = document.getElementById('reg-form');
  const hint = document.getElementById('cnpj-hint');
  let checkSeq = 0;

  form.cnpj.addEventListener('input', async () => {
    form.cnpj.value = formatCnpj(form.cnpj.value);
    const raw = form.cnpj.value.replace(/[^0-9A-Z]/g, '');
    hint.className = 'hint';
    if (raw.length < 14) { hint.textContent = 'O CNPJ é validado na Receita Federal.'; return; }
    const seq = ++checkSeq;
    hint.textContent = 'Verificando CNPJ…';
    try {
      const r = await api('/api/cnpj/check', { method: 'POST', body: { cnpj: raw } });
      if (seq !== checkSeq) return;
      if (!r.valid) { hint.className = 'hint err'; hint.textContent = r.message; return; }
      hint.className = 'hint ok';
      hint.textContent = '✓ CNPJ válido' + (r.name ? ` — ${r.name}` : '') +
        (r.existing ? ' (empresa já cadastrada: você verá os dados da equipe)' : '');
    } catch (err) {
      if (seq === checkSeq) { hint.className = 'hint err'; hint.textContent = err.message; }
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button');
    const box = document.getElementById('err');
    box.hidden = true;
    btn.disabled = true;
    try {
      clearOfflineData();
      state.me = await api('/api/register', {
        method: 'POST',
        body: { name: form.name.value, email: form.email.value, password: form.password.value, cnpj: form.cnpj.value },
      });
      toast('Conta criada!');
      location.hash = '#/ranking';
    } catch (err) {
      box.textContent = err.message;
      box.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });
}

// ===================== fornecedores =====================

async function viewSuppliers() {
  setChrome({ title: 'Fornecedores', tab: 'suppliers', fab: true });
  loading();
  const list = await getSuppliers();
  $app.innerHTML = `
    ${list.offline ? offlineNote('fornecedores') : ''}
    ${scopeBarHtml()}
    <div class="toolbar"><input type="search" id="q" placeholder="Buscar fornecedor, contato, stand, província"></div>
    <div class="list" id="list"></div>
    <a class="fab" href="#/suppliers/new" aria-label="Novo fornecedor">+</a>`;
  const render = (q = '') => {
    const term = q.trim().toLowerCase();
    const rows = list.filter((s) => !term || [s.name, s.booth, s.contact_name, s.phone, s.province, s.address]
      .some((v) => (v || '').toLowerCase().includes(term)));
    document.getElementById('list').innerHTML = rows.length
      ? rows.map((s) => `
        <a class="item" href="${s.pending ? '#/outbox' : `#/suppliers/${s.id}`}">
          ${thumbImg(s.card_photo, ic('contact'))}
          <div class="item-body">
            <div class="item-title">${esc(s.name)}</div>
            ${pendingTag(s)}
            <div class="item-sub">${s.contact_name ? esc(s.contact_name) + ' · ' : ''}${s.phone && (s.phone_whatsapp || s.phone_wechat) ? `<span class="msg-icons">${[s.phone_whatsapp && 'whatsapp', s.phone_wechat && 'wechat'].filter(Boolean).map((k) => `<span class="msg-badge ${k}" title="${k === 'wechat' ? 'WeChat' : 'WhatsApp'}">${MSG_ICONS[k]}</span>`).join('')}</span> · ` : ''}${s.booth ? 'Stand ' + esc(s.booth) : 'Sem stand'}${s.pending ? '' : ` · ${s.product_count} produto(s)`}</div>
            ${companyTag(s.company_cnpj)}
          </div>
        </a>`).join('')
      : `<div class="empty">${list.length ? 'Nenhum fornecedor encontrado.' : 'Nenhum fornecedor cadastrado ainda.<br><a class="btn primary" href="#/suppliers/new">Cadastrar fornecedor</a>'}</div>`;
  };
  render();
  bindScopeBar();
  document.getElementById('q').addEventListener('input', (e) => render(e.target.value));
}

async function viewSupplier(id) {
  setChrome({ title: 'Fornecedor', back: '#/suppliers', tab: 'suppliers' });
  loading();
  const s = await api(`/api/suppliers/${id}`);
  setChrome({ title: s.name, back: '#/suppliers', tab: 'suppliers' });
  $app.innerHTML = `
    ${s.card_photo ? `<div class="detail-photo" id="card-photo"><img src="${esc(s.card_photo)}" alt="Cartão de visitas"></div>`
      : `<a class="btn block" href="#/suppliers/${s.id}/edit">${ic('contact')} Adicionar foto do cartão</a>`}
    <div class="card stack" style="margin-top:14px">
      <div><div class="item-sub">Nome</div><div class="item-title">${esc(s.name)}</div></div>
      ${s.contact_name ? `<div><div class="item-sub">Contato</div><div>${esc(s.contact_name)}</div></div>` : ''}
      ${s.phone ? `<div><div class="item-sub">Telefone</div><div class="phone-line">
        <a href="tel:${esc(s.phone.replace(/[^0-9+]/g, ''))}">${esc(s.phone)}</a>
        ${s.phone.replace(/\D/g, '').length >= 8 ? `<a class="btn small${s.phone_whatsapp ? ' wa-btn' : ''}" target="_blank" rel="noopener" href="${esc(waLink(s.phone))}">${s.phone_whatsapp ? MSG_ICONS.whatsapp : ''}WhatsApp</a>` : ''}
        ${s.phone_wechat ? `<button type="button" class="btn small wc-btn" data-msg="wechat" data-phone="${esc(s.phone)}">${MSG_ICONS.wechat}WeChat</button>` : ''}
      </div></div>` : ''}
      <div><div class="item-sub">Stand</div><div>${esc(s.booth || '—')}</div></div>
      ${s.address || s.province ? `<div><div class="item-sub">Endereço</div><div class="trip-line">
        <span style="flex:1;min-width:0;white-space:pre-wrap">${esc([s.address, provinceLabel(s.province)].filter(Boolean).join('\n'))}</span>
        ${s.address ? `<button type="button" class="copy-btn" data-copy="${esc(s.address)}" title="Copiar endereço">Copiar</button>` : ''}
      </div></div>` : ''}
      ${isAdmin() ? `<div><div class="item-sub">Empresa</div><div>${esc(s.company_name || companyLabel(s.company_cnpj))}</div></div>` : ''}
      ${s.notes ? `<div><div class="item-sub">Observações</div><div style="white-space:pre-wrap">${esc(s.notes)}</div></div>` : ''}
      <div class="actions">
        <a class="btn" href="#/suppliers/${s.id}/edit">Editar</a>
        <a class="btn primary" href="#/products/new?supplier=${s.id}&company=${encodeURIComponent(s.company_cnpj)}">+ Produto</a>
      </div>
      ${state.me?.features?.product_ocr ? `<a class="btn block" href="#/products/scan?supplier=${s.id}&company=${encodeURIComponent(s.company_cnpj)}">${ic('camera')} Produtos pela foto (catálogo, tabela de preços)</a>` : ''}
      <div class="meta">Atualizado ${dateBr(s.updated_at)}${s.updated_by_name ? ' por ' + esc(s.updated_by_name) : ''}</div>
    </div>
    <h2>Produtos deste fornecedor (${s.products.length})</h2>
    <div class="list">${s.products.length ? s.products.map((p) => `
      <div class="sup-prod">
        <a class="item" href="#/products/${p.id}">
          ${thumbImg(p.photo)}
          <div class="item-body">
            <div class="item-title">${esc(p.name)}</div>
            <div class="item-sub">${priceIn(p.price, p.currency)}${p.moq ? ' · MOQ ' + p.moq : ''}${p.incoterm ? ' · ' + esc(p.incoterm) : ''}</div>
          </div>
          <div class="item-side"><div>${brl(p.estimated_brl)}</div><div class="item-sub">estimado</div></div>
        </a>
        <label class="sup-prod-cam" title="Tirar foto deste produto (fica nas fotos deste fornecedor)">
          ${ic('camera')}<small>${p.photo_count ? `${p.photo_count} foto${p.photo_count > 1 ? 's' : ''}` : 'Foto'}</small>
          <input type="file" accept="image/*" multiple data-sup-photo="${p.id}" hidden>
        </label>
      </div>`).join('') : '<div class="empty">Nenhum produto vinculado.</div>'}
    </div>`;
  document.getElementById('card-photo')?.addEventListener('click', () => openLightbox(s.card_photo));
  bindCopyButtons();
  bindMsgButtons();
  // Foto do produto direto da lista do fornecedor: entra nas fotos deste fornecedor no produto.
  $app.querySelectorAll('[data-sup-photo]').forEach((input) => input.addEventListener('change', async () => {
    const files = [...input.files];
    input.value = '';
    if (!files.length) return;
    const label = input.closest('label');
    label.classList.add('busy');
    let sent = 0;
    try {
      for (const [i, file] of files.entries()) {
        label.querySelector('small').textContent = `${i + 1} de ${files.length}…`;
        const photo = await resizeImage(file, 1024, 0.75);
        await api(`/api/products/${input.dataset.supPhoto}/photos`, { method: 'POST', body: { supplier_id: s.id, photo, photo_thumb: await makeThumb(photo) } });
        sent++;
      }
      toast(sent > 1 ? `${sent} fotos adicionadas.` : 'Foto adicionada.');
    } catch (err) {
      toast(sent ? `${sent} foto(s) enviada(s). ${err.message}` : err.message);
    } finally {
      if (location.hash === `#/suppliers/${s.id}`) viewSupplier(s.id);
    }
  }));
}

// Ícones de WhatsApp e WeChat ao lado do telefone.
const MSG_ICONS = {
  whatsapp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.4.1-.7.3-.2.3-.9.9-.9 2.2s.9 2.5 1 2.7c.1.2 1.8 2.8 4.4 3.9 1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z"/></svg>',
  wechat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 3.5C4.9 3.5 1.5 6.3 1.5 9.8c0 2 1.1 3.8 2.9 4.9l-.7 2.2 2.6-1.4c.9.3 1.8.4 2.7.4h.6a5.7 5.7 0 0 1-.2-1.6c0-3.4 3.2-6.1 7.2-6.1h.6C16.5 5.5 13.1 3.5 9 3.5Zm-2.6 4.4a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm5.2 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm10.9 6.3c0-2.9-2.9-5.3-6.4-5.3s-6.4 2.4-6.4 5.3 2.9 5.3 6.4 5.3c.7 0 1.4-.1 2.1-.3l2 1.1-.5-1.8a5 5 0 0 0 2.8-4.3Zm-8.5-.9a.9.9 0 1 1 0-1.7.9.9 0 0 1 0 1.7Zm4.3 0a.9.9 0 1 1 0-1.7.9.9 0 0 1 0 1.7Z"/></svg>',
};

// Número no formato internacional para o WhatsApp (wa.me exige o código do país).
// Celular chinês sem código (11 dígitos começando com 13–19) ou fixo com o 0 de longa distância
// recebem o 86 da China; "+" ou "00" na frente já indicam o país.
function waNumber(phone) {
  const raw = String(phone || '').trim();
  const d = raw.replace(/\D/g, '');
  if (raw.startsWith('+')) return d;
  if (d.startsWith('00')) return d.slice(2);
  if (/^1[3-9]\d{9}$/.test(d)) return '86' + d;
  if (/^0[1-9]\d{8,10}$/.test(d)) return '86' + d.slice(1);
  return d;
}
const waLink = (phone) => `https://wa.me/${waNumber(phone)}`;

// Botões de WhatsApp/WeChat da ficha do fornecedor (um único ouvinte em $app, reaproveitado entre telas).
// O WeChat não tem link para abrir a conversa com um número: copia o número e abre o app,
// para colar em "Adicionar contatos".
function bindMsgButtons() {
  if ($app.dataset.msgBound) return;
  $app.dataset.msgBound = '1';
  const act = async (el, e) => {
    e.preventDefault(); e.stopPropagation();
    if (el.dataset.msg === 'whatsapp') { window.open(waLink(el.dataset.phone), '_blank', 'noopener'); return; }
    const number = waNumber(el.dataset.phone);
    try { await navigator.clipboard.writeText(number.startsWith('86') ? number.slice(2) : number); } catch { /* sem área de transferência */ }
    toast('Número copiado. No WeChat: + → Adicionar contatos → cole o número.');
    setTimeout(() => { location.href = 'weixin://'; }, 800);
  };
  $app.addEventListener('click', (e) => { const el = e.target.closest('[data-msg]'); if (el) act(el, e); });
  $app.addEventListener('keydown', (e) => { const el = e.target.closest('[data-msg]'); if (el && (e.key === 'Enter' || e.key === ' ')) act(el, e); });
}

// Botões "Copiar" de endereços (útil para mostrar ao taxista).
function bindCopyButtons() {
  $app.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast('Endereço copiado.'); } catch { toast('Não foi possível copiar.'); }
  }));
}

// Províncias da China (lista em /provinces.js).
const provinceLabel = (name) => {
  const p = (self.PROVINCES || []).find((x) => x.name === name);
  return p ? `${p.name} (${p.local})` : name || '';
};
const provinceOptions = (selected) => `<option value="">Selecione…</option>${(self.PROVINCES || []).map((p) =>
  `<option value="${esc(p.name)}"${p.name === selected ? ' selected' : ''}>${esc(p.name)} (${esc(p.local)})</option>`).join('')}`;

// Lê o cartão de visita pela API e atualiza o cadastro com o que foi lido: campos que o cartão
// traz são substituídos (foto nova = dados novos); os que ele não traz ficam como estão.
let ocrSeq = 0;
async function readBusinessCard(form, dataUrl) {
  const box = document.getElementById('ocr-status');
  if (!state.me?.features?.card_ocr) return;
  const seq = ++ocrSeq;
  const submit = form.querySelector('button[type=submit]');
  box.hidden = false;
  box.className = 'ocr-status busy';
  box.textContent = 'Lendo o cartão de visita…';
  submit.disabled = true;
  try {
    const card = await api('/api/ocr/card', { method: 'POST', body: { image: dataUrl }, timeout: navigator.onLine ? 60_000 : 1 });
    if (seq !== ocrSeq) return;
    const filled = [];
    const fill = (field, value, label) => {
      const el = form[field];
      if (!value || el.value.trim() === value.trim()) return;
      if (el.tagName === 'SELECT' && ![...el.options].some((o) => o.value === value)) return; // fora da lista
      el.value = value;
      el.classList.add('autofilled');
      filled.push(label);
    };
    fill('name', card.company_name || card.company_name_local, 'nome');
    fill('contact_name', card.contact_name, 'contato');
    const phoneBefore = form.phone.value;
    fill('phone', card.phone || card.whatsapp, 'telefone');
    // WhatsApp/WeChat seguem o que o cartão indica para o telefone lido.
    if (card.phone && form.phone.value === card.phone) {
      const changed = phoneBefore !== form.phone.value
        || form.phone_whatsapp.checked !== !!card.phone_whatsapp || form.phone_wechat.checked !== !!card.phone_wechat;
      form.phone_whatsapp.checked = !!card.phone_whatsapp;
      form.phone_wechat.checked = !!card.phone_wechat;
      if (changed && card.phone_whatsapp) filled.push('WhatsApp');
      if (changed && card.phone_wechat) filled.push('WeChat');
    }
    fill('booth', card.booth, 'stand');
    fill('address', card.address, 'endereço');
    fill('province', card.province, 'província');

    // Demais informações do cartão vão para as observações: a linha do mesmo tipo
    // ("E-mail: …") é atualizada; o que o usuário escreveu fica.
    const extras = [
      ['Empresa (nome local)', card.company_name && card.company_name_local],
      ['E-mail', card.email],
      ['WeChat', card.wechat],
      ['WhatsApp', card.whatsapp && card.whatsapp.replace(/\D/g, '').slice(-8) !== form.phone.value.replace(/\D/g, '').slice(-8) ? card.whatsapp : ''],
      ['Outros telefones', card.other_phones],
      ['Site', card.website],
      ['Produtos', card.products],
    ].filter(([, v]) => v);
    const lines = form.notes.value.trim() ? form.notes.value.trim().split('\n') : [];
    let notesChanged = false;
    for (const [k, v] of extras) {
      const line = `${k}: ${v}`;
      const i = lines.findIndex((l) => l.startsWith(`${k}: `));
      if (i >= 0 && lines[i] === line) continue;
      if (i >= 0) lines[i] = line; else lines.push(line);
      notesChanged = true;
    }
    if (notesChanged) {
      form.notes.value = lines.join('\n');
      form.notes.classList.add('autofilled');
      filled.push('observações');
    }
    box.className = 'ocr-status ok';
    box.textContent = filled.length
      ? `✓ Cartão lido: ${filled.join(', ')} atualizado(s). Confira antes de salvar.`
      : 'Cartão lido: os dados já estavam iguais aos do cartão.';
  } catch (err) {
    if (seq !== ocrSeq) return;
    box.className = 'ocr-status err';
    box.textContent = err instanceof OfflineError
      ? 'Sem internet: a leitura automática do cartão não está disponível. Preencha os campos à mão e salve — o fornecedor (com a foto) fica guardado no celular e é enviado quando a conexão voltar.'
      : err.message;
  } finally {
    if (seq === ocrSeq) submit.disabled = false;
  }
}

async function viewSupplierForm(id) {
  const editing = id != null;
  setChrome({ title: editing ? 'Editar fornecedor' : 'Novo fornecedor', back: editing ? `#/suppliers/${id}` : '#/suppliers', tab: 'suppliers', form: true });
  loading();
  const s = editing ? await api(`/api/suppliers/${id}`) : {};
  let cardPhoto = null;
  const formRef = newRef(); // o mesmo cadastro enviado duas vezes não duplica
  const photoHint = state.me?.features?.card_ocr
    ? 'Fotografe o cartão ou escolha da galeria — os dados serão preenchidos automaticamente' : 'Fotografe o cartão ou escolha da galeria';
  const companyField = !isAdmin() ? ''
    : editing
      ? `<div><label>Empresa</label><div>${esc(s.company_name || companyLabel(s.company_cnpj))}</div></div>`
      : `<div><label for="company">Empresa</label><select id="company" name="company">${companyOptions(defaultCompany())}</select>
          <div class="hint">Como administrador, você pode cadastrar para qualquer empresa.</div></div>`;
  $app.innerHTML = `
    <form class="card stack" id="f" novalidate>
      ${companyField}
      <div><label>Foto do cartão de visitas</label>
        <div id="photo">${photoInputHtml(s.card_photo, photoHint)}</div></div>
      <div class="ocr-status" id="ocr-status" hidden></div>
      <div><label for="name">Nome do fornecedor <span class="req">*</span></label><input id="name" name="name" value="${esc(s.name)}" required></div>
      <div><label for="contact_name">Nome de contato</label><input id="contact_name" name="contact_name" value="${esc(s.contact_name)}" autocomplete="off"></div>
      <div class="row stack-sm">
        <div><label for="phone">Telefone</label><input id="phone" name="phone" type="tel" value="${esc(s.phone)}" placeholder="+86 …">
          <div class="msg-toggles" role="group" aria-label="Este telefone é">
            <label class="msg-toggle whatsapp"><input type="checkbox" name="phone_whatsapp"${s.phone_whatsapp ? ' checked' : ''}>${MSG_ICONS.whatsapp}WhatsApp</label>
            <label class="msg-toggle wechat"><input type="checkbox" name="phone_wechat"${s.phone_wechat ? ' checked' : ''}>${MSG_ICONS.wechat}WeChat</label>
          </div></div>
        <div><label for="booth">Nº do stand</label><input id="booth" name="booth" value="${esc(s.booth)}" placeholder="ex.: 11.2 C23"></div>
      </div>
      <div><label for="address">Endereço</label><textarea id="address" name="address" rows="2" placeholder="Rua, número, distrito, cidade">${esc(s.address)}</textarea></div>
      <div><label for="province">Província</label><select id="province" name="province">${provinceOptions(s.province)}</select></div>
      <div><label for="notes">Observações</label><textarea id="notes" name="notes">${esc(s.notes)}</textarea></div>
      <div class="error-box" id="err" hidden></div>
      <div class="actions form-actions">
        ${editing ? '<button type="button" class="btn danger" id="del">Excluir</button>' : ''}
        <button class="btn primary" type="submit">Salvar</button>
      </div>
    </form>`;
  const form = document.getElementById('f');
  const photoBox = document.getElementById('photo');
  let removePhoto = false;
  // Excluir a foto tira só a imagem; os dados do fornecedor continuam.
  const delPhoto = document.createElement('button');
  delPhoto.type = 'button';
  delPhoto.className = 'btn small danger photo-remove';
  delPhoto.innerHTML = `${ic('trash')} Excluir foto do cartão`;
  delPhoto.hidden = !s.card_photo;
  photoBox.append(delPhoto);
  delPhoto.addEventListener('click', () => {
    if (!confirm('Excluir a foto do cartão? Os dados do fornecedor continuam salvos.')) return;
    ocrSeq++; // descarta leitura em andamento
    cardPhoto = null;
    removePhoto = Boolean(s.card_photo);
    photoBox.querySelector('.photo-preview').innerHTML = `<div style="padding:24px">${ic('camera')}<br>${esc(photoHint)}</div>`;
    document.getElementById('ocr-status').hidden = true;
    form.querySelector('button[type=submit]').disabled = false;
    delPhoto.hidden = true;
  });
  bindPhotoInput(photoBox, (d) => { cardPhoto = d; removePhoto = false; delPhoto.hidden = false; readBusinessCard(form, d); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const box = document.getElementById('err');
    box.hidden = true;
    if (!form.name.value.trim()) { box.textContent = 'Informe o nome do fornecedor.'; box.hidden = false; return; }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const body = {
        name: form.name.value, contact_name: form.contact_name.value, phone: form.phone.value,
        phone_whatsapp: form.phone_whatsapp.checked, phone_wechat: form.phone_wechat.checked,
        booth: form.booth.value, address: form.address.value, province: form.province.value, notes: form.notes.value,
      };
      if (cardPhoto) Object.assign(body, { card_photo: cardPhoto, card_photo_thumb: await makeThumb(cardPhoto) });
      else if (removePhoto) body.remove_card_photo = true;
      if (form.company) body.company = form.company.value;
      if (editing) {
        const saved = await api(`/api/suppliers/${id}`, { method: 'PUT', body });
        toast('Fornecedor salvo.');
        location.hash = `#/suppliers/${saved.id}`;
        return;
      }
      body.client_ref = formRef;
      const { saved } = await createOrQueue('supplier', body, body.name);
      state.suppliers = null;
      if (saved) { toast('Fornecedor salvo.'); location.hash = `#/suppliers/${saved.id}`; return; }
      toast('Sem internet: fornecedor guardado no celular. Ele será enviado quando a conexão voltar.');
      location.hash = '#/suppliers';
    } catch (err) {
      box.textContent = err.message;
      box.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });
  if (editing) {
    document.getElementById('del').addEventListener('click', async () => {
      if (!confirm('Excluir este fornecedor? As ofertas dele nos produtos também serão removidas.')) return;
      try {
        await api(`/api/suppliers/${id}`, { method: 'DELETE' });
        toast('Fornecedor excluído.');
        location.hash = '#/suppliers';
      } catch (err) { toast(err.message); }
    });
  }
}

// ===================== produtos =====================

function bestOffer(p) { return p.offers[0] || null; }

function savingBadge(priceBrl, estimated) {
  if (priceBrl == null || estimated == null || priceBrl <= 0) return '<span class="badge">sem comparação</span>';
  const s = ((priceBrl - estimated) / priceBrl) * 100;
  return s > 0
    ? `<span class="badge good">${pct(s)} mais barato</span>`
    : `<span class="badge bad">${pct(-s)} mais caro</span>`;
}

async function viewProducts() {
  setChrome({ title: 'Produtos', tab: 'products', fab: true });
  loading();
  const [saved, pending] = await Promise.all([
    api('/api/products' + scopeQS()).catch((err) => { if (err instanceof OfflineError) return Object.assign([], { offline: true }); throw err; }),
    pendingProducts(isAdmin() ? getScope() : null),
  ]);
  const list = [...pending, ...saved];
  $app.innerHTML = `
    ${saved.offline ? offlineNote('produtos') : ''}
    ${scopeBarHtml()}
    <div class="add-choice" aria-label="Novo produto">
      <a class="btn primary" href="#/products/new">${ic('pen')} Manual<small>digitar os dados</small></a>
      ${state.me?.features?.product_ocr ? `<a class="btn" href="#/products/scan">${ic('camera')} Pela foto<small>catálogo ou tabela</small></a>` : ''}
      <a class="btn" href="#/products/import">${ic('receipt')} Planilha<small>importar do Excel</small></a>
    </div>
    <div class="toolbar"><input type="search" id="q" placeholder="Buscar produto ou fornecedor"></div>
    <div class="list" id="list"></div>
    <a class="fab" href="#/products/new" aria-label="Novo produto">+</a>`;
  const render = (q = '') => {
    const term = q.trim().toLowerCase();
    const rows = list.filter((p) => !term || p.name.toLowerCase().includes(term) ||
      p.offers.some((o) => o.supplier_name.toLowerCase().includes(term)));
    document.getElementById('list').innerHTML = rows.length
      ? rows.map((p) => {
        if (p.pending) {
          return `
        <a class="item" href="#/outbox">
          <div class="thumb">${ic('clock')}</div>
          <div class="item-body"><div class="item-title">${esc(p.name)}</div>${pendingTag(p)}</div>
        </a>`;
        }
        const b = bestOffer(p);
        return `
        <a class="item" href="#/products/${p.id}" data-product="${p.id}">
          ${thumbImg(p.list_photo || p.photo)}
          <div class="item-body">
            <div class="item-title">${esc(p.name)}</div>
            <div class="item-sub">${p.offers.length} fornecedor(es)${b ? ' · melhor: ' + esc(b.supplier_name) : ''}</div>
            <div style="margin-top:4px">${savingBadge(p.price_brl, b?.estimated_brl)} ${companyTag(p.company_cnpj)}</div>
          </div>
          <div class="item-side">
            <div class="price-line" title="Preço estimado importando da China">${FLAG_CN}${b ? brl(b.estimated_brl) : '—'}</div>
            <div class="price-line item-sub" title="Preço praticado no Brasil">${FLAG_BR}${brl(p.price_brl)}</div>
          </div>
        </a>`;
      }).join('')
      : `<div class="empty">${list.length ? 'Nenhum produto encontrado.' : 'Nenhum produto cadastrado ainda.<br><a class="btn primary" href="#/products/new">Cadastrar produto</a>'}</div>`;
  };
  render();
  bindScopeBar();
  document.getElementById('q').addEventListener('input', (e) => render(e.target.value));
  // Pressionar e segurar um produto: opção de excluir.
  onLongPress(document.getElementById('list'), '[data-product]', (el) => {
    const p = list.find((x) => x.id === Number(el.dataset.product));
    if (!p) return;
    actionSheet(p.name, [{ label: 'Excluir produto', danger: true, run: async () => {
      if (!confirm(`Excluir "${p.name}"? As ofertas e as fotos dele também serão apagadas.`)) return;
      try {
        await api(`/api/products/${p.id}`, { method: 'DELETE' });
        list.splice(list.indexOf(p), 1);
        render(document.getElementById('q').value);
        toast('Produto excluído.');
      } catch (err) { toast(err.message); }
    } }]);
  });
}

// Toque longo (≈0,6 s) num item da lista. O toque curto continua abrindo o item normalmente.
function onLongPress(container, selector, handler) {
  let timer = null;
  let start = null;
  let fired = false;
  const cancel = () => { clearTimeout(timer); timer = null; };
  container.addEventListener('pointerdown', (e) => {
    const el = e.target.closest(selector);
    if (!el || (e.pointerType === 'mouse' && e.button !== 0)) return;
    fired = false;
    start = { x: e.clientX, y: e.clientY };
    el.classList.add('pressing');
    timer = setTimeout(() => {
      timer = null;
      fired = true;
      el.classList.remove('pressing');
      navigator.vibrate?.(30);
      handler(el);
    }, 600);
  });
  container.addEventListener('pointermove', (e) => {
    if (timer && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) {
      cancel();
      container.querySelectorAll('.pressing').forEach((x) => x.classList.remove('pressing'));
    }
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
    container.addEventListener(ev, () => { cancel(); container.querySelectorAll('.pressing').forEach((x) => x.classList.remove('pressing')); });
  }
  // Depois do toque longo, o clique que vem em seguida não abre o item; o menu do navegador também não aparece.
  container.addEventListener('click', (e) => { if (fired && e.target.closest(selector)) { e.preventDefault(); fired = false; } }, true);
  container.addEventListener('contextmenu', (e) => { if (e.target.closest(selector)) e.preventDefault(); });
}

// Menu de ações que sobe da parte de baixo da tela.
function actionSheet(title, actions) {
  const box = document.createElement('div');
  box.className = 'sheet-backdrop';
  box.innerHTML = `<div class="sheet" role="dialog" aria-label="${esc(title)}">
    <div class="sheet-title">${esc(title)}</div>
    ${actions.map((a, i) => `<button type="button" class="btn block${a.danger ? ' danger' : ''}" data-act="${i}">${a.danger ? ic('trash') + ' ' : ''}${esc(a.label)}</button>`).join('')}
    <button type="button" class="btn block" data-act="cancel">Cancelar</button>
  </div>`;
  const close = () => box.remove();
  box.addEventListener('click', (e) => {
    if (e.target === box) return close();
    const b = e.target.closest('[data-act]');
    if (!b) return;
    close();
    if (b.dataset.act !== 'cancel') actions[Number(b.dataset.act)].run();
  });
  window.addEventListener('hashchange', close, { once: true });
  document.body.appendChild(box);
}

async function viewProduct(id) {
  setChrome({ title: 'Produto', back: '#/products', tab: 'products' });
  loading();
  const p = await api(`/api/products/${id}`);
  setChrome({ title: p.name, back: '#/products', tab: 'products' });
  const b = bestOffer(p);
  $app.innerHTML = `
    ${p.photo ? `<div class="detail-photo" id="photo"><img src="${esc(p.photo)}" alt="${esc(p.name)}"></div>` : ''}
    <div class="card stack" style="margin-top:${p.photo ? 14 : 0}px">
      <div><div class="item-sub">Produto</div><div class="item-title">${esc(p.name)}</div></div>
      ${isAdmin() ? `<div><div class="item-sub">Empresa</div><div>${esc(p.company_name || companyLabel(p.company_cnpj))}</div></div>` : ''}
      <div class="compare">
        <div>${FLAG_BR} Preço no Brasil<b>${brl(p.price_brl)}</b></div>
        <div>${FLAG_CN} Melhor estimado<b>${b ? brl(b.estimated_brl) : '—'}</b></div>
        <div>Diferença<b>${p.price_brl && b ? brl(p.price_brl - b.estimated_brl) : '—'}</b></div>
      </div>
      <div>${savingBadge(p.price_brl, b?.estimated_brl)}</div>
      ${p.units_per_40hq ? `<div><div class="item-sub">Container 40HQ</div>
        <div>${p.units_per_40hq.toLocaleString('pt-BR')} unidades${freightPerUnit(p.units_per_40hq) != null
          ? ` · frete por unidade <b>${usd(freightPerUnit(p.units_per_40hq))}</b> (${brl(freightPerUnit(p.units_per_40hq) * ratesOf(p).USD)})` : ''}</div></div>` : ''}
      ${p.notes ? `<div><div class="item-sub">Observações</div><div style="white-space:pre-wrap">${esc(p.notes)}</div></div>` : ''}
      <a class="btn" href="#/products/${p.id}/edit">Editar</a>
    </div>
    <h2>Fornecedores (${p.offers.length})</h2>
    ${p.offers.length ? `
    <div class="list">${p.offers.map((o, i) => `
      <div class="item rank-item offer-card">
        <a class="offer-head offer-link" style="margin:0" href="#/suppliers/${o.supplier_id}">
          <div class="item-body">
            <div class="item-title">${i === 0 ? ic('star') + ' ' : ''}${esc(o.supplier_name)}</div>
            <div class="item-sub">${o.supplier_booth ? 'Stand ' + esc(o.supplier_booth) : 'Sem stand'}</div>
          </div>
          ${i === 0 ? '<span class="badge good">melhor preço</span>' : ''}
        </a>
        <div class="compare four">
          <div>Preço<b>${priceIn(o.price, o.currency)}</b></div>
          <div>MOQ<b>${o.moq ?? '—'}</b></div>
          <div>${esc(o.incoterm || 'Incoterm')}<b>${pct(o.nationalization_pct)}</b></div>
          <div>Estimado<b>${brl(o.estimated_brl)}</b></div>
        </div>
        <div class="item-sub" style="margin-top:6px">${o.freight_usd > 0 ? `Frete incluído: ${usd(o.freight_usd)}/un.`
          : FREIGHT_INCLUDED.includes(o.incoterm) && p.units_per_40hq ? `Frete já incluso no ${esc(o.incoterm)}` : 'Sem frete no cálculo'}
        </div>
        <div class="offer-photos" aria-label="Fotos deste fornecedor">
          ${(o.photos || []).map((ph) => `<div class="offer-photo">
            <img src="${esc(thumbUrl(ph.url))}" alt="Foto de ${esc(o.supplier_name)}" loading="lazy" data-full="${esc(ph.url)}">
            <button type="button" class="offer-photo-del" data-del-photo="${ph.id}" aria-label="Excluir foto" title="Excluir foto">${ic('trash')}</button>
          </div>`).join('')}
          ${(o.photos || []).length < 12 ? `<label class="offer-photo offer-photo-add" title="Adicionar fotos deste fornecedor">
            ${ic('camera')}<small>${(o.photos || []).length ? 'Mais fotos' : 'Fotos'}</small>
            <input type="file" accept="image/*" multiple data-add-photo="${o.supplier_id}">
          </label>` : ''}
        </div>
      </div>`).join('')}
    </div>
    <p class="hint">${FORMULA} (${ratesText(p)}). Frete por unidade = frete 40HQ ÷ unidades por container; não é somado quando o Incoterm já inclui o frete (CFR, CIF, CPT, CIP, DAP, DPU, DDP).</p>`
    : '<div class="empty">Nenhum fornecedor vinculado a este produto.</div>'}
    <div class="meta">Atualizado ${dateBr(p.updated_at)}${p.updated_by_name ? ' por ' + esc(p.updated_by_name) : ''}</div>`;
  document.getElementById('photo')?.addEventListener('click', () => openLightbox(p.photo));
  bindOfferPhotos(p);
}

// Fotos do produto por fornecedor: ver em tela cheia, adicionar (várias de uma vez) e excluir.
function bindOfferPhotos(p) {
  $app.querySelectorAll('.offer-photo img').forEach((img) => img.addEventListener('click', () => openLightbox(img.dataset.full)));
  $app.querySelectorAll('[data-del-photo]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Excluir esta foto?')) return;
    b.disabled = true;
    try {
      await api(`/api/products/${p.id}/photos/${b.dataset.delPhoto}`, { method: 'DELETE' });
      toast('Foto excluída.');
      viewProduct(p.id);
    } catch (err) { b.disabled = false; toast(err.message); }
  }));
  $app.querySelectorAll('[data-add-photo]').forEach((input) => input.addEventListener('change', async () => {
    const files = [...input.files];
    input.value = '';
    if (!files.length) return;
    const label = input.closest('label');
    label.classList.add('busy');
    let sent = 0;
    try {
      for (const [i, file] of files.entries()) {
        label.querySelector('small').textContent = `${i + 1} de ${files.length}…`;
        const photo = await resizeImage(file, 1024, 0.75);
        await api(`/api/products/${p.id}/photos`, { method: 'POST', body: { supplier_id: Number(input.dataset.addPhoto), photo, photo_thumb: await makeThumb(photo) } });
        sent++;
      }
      toast(sent > 1 ? `${sent} fotos adicionadas.` : 'Foto adicionada.');
    } catch (err) {
      toast(sent ? `${sent} foto(s) enviada(s). ${err.message}` : err.message);
    } finally {
      if (location.hash === `#/products/${p.id}`) viewProduct(p.id);
    }
  }));
}

// ---- produtos parecidos (evita cadastrar o mesmo produto duas vezes) ----
const nameTokens = (t) => new Set(String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/(\d)[.,](\d)/g, '$1$2').replace(/(\d)([a-z])/g, '$1 $2').split(/[^a-z0-9\u4e00-\u9fff]+/)
  .filter((w) => w.length > 1 || /\d/.test(w)));
// Coeficiente de Dice entre as palavras dos nomes (0 a 1); números diferentes (500 ml × 750 ml) não contam como iguais.
function nameSimilarity(a, b) {
  const A = nameTokens(a);
  const B = nameTokens(b);
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return (2 * common) / (A.size + B.size);
}
const sameNumbers = (a, b) => {
  const nums = (t) => [...nameTokens(t)].filter((w) => /^\d+$/.test(w)).sort().join(' ');
  return nums(a) === nums(b);
};
function similarProducts(name, products, { exclude = null, min = 0.6 } = {}) {
  return products.filter((p) => p.id !== exclude)
    .map((p) => ({ p, score: nameSimilarity(name, p.name) }))
    .filter((x) => x.score >= min)
    .sort((x, y) => y.score - x.score).slice(0, 3)
    .map((x) => ({ ...x, strong: x.score >= 0.8 && sameNumbers(name, x.p.name) }));
}

// Nomes dos produtos da empresa (e os da fila), em versão leve, para o aviso de repetido.
const existingProductNames = (company) => Promise.all([
  api(`/api/products?fields=names${isAdmin() ? `&company=${encodeURIComponent(company)}` : ''}`).catch(() => []),
  pendingProducts(isAdmin() ? company : null),
]).then(([a, b]) => [...b, ...a]);

async function viewProductForm(id, query) {
  const editing = id != null;
  setChrome({ title: editing ? 'Editar produto' : 'Novo produto', back: editing ? `#/products/${id}` : '#/products', tab: 'products', form: true });
  loading();
  const p = editing ? await api(`/api/products/${id}`) : { offers: [] };
  // O produto pertence a uma empresa; os fornecedores das ofertas precisam ser dela.
  const company = editing ? p.company_cnpj : isAdmin() ? query.get('company') || defaultCompany() : ownCnpj();
  // Fornecedores e produtos já cadastrados (só nomes, para o aviso de repetido) ao mesmo tempo.
  const [suppliers, existing] = await Promise.all([
    getSuppliers(isAdmin() ? company : null),
    editing ? [] : existingProductNames(company),
  ]);
  const rates = ratesOf(editing ? p : companyInfo(company) || state.me.company);
  const rate = rates.USD; // frete (US$)
  let photo; // undefined = sem alteração, null = remover, string = nova foto
  const formRef = newRef(); // o mesmo cadastro enviado duas vezes não duplica
  // Aberto pelo "+ Produto" de um fornecedor: as fotos tiradas no topo ficam nas fotos desse fornecedor.
  const fromSupplier = !editing && Number(query.get('supplier')) > 0 ? suppliers.find((x) => x.id === Number(query.get('supplier'))) : null;
  let lastPhoto = null; // última foto escolhida (para a leitura automática)

  const companyField = !isAdmin() ? ''
    : editing
      ? `<div class="card"><div class="item-sub">Empresa</div><div>${esc(p.company_name || companyLabel(company))}</div></div>`
      : `<div class="card"><label for="company">Empresa</label><select id="company">${companyOptions(company)}</select>
          <div class="hint">Os fornecedores disponíveis são os desta empresa.</div></div>`;
  const bindCompany = () => document.getElementById('company')?.addEventListener('change', (e) => {
    location.hash = `#/products/new?company=${encodeURIComponent(e.target.value)}`;
  });

  if (!suppliers.length) {
    $app.innerHTML = `${companyField}<div class="empty">Cadastre um fornecedor ${isAdmin() ? 'nesta empresa ' : ''}antes de cadastrar produtos.<br>
      <a class="btn primary" href="#/suppliers/new">Cadastrar fornecedor</a></div>`;
    bindCompany();
    return;
  }

  // photos: fotos já salvas deste fornecedor; newPhotos: escolhidas agora (enviadas ao salvar); delPhotos: a excluir.
  const offers = p.offers.length
    ? p.offers.map((o) => ({ ...o, photos: o.photos || [], newPhotos: [], delPhotos: [] }))
    : [{ supplier_id: Number(query.get('supplier')) || '', price: '', currency: 'CNY', moq: '', incoterm: 'FOB', nationalization_pct: '' }];
  // Vindo do aviso de produto repetido: acrescenta (ou atualiza) a oferta do fornecedor neste produto.
  const addSupplier = Number(query.get('add_supplier'));
  if (editing && addSupplier) {
    const incoming = {
      supplier_id: addSupplier, price: query.get('price') || '', currency: query.get('cur') || 'CNY', moq: query.get('moq') || '',
      incoterm: query.get('incoterm') || 'FOB', nationalization_pct: query.get('nat') || '',
    };
    const cur = offers.find((o) => Number(o.supplier_id) === addSupplier);
    if (cur) for (const k of ['price', 'currency', 'moq', 'incoterm', 'nationalization_pct']) { if (incoming[k] !== '') cur[k] = incoming[k]; }
    else offers.push(incoming);
  }
  for (const o of offers) Object.assign(o, { photos: o.photos || [], newPhotos: o.newPhotos || [], delPhotos: o.delPhotos || [] });

  $app.innerHTML = `
    <form class="stack" id="f" novalidate>
      ${companyField}
      <div class="card stack">
        <div>${fromSupplier
          ? `<label>Foto do produto em ${esc(fromSupplier.name)}</label><div class="hint" style="margin:-2px 0 6px">Pode tirar várias: ficam nas fotos deste fornecedor (mais abaixo).</div>`
          : '<label>Foto geral do produto <small class="item-sub">(opcional — as fotos de cada fornecedor ficam mais abaixo)</small></label>'}
          <div id="photo">${photoInputHtml(p.photo, fromSupplier ? 'Fotografe o produto no estande' : 'Tire uma foto ou escolha da galeria')}</div>
          ${state.me?.features?.product_ocr && !editing
            ? `<button type="button" class="btn small block" id="read-photo" hidden style="margin-top:8px">${ic('sparkles')} Preencher os campos com os dados da foto</button>` : ''}
          ${p.photo ? '<button type="button" class="btn small danger" id="rm-photo" style="margin-top:8px">Remover foto</button>' : ''}</div>
        <div class="ocr-status" id="ocr-status" hidden></div>
        <div><label for="name">Nome do produto <span class="req">*</span></label><input id="name" name="name" value="${esc(p.name)}" required>
          <div class="dup-box" id="dup-box" hidden></div></div>
        <div><label for="price_brl">Preço no Brasil (R$)</label><input id="price_brl" name="price_brl" inputmode="decimal" value="${p.price_brl ?? ''}" placeholder="ex.: 129,90">
          <div class="hint">Preço de referência praticado no mercado brasileiro.</div></div>
        <div><label for="units_per_40hq">Unidades por container 40HQ</label>
          <input id="units_per_40hq" name="units_per_40hq" inputmode="numeric" value="${p.units_per_40hq ?? ''}" placeholder="ex.: 12000">
          <div class="hint" id="freight-hint">${freightHint(p.units_per_40hq, rate)}</div></div>
        <div><label for="notes">Observações</label><textarea id="notes" name="notes">${esc(p.notes)}</textarea></div>
      </div>
      <div class="card">
        <div class="offer-head" style="margin-bottom:12px"><h3>Fornecedores e preços</h3>
          <button type="button" class="btn small" id="add-offer">+ Adicionar</button></div>
        <div id="offers"></div>
        <p class="hint">${FORMULA} (${ratesText({ exchange_rate: rates.USD, cny_rate: rates.CNY })}). O frete não é somado quando o Incoterm já o inclui (CFR, CIF, CPT, CIP, DAP, DPU, DDP).</p>
      </div>
      <div class="error-box" id="err" hidden></div>
      <div class="actions form-actions">
        ${editing ? '<button type="button" class="btn danger" id="del">Excluir</button>' : ''}
        <button class="btn primary" type="submit">Salvar</button>
      </div>
    </form>`;

  // Cadastro manual: a foto é só a foto do produto. A leitura automática é opcional (botão).
  const readBtn = document.getElementById('read-photo');
  bindPhotoInput(document.getElementById('photo'), (d) => {
    lastPhoto = d;
    if (fromSupplier) {
      const o = offers.find((x) => Number(x.supplier_id) === fromSupplier.id) || offers[0];
      if (o.newPhotos.length + (o.photos?.length || 0) < 12) o.newPhotos.push(d);
      renderOffers();
      toast('Foto adicionada às fotos deste fornecedor.');
    } else {
      photo = d;
    }
    if (readBtn) readBtn.hidden = false;
  });
  readBtn?.addEventListener('click', () => { if (lastPhoto) readProductPhoto(lastPhoto); });
  bindCompany();
  document.getElementById('rm-photo')?.addEventListener('click', (e) => {
    photo = null;
    document.querySelector('#photo .photo-preview').innerHTML = `<div style="padding:24px">${ic('camera')}<br>Tire uma foto ou escolha da galeria</div>`;
    e.target.remove();
  });

  const form = document.getElementById('f');
  const offersEl = document.getElementById('offers');

  function offerCalc(o) {
    const priceV = parseNum(o.price);
    const natV = parseNum(o.nationalization_pct) || 0;
    if (priceV == null || Number.isNaN(priceV)) return '<span class="item-sub">Informe o preço</span>';
    const perUnit = freightPerUnit(parseNum(form.units_per_40hq.value, { thousands: true })) || 0;
    const freight = offerFreight(o.incoterm, perUnit);
    const est = estimate(priceV, o.currency, natV, rates, freight);
    const br = parseNum(form.price_brl.value, { thousands: true });
    const note = freight > 0
      ? `<span class="item-sub">inclui frete ${usd(freight)}/un.</span>`
      : perUnit > 0 ? `<span class="item-sub">frete já incluso no ${esc(o.incoterm)}</span>` : '';
    return `<span>Estimado: <b>${brl(est)}</b></span>${note}${br > 0 ? savingBadge(br, est) : ''}`;
  }

  function renderOffers() {
    offersEl.innerHTML = offers.map((o, i) => `
      <div class="offer" data-i="${i}">
        <div class="offer-head">
          <div class="combo">
            <input class="combo-input" data-combo="${i}" value="${esc(supplierLabel(o.supplier_id))}"
              placeholder="Buscar fornecedor pelo nome ou stand…" autocomplete="off" role="combobox"
              aria-label="Fornecedor" aria-expanded="false" aria-autocomplete="list">
            <ul class="combo-list" role="listbox" hidden></ul>
          </div>
          ${offers.length > 1 ? `<button type="button" class="icon-btn" data-rm="${i}" aria-label="Remover">✕</button>` : ''}
        </div>
        <div class="row">
          <div><label>Preço <span class="req">*</span></label><input data-k="price" inputmode="decimal" value="${esc(o.price)}" placeholder="0,00"></div>
          <div><label>Moeda</label>${curSelect(o.currency)}</div>
        </div>
        <div class="row" style="margin-top:10px">
          <div><label>MOQ</label><input data-k="moq" inputmode="numeric" value="${esc(o.moq ?? '')}" placeholder="unid."></div>
          <div><label>Incoterm</label><select data-k="incoterm">
            <option value="">—</option>
            ${INCOTERMS.map((t) => `<option ${o.incoterm === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select></div>
        </div>
        <div class="row" style="margin-top:10px">
          <div><label>Nacionaliz. (%)</label><input data-k="nationalization_pct" inputmode="decimal" value="${esc(o.nationalization_pct ?? '')}" placeholder="ex.: 85"></div>
          <div></div>
        </div>
        <div class="offer-calc" data-calc="${i}">${offerCalc(o)}</div>
        ${offerPhotosHtml(o, i)}
      </div>`).join('');
  }
  function offerPhotosHtml(o, i) {
    const kept = (o.photos || []).filter((ph) => !(o.delPhotos || []).includes(ph.id));
    const fresh = o.newPhotos || [];
    const total = kept.length + fresh.length;
    return `<div class="offer-photos-label">Fotos deste fornecedor <small class="item-sub">(opcional)</small></div>
      <div class="offer-photos">
        ${kept.map((ph) => `<div class="offer-photo"><img src="${esc(thumbUrl(ph.url))}" alt="" data-full="${esc(ph.url)}">
          <button type="button" class="offer-photo-del" data-del-old="${i}:${ph.id}" aria-label="Excluir foto">${ic('trash')}</button></div>`).join('')}
        ${fresh.map((d, j) => `<div class="offer-photo"><img src="${d}" alt="" data-full="${d}">
          <button type="button" class="offer-photo-del" data-del-new="${i}:${j}" aria-label="Excluir foto">${ic('trash')}</button></div>`).join('')}
        ${total < 12 ? `<label class="offer-photo offer-photo-add">${ic('camera')}<small>${total ? 'Mais fotos' : 'Fotos'}</small>
          <input type="file" accept="image/*" multiple data-add-new="${i}"></label>` : ''}
      </div>`;
  }
  renderOffers();

  // ---- campo de fornecedor com busca ----
  function supplierLabel(id) {
    const s = suppliers.find((x) => x.id === Number(id));
    return s ? s.name + (s.booth ? ` — ${s.booth}` : '') + (s.pending ? ' (aguardando internet)' : '') : '';
  }

  // ---- aviso de produto parecido já cadastrado ----
  const dupBox = document.getElementById('dup-box');
  function checkDuplicates() {
    if (editing) return;
    const found = similarProducts(form.name.value, existing);
    dupBox.hidden = !found.length || form.name.value.trim().length < 3;
    if (dupBox.hidden) return;
    const o = offers.find((x) => x.supplier_id) || offers[0];
    const qs = new URLSearchParams({
      ...(Number(o.supplier_id) > 0 ? { add_supplier: o.supplier_id } : {}), price: o.price || '', cur: o.currency || 'CNY', moq: o.moq || '',
      incoterm: o.incoterm || '', nat: o.nationalization_pct || '',
    });
    dupBox.innerHTML = `<div class="dup-title">${ic('alert')} Parecido com produto já cadastrado:</div>${found.map(({ p: x }) => `
      <div class="dup-item"><span>${esc(x.name)}${x.pending ? ' <small>(aguardando envio)</small>' : ` <small>· ${x.offer_count ?? x.offers?.length ?? 0} fornecedor(es)</small>`}</span>
        ${x.pending || !x.id ? '' : `<a class="btn small" href="#/products/${x.id}/edit?${qs}">${Number(o.supplier_id) > 0 ? 'Adicionar a oferta neste' : 'Abrir este'}</a>`}
      </div>`).join('')}
      <div class="hint">Se for o mesmo produto, adicione a oferta nele em vez de criar outro — assim a comparação entre fornecedores funciona.</div>`;
  }
  let dupTimer;
  form.name.addEventListener('input', () => { clearTimeout(dupTimer); dupTimer = setTimeout(checkDuplicates, 250); });

  // ---- leitura da foto do produto ----
  let ocrSeq = 0;
  async function readProductPhoto(dataUrl) {
    if (!state.me?.features?.product_ocr) return;
    const box = document.getElementById('ocr-status');
    const submit = form.querySelector('button[type=submit]');
    const seq = ++ocrSeq;
    box.hidden = false;
    box.className = 'ocr-status busy';
    box.textContent = 'Lendo a foto…';
    submit.disabled = true;
    try {
      const { products } = await api('/api/ocr/product', { method: 'POST', body: { image: dataUrl }, timeout: navigator.onLine ? 90_000 : 1 });
      if (seq !== ocrSeq) return;
      if (!products.length) {
        box.className = 'ocr-status err';
        box.textContent = 'Não encontrei dados de produto nesta foto. Preencha os campos à mão.';
        return;
      }
      if (products.length > 1) {
        box.className = 'ocr-status ok';
        box.innerHTML = `Encontrei <b>${products.length} produtos</b> nesta foto.
          <div class="actions" style="margin-top:8px">
            <button type="button" class="btn small primary" id="scan-all">Cadastrar os ${products.length} de uma vez</button>
            <button type="button" class="btn small" id="scan-first">Usar só o primeiro</button></div>`;
        document.getElementById('scan-all').addEventListener('click', () => {
          const o = offers[0];
          scanHandoff = { photo: dataUrl, products, company, supplier: Number(o.supplier_id) || null };
          location.hash = `#/products/scan?company=${encodeURIComponent(company)}${o.supplier_id ? `&supplier=${o.supplier_id}` : ''}`;
        });
        document.getElementById('scan-first').addEventListener('click', () => applyRead(products[0], box));
        return;
      }
      applyRead(products[0], box);
    } catch (err) {
      if (seq !== ocrSeq) return;
      box.className = 'ocr-status err';
      box.textContent = err instanceof OfflineError ? 'Sem internet: a leitura automática da foto não está disponível. Preencha à mão — o cadastro fica guardado e é enviado depois.' : err.message;
    } finally {
      if (seq === ocrSeq) submit.disabled = false;
    }
  }
  function applyRead(r0, box) {
    const found = r0.price == null ? priceFromText(r0.price_note) : null;
    const r = found ? { ...r0, ...found } : r0;
    const filled = [];
    const set = (el, v, label) => { if (v == null || v === '' || String(el.value).trim()) return; el.value = v; el.classList.add('autofilled'); filled.push(label); };
    set(form.name, r.name, 'nome');
    set(form.units_per_40hq, r.units_per_40hq, 'unidades/40HQ');
    const o = offers.find((x) => !String(x.price).trim()) || offers[0];
    if (r.price != null && !String(o.price).trim()) { o.price = String(r.price).replace('.', ','); o.currency = r.currency || 'CNY'; filled.push(`preço (${CUR_LABEL[o.currency]})`); }
    if (r.moq != null && !String(o.moq ?? '').trim()) { o.moq = r.moq; filled.push('MOQ'); }
    if (r.incoterm) { o.incoterm = r.incoterm; filled.push('Incoterm'); }
    const extra = [r.name_original && `Nome original: ${r.name_original}`, r.price_note && `Preço: ${r.price_note}`, r.specs]
      .filter((l) => l && !form.notes.value.includes(l));
    if (extra.length) {
      form.notes.value = [form.notes.value.trim(), ...extra].filter(Boolean).join('\n');
      form.notes.classList.add('autofilled');
      filled.push('observações');
    }
    renderOffers();
    document.getElementById('freight-hint').innerHTML = freightHint(parseNum(form.units_per_40hq.value, { thousands: true }), rate);
    checkDuplicates();
    box.className = 'ocr-status ok';
    box.textContent = filled.length ? `✓ Foto lida: ${filled.join(', ')} preenchido(s). Confira antes de salvar.` : 'Foto lida, mas os campos já estavam preenchidos.';
  }
  const norm = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

  function comboOptions(i, text) {
    const term = norm(text);
    const showAll = !term || text === supplierLabel(offers[i].supplier_id);
    const used = new Set(offers.filter((_, j) => j !== i).map((o) => Number(o.supplier_id)));
    return suppliers.filter((s) => showAll || norm(s.name).includes(term) || norm(s.booth).includes(term))
      .map((s) => ({ ...s, used: used.has(s.id) }));
  }

  function openCombo(input) {
    const i = Number(input.dataset.combo);
    const list = input.nextElementSibling;
    const opts = comboOptions(i, input.value);
    list.innerHTML = opts.length
      ? opts.map((s) => `
        <li role="option" data-id="${s.id}" class="${s.used ? 'disabled' : ''} ${Number(offers[i].supplier_id) === s.id ? 'selected' : ''}"
          aria-disabled="${s.used}">
          <span>${esc(s.name)}</span>
          <small>${s.used ? 'já adicionado' : s.booth ? 'Stand ' + esc(s.booth) : ''}</small>
        </li>`).join('')
      : '<li class="empty-opt">Nenhum fornecedor encontrado</li>';
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    list.querySelector('li[data-id]:not(.disabled)')?.classList.add('active');
  }

  function closeCombo(input) {
    const list = input.nextElementSibling;
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    // Texto digitado sem escolher uma opção volta para o fornecedor selecionado.
    input.value = supplierLabel(offers[Number(input.dataset.combo)].supplier_id);
  }

  function pickSupplier(input, id) {
    const i = Number(input.dataset.combo);
    // As fotos já salvas eram do fornecedor anterior (saem com ele ao salvar); as novas vão para o novo.
    if (Number(offers[i].supplier_id) !== id && offers[i].photos?.length) {
      offers[i].photos = [];
      offers[i].supplier_id = id;
      renderOffers();
      checkDuplicates();
      return;
    }
    offers[i].supplier_id = id;
    input.value = supplierLabel(id);
    closeCombo(input);
    checkDuplicates();
  }

  offersEl.addEventListener('focusin', (e) => {
    if (e.target.dataset.combo === undefined) return;
    e.target.select();
    openCombo(e.target);
    // No celular o teclado ocupa metade da tela: sobe o campo para a lista de opções caber.
    if (matchMedia('(max-width: 600px)').matches) {
      const input = e.target;
      setTimeout(() => input.scrollIntoView({ block: 'start', behavior: 'smooth' }), 250);
    }
  });
  offersEl.addEventListener('focusout', (e) => {
    if (e.target.dataset.combo !== undefined) closeCombo(e.target);
  });
  offersEl.addEventListener('mousedown', (e) => {
    const li = e.target.closest('.combo-list li[data-id]');
    if (!li) return;
    e.preventDefault(); // mantém o foco no campo até concluir a escolha
    if (li.classList.contains('disabled')) return;
    pickSupplier(li.closest('.combo').querySelector('.combo-input'), Number(li.dataset.id));
  });
  offersEl.addEventListener('keydown', (e) => {
    const input = e.target;
    if (input.dataset.combo === undefined) return;
    const list = input.nextElementSibling;
    const items = [...list.querySelectorAll('li[data-id]:not(.disabled)')];
    const cur = items.findIndex((li) => li.classList.contains('active'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (list.hidden) return openCombo(input);
      const next = items[(cur + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
      items.forEach((li) => li.classList.toggle('active', li === next));
      next?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (!list.hidden && items[cur]) pickSupplier(input, Number(items[cur].dataset.id));
    } else if (e.key === 'Escape') {
      closeCombo(input);
    }
  });

  offersEl.addEventListener('input', (e) => {
    if (e.target.dataset.combo !== undefined) { openCombo(e.target); return; }
    const k = e.target.dataset.k;
    if (!k) return;
    const i = Number(e.target.closest('.offer').dataset.i);
    offers[i][k] = e.target.value;
    offersEl.querySelector(`[data-calc="${i}"]`).innerHTML = offerCalc(offers[i]);
  });
  offersEl.addEventListener('click', (e) => {
    const img = e.target.closest('.offer-photo img');
    if (img) { openLightbox(img.dataset.full); return; }
    const delOld = e.target.closest('[data-del-old]')?.dataset.delOld;
    if (delOld) { const [i, pid] = delOld.split(':').map(Number); offers[i].delPhotos.push(pid); renderOffers(); return; }
    const delNew = e.target.closest('[data-del-new]')?.dataset.delNew;
    if (delNew) { const [i, j] = delNew.split(':').map(Number); offers[i].newPhotos.splice(j, 1); renderOffers(); return; }
    const rm = e.target.closest('[data-rm]')?.dataset.rm;
    if (rm === undefined) return;
    offers.splice(Number(rm), 1);
    renderOffers();
  });
  offersEl.addEventListener('change', async (e) => {
    const i = e.target.dataset.addNew;
    if (i === undefined) return;
    const files = [...e.target.files];
    const o = offers[Number(i)];
    const room = 12 - ((o.photos || []).length - o.delPhotos.length) - o.newPhotos.length;
    if (files.length > room) toast(`Cabem mais ${room} foto(s) para este fornecedor.`);
    for (const file of files.slice(0, Math.max(0, room))) {
      try { o.newPhotos.push(await resizeImage(file, 1024, 0.75)); } catch (err) { toast(err.message); }
    }
    renderOffers();
  });
  form.units_per_40hq.addEventListener('input', () => {
    document.getElementById('freight-hint').innerHTML = freightHint(parseNum(form.units_per_40hq.value, { thousands: true }), rate);
    offers.forEach((o, i) => { offersEl.querySelector(`[data-calc="${i}"]`).innerHTML = offerCalc(o); });
  });
  form.price_brl.addEventListener('input', () => {
    offers.forEach((o, i) => { offersEl.querySelector(`[data-calc="${i}"]`).innerHTML = offerCalc(o); });
  });
  document.getElementById('add-offer').addEventListener('click', () => {
    const last = offers[offers.length - 1];
    offers.push({ supplier_id: '', price: '', currency: last?.currency || 'CNY', moq: '', incoterm: last?.incoterm || 'FOB', nationalization_pct: last?.nationalization_pct ?? '', photos: [], newPhotos: [], delPhotos: [] });
    renderOffers();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const box = document.getElementById('err');
    box.hidden = true;
    const fail = (m) => { box.textContent = m; box.hidden = false; };

    if (!form.name.value.trim()) return fail('Informe o nome do produto.');
    const priceBrl = parseNum(form.price_brl.value, { thousands: true });
    if (Number.isNaN(priceBrl)) return fail('Preço no Brasil inválido.');
    const payloadOffers = [];
    for (const [i, o] of offers.entries()) {
      const blank = !o.supplier_id && !String(o.price).trim();
      if (blank && offers.length > 0) continue; // linha vazia é ignorada
      if (!o.supplier_id) return fail(`Selecione o fornecedor da linha ${i + 1}.`);
      const price = parseNum(o.price);
      if (price == null || Number.isNaN(price)) return fail(`Informe o preço da linha ${i + 1}.`);
      const moq = parseNum(o.moq, { thousands: true });
      const nat = parseNum(o.nationalization_pct);
      if (Number.isNaN(moq) || Number.isNaN(nat)) return fail(`Verifique MOQ e % da linha ${i + 1}.`);
      payloadOffers.push({ supplier_id: Number(o.supplier_id), price, currency: o.currency || 'CNY', moq, incoterm: o.incoterm || null, nationalization_pct: nat ?? 0 });
    }

    const units = parseNum(form.units_per_40hq.value, { thousands: true });
    if (units !== null && !(Number.isInteger(units) && units > 0)) return fail('Unidades por container 40HQ deve ser um número inteiro.');
    const body = { name: form.name.value, price_brl: priceBrl, units_per_40hq: units, notes: form.notes.value, offers: payloadOffers };
    if (photo !== undefined) body.photo = photo;
    if (photo) body.photo_thumb = await makeThumb(photo);
    if (isAdmin() && !editing) body.company = company;
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    // Fotos por fornecedor: enviadas uma a uma depois de salvar o produto.
    const syncPhotos = async (productId) => {
      const jobs = [];
      for (const o of offers) {
        const sid = Number(o.supplier_id);
        if (!payloadOffers.some((x) => x.supplier_id === sid)) continue;
        for (const pid of o.delPhotos) jobs.push(() => api(`/api/products/${productId}/photos/${pid}`, { method: 'DELETE' }));
        for (const d of o.newPhotos) jobs.push(async () => api(`/api/products/${productId}/photos`, { method: 'POST', body: { supplier_id: sid, photo: d, photo_thumb: await makeThumb(d) } }));
      }
      let failed = 0;
      for (const [n, job] of jobs.entries()) {
        btn.textContent = `Enviando fotos ${n + 1} de ${jobs.length}…`;
        try { await job(); } catch { failed++; }
      }
      return failed;
    };
    const newCount = offers.reduce((s, o) => s + o.newPhotos.length, 0);
    try {
      if (editing) {
        const saved = await api(`/api/products/${id}`, { method: 'PUT', body });
        const failed = await syncPhotos(saved.id);
        toast(failed ? `Produto salvo, mas ${failed} foto(s) não foram enviadas. Tente de novo pela tela do produto.` : 'Produto salvo.');
        location.hash = `#/products/${saved.id}`;
        return;
      }
      body.client_ref = formRef;
      const { saved } = await createOrQueue('product', body, body.name);
      if (saved) {
        const failed = await syncPhotos(saved.id);
        toast(failed ? `Produto salvo, mas ${failed} foto(s) não foram enviadas. Tente de novo pela tela do produto.` : 'Produto salvo.');
        location.hash = `#/products/${saved.id}`;
        return;
      }
      toast(newCount ? 'Sem internet: produto guardado no celular e enviado quando a conexão voltar. As fotos dos fornecedores precisam ser adicionadas depois, com internet.'
        : 'Sem internet: produto guardado no celular. Ele será enviado quando a conexão voltar.');
      location.hash = '#/products';
    } catch (err) {
      fail(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Salvar';
    }
  });

  if (editing) {
    document.getElementById('del').addEventListener('click', async () => {
      if (!confirm('Excluir este produto?')) return;
      try {
        await api(`/api/products/${id}`, { method: 'DELETE' });
        toast('Produto excluído.');
        location.hash = '#/products';
      } catch (err) { toast(err.message); }
    });
  }
}

// ===================== cadastro pela foto (vários produtos) =====================
// Foto de produto, etiqueta, catálogo ou tabela de preços → lista de produtos para conferir e salvar
// de uma vez. Várias fotos podem ser lidas em sequência (os itens vão sendo somados).

async function viewProductScan(query) {
  const fromSupplier = Number(query.get('supplier')) > 0 ? Number(query.get('supplier')) : null;
  setChrome({ title: 'Cadastrar pela foto', back: fromSupplier ? `#/suppliers/${fromSupplier}` : '#/products', tab: 'products', form: true });
  loading();
  const company = isAdmin() ? query.get('company') || defaultCompany() : ownCnpj();
  const [suppliers, existing] = await Promise.all([getSuppliers(isAdmin() ? company : null), existingProductNames(company)]);
  const handoff = scanHandoff?.company === company ? scanHandoff : null;
  scanHandoff = null;
  let supplierId = Number(query.get('supplier')) || handoff?.supplier || '';
  const items = [];
  const ocrOn = state.me?.features?.product_ocr;

  $app.innerHTML = `
    <form class="stack" id="f" novalidate>
      ${isAdmin() ? `<div class="card"><label for="company">Empresa</label><select id="company">${companyOptions(company)}</select></div>` : ''}
      <div class="card stack">
        <div><label for="supplier">Fornecedor</label>
          <select id="supplier"><option value="">— escolha o fornecedor —</option>${suppliers.map((s) =>
            `<option value="${s.id}"${s.id === Number(supplierId) ? ' selected' : ''}>${esc(s.name)}${s.booth ? ` — ${esc(s.booth)}` : ''}${s.pending ? ' (aguardando internet)' : ''}</option>`).join('')}</select>
          <div class="hint">Todos os produtos da lista ficam vinculados a este fornecedor, com o preço de cada um. Sem fornecedor, são salvos sem preço de oferta. <a href="#/suppliers/new">+ Novo fornecedor</a></div></div>
        <div class="row">
          <div><label for="nat">Nacionaliz. (%) para todos</label><input id="nat" inputmode="decimal" placeholder="ex.: 85"></div>
          <div><label for="incoterm-all">Incoterm para todos</label><select id="incoterm-all">${INCOTERMS.map((t) => `<option${t === 'FOB' ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
        </div>
      </div>
      <div class="card">
        <label>Foto</label>
        <div id="photo">${photoInputHtml(null, ocrOn ? 'Fotografe o produto, a etiqueta, o catálogo ou a tabela de preços' : 'Leitura de fotos indisponível (ANTHROPIC_API_KEY não configurada)')}</div>
        <div class="hint">Pode ler várias fotos seguidas: os produtos vão sendo somados à lista abaixo.</div>
        <div class="ocr-status" id="ocr-status" hidden></div>
      </div>
      <div id="items" class="stack"></div>
      <div class="error-box" id="err" hidden></div>
      <div class="actions form-actions"><button class="btn primary" type="submit" id="save" disabled>Salvar</button></div>
    </form>`;

  const form = document.getElementById('f');
  const itemsEl = document.getElementById('items');
  const box = document.getElementById('ocr-status');
  const saveBtn = document.getElementById('save');
  // Incoterm padrão: ao escolher, aplica a todos os produtos da lista (e aos das próximas fotos).
  // Depois dá para trocar o de um produto específico no próprio item.
  let incotermChosen = false;
  // Nacionalização "para todos": preenche na hora a de cada produto (que continua editável).
  document.getElementById('nat').addEventListener('input', (e) => {
    for (const it of items) it.nat = e.target.value;
    itemsEl.querySelectorAll('[data-k=nat]').forEach((el) => { el.value = e.target.value; });
  });
  document.getElementById('incoterm-all').addEventListener('change', (e) => {
    incotermChosen = true;
    for (const it of items) it.incoterm = e.target.value;
    if (items.length) { render(); toast(`Incoterm ${e.target.value} aplicado a todos os produtos.`); }
  });
  document.getElementById('company')?.addEventListener('change', (e) => {
    location.hash = `#/products/scan?company=${encodeURIComponent(e.target.value)}`;
  });
  document.getElementById('supplier').addEventListener('change', (e) => { supplierId = Number(e.target.value) || ''; });

  const numText = (v) => (v == null ? '' : String(v).replace('.', ','));
  function addItems(products, photo) {
    const defaultIncoterm = document.getElementById('incoterm-all').value;
    // Incoterm padrão escolhido pelo usuário vale para todos; senão usa o que a foto indicar.
    for (const r0 of products) {
      // Preço que veio só no texto ("¥16,80 (500 pcs)") vai para o campo de preço.
      const found = r0.price == null ? priceFromText(r0.price_note) : null;
      const r = found ? { ...r0, ...found } : r0;
      // Nas observações só ficam as faixas de preço (quando dizem mais do que o próprio preço).
      const noteNums = String(r.price_note || '').match(/\d+(?:[.,]\d+)?/g) || [];
      const tiers = r.price_note && !(noteNums.length === 1 && Number(noteNums[0].replace(',', '.')) === r.price);
      const match = similarProducts(r.name, existing.filter((x) => x.id)).find((x) => x.strong);
      items.push({
        ref: newRef(), include: true, name: r.name, price: numText(r.price), currency: r.currency || 'CNY', moq: r.moq ?? '',
        incoterm: incotermChosen ? defaultIncoterm : r.incoterm || defaultIncoterm, units_per_40hq: r.units_per_40hq ?? '',
        nat: document.getElementById('nat').value, own_photo: null,
        notes: [r.name_original && `Nome original: ${r.name_original}`, tiers && `Preços: ${r.price_note}`, r.specs].filter(Boolean).join('\n'),
        photo, use_photo: products.length === 1, target: match ? match.p.id : '',
      });
    }
    render();
  }

  function itemHtml(it, i) {
    const similar = similarProducts(it.name, existing.filter((x) => x.id));
    return `
      <div class="card scan-item${it.include ? '' : ' off'}" data-i="${i}">
        <div class="scan-head">
          <label class="scan-check"><input type="checkbox" data-k="include"${it.include ? ' checked' : ''}> Cadastrar</label>
          <img class="scan-src" src="${it.photo}" alt="Foto lida">
          <button type="button" class="icon-btn" data-rm="${i}" aria-label="Remover da lista">✕</button>
        </div>
        <div><label>Nome do produto</label><input data-k="name" value="${esc(it.name)}"></div>
        <div class="row">
          <div><label>Preço</label><input data-k="price" inputmode="decimal" value="${esc(it.price)}" placeholder="0,00"></div>
          <div><label>Moeda</label>${curSelect(it.currency)}</div>
        </div>
        <div class="row">
          <div><label>MOQ</label><input data-k="moq" inputmode="numeric" value="${esc(it.moq)}" placeholder="unid."></div>
          <div><label>Incoterm</label><select data-k="incoterm"><option value="">—</option>${INCOTERMS.map((t) => `<option${it.incoterm === t ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
        </div>
        <div class="row">
          <div><label>Unid. / 40HQ</label><input data-k="units_per_40hq" inputmode="numeric" value="${esc(it.units_per_40hq)}"></div>
          <div><label>Nacionaliz. (%)</label><input data-k="nat" inputmode="decimal" value="${esc(it.nat ?? '')}" placeholder="ex.: 85"></div>
        </div>
        <div><label>Observações</label><textarea data-k="notes" rows="2">${esc(it.notes)}</textarea></div>
        <div class="scan-photo">
          ${it.own_photo ? `<img src="${it.own_photo}" alt="Foto do produto" data-view-photo="${i}">
            <div class="scan-photo-actions"><span class="item-sub">Foto deste produto</span>
              <button type="button" class="btn small" data-rm-photo="${i}">${ic('trash')} Remover</button></div>`
            : `<label class="btn small">${ic('camera')} Foto do produto<input type="file" accept="image/*" data-item-photo="${i}" hidden></label>`}
        </div>
        ${similar.length ? `<div class="dup-box"><div class="dup-title">${ic('alert')} Parecido com produto já cadastrado</div>
          <select data-k="target"><option value="">Criar produto novo</option>${similar.map(({ p }) =>
            `<option value="${p.id}"${Number(it.target) === p.id ? ' selected' : ''}>Adicionar a oferta em: ${esc(p.name)}</option>`).join('')}</select></div>` : ''}
        ${it.target || it.own_photo ? '' : `<label class="scan-check"><input type="checkbox" data-k="use_photo"${it.use_photo ? ' checked' : ''}> Usar a foto da lista como foto do produto</label>`}
        <div class="item-error" hidden></div>
      </div>`;
  }
  function render() {
    itemsEl.innerHTML = items.map(itemHtml).join('');
    updateSave();
  }
  function updateSave() {
    const n = items.filter((x) => x.include).length;
    saveBtn.disabled = !n;
    saveBtn.textContent = n ? `Salvar ${n} produto(s)` : 'Salvar';
  }
  itemsEl.addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    const card = e.target.closest('.scan-item');
    const it = items[Number(card.dataset.i)];
    it[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (k === 'include') { card.classList.toggle('off', !it.include); updateSave(); }
  });
  itemsEl.addEventListener('change', async (e) => {
    const pi = e.target.dataset.itemPhoto;
    if (pi !== undefined && e.target.files[0]) {
      try {
        const it = items[Number(pi)];
        it.own_photo = await resizeImage(e.target.files[0]);
        it.use_photo = false;
        render();
      } catch (err) { toast(err.message); }
      return;
    }
    const k = e.target.dataset.k;
    if (k === 'target') { items[Number(e.target.closest('.scan-item').dataset.i)].target = e.target.value; render(); }
    if (k === 'name') render(); // atualiza o aviso de parecido
  });
  itemsEl.addEventListener('click', (e) => {
    const view = e.target.closest('[data-view-photo]')?.dataset.viewPhoto;
    if (view !== undefined) { openLightbox(items[Number(view)].own_photo); return; }
    const rmPhoto = e.target.closest('[data-rm-photo]')?.dataset.rmPhoto;
    if (rmPhoto !== undefined) { items[Number(rmPhoto)].own_photo = null; render(); return; }
    const rm = e.target.closest('[data-rm]')?.dataset.rm;
    if (rm === undefined) return;
    items.splice(Number(rm), 1);
    render();
  });

  let reading = 0;
  async function readPhoto(dataUrl) {
    if (!ocrOn) { toast('Leitura de fotos indisponível.'); return; }
    reading++;
    box.hidden = false;
    box.className = 'ocr-status busy';
    box.textContent = 'Lendo a foto…';
    try {
      const { products } = await api('/api/ocr/product', { method: 'POST', body: { image: dataUrl }, timeout: navigator.onLine ? 90_000 : 1 });
      if (!products.length) {
        box.className = 'ocr-status err';
        box.textContent = 'Não encontrei produtos nesta foto. Tente uma foto mais próxima e com boa luz.';
        return;
      }
      addItems(products, dataUrl);
      box.className = 'ocr-status ok';
      box.textContent = `✓ ${products.length} produto(s) lido(s). Confira e corrija antes de salvar.`;
    } catch (err) {
      box.className = 'ocr-status err';
      box.textContent = err instanceof OfflineError
        ? 'Sem internet: a leitura da foto precisa de conexão. Use “Novo produto” para cadastrar à mão — fica guardado e é enviado depois.'
        : err.message;
    } finally {
      reading--;
    }
  }
  bindPhotoInput(document.getElementById('photo'), readPhoto);
  if (handoff) {
    addItems(handoff.products, handoff.photo);
    box.hidden = false;
    box.className = 'ocr-status ok';
    box.textContent = `✓ ${handoff.products.length} produto(s) lido(s). Confira e corrija antes de salvar.`;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('err');
    err.hidden = true;
    if (reading) { toast('Aguarde terminar a leitura da foto.'); return; }
    const sid = Number(supplierId) || null;

    // Confere tudo antes de enviar o primeiro.
    const jobs = [];
    for (const [i, it] of items.entries()) {
      if (!it.include) continue;
      const fail = (m) => { err.textContent = `Produto ${i + 1} (${it.name || 'sem nome'}): ${m}`; err.hidden = false; itemsEl.children[i]?.scrollIntoView({ block: 'center' }); };
      if (!String(it.name).trim()) return fail('informe o nome.');
      const price = parseNum(it.price);
      const moq = parseNum(it.moq, { thousands: true });
      const units = parseNum(it.units_per_40hq, { thousands: true });
      const nat = parseNum(it.nat);
      if (Number.isNaN(price) || Number.isNaN(moq) || Number.isNaN(units) || Number.isNaN(nat)) return fail('verifique preço, MOQ, unidades e nacionalização.');
      if (units !== null && !(Number.isInteger(units) && units > 0)) return fail('unidades por 40HQ deve ser um número inteiro.');
      // Com fornecedor escolhido, todo produto precisa de preço: sem ele não há oferta e o produto ficaria sem vínculo.
      if (sid && price == null) return fail('informe o preço — sem preço o produto não fica vinculado ao fornecedor.');
      const offer = sid
        ? { supplier_id: sid, price, currency: it.currency || 'CNY', moq: moq != null ? Math.round(moq) : null, incoterm: it.incoterm || null, nationalization_pct: nat ?? 0 } : null;
      if (it.target && !offer) return fail('para adicionar a oferta a um produto existente, escolha o fornecedor e informe o preço.');
      jobs.push({ it, offer, units });
    }
    if (!jobs.length) return;

    saveBtn.disabled = true;
    let saved = 0;
    let queued = 0;
    try {
      for (const { it, offer, units } of jobs) {
        saveBtn.textContent = `Salvando ${saved + queued + 1} de ${jobs.length}…`;
        let r;
        if (it.target) {
          r = await addOfferOrQueue(Number(it.target), offer, it.name, { units });
          // Produto já existente: a foto tirada entra nas fotos deste fornecedor no produto.
          if (r.saved && it.own_photo && offer) {
            await api(`/api/products/${it.target}/photos`, { method: 'POST', body: { supplier_id: offer.supplier_id, photo: it.own_photo, photo_thumb: await makeThumb(it.own_photo) } })
              .catch(() => toast(`A foto de "${it.name}" não foi enviada; adicione pela tela do produto.`));
          }
        } else {
          const body = { name: it.name.trim(), price_brl: null, units_per_40hq: units, notes: it.notes, offers: offer ? [offer] : [], client_ref: it.ref };
          const photo = it.own_photo || (it.use_photo ? it.photo : null);
          if (photo) Object.assign(body, { photo, photo_thumb: await makeThumb(photo) });
          if (isAdmin()) body.company = company;
          r = await createOrQueue('product', body, body.name);
        }
        if (r.saved) saved++; else queued++;
        items.splice(items.indexOf(it), 1); // já salvo: não envia de novo se outro falhar
      }
    } catch (e2) {
      render();
      err.textContent = `${saved + queued} produto(s) salvo(s). Erro no próximo: ${e2.message}`;
      err.hidden = false;
      return;
    }
    toast(queued
      ? `${saved} produto(s) salvo(s) e ${queued} guardado(s) no celular — serão enviados quando a internet voltar.`
      : `${saved} produto(s) salvo(s).`);
    location.hash = fromSupplier ? `#/suppliers/${fromSupplier}` : '#/products';
  });
}

// ===================== cadastro por planilha Excel =====================
// Baixa o modelo (com a lista de fornecedores), envia a planilha preenchida, confere as linhas e salva.
// Fornecedor não encontrado fica em branco: o preço vai para as observações para vincular depois.

async function viewProductImport(query) {
  setChrome({ title: 'Importar planilha', back: '#/products', tab: 'products', form: true });
  loading();
  const company = isAdmin() ? query.get('company') || defaultCompany() : ownCnpj();
  const [suppliers, existing] = await Promise.all([getSuppliers(isAdmin() ? company : null), existingProductNames(company)]);
  const realSuppliers = suppliers.filter((x) => x.id > 0);
  let rows = [];

  $app.innerHTML = `
    <form class="stack" id="f" novalidate>
      ${isAdmin() ? `<div class="card"><label for="company">Empresa</label><select id="company">${companyOptions(company)}</select></div>` : ''}
      <div class="card stack">
        <div><b>1.</b> Baixe o modelo e preencha uma linha por produto. A coluna Fornecedor já vem com a lista dos fornecedores cadastrados.</div>
        <a class="btn" href="/api/products/import-template${isAdmin() ? `?company=${encodeURIComponent(company)}` : ''}" download>${ic('download')} Baixar modelo da planilha</a>
        <div><b>2.</b> Envie a planilha preenchida (.xlsx). Você confere tudo antes de salvar.</div>
        <label class="btn primary">${ic('upload')} Escolher planilha<input type="file" id="file" accept="${XLSX_ACCEPT}" hidden></label>
        <div class="ocr-status" id="status" hidden></div>
      </div>
      <div id="rows" class="stack"></div>
      <div class="error-box" id="err" hidden></div>
      <div class="actions form-actions"><button class="btn primary" type="submit" id="save" disabled>Salvar</button></div>
    </form>`;
  document.getElementById('company')?.addEventListener('change', (e) => { location.hash = `#/products/import?company=${encodeURIComponent(e.target.value)}`; });
  const rowsEl = document.getElementById('rows');
  const status = document.getElementById('status');
  const saveBtn = document.getElementById('save');

  const numText = (v) => (v == null ? '' : String(v).replace('.', ','));
  function rowHtml(r, i) {
    const similar = similarProducts(r.name, existing.filter((x) => x.id)).find((x) => x.strong);
    const missing = r.supplier_name && !r.supplier_id;
    return `
      <div class="card scan-item${r.include ? '' : ' off'}" data-i="${i}">
        <div class="scan-head">
          <label class="scan-check"><input type="checkbox" data-k="include"${r.include ? ' checked' : ''}> Cadastrar</label>
          <span class="item-sub" style="margin-left:auto">linha ${r.line}</span>
        </div>
        <div><label>Nome do produto</label><input data-k="name" value="${esc(r.name)}"></div>
        <div><label>Fornecedor</label><select data-k="supplier_id"><option value="">— sem fornecedor (vincular depois) —</option>${realSuppliers.map((x) =>
          `<option value="${x.id}"${x.id === Number(r.supplier_id) ? ' selected' : ''}>${esc(x.name)}${x.booth ? ` — ${esc(x.booth)}` : ''}</option>`).join('')}</select>
          ${missing ? `<div class="hint">“${esc(r.supplier_name)}” não foi encontrado: o produto entra sem fornecedor e o preço fica nas observações.</div>` : ''}</div>
        <div class="row">
          <div><label>Preço</label><input data-k="price" inputmode="decimal" value="${esc(r.price)}" placeholder="0,00"></div>
          <div><label>Moeda</label>${curSelect(r.currency)}</div>
        </div>
        <div class="row">
          <div><label>MOQ</label><input data-k="moq" inputmode="numeric" value="${esc(r.moq)}" placeholder="unid."></div>
          <div><label>Incoterm</label><select data-k="incoterm"><option value="">—</option>${INCOTERMS.map((t) => `<option${r.incoterm === t ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
        </div>
        <div class="row">
          <div><label>Nacionaliz. (%)</label><input data-k="nat" inputmode="decimal" value="${esc(r.nat)}" placeholder="ex.: 85"></div>
          <div><label>Preço no Brasil (R$)</label><input data-k="price_brl" inputmode="decimal" value="${esc(r.price_brl)}"></div>
        </div>
        <div class="row">
          <div><label>Unid. / 40HQ</label><input data-k="units_per_40hq" inputmode="numeric" value="${esc(r.units_per_40hq)}"></div>
          <div></div>
        </div>
        <div><label>Observações</label><textarea data-k="notes" rows="2">${esc(r.notes)}</textarea></div>
        ${similar ? `<div class="dup-box"><div class="dup-title">${ic('alert')} Parecido com produto já cadastrado: ${esc(similar.p.name)}</div>
          <div class="hint">Se for o mesmo, desmarque “Cadastrar” e adicione a oferta no produto existente.</div></div>` : ''}
      </div>`;
  }
  function render() {
    rowsEl.innerHTML = rows.map(rowHtml).join('');
    const n = rows.filter((r) => r.include).length;
    saveBtn.disabled = !n;
    saveBtn.textContent = n ? `Salvar ${n} produto(s)` : 'Salvar';
  }
  rowsEl.addEventListener('input', (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    const r = rows[Number(e.target.closest('.scan-item').dataset.i)];
    r[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (k === 'include' || k === 'supplier_id') render();
  });

  document.getElementById('file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > MAX_XLSX) { toast('Planilha muito grande (máximo 3 MB).'); return; }
    status.hidden = false;
    status.className = 'ocr-status busy';
    status.textContent = 'Lendo a planilha…';
    try {
      const r = await api('/api/products/import/parse', { method: 'POST', body: { file: await readFileAsDataUrl(file), ...(isAdmin() ? { company } : {}) }, timeout: 60_000 });
      if (r.error) { status.className = 'ocr-status err'; status.textContent = r.error; return; }
      rows = r.rows.map((x) => ({ ...x, include: true, price: numText(x.price), nat: numText(x.nat), price_brl: numText(x.price_brl),
        moq: x.moq ?? '', units_per_40hq: x.units_per_40hq ?? '', supplier_id: x.supplier_id ?? '' }));
      const linked = rows.filter((x) => x.supplier_id).length;
      status.className = 'ocr-status ok';
      status.textContent = `✓ ${rows.length} produto(s) lido(s), ${linked} com fornecedor encontrado. Confira e corrija antes de salvar.`;
      render();
    } catch (err) {
      status.className = 'ocr-status err';
      status.textContent = err.message;
    }
  });

  document.getElementById('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = document.getElementById('err');
    err.hidden = true;
    const jobs = [];
    for (const [i, r] of rows.entries()) {
      if (!r.include) continue;
      const fail = (m) => { err.textContent = `Linha ${r.line} (${r.name || 'sem nome'}): ${m}`; err.hidden = false; rowsEl.children[i]?.scrollIntoView({ block: 'center' }); };
      if (!String(r.name).trim()) return fail('informe o nome.');
      const price = parseNum(r.price);
      const moq = parseNum(r.moq, { thousands: true });
      const nat = parseNum(r.nat);
      const priceBrl = parseNum(r.price_brl, { thousands: true });
      const units = parseNum(r.units_per_40hq, { thousands: true });
      if ([price, moq, nat, priceBrl, units].some(Number.isNaN)) return fail('verifique os números (preço, MOQ, nacionalização, preço no Brasil, unidades).');
      if (units !== null && !(Number.isInteger(units) && units > 0)) return fail('unidades por 40HQ deve ser um número inteiro.');
      const sid = Number(r.supplier_id) || null;
      if (sid && price == null) return fail('informe o preço — sem preço o produto não fica vinculado ao fornecedor.');
      const notes = [String(r.notes || '').trim(),
        !sid && price != null ? `Preço da planilha: ${priceIn(price, r.currency)}${r.supplier_name ? ` · fornecedor: ${r.supplier_name}` : ''}` : ''].filter(Boolean).join('\n');
      const offer = sid ? { supplier_id: sid, price, currency: r.currency || 'CNY', moq: moq != null ? Math.round(moq) : null, incoterm: r.incoterm || null, nationalization_pct: nat ?? 0 } : null;
      const body = { name: r.name.trim(), price_brl: priceBrl, units_per_40hq: units, notes, offers: offer ? [offer] : [], client_ref: r.ref || (r.ref = newRef()) };
      if (isAdmin()) body.company = company;
      jobs.push({ r, body });
    }
    if (!jobs.length) return;
    saveBtn.disabled = true;
    let saved = 0;
    let queued = 0;
    try {
      for (const { r, body } of jobs) {
        saveBtn.textContent = `Salvando ${saved + queued + 1} de ${jobs.length}…`;
        const res = await createOrQueue('product', body, body.name);
        if (res.saved) saved++; else queued++;
        rows.splice(rows.indexOf(r), 1); // já salvo: não envia de novo se outro falhar
      }
    } catch (e2) {
      render();
      err.textContent = `${saved + queued} produto(s) salvo(s). Erro no próximo: ${e2.message}`;
      err.hidden = false;
      return;
    }
    toast(queued ? `${saved} produto(s) salvo(s) e ${queued} guardado(s) no celular — serão enviados quando a internet voltar.` : `${saved} produto(s) importado(s).`);
    location.hash = '#/products';
  });
}

// ===================== teste de modelos de leitura (administrador) =====================

async function viewModelTest() {
  if (!isAdmin()) { location.hash = '#/account'; return; }
  setChrome({ title: 'Teste de modelos', tab: 'account', back: '#/account' });
  loading();
  const { models, samples } = await api('/api/admin/ocr-bench');
  const label = (id) => models.find((m) => m.id === id)?.label || id;
  const money = (v) => (v == null ? '—' : `US$ ${v < 0.01 ? v.toFixed(4) : v.toFixed(3)}`);
  const secs = (ms) => (ms == null ? '—' : `${(ms / 1000).toFixed(1)} s`);
  $app.innerHTML = `
    <p class="hint" style="margin-top:0">Roda as mesmas fotos em cada modelo e confere com o gabarito. As fotos de teste são fictícias
      (cartões em inglês e chinês, etiqueta, tabela em US$ e tabela em yuan). Custo do teste completo: cerca de US$ 0,60.</p>
    <div class="card">
      <div class="item-sub">Modelos comparados</div>
      <div>${models.map((m) => `<b>${esc(m.label)}</b>${m.current ? ' <span class="badge good">em uso</span>' : ''} <small class="item-sub">${m.input == null ? 'lê com o primeiro e passa para o segundo só quando precisa' : `US$ ${m.input} / ${m.output} por milhão de tokens`}</small>`).join('<br>')}</div>
      <button class="btn primary block" id="run" style="margin-top:12px">▶ Rodar teste com as ${samples.length} fotos</button>
    </div>
    <div id="summary"></div>
    <div id="details" class="stack"></div>
    <h2>Testar com uma foto sua</h2>
    <div class="card stack">
      <div class="row"><label class="scan-check"><input type="radio" name="kind" value="card" checked> Cartão de visita</label>
        <label class="scan-check"><input type="radio" name="kind" value="product"> Produto / tabela</label></div>
      <div id="own-photo">${photoInputHtml(null, 'Tire a foto ou escolha da galeria')}</div>
      <div id="own-result"></div>
    </div>`;

  const totals = Object.fromEntries(models.map((m) => [m.id, { points: 0, total: 0, cost: 0, ms: 0, n: 0, errors: 0, escalated: 0 }]));
  function renderSummary(done) {
    document.getElementById('summary').innerHTML = `
      <h2>Resultado ${done < samples.length ? `(${done} de ${samples.length}…)` : ''}</h2>
      <div class="card"><table class="bench-table"><tr><th>Modelo</th><th>Acerto</th><th>Custo médio por foto</th><th>Tempo médio</th></tr>
      ${models.map((m) => {
        const t = totals[m.id];
        const pct = t.total ? Math.round((100 * t.points) / t.total) : null;
        return `<tr><td><b>${esc(m.label)}</b>${t.errors ? `<br><small class="item-sub">${t.errors} erro(s)</small>` : ''}${t.escalated ? `<br><small class="item-sub">usou a reserva em ${t.escalated} foto(s)</small>` : ''}</td>
          <td><b>${pct == null ? '—' : pct + '%'}</b><br><small class="item-sub">${t.points}/${t.total}</small></td>
          <td>${t.n ? money(t.cost / t.n) : '—'}</td><td>${t.n ? secs(t.ms / t.n) : '—'}</td></tr>`;
      }).join('')}</table></div>`;
  }

  document.getElementById('run').addEventListener('click', async (e) => {
    e.target.disabled = true;
    for (const t of Object.values(totals)) Object.assign(t, { points: 0, total: 0, cost: 0, ms: 0, n: 0, errors: 0, escalated: 0 });
    const details = document.getElementById('details');
    details.innerHTML = '';
    renderSummary(0);
    let done = 0;
    for (const s of samples) {
      e.target.textContent = `Lendo foto ${done + 1} de ${samples.length}…`;
      let r;
      try { r = await api(`/api/admin/ocr-bench/${s.id}`, { method: 'POST', body: {}, background: true }); } catch (err) { toast(err.message); break; }
      for (const x of r.results) {
        const t = totals[x.model];
        t.points += x.points || 0; t.total += x.total || 0;
        if (x.cost_usd != null) { t.cost += x.cost_usd; t.ms += x.ms || 0; t.n++; }
        if (x.error) t.errors++;
        if (x.escalated) t.escalated++;
      }
      done++;
      renderSummary(done);
      details.insertAdjacentHTML('beforeend', `
        <div class="card bench-sample">
          <div class="scan-head"><img class="scan-src" src="${s.image}" alt=""><b style="flex:1">${esc(s.label)}</b></div>
          ${r.results.map((x) => `<div class="bench-row"><span><b>${esc(label(x.model))}</b> · ${x.points}/${x.total}${x.escalated ? ` <small class="item-sub">(reserva: ${esc(x.escalated)})</small>` : ''}</span>
            <small class="item-sub">${money(x.cost_usd)} · ${secs(x.ms)}</small>
            ${x.error ? `<div class="error-box">${esc(x.error)}</div>` : x.misses?.length ? `<div class="item-sub">Errou: ${esc(x.misses.join(', '))}</div>` : '<div class="item-sub">✓ tudo certo</div>'}</div>`).join('')}
        </div>`);
    }
    e.target.disabled = false;
    e.target.textContent = `▶ Rodar de novo`;
  });

  bindPhotoInput(document.getElementById('own-photo'), async (dataUrl) => {
    const out = document.getElementById('own-result');
    const kind = $app.querySelector('input[name=kind]:checked').value;
    out.innerHTML = '<div class="ocr-status busy">Lendo com todos os modelos…</div>';
    try {
      const r = await api('/api/admin/ocr-compare', { method: 'POST', body: { kind, image: dataUrl }, background: true });
      const fields = kind === 'card'
        ? [['company_name', 'Empresa'], ['contact_name', 'Contato'], ['phone', 'Telefone'], ['phone_whatsapp', 'WhatsApp'], ['phone_wechat', 'WeChat'],
          ['booth', 'Stand'], ['address', 'Endereço'], ['province', 'Província'], ['email', 'E-mail'], ['wechat', 'WeChat ID']]
        : null;
      const show = (v) => (v === true ? 'sim' : v === false ? 'não' : v == null || v === '' ? '—' : String(v));
      out.innerHTML = r.results.map((x) => `
        <div class="card bench-sample"><div class="bench-row"><b>${esc(label(x.model))}</b>
          <small class="item-sub">${money(x.cost_usd)} · ${secs(x.ms)}</small></div>
          ${x.error ? `<div class="error-box">${esc(x.error)}</div>` : fields
            ? `<table class="bench-table">${fields.map(([k, l]) => `<tr><td>${l}</td><td>${esc(show(x.output[k]))}</td></tr>`).join('')}</table>`
            : `<table class="bench-table"><tr><th>Produto</th><th>Preço</th><th>MOQ</th></tr>${(x.output.products || []).map((p) =>
              `<tr><td>${esc(p.name)}${p.price_note ? `<br><small class="item-sub">${esc(p.price_note)}</small>` : ''}</td><td>${esc(p.price != null ? priceIn(p.price, p.currency) : show(p.price))}</td><td>${esc(show(p.moq))}</td></tr>`).join('')}</table>`}
        </div>`).join('');
    } catch (err) {
      out.innerHTML = `<div class="error-box">${esc(err.message)}</div>`;
    }
  });
}

// ===================== controle de viagem (despesas) =====================
// Extrato pessoal: cada usuário lança e vê só as próprias despesas.

const EXPENSE_CATS = [
  ['hospedagem', ic('bed'), 'Hospedagem'], ['alimentacao', ic('utensils'), 'Alimentação'], ['transporte', ic('car'), 'Transporte local'],
  ['passagens', ic('plane'), 'Passagens'], ['feira', ic('landmark'), 'Feira'], ['amostras', ic('package'), 'Amostras'],
  ['comunicacao', ic('phone'), 'Internet e telefone'], ['compras', ic('bag'), 'Compras'], ['outros', ic('receipt'), 'Outros'],
];
const PAYMENTS = [['cartao', 'Cartão', 'Cartão'], ['dinheiro', 'Dinheiro', 'Dinheiro'], ['alipay', 'Alipay', 'Alipay'], ['wechat', 'WeChat Pay', 'WeChat Pay'], ['outro', 'Outro', 'Outro']];
const CURRENCY_SYMBOL = { CNY: '¥', BRL: 'R$', USD: 'US$' };
// Custos estimados sobre os gastos em moeda estrangeira (yuan e dólar): IOF do cartão/câmbio
// e a taxa de conversão cobrada pela operadora/banco.
const IOF_RATE = 0.035;
const FX_FEE_RATE = 0.0065;
function expenseFees(list) {
  const foreign = list.filter((e) => e.currency !== 'BRL').reduce((s, e) => s + e.amount_brl, 0);
  const iof = Math.round(foreign * IOF_RATE * 100) / 100;
  const fx = Math.round(foreign * FX_FEE_RATE * 100) / 100;
  return { foreign, iof, fx };
}
const catInfo = (k) => EXPENSE_CATS.find((c) => c[0] === k) || EXPENSE_CATS[EXPENSE_CATS.length - 1];
const moneyIn = (n, cur) => (cur === 'BRL' ? brl(n) : `${CURRENCY_SYMBOL[cur]} ${Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const fmtDay = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
};
// Câmbio do dia guardado no celular, para lançar sem internet.
function savedRates() { try { return JSON.parse(localStorage.getItem('cfb.rates') || 'null'); } catch { return null; } }
async function expenseRates() {
  try {
    const r = await api('/api/fx/rates', { fresh: true, timeout: 8000, background: true });
    try { localStorage.setItem('cfb.rates', JSON.stringify(r)); } catch { /* sem armazenamento */ }
    return r;
  } catch {
    return savedRates() || { BRL: 1, USD: state.me?.company?.exchange_rate ?? null, CNY: null, cny_source: null };
  }
}

async function viewExpenses(query) {
  setChrome({ title: 'Controle de viagem', tab: 'account', back: '#/account', fab: true });
  loading();
  const [saved, queued] = await Promise.all([
    api('/api/expenses').catch((err) => { if (err instanceof OfflineError) return Object.assign([], { offline: true }); throw err; }),
    outboxAll().then((items) => items.filter((i) => i.kind === 'expense').map((i) => ({
      ...i.body, id: null, pending: true, error: i.error || null,
      amount_brl: Math.round(Number(i.body.amount) * (i.body.currency === 'BRL' ? 1 : Number(i.body.rate_brl)) * 100) / 100,
    }))),
  ]);
  const all = [...queued, ...saved];
  const filter = query.get('cat') || '';
  const list = filter ? all.filter((e) => e.category === filter) : all;
  const total = all.reduce((s, e) => s + e.amount_brl, 0);
  const fees = expenseFees(all);
  const byCat = EXPENSE_CATS.map(([k, icon, label]) => ({ k, icon, label, sum: all.filter((e) => e.category === k).reduce((s, e) => s + e.amount_brl, 0) }))
    .filter((c) => c.sum > 0).sort((a, b) => b.sum - a.sum);
  const days = [...new Set(list.map((e) => e.spent_on))].sort().reverse();

  $app.innerHTML = `
    ${saved.offline ? offlineNote('despesas') : ''}
    <div class="card exp-summary">
      <div class="item-sub">Total gasto na viagem</div>
      <div class="exp-total">${brl(total)}</div>
      <div class="item-sub">${all.length} lançamento(s)${all.some((e) => e.currency !== 'BRL') ? ' · valores em yuan e dólar convertidos pelo câmbio do lançamento' : ''}</div>
      <div class="exp-fees">
        <div><span>IOF estimado (${pct(IOF_RATE * 100)})</span><b>${brl(fees.iof)}</b></div>
        <div><span>Taxas de conversão estimadas (${pct(FX_FEE_RATE * 100)})</span><b>${brl(fees.fx)}</b></div>
        <div class="exp-fees-total"><span>Total com IOF e taxas</span><b>${brl(total + fees.iof + fees.fx)}</b></div>
        <div class="item-sub">Calculados sobre os gastos em yuan e dólar (${brl(fees.foreign)}). Gastos lançados em reais não pagam IOF.</div>
      </div>
      ${byCat.length ? `<div class="exp-cats">${byCat.map((c) => `
        <a class="exp-cat${filter === c.k ? ' active' : ''}" href="#/expenses${filter === c.k ? '' : `?cat=${c.k}`}">
          <span>${c.icon} ${esc(c.label)}</span><b>${brl(c.sum)}</b>
          <i style="width:${Math.max(3, Math.round((100 * c.sum) / byCat[0].sum))}%"></i>
        </a>`).join('')}</div>` : ''}
    </div>
    <div class="actions" style="margin:12px 0">
      <a class="btn primary" href="#/expenses/new">+ Lançar despesa</a>
      ${all.length ? `<button type="button" class="btn" id="export">${ic('download')} Exportar planilha</button>` : ''}
    </div>
    ${filter ? `<div class="hint" style="margin-bottom:8px">Mostrando só: <b>${esc(catInfo(filter)[2])}</b> · <a href="#/expenses">ver todas</a></div>` : ''}
    <div class="exp-list">${days.length ? days.map((d) => {
      const items = list.filter((e) => e.spent_on === d);
      return `
      <div class="exp-day"><span>${esc(fmtDay(d))}</span><b>${brl(items.reduce((s, e) => s + e.amount_brl, 0))}</b></div>
      ${items.map((e) => `
        <a class="item exp-item" href="${e.pending ? '#/outbox' : `#/expenses/${e.id}/edit`}">
          <div class="thumb">${catInfo(e.category)[1]}</div>
          <div class="item-body">
            <div class="item-title">${esc(e.description)}</div>
            <div class="item-sub">${esc(catInfo(e.category)[2])}${e.payment ? ' · ' + esc((PAYMENTS.find((p) => p[0] === e.payment) || [])[1] || '') : ''}</div>
            ${pendingTag(e)}
          </div>
          <div class="item-side"><div>${moneyIn(e.amount, e.currency)}</div>${e.currency !== 'BRL' ? `<div class="item-sub">${brl(e.amount_brl)}</div>` : ''}</div>
        </a>`).join('')}`;
    }).join('') : `<div class="empty">${all.length ? 'Nenhuma despesa nesta categoria.' : 'Nenhuma despesa lançada ainda.<br>Toque em “Lançar despesa” a cada gasto: hotel, táxi, refeições, amostras…'}</div>`}
    </div>
    <a class="fab" href="#/expenses/new" aria-label="Lançar despesa">+</a>`;

  document.getElementById('export')?.addEventListener('click', () => exportExpenses(all));
}

// Planilha (CSV) que abre no Excel em português: separador ";" e vírgula decimal.
function exportExpenses(list) {
  const num = (n) => Number(n).toFixed(2).replace('.', ',');
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Data', 'Descrição', 'Categoria', 'Pagamento', 'Moeda', 'Valor', 'Câmbio (R$)', 'Valor em R$']]
    .concat([...list].sort((a, b) => a.spent_on.localeCompare(b.spent_on)).map((e) => [
      e.spent_on.split('-').reverse().join('/'), e.description, catInfo(e.category)[2],
      (PAYMENTS.find((p) => p[0] === e.payment) || [])[2] || '', e.currency, num(e.amount),
      e.currency === 'BRL' ? '1' : String(e.rate_brl).replace('.', ','), num(e.amount_brl),
    ]));
  const total = list.reduce((s, e) => s + e.amount_brl, 0);
  const fees = expenseFees(list);
  rows.push(['', '', '', '', '', '', 'Total', num(total)]);
  rows.push(['', '', '', '', '', '', `IOF estimado (${pct(IOF_RATE * 100)})`, num(fees.iof)]);
  rows.push(['', '', '', '', '', '', `Taxas de conversão estimadas (${pct(FX_FEE_RATE * 100)})`, num(fees.fx)]);
  rows.push(['', '', '', '', '', '', 'Total com IOF e taxas', num(total + fees.iof + fees.fx)]);
  const csv = '\ufeff' + rows.map((r) => r.map(cell).join(';')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `controle-de-viagem-${isoToday()}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function viewExpenseForm(id) {
  const editing = id != null;
  setChrome({ title: editing ? 'Editar despesa' : 'Lançar despesa', back: '#/expenses', tab: 'account', form: true });
  loading();
  const [list, rates] = await Promise.all([editing ? api('/api/expenses') : null, expenseRates()]);
  const e = editing ? list.find((x) => x.id === Number(id)) : null;
  if (editing && !e) throw new Error('Despesa não encontrada.');
  let lastCur = 'CNY';
  try { lastCur = localStorage.getItem('cfb.expCur') || 'CNY'; } catch { /* sem armazenamento */ }
  const cur0 = e?.currency || lastCur;
  const rateFor = (c) => (c === 'BRL' ? 1 : rates[c]);
  const formRef = newRef();

  $app.innerHTML = `
    <form class="card stack" id="f" novalidate>
      <div><label for="description">Descrição <span class="req">*</span></label>
        <input id="description" name="description" value="${esc(e?.description)}" placeholder="ex.: Táxi hotel → feira" autocomplete="off" required></div>
      <div><label>Valor <span class="req">*</span></label>
        <div class="segmented" id="cur">${['CNY', 'BRL', 'USD'].map((c) => `<button type="button" data-cur="${c}" class="${c === cur0 ? 'active' : ''}">${CURRENCY_SYMBOL[c]} ${c === 'CNY' ? 'Yuan' : c === 'BRL' ? 'Real' : 'Dólar'}</button>`).join('')}</div>
        <input id="amount" name="amount" inputmode="decimal" value="${e ? String(e.amount).replace('.', ',') : ''}" placeholder="0,00" class="exp-amount"></div>
      <div id="rate-box"><label for="rate">Câmbio: R$ por <span id="rate-cur"></span></label>
        <input id="rate" name="rate" inputmode="decimal">
        <div class="hint" id="rate-hint"></div></div>
      <div class="exp-preview" id="preview"></div>
      <div><label>Categoria <span class="req">*</span></label>
        <div class="exp-cat-grid">${EXPENSE_CATS.map(([k, icon, label]) => `
          <label class="exp-cat-opt"><input type="radio" name="category" value="${k}"${e?.category === k ? ' checked' : ''}><span>${icon}<small>${esc(label)}</small></span></label>`).join('')}</div></div>
      <div class="row">
        <div><label for="spent_on">Data</label><input id="spent_on" name="spent_on" type="date" value="${esc(e?.spent_on || isoToday())}"></div>
        <div><label for="payment">Pagamento</label><select id="payment" name="payment"><option value="">—</option>${PAYMENTS.map(([k, l]) => `<option value="${k}"${e?.payment === k ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      </div>
      <div class="error-box" id="err" hidden></div>
      <div class="actions form-actions">
        ${editing ? '<button type="button" class="btn danger" id="del">Excluir</button>' : ''}
        <button class="btn primary" type="submit">Salvar</button>
      </div>
    </form>`;

  const form = document.getElementById('f');
  let currency = cur0;
  const rateInput = form.rate;
  function setCurrency(c, { keepRate = false } = {}) {
    currency = c;
    form.querySelectorAll('#cur button').forEach((b) => b.classList.toggle('active', b.dataset.cur === c));
    document.getElementById('rate-box').hidden = c === 'BRL';
    document.getElementById('rate-cur').textContent = c === 'CNY' ? 'yuan (¥ 1)' : 'dólar (US$ 1)';
    if (!keepRate) rateInput.value = rateFor(c) != null ? String(rateFor(c)).replace('.', ',') : '';
    document.getElementById('rate-hint').textContent = c === 'CNY'
      ? (rates.cny_source ? `Cotação do dia (${rates.cny_source}). Ajuste se o seu câmbio foi outro.` : 'Sem cotação agora: informe o câmbio.')
      : 'Câmbio da empresa usado nas estimativas. Ajuste se o seu foi outro.';
    preview();
  }
  function preview() {
    const amount = parseNum(form.amount.value, { thousands: true });
    const rate = currency === 'BRL' ? 1 : parseNum(rateInput.value);
    document.getElementById('preview').textContent = amount > 0 && rate > 0 && currency !== 'BRL' ? `≈ ${brl(Math.round(amount * rate * 100) / 100)}` : '';
  }
  if (e && e.currency !== 'BRL') { setCurrency(e.currency, { keepRate: true }); rateInput.value = String(e.rate_brl).replace('.', ','); preview(); } else setCurrency(cur0);
  form.querySelector('#cur').addEventListener('click', (ev) => { const c = ev.target.closest('[data-cur]')?.dataset.cur; if (c) setCurrency(c); });
  form.amount.addEventListener('input', preview);
  rateInput.addEventListener('input', preview);
  if (!editing) form.description.focus();

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const box = document.getElementById('err');
    const fail = (m) => { box.textContent = m; box.hidden = false; };
    box.hidden = true;
    const amount = parseNum(form.amount.value, { thousands: true });
    const rate = currency === 'BRL' ? 1 : parseNum(rateInput.value);
    if (!form.description.value.trim()) return fail('Informe a descrição.');
    if (!(amount > 0)) return fail('Informe o valor.');
    if (!(rate > 0)) return fail('Informe o câmbio para reais.');
    const category = form.querySelector('input[name=category]:checked')?.value;
    if (!category) return fail('Escolha a categoria.');
    const body = {
      description: form.description.value.trim(), amount, currency, rate_brl: rate, category,
      spent_on: form.spent_on.value || isoToday(), payment: form.payment.value || null,
    };
    try { localStorage.setItem('cfb.expCur', currency); } catch { /* sem armazenamento */ }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      if (editing) {
        await api(`/api/expenses/${id}`, { method: 'PUT', body });
        toast('Despesa salva.');
      } else {
        body.client_ref = formRef;
        const { saved } = await createOrQueue('expense', body, body.description);
        toast(saved ? 'Despesa lançada.' : 'Sem internet: despesa guardada no celular. Ela será enviada quando a conexão voltar.');
      }
      location.hash = '#/expenses';
    } catch (err) {
      fail(err.message);
    } finally {
      btn.disabled = false;
    }
  });
  document.getElementById('del')?.addEventListener('click', async () => {
    if (!confirm('Excluir esta despesa?')) return;
    try {
      await api(`/api/expenses/${id}`, { method: 'DELETE' });
      toast('Despesa excluída.');
      location.hash = '#/expenses';
    } catch (err) { toast(err.message); }
  });
}

// ===================== intérprete por voz e créditos =====================
// Toque para falar, toque de novo para parar: o áudio vai para o nosso servidor (que usa a Azure),
// volta o texto nos dois idiomas e a tradução falada. Cobrado em segundos de áudio, dos créditos da empresa.

const fmtDur = (s) => {
  const v = Math.max(0, Math.floor(s));
  const h = Math.floor(v / 3600);
  const m = Math.floor((v % 3600) / 60);
  return h ? `${h}h${String(m).padStart(2, '0')}min` : m ? `${m} min${v % 60 ? ` ${v % 60}s` : ''}` : `${v}s`;
};
const INTERP_PAIRS = { 'pt-zh': ['pt', 'zh'], 'pt-en': ['pt', 'en'] };
const INTERP_LANG = {
  pt: { flag: FLAG_BR, speak: 'Falar em português', name: 'Português' },
  zh: { flag: FLAG_CN, speak: '说中文 (falar em chinês)', name: '中文' },
  en: { flag: FLAG_US, speak: 'Speak English', name: 'English' },
};

// Grava o microfone e devolve WAV 16 kHz mono (formato aceito pela Azure em qualquer celular).
async function recordToWav(blob) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  const data = await blob.arrayBuffer();
  // Forma com callbacks: funciona também no Safari mais antigo.
  const decoded = await new Promise((resolve, reject) => ctx.decodeAudioData(data, resolve, reject));
  ctx.close?.();
  // Mistura os canais e reduz para 16 kHz fazendo a média de cada janela — sem OfflineAudioContext,
  // que no Safari recusa taxas abaixo de 22.050 Hz.
  const rate = 16000;
  const chans = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
  const ratio = decoded.sampleRate / rate;
  const pcm = new Float32Array(Math.max(1, Math.floor(decoded.length / ratio)));
  for (let i = 0; i < pcm.length; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.max(a + 1, Math.min(decoded.length, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = a; j < b; j++) for (const ch of chans) sum += ch[j];
    pcm[i] = sum / ((b - a) * chans.length);
  }
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, pcm[i])) * 0x7fff, true);
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.replace(/^data:[^;]*;/, 'data:audio/wav;'));
    r.readAsDataURL(new Blob([buf], { type: 'audio/wav' }));
  });
}

// Voz do intérprete pelo Web Audio (não depende da política de mídia da página nem de um
// <audio> com data: URL). Celulares só liberam o som que começa num toque: o contexto é criado e
// "destravado" no toque do botão e reaproveitado quando a tradução chega.
let interpCtx = null;
let interpSource = null;
// iPhone (iOS 17+): enquanto o microfone está aberto o som sai baixo, pelo fone do ouvido; depois
// de gravar volta para "playback" — alto-falante, tocando mesmo com a chave de silencioso ligada.
const setAudioSession = (type) => { try { if (navigator.audioSession) navigator.audioSession.type = type; } catch { /* sem suporte */ } };
function unlockInterpAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;
  if (!interpCtx) interpCtx = new Ctx();
  interpCtx.resume?.().catch(() => {});
  const src = interpCtx.createBufferSource();
  src.buffer = interpCtx.createBuffer(1, 1, 22050);
  src.connect(interpCtx.destination);
  src.start(0);
}
async function playInterp(dataUrl) {
  const bytes = Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0));
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!interpCtx && Ctx) interpCtx = new Ctx();
  if (interpCtx) {
    if (interpCtx.state !== 'running') await interpCtx.resume().catch(() => {});
    const buffer = await new Promise((resolve, reject) => interpCtx.decodeAudioData(bytes.buffer, resolve, reject));
    try { interpSource?.stop(); } catch { /* já terminou */ }
    interpSource = interpCtx.createBufferSource();
    interpSource.buffer = buffer;
    interpSource.connect(interpCtx.destination);
    interpSource.start(0);
    if (interpCtx.state === 'running') return;
  }
  // Reserva: player comum.
  await new Audio(URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }))).play();
}

async function viewInterpreter() {
  setChrome({ title: 'Intérprete', tab: 'trip' });
  loading();
  const credits = await api('/api/credits').catch(() => null);
  let balance = credits?.balance_seconds ?? 0;
  let pair = 'pt-zh';
  try { pair = localStorage.getItem('cfb.pair') || 'pt-zh'; } catch { /* sem armazenamento */ }
  if (!INTERP_PAIRS[pair]) pair = 'pt-zh';
  const log = [];
  let recording = null; // { lang, recorder, stream, chunks, timer, started }
  let busy = false;

  const enabled = state.me?.features?.interpreter;
  function render() {
    const [a, b] = INTERP_PAIRS[pair];
    $app.innerHTML = `
      ${subnavHtml('interpreter')}
      ${enabled ? '' : '<div class="ocr-status err">O intérprete ainda não foi configurado (chave da Azure na Vercel).</div>'}
      <div class="card interp-head">
        <div><div class="item-sub">Saldo da empresa</div><b class="interp-bal ${balance < 120 ? 'low' : ''}">${fmtDur(balance)}</b></div>
        <select id="pair" aria-label="Idiomas">${Object.keys(INTERP_PAIRS).map((k) => {
          const [x, y] = INTERP_PAIRS[k];
          return `<option value="${k}"${k === pair ? ' selected' : ''}>${INTERP_LANG[x].name} ⇄ ${INTERP_LANG[y].name}</option>`;
        }).join('')}</select>
        <a class="btn small primary" href="#/credits">Comprar minutos</a>
      </div>
      <div class="interp-buttons">
        ${[a, b].map((l) => `<button type="button" class="interp-btn${recording?.lang === l ? ' rec' : ''}" data-lang="${l}" ${busy || !enabled ? 'disabled' : ''}>
          <span class="interp-flag">${INTERP_LANG[l].flag}</span>
          <b>${recording?.lang === l ? '● Gravando… toque para traduzir' : INTERP_LANG[l].speak}</b>
          ${recording?.lang === l ? '<small id="rec-time">0s</small>' : '<small>toque, fale e toque de novo</small>'}
        </button>`).join('')}
      </div>
      ${busy ? '<div class="ocr-status busy">Traduzindo…</div>' : ''}
      <div class="interp-log">${log.length ? log.map((m, i) => `
        <div class="card interp-msg ${m.from}">
          <div class="item-sub">${INTERP_LANG[m.from].flag} ${esc(m.source)}</div>
          <div class="interp-tr">${INTERP_LANG[m.to].flag} ${esc(m.translated || '—')}</div>
          ${m.audio ? `<button type="button" class="btn small" data-play="${i}">${ic('speaker')} Ouvir de novo</button>` : ''}
        </div>`).join('') : `<div class="empty">Toque no seu idioma, fale uma frase e toque de novo. O app mostra e fala a tradução.<br>
          Para o fornecedor responder, ele toca no botão do idioma dele.<br><small>Cobrado só o tempo de fala (até 60 s por vez).</small></div>`}
      </div>`;
    document.getElementById('pair').addEventListener('change', (e) => {
      pair = e.target.value;
      try { localStorage.setItem('cfb.pair', pair); } catch { /* sem armazenamento */ }
      render();
    });
    $app.querySelectorAll('.interp-btn').forEach((btn) => btn.addEventListener('click', () => toggle(btn.dataset.lang)));
    $app.querySelectorAll('[data-play]').forEach((b2) => b2.addEventListener('click', () => {
      unlockInterpAudio();
      playInterp(log[Number(b2.dataset.play)].audio).catch(() => toast('Não consegui tocar o áudio. Confira o volume e o modo silencioso.'));
    }));
  }

  async function toggle(lang) {
    unlockInterpAudio();
    if (recording) { stop(); return; }
    if (balance <= 0) { toast('Sem créditos do intérprete. Compre minutos para continuar.'); return; }
    if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
      toast('Este navegador não grava áudio. No iPhone, atualize para o iOS 14.5 ou mais novo e use o Safari.');
      return;
    }
    let stream;
    setAudioSession('play-and-record');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      setAudioSession('playback');
      toast('Permita o uso do microfone para usar o intérprete.');
      return;
    }
    const recorder = new MediaRecorder(stream);
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => finish(lang, chunks, recorder.mimeType);
    recording = { lang, recorder, stream, started: Date.now() };
    recorder.start();
    recording.timer = setInterval(() => {
      const s = Math.floor((Date.now() - recording.started) / 1000);
      const el = document.getElementById('rec-time');
      if (el) el.textContent = `${s}s de 60s`;
      if (s >= 60) stop();
    }, 500);
    render();
  }
  function stop() {
    if (!recording) return;
    clearInterval(recording.timer);
    recording.recorder.stop();
    recording.stream.getTracks().forEach((t) => t.stop());
    setAudioSession('playback');
  }

  async function finish(lang, chunks, mime) {
    recording = null;
    busy = true;
    render();
    const [a, b] = INTERP_PAIRS[pair];
    const to = lang === a ? b : a;
    try {
      const audio = await recordToWav(new Blob(chunks, { type: mime }));
      const r = await api('/api/interpreter', { method: 'POST', body: { from: lang, to, audio }, background: true, timeout: 45_000 });
      balance = r.balance_seconds;
      if (!r.source) toast('Não entendi. Fale mais perto do celular e tente de novo.');
      else {
        log.unshift({ from: lang, to, source: r.source, translated: r.translated, audio: r.audio });
        if (r.audio) playInterp(r.audio).catch(() => toast('Toque em "Ouvir de novo" para escutar a tradução.'));
      }
    } catch (err) {
      toast(err.message);
    } finally {
      busy = false;
      if (location.hash.startsWith('#/interpreter')) render();
    }
  }
  render();
}

async function viewCredits() {
  setChrome({ title: 'Créditos do intérprete', tab: 'account', back: '#/account' });
  loading();
  const c = await api('/api/credits');
  const kinds = { purchase: 'Compra', grant: 'Cortesia', usage: 'Uso', refund: 'Estorno' };
  $app.innerHTML = `
    <div class="card exp-summary">
      <div class="item-sub">Saldo da empresa (toda a equipe usa o mesmo saldo)</div>
      <div class="exp-total">${fmtDur(c.balance_seconds)}</div>
      <a class="btn small" href="#/interpreter" style="justify-self:start">Abrir o intérprete</a>
    </div>
    <h2>Comprar minutos</h2>
    ${c.payments_enabled ? '' : '<div class="ocr-status err">Pagamento ainda não configurado (chave do Asaas na Vercel). Fale com a BR Trading para liberar créditos.</div>'}
    <div class="credit-packs">${c.packages.map((p) => `
      <div class="card credit-pack">
        <b>${fmtDur(p.minutes * 60)}</b>
        <div class="exp-total" style="font-size:1.4rem">${brl(p.price)}</div>
        <small class="item-sub">${brl(p.price / p.minutes)} por minuto de fala</small>
        <div class="actions">
          <button type="button" class="btn primary small" data-buy="${esc(p.id)}" data-method="pix" ${c.payments_enabled ? '' : 'disabled'}>Pix</button>
          <button type="button" class="btn small" data-buy="${esc(p.id)}" data-method="card" ${c.payments_enabled ? '' : 'disabled'}>Cartão</button>
        </div>
      </div>`).join('')}</div>
    <div id="checkout"></div>
    ${c.pending.length ? `<h2>Pagamentos aguardando</h2><div class="list">${c.pending.map((p) => `
      <button type="button" class="item" data-resume="${p.id}" style="text-align:left;width:100%">
        <div class="thumb">${ic('clock')}</div><div class="item-body"><div class="item-title">${fmtDur(p.minutes * 60)} · ${brl(p.value)}</div>
        <div class="item-sub">${p.method === 'pix' ? 'Pix' : 'Cartão'} · ${dateBr(p.created_at)} · toque para ver</div></div></button>`).join('')}</div>` : ''}
    <h2>Extrato</h2>
    <div class="list">${c.ledger.length ? c.ledger.map((l) => `
      <div class="item"><div class="thumb">${ic({ purchase: 'card', grant: 'gift', usage: 'mic', refund: 'undo' }[l.kind] || 'receipt')}</div>
        <div class="item-body"><div class="item-title">${esc(kinds[l.kind] || l.kind)}${l.note ? ` · <span class="item-sub">${esc(l.note)}</span>` : ''}</div>
          <div class="item-sub">${dateBr(l.created_at)}${l.user_name ? ` · ${esc(l.user_name)}` : ''}</div></div>
        <div class="item-side"><b class="${l.seconds < 0 ? '' : 'pos'}">${l.seconds < 0 ? '−' : '+'}${fmtDur(Math.abs(l.seconds))}</b></div></div>`).join('')
      : '<div class="empty">Nenhum movimento ainda.</div>'}</div>`;

  let poll = null;
  const hash = location.hash;
  function showPayment(p) {
    const box = document.getElementById('checkout');
    box.innerHTML = `<div class="card stack checkout">
      <h3 style="margin:0">${fmtDur(p.minutes * 60)} por ${brl(p.value)}</h3>
      ${p.paid ? '<div class="ocr-status ok">✓ Pagamento confirmado! Os minutos já estão no saldo.</div>' : p.method === 'pix' && p.pix ? `
        <img class="pix-qr" src="data:image/png;base64,${esc(p.pix.image)}" alt="QR Code Pix">
        <div class="hint">Abra o app do banco → Pix → ler QR Code, ou copie o código:</div>
        <div class="pix-code"><code>${esc(p.pix.payload)}</code><button type="button" class="btn small" id="copy-pix">Copiar</button></div>
        <div class="ocr-status busy">Aguardando o pagamento… a confirmação aparece aqui sozinha.</div>` : `
        <a class="btn primary" href="${esc(p.invoice_url)}" target="_blank" rel="noopener">Pagar com cartão (página segura do Asaas)</a>
        <div class="ocr-status busy">Depois de pagar, volte para esta tela: a confirmação aparece aqui sozinha.</div>`}
    </div>`;
    document.getElementById('copy-pix')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(p.pix.payload); toast('Código Pix copiado.'); } catch { toast('Não foi possível copiar.'); }
    });
    box.scrollIntoView({ block: 'start', behavior: 'smooth' });
    clearTimeout(poll);
    if (p.paid) { setTimeout(() => { if (location.hash === hash) viewCredits(); }, 2500); return; }
    const started = Date.now();
    const tick = async () => {
      if (location.hash !== hash || Date.now() - started > 30 * 60_000) return;
      try {
        const r = await api(`/api/credits/payments/${p.id}`, { background: true });
        if (r.paid) { toast('Pagamento confirmado!'); showPayment(r); return; }
      } catch { /* tenta de novo */ }
      poll = setTimeout(tick, 5000);
    };
    poll = setTimeout(tick, 5000);
  }
  $app.querySelectorAll('[data-buy]').forEach((b) => b.addEventListener('click', async () => {
    $app.querySelectorAll('[data-buy]').forEach((x) => { x.disabled = true; });
    try {
      showPayment(await api('/api/credits/checkout', { method: 'POST', body: { package_id: b.dataset.buy, method: b.dataset.method } }));
    } catch (err) { toast(err.message); } finally { $app.querySelectorAll('[data-buy]').forEach((x) => { x.disabled = !c.payments_enabled; }); }
  }));
  $app.querySelectorAll('[data-resume]').forEach((b) => b.addEventListener('click', async () => {
    try { showPayment(await api(`/api/credits/payments/${b.dataset.resume}`)); } catch (err) { toast(err.message); }
  }));
}

async function viewAdminCredits() {
  if (!isAdmin()) { location.hash = '#/account'; return; }
  setChrome({ title: 'Créditos do intérprete', tab: 'account', back: '#/account' });
  loading();
  const d = await api('/api/admin/credits');
  const ok = (v, yes, no) => `<span class="${v ? 'pos' : 'neg'}">${v ? '✓ ' + yes : '✕ ' + no}</span>`;
  $app.innerHTML = `
    <div class="card stack">
      <div>Intérprete (Azure): ${ok(d.interpreter_enabled, 'configurado', 'falta AZURE_SPEECH_KEY / AZURE_SPEECH_REGION')}</div>
      <div>Pagamentos (Asaas): ${ok(d.payments_enabled, d.sandbox ? 'configurado (SANDBOX — testes)' : 'configurado (produção)', 'falta ASAAS_API_KEY')}</div>
      <div>Webhook do Asaas: ${ok(d.webhook_configured, 'token configurado', 'falta ASAAS_WEBHOOK_TOKEN')}
        <div class="hint">No Asaas: Integrações → Webhooks → URL <code>${esc(location.origin)}/api/asaas/webhook</code>, eventos de cobrança, mesmo token.</div></div>
    </div>
    <h2>Empresas</h2>
    <div class="src-table-wrap card"><table class="bench-table"><tr><th>Empresa</th><th>Saldo</th><th>Usado</th><th>Pago</th></tr>
      ${d.companies.map((c) => `<tr><td>${esc(c.name || c.cnpj)}</td><td><b>${fmtDur(c.balance_seconds)}</b></td><td>${fmtDur(c.used_seconds)}</td><td>${brl(c.paid)}</td></tr>`).join('')}
    </table></div>
    <h2>Dar créditos (cortesia ou ajuste)</h2>
    <form class="card stack" id="grant" novalidate>
      <div><label for="g-company">Empresa</label><select id="g-company">${d.companies.map((c) => `<option value="${esc(c.cnpj)}">${esc(c.name || c.cnpj)}</option>`).join('')}</select></div>
      <div class="row"><div><label for="g-min">Minutos</label><input id="g-min" inputmode="numeric" placeholder="ex.: 30 (negativo para retirar)"></div>
        <div><label for="g-note">Observação</label><input id="g-note" placeholder="ex.: Teste grátis"></div></div>
      <button class="btn primary" type="submit">Lançar</button>
    </form>
    <h2>Pacotes à venda</h2>
    <form class="card stack" id="packs" novalidate>
      ${[0, 1, 2, 3].map((i) => {
        const p = d.packages[i] || {};
        return `<div class="row"><div><label>Minutos</label><input name="m${i}" inputmode="numeric" value="${p.minutes ?? ''}"></div>
          <div><label>Preço (R$)</label><input name="p${i}" inputmode="decimal" value="${p.price != null ? String(p.price).replace('.', ',') : ''}"></div></div>`;
      }).join('')}
      <div class="hint">Deixe em branco para não oferecer. Custo aproximado da Azure: R$ 13 por hora de fala — inclua as taxas do Asaas e os impostos.</div>
      <button class="btn primary" type="submit">Salvar pacotes</button>
    </form>
    <h2>Últimos pagamentos</h2>
    <div class="list">${d.payments.length ? d.payments.map((p) => `
      <div class="item"><div class="thumb">${ic(p.paid ? 'check' : 'clock')}</div><div class="item-body">
        <div class="item-title">${esc(p.company_name || p.cnpj)} · ${fmtDur(p.minutes * 60)} · ${brl(p.value)}</div>
        <div class="item-sub">${p.method === 'pix' ? 'Pix' : 'Cartão'} · ${esc(p.status)} · ${dateBr(p.created_at)}</div></div></div>`).join('')
      : '<div class="empty">Nenhum pagamento ainda.</div>'}</div>`;
  document.getElementById('grant').addEventListener('submit', async (e) => {
    e.preventDefault();
    const minutes = parseInt(document.getElementById('g-min').value, 10);
    if (!minutes) { toast('Informe os minutos.'); return; }
    try {
      await api('/api/admin/credits/grant', { method: 'POST', body: { cnpj: document.getElementById('g-company').value, minutes, note: document.getElementById('g-note').value } });
      toast('Créditos lançados.');
      viewAdminCredits();
    } catch (err) { toast(err.message); }
  });
  document.getElementById('packs').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const packages = [0, 1, 2, 3].map((i) => ({ minutes: parseNum(f[`m${i}`].value, { thousands: true }), price: parseNum(f[`p${i}`].value, { thousands: true }) }))
      .filter((p) => p.minutes || p.price);
    try {
      await api('/api/admin/credits/packages', { method: 'PUT', body: { packages } });
      toast('Pacotes salvos.');
      viewAdminCredits();
    } catch (err) { toast(err.message); }
  });
}

// ===================== fila de envio (sem internet) =====================

async function viewOutbox() {
  setChrome({ title: 'Aguardando envio', back: '#/products', tab: 'products' });
  const items = await outboxAll();
  $app.innerHTML = `
    <p class="hint" style="margin-top:0">Cadastros feitos sem internet ficam guardados neste celular e são enviados sozinhos quando a
      conexão volta. Não saia da conta antes de enviá-los.</p>
    <button class="btn primary block" id="send-now" ${items.length ? '' : 'disabled'}>Enviar agora</button>
    <div class="list" style="margin-top:14px">${items.length ? items.map((i) => `
      <div class="item">
        <div class="thumb">${ic(i.error ? 'alert' : 'clock')}</div>
        <div class="item-body">
          <div class="item-title">${esc(OUTBOX_KIND[i.kind])}: ${esc(i.label || i.body.name || '')}</div>
          <div class="item-sub">Feito em ${dateBr(i.created_at)}</div>
          ${i.error ? `<div class="error-box" style="margin-top:6px">${esc(i.error)}</div>` : ''}
        </div>
        <button type="button" class="btn small danger" data-discard="${esc(i.ref)}">Descartar</button>
      </div>`).join('') : '<div class="empty">Nada aguardando envio. ✓</div>'}
    </div>`;
  document.getElementById('send-now').addEventListener('click', async (e) => {
    if (!navigator.onLine) { toast('Ainda sem internet.'); return; }
    e.target.disabled = true;
    await flushOutbox();
    if (location.hash.startsWith('#/outbox')) viewOutbox();
  });
  $app.querySelectorAll('[data-discard]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Descartar este cadastro? Ele não será enviado.')) return;
    await outboxDelete(b.dataset.discard);
    refreshOutboxBar();
    viewOutbox();
  }));
}

// ===================== ranking =====================

let rankingMode = 'products';

async function viewRanking() {
  setChrome({ title: 'Mais vantajosos', tab: 'ranking' });
  loading();
  const r = await api('/api/ranking' + scopeQS());
  const render = () => {
    const body = rankingMode === 'products' ? renderRankProducts(r) : renderRankSuppliers(r);
    $app.innerHTML = `
      ${scopeBarHtml()}
      <div class="stats">
        <div class="stat"><b>${r.summary.products}</b><span>produtos</span></div>
        <div class="stat"><b>${r.summary.compared}</b><span>comparados</span></div>
        <div class="stat"><b style="color:var(--good)">${r.summary.advantageous}</b><span>vantajosos</span></div>
      </div>
      <div class="segmented" style="margin-top:14px">
        <button data-mode="products" class="${rankingMode === 'products' ? 'active' : ''}">Por produto</button>
        <button data-mode="suppliers" class="${rankingMode === 'suppliers' ? 'active' : ''}">Por fornecedor</button>
      </div>
      ${body}`;
    $app.querySelectorAll('.segmented button').forEach((b) => b.addEventListener('click', () => { rankingMode = b.dataset.mode; render(); }));
    bindScopeBar();
  };
  render();
}

function renderRankProducts(r) {
  if (!r.items.length) {
    return `<div class="empty">Cadastre fornecedores e produtos para ver o ranking.<br><a class="btn primary" href="#/products/new">Cadastrar produto</a></div>`;
  }
  return `<div class="list">${r.items.map((it, i) => `
    <a class="item rank-item" href="#/products/${it.product_id}">
      <div class="rank-top">
        <div class="rank-pos">${it.saving_pct !== null ? i + 1 : '–'}</div>
        ${thumbImg(it.photo)}
        <div class="item-body">
          <div class="item-title">${esc(it.name)}</div>
          <div class="item-sub">${it.best ? `${ic('star')} ${esc(it.best.supplier_name)}${it.best.supplier_booth ? ' · Stand ' + esc(it.best.supplier_booth) : ''}` : 'Sem fornecedor'}</div>
          <div style="margin-top:4px">${savingBadge(it.price_brl, it.best?.estimated_brl)}${it.options.length > 1 ? ` <span class="badge">${it.options.length} fornecedores</span>` : ''} ${companyTag(it.company_cnpj)}</div>
        </div>
      </div>
      <div class="compare">
        <div>${FLAG_CN} Estimado<b>${it.best ? brl(it.best.estimated_brl) : '—'}</b></div>
        <div>${FLAG_BR} Brasil<b>${brl(it.price_brl)}</b></div>
        <div>Economia<b style="color:${it.saving_brl > 0 ? 'var(--good)' : it.saving_brl < 0 ? 'var(--bad)' : 'inherit'}">${it.saving_brl == null ? '—' : brl(it.saving_brl)}</b></div>
      </div>
    </a>`).join('')}</div>
    <p class="hint">Ordenado pela maior economia percentual. ${FORMULA} ${isAdmin() && !r.company ? 'com o câmbio de cada empresa' : `(${ratesText(r)})`}.</p>`;
}

function renderRankSuppliers(r) {
  if (!r.suppliers.length) return '<div class="empty">Nenhum fornecedor com ofertas ainda.</div>';
  return `<div class="list">${r.suppliers.map((s, i) => `
    <a class="item" href="#/suppliers/${s.supplier_id}">
      <div class="rank-pos">${i + 1}</div>
      <div class="item-body">
        <div class="item-title">${esc(s.name)}</div>
        <div class="item-sub">${s.booth ? 'Stand ' + esc(s.booth) + ' · ' : ''}melhor opção em ${s.best_count} produto(s)</div>
        <div class="badges"><span class="badge good">${s.advantageous_count} vantajoso(s)</span>
          <span class="badge">economia ${brl(s.total_saving_brl)}</span> ${companyTag(s.company_cnpj)}</div>
      </div>
    </a>`).join('')}</div>
    <p class="hint">Fornecedores ordenados pelo número de produtos em que oferecem o melhor preço estimado abaixo do preço no Brasil.</p>`;
}

// ===================== roteiro de viagem =====================

// Campos do editor de roteiro (Local/endereço e Contato saíram do formulário a pedido;
// se vierem na planilha, continuam aparecendo no roteiro e são preservados ao salvar).
const TRIP_FIELDS = [
  ['time', 'Hora'], ['city', 'Cidade'], ['activity', 'Atividade'],
  ['transport', 'Transporte'], ['hotel', 'Hotel'], ['notes', 'Observações'],
];
const TRIP_ICONS = { location: ic('pin'), hotel: ic('bed'), contact: ic('user'), notes: ic('note') };
// Meios de transporte. A ordem importa: "Transfer para o aeroporto" é van, não avião.
// O texto é comparado sem acentos e em minúsculas ("Vôo", "AÉREA", "Ônibus" também valem).
const TRANSPORT_RULES = [
  [/transfer|tra[n]?slado|\bcarro\b|\bvan\b|\btaxi|\bdidi\b|\buber\b|motorista|\bcar\b|专车|接送|出租/, ic('van')],
  [/\bvoo|\bvoa|aviao|aere[oa]|aeroporto|\bflight|\bfly|airport|airline|航班|飞机/, ic('plane')],
  [/\btre[mn]|alta velocidade|high.?speed|\bcrh\b|\bg\d{1,4}\b|\bmetro\b|subway|高铁|动车|火车|地铁/, ic('train')],
  [/onibus|\bbus\b|\bcoach\b|巴士|大巴/, ic('bus')],
  [/\bbarco\b|balsa|ferry|\bboat\b|轮渡/, ic('ship')],
  [/a pe\b|caminhada|\bwalk/, ic('walk')],
];
// Ícone da atividade. Olha primeiro o texto da atividade ("Trem para Shenzhen" → trem), depois o
// campo Transporte, e só usa o tipo da legenda de cores quando nada indica — o tipo costuma ser
// genérico, ex.: "Deslocamento (voo, trem, transfer)".
const ICON_RULES = [
  ...TRANSPORT_RULES,
  [/deslocamento/, ic('van')],
  [/\bfeira\b|\bfair\b|\bexpo\b/, ic('landmark')],
  [/fabrica|factory|visita/, ic('factory')],
  [/\bhotel\b|check-?in/, ic('bed')],
  [/\blivre\b|descanso|\bfree\b/, ic('sun')],
];
const plain = (text) => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const matchIcon = (rules, text) => { const t = plain(text); return rules.find(([re]) => re.test(t))?.[1] || ''; };
const iconFor = (text) => matchIcon(ICON_RULES, text);
// Ícone da linha "Transporte": conforme o meio informado; carro quando não dá para saber.
// Número de voo no formato da companhia: "CZ3456", "MU 5102" (em maiúsculas, como no bilhete).
const FLIGHT_NO = /\b[A-Z][A-Z0-9]\s?\d{3,4}\b/;
const transportIcon = (text) => matchIcon(TRANSPORT_RULES, text) || (FLIGHT_NO.test(text) ? ic('plane') : ic('car'));
const tripIcon = (it) => iconFor(it.activity) || matchIcon(TRANSPORT_RULES, it.transport) || iconFor(it.category);
const WEEKDAYS = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.'];

const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function dayTitle(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${WEEKDAYS[new Date(y, m - 1, d).getDay()]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}
function dateRange(a, b) {
  if (!a) return '';
  const f = (iso) => iso.split('-').reverse().join('/');
  return a === b || !b ? f(a) : `${f(a).slice(0, 5)} a ${f(b)}`;
}

const subnavHtml = (active) => `<nav class="subnav subnav-page" aria-label="Roteiro">
  <a href="#/trip" class="${active === 'trip' ? 'active' : ''}">Roteiro</a><a href="#/map" class="${active === 'map' ? 'active' : ''}">Mapa</a><a href="#/interpreter" class="${active === 'interpreter' ? 'active' : ''}">Intérprete</a><a href="#/tourism" class="${active === 'tourism' ? 'active' : ''}">Turismo</a></nav>`;

// ===================== turismo =====================

const TOUR_CATS = {
  turismo: ['pin', 'Pontos turísticos'], cultura: ['landmark', 'Cultura e história'], compras: ['bag', 'Compras'],
  gastronomia: ['utensils', 'Gastronomia'], natureza: ['leaf', 'Parques e natureza'],
};
// Distância em linha reta (km).
function kmBetween(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
const fmtKm = (km) => (km < 1 ? `${Math.max(50, Math.round(km * 20) * 50)} m` : `${km.toLocaleString('pt-BR', { maximumFractionDigits: km < 10 ? 1 : 0 })} km`);
// Amap (高德): o mapa usado na China. Busca pelo nome em chinês, abre o app se estiver instalado.
const amapLink = (p, city) => `https://uri.amap.com/search?keyword=${encodeURIComponent(p.zh)}&city=${encodeURIComponent(city.zh)}&callnative=1&src=missaochina`;
const otherMapLink = (p) => (/iPhone|iPad|Macintosh/.test(navigator.userAgent)
  ? `https://maps.apple.com/?q=${encodeURIComponent(p.zh)}&ll=${p.lat},${p.lng}`
  : `geo:0,0?q=${p.lat},${p.lng}(${encodeURIComponent(p.zh)})`);

// Última localização conhecida (para não pedir o GPS de novo a cada visita à tela).
let tourPos = null;

async function viewTourism(query) {
  setChrome({ title: 'Turismo', tab: 'trip' });
  if (!window.TOURISM) {
    $app.innerHTML = `${subnavHtml('tourism')}<div class="empty">Atualizando o app… feche e abra de novo para ver o turismo.</div>`;
    return;
  }
  const { CITIES, PLACES, PHOTOS = {} } = window.TOURISM;
  let saved = null;
  try { saved = localStorage.getItem('cfb.tourCity'); } catch { /* sem armazenamento */ }
  let cityId = query.get('city') || null;
  let cat = '';
  let locating = false;
  let locError = '';

  const nearestCity = (pos) => CITIES.map((c) => ({ c, km: kmBetween(pos, c) })).sort((a, b) => a.km - b.km)[0];
  const currentCity = () => CITIES.find((c) => c.id === cityId) || CITIES.find((c) => c.id === saved) || CITIES[0];

  function render() {
    const city = currentCity();
    const near = tourPos && nearestCity(tourPos);
    const here = near && near.c.id === city.id && near.km < 80;
    let list = PLACES.filter((p) => p.city === city.id && (!cat || p.cat === cat))
      .map((p) => ({ ...p, km: here ? kmBetween(tourPos, p) : null }));
    if (here) list = list.sort((a, b) => a.km - b.km);
    const cats = Object.keys(TOUR_CATS).filter((k) => PLACES.some((p) => p.city === city.id && p.cat === k));
    $app.innerHTML = `
      ${subnavHtml('tourism')}
      <div class="card tour-head">
        <div class="tour-where">
          ${ic('locate')}
          <div>${locating ? 'Procurando sua localização…'
            : here ? `Você está em <b>${esc(city.name)}</b> · pontos ordenados pelo mais perto`
            : near && near.km < 80 ? `Você está em ${esc(near.c.name)} · mostrando ${esc(city.name)}`
            : near ? `Você está longe das cidades da lista (a ${fmtKm(near.km)} de ${esc(near.c.name)}).`
            : locError || 'Ative a localização para ver o que está mais perto de você.'}</div>
        </div>
        <div class="row">
          <select id="tour-city" aria-label="Cidade">${CITIES.map((c) => `<option value="${c.id}"${c.id === city.id ? ' selected' : ''}>${esc(c.name)} · ${c.zh}</option>`).join('')}</select>
          <button type="button" class="btn" id="tour-locate"${locating ? ' disabled' : ''}>${ic('locate')} Perto de mim</button>
        </div>
        <div class="tour-cats">
          <button type="button" class="tour-cat${cat ? '' : ' active'}" data-cat="">Todos</button>
          ${cats.map((k) => `<button type="button" class="tour-cat${cat === k ? ' active' : ''}" data-cat="${k}">${ic(TOUR_CATS[k][0])} ${TOUR_CATS[k][1]}</button>`).join('')}
        </div>
      </div>
      <div class="list">${list.map((p, i) => {
        const ph = PHOTOS[p.zh];
        return `
        <div class="card tour-item${ph ? ' has-photo' : ''}">
          ${ph ? `<figure class="tour-photo">
            <img src="/tourism/${ph[0]}.webp" alt="${esc(p.name)}" loading="lazy" decoding="async" width="480" height="270" data-photo="${ph[0]}">
            <figcaption><a href="https://commons.wikimedia.org/wiki/File:${encodeURIComponent(ph[3].replace(/ /g, '_'))}" target="_blank" rel="noopener">Foto: ${esc(ph[1] || 'Wikimedia Commons')} · ${esc(ph[2])}</a></figcaption>
          </figure>` : ''}
          <div class="tour-top">
            ${ph ? '' : `<div class="thumb">${ic(TOUR_CATS[p.cat][0])}</div>`}
            <div class="item-body">
              <div class="item-title">${esc(p.name)}</div>
              <div class="tour-zh">${esc(p.zh)}</div>
              <div class="item-sub">${ph ? ic(TOUR_CATS[p.cat][0]) + ' ' : ''}${TOUR_CATS[p.cat][1]}${p.km != null ? ` · <b>${fmtKm(p.km)}</b>` : ''}</div>
            </div>
          </div>
          <p class="tour-desc">${esc(p.desc)}</p>
          <div class="tour-actions">
            <a class="btn small primary" href="${esc(amapLink(p, city))}" target="_blank" rel="noopener">${ic('navigation')} Como chegar</a>
            <button type="button" class="btn small" data-taxi="${i}">${ic('car')} Mostrar ao taxista</button>
            <a class="btn small" href="${esc(otherMapLink(p))}">${ic('map')} Outro mapa</a>
          </div>
        </div>`;
      }).join('')}
      </div>
      <p class="hint">“Como chegar” abre o Amap (高德地图), o mapa que funciona na China. Sem o app instalado, abre a versão web.
        Google Maps não funciona na China sem VPN.</p>`;

    document.getElementById('tour-city').addEventListener('change', (e) => {
      cityId = e.target.value;
      try { localStorage.setItem('cfb.tourCity', cityId); } catch { /* sem armazenamento */ }
      cat = '';
      render();
    });
    document.getElementById('tour-locate').addEventListener('click', () => locate(true));
    $app.querySelectorAll('[data-cat]').forEach((b) => b.addEventListener('click', () => { cat = b.dataset.cat; render(); }));
    $app.querySelectorAll('[data-photo]').forEach((img) => img.addEventListener('click', () => openLightbox(img.src)));
    $app.querySelectorAll('[data-taxi]').forEach((b) => b.addEventListener('click', () => showTaxiCard(list[Number(b.dataset.taxi)], city)));
  }

  function locate(userAsked) {
    if (!navigator.geolocation) { locError = 'Este celular não informa a localização. Escolha a cidade.'; render(); return; }
    locating = true;
    render();
    navigator.geolocation.getCurrentPosition((pos) => {
      tourPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const near = nearestCity(tourPos);
      // Na cidade (ou perto dela): mostra essa cidade, a não ser que o usuário já tenha escolhido outra agora.
      if (near.km < 80 && (userAsked || !query.get('city'))) cityId = near.c.id;
      locating = false;
      if (location.hash.startsWith('#/tourism')) render();
    }, (err) => {
      locating = false;
      locError = err.code === 1
        ? 'Localização não permitida. Libere nas configurações do navegador ou escolha a cidade.'
        : 'Não consegui obter a localização agora. Escolha a cidade ou tente de novo ao ar livre.';
      if (location.hash.startsWith('#/tourism')) render();
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 5 * 60_000 });
  }

  render();
  // Já tinha permitido antes (ou já localizou nesta sessão): atualiza sem perguntar.
  const perm = await navigator.permissions?.query({ name: 'geolocation' }).catch(() => null);
  if (!location.hash.startsWith('#/tourism')) return;
  if (perm?.state === 'denied') {
    locError = 'Localização bloqueada para este app. Libere nas configurações do navegador ou escolha a cidade.';
    render();
  } else locate(false);
}

// Cartão grande em chinês para mostrar ao motorista de táxi/DiDi.
function showTaxiCard(p, city) {
  const box = document.createElement('div');
  box.className = 'taxi-card';
  box.setAttribute('role', 'dialog');
  box.innerHTML = `
    <div class="taxi-inner">
      <div class="taxi-ask">您好，请带我去这里</div>
      <div class="taxi-place">${esc(p.zh)}</div>
      <div class="taxi-city">${esc(city.zh)}</div>
      <div class="item-sub">${esc(p.name)} · ${esc(city.name)}</div>
      <div class="item-sub">“Olá, por favor me leve até aqui”</div>
      <button type="button" class="btn block">Fechar</button>
    </div>`;
  box.addEventListener('click', (e) => { if (e.target === box || e.target.closest('button')) box.remove(); });
  window.addEventListener('hashchange', () => box.remove(), { once: true });
  document.body.appendChild(box);
}

async function viewTrip(id) {
  setChrome({ title: 'Roteiro de viagem', tab: 'trip', back: id && isAdmin() ? '#/trip' : null });
  loading();
  if (id) return renderTrip(await api(`/api/itineraries/${id}`), { back: '#/trip' });
  const list = await api('/api/itineraries' + scopeQS());
  // Usuário com um único roteiro vê o roteiro direto.
  if (!isAdmin() && list.length === 1) return renderTrip(await api(`/api/itineraries/${list[0].id}`), { back: null });
  $app.innerHTML = `
    ${subnavHtml('trip')}
    ${scopeBarHtml()}
    ${isAdmin() ? `<a class="btn primary block" href="#/trip/new" style="margin-bottom:14px">${ic('upload')} Enviar roteiro (Excel)</a>` : ''}
    <div class="list">${list.length ? list.map((it) => `
      <a class="item" href="#/trip/${it.id}">
        <div class="thumb">${ic('plane')}</div>
        <div class="item-body">
          <div class="item-title">${esc(it.title)}</div>
          <div class="item-sub">${it.start_date ? esc(dateRange(it.start_date, it.end_date)) + ' · ' : ''}${it.day_count} dia(s) · ${it.item_count} atividade(s)</div>
          ${companyTag(it.company_cnpj)}
        </div>
      </a>`).join('') : `<div class="empty">${isAdmin()
        ? 'Nenhum roteiro enviado para esta seleção.<br>Use “Enviar roteiro” para subir a planilha Excel de uma empresa.'
        : 'Seu roteiro de viagem ainda não foi publicado.<br>Ele aparecerá aqui assim que a BR Trading enviar.'}</div>`}
    </div>`;
  bindScopeBar();
}

function tripItemHtml(it, dayCity) {
  const lines = ['location', 'transport', 'hotel', 'contact', 'notes'].filter((f) => it[f]).map((f) => `
    <div class="trip-line"><span aria-hidden="true">${f === 'transport' ? transportIcon(it[f]) : TRIP_ICONS[f]}</span><span>${esc(it[f])}</span>${f === 'location'
      ? `<button type="button" class="copy-btn" data-copy="${esc(it[f])}" title="Copiar endereço">Copiar</button>` : ''}</div>`).join('');
  const extras = (it.extra || []).map((e) => `<div class="trip-line"><span class="item-sub">${esc(e.label)}:</span><span>${esc(e.value)}</span></div>`).join('');
  const icon = tripIcon(it);
  return `
    <li class="trip-item${it.color ? ' tinted' : ''}"${it.color ? ` style="--cat:${esc(it.color)}"` : ''}>
      <div class="trip-time">${esc(it.time || '')}</div>
      <div class="trip-body">
        ${it.city && it.city !== dayCity ? `<span class="badge">${esc(it.city)}</span>` : ''}
        ${it.activity ? `<div class="trip-activity">${icon ? `<span aria-hidden="true">${icon}</span> ` : ''}${esc(it.activity)}</div>` : ''}
        ${lines}${extras}
      </div>
    </li>`;
}

function renderTrip(it, { back }) {
  setChrome({ title: it.title, tab: 'trip', back });
  const today = isoToday();
  const first = it.start_date;
  const dayNumber = (d, i) => (first && d.date
    ? Math.round((Date.parse(d.date) - Date.parse(first)) / 86400_000) + 1 : i + 1);
  $app.innerHTML = `
    ${subnavHtml('trip')}
    <div class="card trip-head">
      <div class="item-title">${esc(it.title)}</div>
      <div class="item-sub">${it.start_date ? esc(dateRange(it.start_date, it.end_date)) + ' · ' : ''}${it.day_count} dia(s)</div>
      ${isAdmin() ? `<div>${companyTag(it.company_cnpj)}</div>` : ''}
      ${isAdmin() ? `<div class="actions" style="margin-top:10px">
        <a class="btn small" href="/api/itineraries/${it.id}/file" download>${ic('download')} Planilha original</a>
        <a class="btn small" href="#/trip/${it.id}/edit">${ic('pen')} Editar</a>
      </div>` : ''}
    </div>
    <div class="trip-days">${it.days.map((d, i) => {
      const cities = [...new Set(d.items.map((x) => x.city).filter(Boolean))];
      const isToday = d.date === today;
      return `
      <section class="card trip-day ${isToday ? 'today' : ''} ${d.date && d.date < today ? 'past' : ''}" ${isToday ? 'id="trip-today"' : ''}>
        <header class="trip-day-head">
          <div class="trip-day-num">Dia ${dayNumber(d, i)}</div>
          <div class="trip-day-title">${esc(d.date ? dayTitle(d.date) : '')}${d.label ? ` <span>${esc(d.label)}</span>` : ''}</div>
          ${isToday ? '<span class="badge good">Hoje</span>' : ''}
        </header>
        ${cities.length || d.sheet ? `<div class="badges" style="margin:0 0 6px">${cities.map((c) => `<span class="badge city">${ic('pin')} ${esc(c)}</span>`).join('')}</div>` : ''}
        <ul class="trip-items">${d.items.map((x) => tripItemHtml(x, cities.length === 1 ? cities[0] : null)).join('')}</ul>
      </section>`;
    }).join('')}</div>
    <p class="hint">Atualizado ${dateBr(it.updated_at)}${it.updated_by_name ? ' por ' + esc(it.updated_by_name) : ''}.</p>`;
  bindCopyButtons();
  document.getElementById('trip-today')?.scrollIntoView({ block: 'start' });
}

// Lê o arquivo escolhido como data URL (para enviar ao servidor).
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    r.readAsDataURL(file);
  });
}
const XLSX_ACCEPT = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_XLSX = 3 * 1024 * 1024;

async function viewTripUpload() {
  if (!isAdmin()) { location.hash = '#/trip'; return; }
  setChrome({ title: 'Enviar roteiro', tab: 'trip', back: '#/trip', form: true });
  $app.innerHTML = `
    <form class="card stack" id="f" novalidate>
      <div><label for="company">Empresa (CNPJ) <span class="req">*</span></label><select id="company">${companyOptions(defaultCompany())}</select>
        <div class="hint">Todos os usuários deste CNPJ verão o roteiro.</div></div>
      <div><label for="title">Título</label><input id="title" placeholder="em branco = título da planilha">
        <div class="hint">Se ficar em branco, usa o título escrito no topo da planilha.</div></div>
      <div><label for="file">Planilha do roteiro (.xlsx) <span class="req">*</span></label>
        <input id="file" type="file" accept="${XLSX_ACCEPT}">
        <div class="hint">A primeira linha da tabela deve ter os títulos das colunas, por exemplo: Data, Hora, Cidade,
          Atividade, Local, Transporte, Hotel, Contato, Observações. Datas em branco continuam o dia de cima.</div></div>
      <div class="error-box" id="err" hidden></div>
      <div class="actions form-actions"><button class="btn primary" type="submit">Enviar roteiro</button></div>
    </form>`;
  const form = document.getElementById('f');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const box = document.getElementById('err');
    box.hidden = true;
    const file = form.querySelector('#file').files[0];
    const fail = (m) => { box.textContent = m; box.hidden = false; };
    if (!file) return fail('Escolha a planilha do roteiro.');
    if (file.size > MAX_XLSX) return fail('Planilha muito grande (máximo 3 MB).');
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Lendo planilha…';
    try {
      const saved = await api('/api/itineraries', { method: 'POST', body: {
        company: form.querySelector('#company').value, title: form.querySelector('#title').value,
        file_name: file.name, file: await readFileAsDataUrl(file),
      } });
      toast(`Roteiro enviado: ${saved.day_count} dia(s), ${saved.item_count} atividade(s).`);
      location.hash = `#/trip/${saved.id}`;
    } catch (err) {
      fail(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Enviar roteiro';
    }
  });
}

async function viewTripEdit(id) {
  if (!isAdmin()) { location.hash = `#/trip/${id}`; return; }
  setChrome({ title: 'Editar roteiro', tab: 'trip', back: `#/trip/${id}`, form: true });
  loading();
  const it = await api(`/api/itineraries/${id}`);
  const days = structuredClone(it.days);
  $app.innerHTML = `
    <form class="stack" id="f" novalidate>
      <div class="card stack">
        <div><label for="title">Título</label><input id="title" value="${esc(it.title)}"></div>
        <div class="item-sub">Empresa: ${esc(it.company_name || companyLabel(it.company_cnpj))}</div>
        <div><label for="file">Substituir pela nova planilha (.xlsx)</label><input id="file" type="file" accept="${XLSX_ACCEPT}">
          <div class="hint">Ao enviar uma nova planilha, o roteiro inteiro é substituído pelo conteúdo dela.</div></div>
      </div>
      <div id="days"></div>
      <button type="button" class="btn block" id="add-day">+ Adicionar dia</button>
      <div class="error-box" id="err" hidden></div>
      <div class="actions form-actions">
        <button type="button" class="btn danger" id="del">Excluir</button>
        <button class="btn primary" type="submit">Salvar</button>
      </div>
    </form>`;
  const daysEl = document.getElementById('days');

  const renderDays = () => {
    daysEl.innerHTML = days.map((d, di) => `
      <div class="card stack trip-edit-day" data-day="${di}">
        <div class="offer-head" style="margin:0"><h3>Dia ${di + 1}</h3>
          <button type="button" class="icon-btn" data-rm-day="${di}" aria-label="Remover dia">✕</button></div>
        <div class="row">
          <div><label>Data</label><input type="date" data-day-k="date" value="${esc(d.date || '')}"></div>
          <div><label>Descrição do dia</label><input data-day-k="label" value="${esc(d.label || '')}" placeholder="opcional"></div>
        </div>
        ${d.items.map((x, ii) => `
          <div class="offer" data-item="${ii}">
            <div class="offer-head"><b>Atividade ${ii + 1}</b>
              <button type="button" class="icon-btn" data-rm-item="${ii}" aria-label="Remover atividade">✕</button></div>
            <div class="row">
              ${TRIP_FIELDS.slice(0, 2).map(([k, l]) => `<div><label>${l}</label><input data-k="${k}" value="${esc(x[k] || '')}"></div>`).join('')}
            </div>
            ${TRIP_FIELDS.slice(2).map(([k, l]) => `<div style="margin-top:10px"><label>${l}</label>${k === 'activity' || k === 'notes'
              ? `<textarea data-k="${k}" rows="2">${esc(x[k] || '')}</textarea>` : `<input data-k="${k}" value="${esc(x[k] || '')}">`}</div>`).join('')}
            ${(x.extra || []).length ? `<div class="hint">Outras colunas: ${x.extra.map((e) => `${esc(e.label)}: ${esc(e.value)}`).join(' · ')}</div>` : ''}
          </div>`).join('')}
        <button type="button" class="btn small" data-add-item="${di}">+ Atividade</button>
      </div>`).join('');
  };
  renderDays();

  daysEl.addEventListener('input', (e) => {
    const dayEl = e.target.closest('[data-day]');
    if (!dayEl) return;
    const d = days[Number(dayEl.dataset.day)];
    if (e.target.dataset.dayK) { d[e.target.dataset.dayK] = e.target.value || null; return; }
    const itemEl = e.target.closest('[data-item]');
    if (itemEl && e.target.dataset.k) d.items[Number(itemEl.dataset.item)][e.target.dataset.k] = e.target.value;
  });
  daysEl.addEventListener('click', (e) => {
    const t = e.target;
    if (t.dataset.rmDay !== undefined) {
      if (!confirm('Remover este dia e todas as atividades dele?')) return;
      days.splice(Number(t.dataset.rmDay), 1); renderDays();
    } else if (t.dataset.rmItem !== undefined) {
      days[Number(t.closest('[data-day]').dataset.day)].items.splice(Number(t.dataset.rmItem), 1); renderDays();
    } else if (t.dataset.addItem !== undefined) {
      days[Number(t.dataset.addItem)].items.push({}); renderDays();
    }
  });
  document.getElementById('add-day').addEventListener('click', () => {
    const last = days[days.length - 1]?.date;
    const next = last ? new Date(Date.parse(last) + 86400_000).toISOString().slice(0, 10) : null;
    days.push({ date: next, label: '', items: [{}] });
    renderDays();
    daysEl.lastElementChild.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });

  const form = document.getElementById('f');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const box = document.getElementById('err');
    box.hidden = true;
    const file = form.querySelector('#file').files[0];
    if (file && file.size > MAX_XLSX) { box.textContent = 'Planilha muito grande (máximo 3 MB).'; box.hidden = false; return; }
    if (file && !confirm('Substituir o roteiro inteiro pelo conteúdo da nova planilha?')) return;
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const body = { title: form.querySelector('#title').value };
      if (file) Object.assign(body, { file: await readFileAsDataUrl(file), file_name: file.name });
      else body.days = days;
      await api(`/api/itineraries/${id}`, { method: 'PUT', body });
      toast('Roteiro salvo.');
      location.hash = `#/trip/${id}`;
    } catch (err) {
      box.textContent = err.message;
      box.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });
  document.getElementById('del').addEventListener('click', async () => {
    if (!confirm('Excluir este roteiro? Os usuários da empresa deixarão de vê-lo.')) return;
    try {
      await api(`/api/itineraries/${id}`, { method: 'DELETE' });
      toast('Roteiro excluído.');
      location.hash = '#/trip';
    } catch (err) { toast(err.message); }
  });
}

// ===================== mapa da feira =====================

const FAIR_MAP_URL = 'https://365.cantonfair.org.cn/en-US/exhibition-hall-map?phase=first';

function viewMap() {
  setChrome({ title: 'Mapa da feira', tab: 'trip', map: true });
  $app.innerHTML = '';
  const frame = document.getElementById('map-frame');
  document.getElementById('map-open').href = FAIR_MAP_URL;
  // Ocupa exatamente o espaço entre a barra do topo e a barra de abas.
  const fit = () => {
    const view = document.getElementById('map-view');
    view.style.top = `${document.getElementById('topbar').getBoundingClientRect().bottom}px`;
    view.style.bottom = `${window.innerHeight - document.getElementById('tabbar').getBoundingClientRect().top}px`;
  };
  fit();
  if (!viewMap.bound) { window.addEventListener('resize', () => { if (document.body.classList.contains('map-mode')) fit(); }); viewMap.bound = true; }
  if (!frame.querySelector('iframe')) {
    frame.innerHTML = `<div class="spinner" id="map-loading">Carregando o mapa da feira…</div>
      <iframe src="${FAIR_MAP_URL}" title="Mapa dos pavilhões da Feira de Cantão" referrerpolicy="no-referrer"
        allow="fullscreen" loading="eager"></iframe>`;
    frame.querySelector('iframe').addEventListener('load', () => document.getElementById('map-loading')?.remove());
  }
}

// ===================== meu cartão de visitas =====================

// Cartão de visitas do próprio usuário: mostrar em tela cheia ao fornecedor ou compartilhar.
function renderMyCard() {
  const box = document.getElementById('my-card');
  if (!box) return;
  const { user, company } = state.me;
  box.innerHTML = `
    <div class="item-sub" style="margin-bottom:6px">Meu cartão de visitas</div>
    ${user.card_photo ? `
      <button type="button" class="my-card-img" id="my-card-show" aria-label="Mostrar cartão em tela cheia">
        <img src="${esc(user.card_photo)}" alt="Meu cartão de visitas"></button>
      <div class="actions" style="margin-top:10px">
        <button type="button" class="btn" id="my-card-full">⤢ Mostrar</button>
        <button type="button" class="btn primary" id="my-card-share">${ic('share')} Compartilhar</button>
      </div>
      <details class="my-card-more"><summary>Trocar ou remover</summary>
        <div id="my-card-photo" style="margin-top:8px">${photoInputHtml(null, '')}</div>
        <button type="button" class="btn small danger" id="my-card-del" style="margin-top:8px">Remover cartão</button>
      </details>` : `
      <div id="my-card-photo">${photoInputHtml(null, 'Adicione a foto do seu cartão para mostrar ou enviar aos fornecedores')}</div>`}`;

  const root = document.getElementById('my-card-photo');
  if (!user.card_photo) root.querySelector('.photo-input').classList.add('compact');
  else root.querySelector('.photo-input').hidden = true;
  bindPhotoInput(root, async (dataUrl) => {
    try {
      state.me = await api('/api/me/card', { method: 'PUT', body: { image: dataUrl } });
      renderMyCard();
      toast('Cartão de visitas salvo.');
    } catch (err) { toast(err.message); }
  }, { maxSize: 1800, quality: 0.9 });

  const show = () => openLightbox(user.card_photo, { rotateToFit: true });
  document.getElementById('my-card-show')?.addEventListener('click', show);
  document.getElementById('my-card-full')?.addEventListener('click', show);
  document.getElementById('my-card-share')?.addEventListener('click', () => shareImage(user.card_photo, {
    fileName: `cartao-${user.name}.jpg`, title: 'Cartão de visitas', text: `${user.name}${company.name ? ' — ' + company.name : ''}`,
  }));
  document.getElementById('my-card-del')?.addEventListener('click', async () => {
    if (!confirm('Remover o seu cartão de visitas?')) return;
    try {
      state.me = await api('/api/me/card', { method: 'DELETE' });
      renderMyCard();
      toast('Cartão removido.');
    } catch (err) { toast(err.message); }
  });
}

// Compartilha uma imagem pelo menu do celular (WhatsApp, WeChat, e-mail...);
// onde isso não existe (ex.: computador), baixa o arquivo.
async function shareImage(url, { fileName, title, text }) {
  try {
    const blob = await fetch(url, { credentials: 'same-origin' }).then((r) => {
      if (!r.ok) throw new Error('Não foi possível carregar a imagem.');
      return r.blob();
    });
    const safeName = fileName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.-]+/g, '-');
    const file = new File([blob], safeName, { type: blob.type || 'image/jpeg' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title, text });
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = safeName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    toast('Imagem baixada. Envie pelo app de sua preferência.');
  } catch (err) {
    if (err.name !== 'AbortError') toast(err.message || 'Não foi possível compartilhar.');
  }
}

// ===================== frete 40HQ =====================

const freight40hq = () => state.me?.settings?.freight_40hq_usd ?? null;
const freightPerUnit = (units) => (freight40hq() != null && units > 0 ? freight40hq() / units : null);

function freightHint(units, rate) {
  const f = freightPerUnit(units);
  if (f == null) {
    return freight40hq() == null
      ? 'Quantidade que cabe num container 40HQ.'
      : `Frete 40HQ: ${usd(freight40hq())}. Informe as unidades para ver o frete por unidade.`;
  }
  return `Frete por unidade: <b>${usd(f)}</b> (${brl(f * rate)}) — frete 40HQ de ${usd(freight40hq())} ÷ ${units.toLocaleString('pt-BR')} un. Entra no preço estimado.`;
}

// Cartão do administrador na aba Conta: valor do frete internacional do container 40HQ.
function renderFreightCard() {
  const box = document.getElementById('freight-card');
  if (!box || !isAdmin()) return;
  const st = state.me.settings || {};
  box.innerHTML = `
    <h2>Frete internacional</h2>
    <form class="card stack" id="freight-form">
      <div><label for="freight">Valor do frete internacional 40HQ (USD)</label>
        <input id="freight" name="freight" inputmode="decimal" placeholder="ex.: 3500"
          value="${st.freight_40hq_usd != null ? String(st.freight_40hq_usd).replace('.', ',') : ''}"></div>
      <p class="hint" style="margin:0">Vale para todas as empresas. Usado para calcular o frete por unidade dos produtos
        (frete ÷ unidades por container 40HQ).${st.freight_updated_at ? ` Atualizado em ${dateBr(st.freight_updated_at)}${st.freight_updated_by ? ' por ' + esc(st.freight_updated_by) : ''}.` : ''}</p>
      <button class="btn primary" type="submit">Salvar frete</button>
    </form>`;
  box.querySelector('#freight-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = parseNum(e.target.freight.value, { thousands: true });
    if (Number.isNaN(v) || (v !== null && v < 0)) return toast('Valor do frete inválido.');
    try {
      state.me = await api('/api/admin/settings', { method: 'PUT', body: { freight_40hq_usd: v } });
      renderFreightCard();
      toast('Frete 40HQ salvo.');
    } catch (err) { toast(err.message); }
  });
}

// ===================== administração: usuários e empresas =====================

async function viewAdmin(query) {
  if (!isAdmin()) { location.hash = '#/account'; return; }
  const tab = query.get('tab') === 'companies' ? 'companies' : 'users';
  setChrome({ title: 'Usuários e empresas', tab: 'account', back: '#/account' });
  loading();
  const [users, companies] = await Promise.all([api('/api/admin/users'), api('/api/admin/companies')]);
  const companyName = (c) => c.name || c.cnpj_formatted;
  $app.innerHTML = `
    <nav class="subnav subnav-page">
      <a href="#/admin?tab=users" class="${tab === 'users' ? 'active' : ''}">Usuários (${users.length})</a>
      <a href="#/admin?tab=companies" class="${tab === 'companies' ? 'active' : ''}">Empresas (${companies.length})</a>
    </nav>
    <div class="toolbar"><input type="search" id="q" placeholder="${tab === 'users' ? 'Buscar nome, e-mail ou empresa' : 'Buscar empresa ou CNPJ'}"></div>
    <div class="list" id="list"></div>
    ${tab === 'companies' ? '<p class="hint">Uma empresa só pode ser excluída depois que todos os usuários dela forem excluídos ou mudados para outra empresa. Ao excluir, os fornecedores, produtos, roteiros e fotos dela são apagados.</p>' : ''}`;

  const norm = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const renderUsers = (term) => users.filter((u) => !term || norm(`${u.name} ${u.email} ${u.company_name} ${u.cnpj}`).includes(term))
    .map((u) => `
      <div class="item admin-row" data-user="${u.id}">
        <div class="item-body">
          <div class="item-title">${esc(u.name)} ${u.role === 'admin' ? '<span class="badge admin">ADMIN</span>' : ''} ${u.is_self ? '<span class="badge">você</span>' : ''}</div>
          <div class="item-sub">${esc(u.email)}</div>
          <label class="admin-company">Empresa
            <select data-move="${u.id}">${companies.map((c) => `<option value="${esc(c.cnpj)}" ${c.cnpj === u.cnpj ? 'selected' : ''}>${c.name ? `${esc(c.name)} — ` : ''}${esc(c.cnpj_formatted)}</option>`).join('')}</select>
          </label>
        </div>
        ${u.is_self ? '' : `<button type="button" class="icon-btn danger-icon" data-del-user="${u.id}" aria-label="Excluir usuário" title="Excluir usuário">${ic('trash')}</button>`}
      </div>`).join('') || '<div class="empty">Nenhum usuário encontrado.</div>';
  const renderCompanies = (term) => companies.filter((c) => !term || norm(`${c.name} ${c.cnpj} ${c.cnpj_formatted}`).includes(term))
    .map((c) => `
      <div class="item admin-row">
        <div class="item-body">
          <div class="item-title">${esc(c.name || 'Empresa sem razão social')}</div>
          <div class="item-sub">CNPJ ${esc(c.cnpj_formatted)}</div>
          <div class="badges"><span class="badge">${c.users} usuário(s)</span><span class="badge">${c.suppliers} fornecedor(es)</span>
            <span class="badge">${c.products} produto(s)</span><span class="badge">${c.itineraries} roteiro(s)</span></div>
          ${c.users ? '<div class="hint">Para excluir, primeiro exclua ou mude a empresa dos usuários.</div>' : ''}
        </div>
        <button type="button" class="icon-btn danger-icon" data-del-company="${esc(c.cnpj)}" ${c.users ? 'disabled' : ''}
          aria-label="Excluir empresa" title="${c.users ? 'Exclua os usuários primeiro' : 'Excluir empresa'}">${ic('trash')}</button>
      </div>`).join('') || '<div class="empty">Nenhuma empresa encontrada.</div>';

  const list = document.getElementById('list');
  const render = () => {
    const term = norm(document.getElementById('q').value.trim());
    list.innerHTML = tab === 'users' ? renderUsers(term) : renderCompanies(term);
  };
  render();
  document.getElementById('q').addEventListener('input', render);

  // Depois de alterar cadastros, atualiza a lista de empresas usada nos filtros do admin.
  const refresh = async (msg) => { toast(msg); state.me = await api('/api/me'); router(); };

  list.addEventListener('change', async (e) => {
    const id = e.target.dataset.move;
    if (!id) return;
    const u = users.find((x) => String(x.id) === id);
    const to = companies.find((c) => c.cnpj === e.target.value);
    if (!confirm(`Mudar ${u.name} para a empresa ${companyName(to)}?\n\nEle(a) passará a ver os fornecedores, produtos e roteiros dessa empresa.`)) {
      e.target.value = u.cnpj; return;
    }
    try {
      await api(`/api/admin/users/${id}`, { method: 'PUT', body: { cnpj: to.cnpj } });
      await refresh(`${u.name} agora está em ${companyName(to)}.`);
    } catch (err) { toast(err.message); e.target.value = u.cnpj; }
  });
  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.delUser) {
      const u = users.find((x) => String(x.id) === btn.dataset.delUser);
      if (!confirm(`Excluir o usuário ${u.name} (${u.email})?\n\nEle(a) perde o acesso ao app. Os cadastros feitos por ele(a) continuam na empresa.`)) return;
      try { await api(`/api/admin/users/${u.id}`, { method: 'DELETE' }); await refresh('Usuário excluído.'); } catch (err) { toast(err.message); }
    } else if (btn.dataset.delCompany) {
      const c = companies.find((x) => x.cnpj === btn.dataset.delCompany);
      const typed = prompt(`Excluir a empresa ${companyName(c)}?\n\nSerão apagados ${c.suppliers} fornecedor(es), ${c.products} produto(s) e ${c.itineraries} roteiro(s). Não dá para desfazer.\n\nPara confirmar, digite EXCLUIR:`);
      if (typed == null) return;
      if (typed.trim().toUpperCase() !== 'EXCLUIR') { toast('Exclusão cancelada.'); return; }
      try { await api(`/api/admin/companies/${encodeURIComponent(c.cnpj)}`, { method: 'DELETE' }); await refresh('Empresa excluída.'); } catch (err) { toast(err.message); }
    }
  });
}

// ===================== câmbio =====================

const fmtRate = (n) => (n == null ? '' : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 }));
const fxFailing = () => state.me?.company?.rate_mode === 'auto' && state.me?.fx && !state.me.fx.ok;

// Cartão de câmbio da aba Conta: cotação automática do dia ou valor manual.
function renderRateCard() {
  const box = document.getElementById('rate-card');
  if (!box) return;
  const { company, fx } = state.me;
  const auto = company.rate_mode === 'auto';
  const failing = fxFailing();
  const quoteInfo = !auto
    ? `Valor manual${company.rate_updated_at ? ` · definido em ${dateBr(company.rate_updated_at)}` : ''}`
    : company.rate_source
      ? `${esc(company.rate_source)}${company.rate_updated_at ? ` · cotação de ${dateBr(company.rate_updated_at)}` : ''}`
      : 'valor padrão (aguardando a primeira cotação)';
  box.innerHTML = `
    <div class="card stack">
      <div class="segmented" role="tablist" style="margin:0">
        <button type="button" data-mode="auto" class="${auto ? 'active' : ''}">Automático</button>
        <button type="button" data-mode="manual" class="${auto ? '' : 'active'}">Manual</button>
      </div>
      <div class="rate-now">
        <span class="item-sub">¥ 1,00 (RMB) =</span>
        <b>R$ ${fmtRate(ratesOf(company).CNY)}</b>
        <span class="item-sub">US$ 1,00 = R$ ${fmtRate(company.exchange_rate)} · ${quoteInfo}${company.cny_estimated ? ' · yuan estimado pelo dólar até a próxima cotação' : ''}</span>
      </div>
      ${failing ? `<div class="error-box">${ic('alert')} ${esc(fx.error)} Estamos usando o último valor disponível.
        Tente atualizar de novo ou informe o câmbio manualmente abaixo.</div>` : ''}
      ${auto ? `
        <p class="hint" style="margin:0">Atualizado sozinho a cada 30 minutos: dólar pela PTAX (taxa de venda) do Banco Central,
          com AwesomeAPI e ExchangeRate-API como reserva; yuan pela AwesomeAPI. Os preços dos fornecedores em RMB usam o câmbio do yuan;
          os em US$ e o frete usam o do dólar.</p>
        <button type="button" class="btn" id="fx-refresh">${ic('refresh')} Atualizar agora</button>` : ''}
      <form class="stack" id="rate-form" ${auto && !failing ? 'hidden' : ''}>
        <div class="row">
          <div><label for="rate_cny">R$ por ¥ 1,00</label>
            <input id="rate_cny" name="rate_cny" inputmode="decimal" value="${fmtRate(ratesOf(company).CNY)}"></div>
          <div><label for="rate">R$ por US$ 1,00</label>
            <input id="rate" name="rate" inputmode="decimal" value="${fmtRate(company.exchange_rate)}"></div>
        </div>
        <button class="btn primary" type="submit">Usar este valor</button>
        ${!auto && fx?.rate ? `<p class="hint" style="margin:0">Cotação do dia: ${fx.cny_rate ? `¥1 = R$ ${fmtRate(fx.cny_rate)} · ` : ''}US$1 = ${brl(fx.rate)} (${esc(fx.source)}).</p>` : ''}
      </form>
      <p class="hint" style="margin:0">O câmbio vale para todos os usuários deste CNPJ.</p>
    </div>`;

  const save = async (body, msg) => {
    try {
      state.me = await api('/api/settings', { method: 'PUT', body });
      setChrome({ title: 'Conta', tab: 'account' });
      renderRateCard();
      toast(msg);
    } catch (err) { toast(err.message); }
  };
  box.querySelectorAll('.segmented button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.mode === 'auto' && !auto) save({ mode: 'auto' }, 'Câmbio automático ativado.');
    if (b.dataset.mode === 'manual' && auto) {
      box.querySelector('#rate-form').hidden = false;
      box.querySelectorAll('.segmented button').forEach((x) => x.classList.toggle('active', x === b));
      box.querySelector('#rate_cny').focus();
    }
  }));
  box.querySelector('#fx-refresh')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Atualizando…';
    try {
      state.me = await api('/api/fx/refresh', { method: 'POST', body: {} });
      setChrome({ title: 'Conta', tab: 'account' });
      renderRateCard();
      toast(fxFailing() ? 'Não foi possível atualizar a cotação.' : `Cotação atualizada: ¥1 = R$ ${fmtRate(ratesOf(state.me.company).CNY)}`);
    } catch (err) {
      toast(err.message);
      e.target.disabled = false;
      e.target.innerHTML = `${ic('refresh')} Atualizar agora`;
    }
  });
  box.querySelector('#rate-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = parseNum(e.target.rate.value);
    const c = parseNum(e.target.rate_cny.value);
    if (!(v > 0) || !(c > 0)) return toast('Câmbio inválido.');
    save({ exchange_rate: v, cny_rate: c }, 'Câmbio manual salvo.');
  });
}

// ===================== conta =====================

async function viewAccount() {
  setChrome({ title: 'Conta', tab: 'account' });
  state.me = await api('/api/me');
  setChrome({ title: 'Conta', tab: 'account' });
  const { user, company } = state.me;
  $app.innerHTML = `
    <div class="card stack">
      <div id="my-card"></div>
      <div><div class="item-sub">Usuário</div><div class="item-title">${esc(user.name)} ${user.is_admin ? '<span class="badge admin">ADMINISTRADOR</span>' : ''}</div><div class="item-sub">${esc(user.email)}</div></div>
      ${user.is_admin ? `<p class="hint" style="margin:0">Você pode ver e editar fornecedores e produtos de todas as ${state.me.companies.length} empresas cadastradas. Use o filtro de empresa no topo das listas.</p>` : ''}
      <div><div class="item-sub">Empresa</div><div class="item-title">${esc(company.name || 'Empresa')}</div><div class="item-sub">CNPJ ${esc(company.cnpj_formatted)}</div></div>
    </div>
    <a class="item" href="#/credits" style="margin-top:14px"><div class="thumb">${ic('mic')}</div><div class="item-body">
      <div class="item-title">Créditos do intérprete</div>
      <div class="item-sub">Saldo de minutos de tradução por voz e compra por Pix ou cartão</div></div></a>
    <a class="item" href="#/expenses" style="margin-top:10px"><div class="thumb">${ic('receipt')}</div><div class="item-body">
      <div class="item-title">Controle de viagem</div>
      <div class="item-sub">Lance e categorize as despesas da viagem — seu extrato pessoal</div></div></a>
    <h2 id="cambio">Câmbio para estimativas</h2>
    <div id="rate-card"></div>
    <div id="freight-card"></div>
    ${user.is_admin ? `<h2>Administração</h2>
      <a class="item" href="#/admin"><div class="thumb">${ic('users')}</div><div class="item-body">
        <div class="item-title">Usuários e empresas</div>
        <div class="item-sub">Ver todos os cadastros, mudar a empresa de um usuário, excluir usuários e empresas</div></div></a>
      <a class="item" href="#/admin/credits"><div class="thumb">${ic('card')}</div><div class="item-body">
        <div class="item-title">Créditos do intérprete (empresas)</div>
        <div class="item-sub">Saldos e consumo de cada empresa, cortesias, pacotes e pagamentos do Asaas</div></div></a>
      <a class="item" href="#/admin/models"><div class="thumb">${ic('flask')}</div><div class="item-body">
        <div class="item-title">Teste de modelos de leitura</div>
        <div class="item-sub">Comparar acerto, custo e tempo da leitura de cartões e produtos entre os modelos de IA</div></div></a>` : ''}
    <h2>Equipe (${company.members.length})</h2>
    <div class="card"><ul class="members">${company.members.map((m) => `<li><b>${esc(m.name)}</b><span class="item-sub">${esc(m.email)}</span></li>`).join('')}</ul>
      <p class="hint">Novos colegas podem se cadastrar com o mesmo CNPJ para acessar os mesmos fornecedores e produtos.</p></div>
    <button class="btn block" id="app-update" style="margin-top:20px">${ic('refresh')} Atualizar o app</button>
    <button class="btn block" id="logout" style="margin-top:10px">Sair</button>
    <div class="signature"><img class="brand-logo" src="/brand/logo.png" alt="BR Trading"><span>Missão China by BR Trading</span><span id="app-version"></span></div>`;
  // Versão guardada no celular (cache do service worker) e atualização forçada.
  caches?.keys().then((keys) => {
    const v = keys.find((k) => k.startsWith('shell-'));
    if (v) document.getElementById('app-version').textContent = `Versão ${v.slice(6)}`;
  }).catch(() => {});
  document.getElementById('app-update').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    e.currentTarget.textContent = 'Atualizando…';
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      await reg?.update().catch(() => {});
      // Apaga só as telas guardadas (cadastros pendentes e dados salvos continuam).
      for (const k of await caches.keys()) if (k.startsWith('shell-')) await caches.delete(k);
    } catch { /* sem suporte: só recarrega */ }
    location.reload();
  });
  renderMyCard();
  renderRateCard();
  renderFreightCard();
  if (location.hash.includes('cambio')) document.getElementById('cambio').scrollIntoView();
  document.getElementById('logout').addEventListener('click', async () => {
    const pending = await outboxAll();
    if (pending.length && !confirm(`Há ${pending.length} cadastro(s) feitos sem internet que ainda não foram enviados. Se sair agora, eles serão perdidos. Sair mesmo assim?`)) return;
    for (const i of pending) await outboxDelete(i.ref).catch(() => {});
    await api('/api/logout', { method: 'POST', body: {} }).catch(() => {});
    navigator.serviceWorker?.controller?.postMessage('logout'); // apaga dados e fotos salvos offline
    state.me = null;
    state.suppliers = null;
    location.hash = '#/login';
  });
}

// ===================== roteador =====================

const routes = [
  [/^\/login$/, viewLogin, true],
  [/^\/register$/, viewRegister, true],
  [/^\/ranking$/, viewRanking],
  [/^\/suppliers$/, viewSuppliers],
  [/^\/suppliers\/new$/, () => viewSupplierForm(null)],
  [/^\/suppliers\/(\d+)$/, (m) => viewSupplier(m[1])],
  [/^\/suppliers\/(\d+)\/edit$/, (m) => viewSupplierForm(m[1])],
  [/^\/products$/, viewProducts],
  [/^\/products\/new$/, (m, q) => viewProductForm(null, q)],
  [/^\/products\/scan$/, (m, q) => viewProductScan(q)],
  [/^\/products\/import$/, (m, q) => viewProductImport(q)],
  [/^\/outbox$/, viewOutbox],
  [/^\/interpreter$/, viewInterpreter],
  [/^\/tourism$/, (m, q) => viewTourism(q)],
  [/^\/credits$/, viewCredits],
  [/^\/admin\/credits$/, viewAdminCredits],
  [/^\/expenses$/, (m, q) => viewExpenses(q)],
  [/^\/expenses\/new$/, () => viewExpenseForm(null)],
  [/^\/expenses\/(\d+)\/edit$/, (m) => viewExpenseForm(m[1])],
  [/^\/products\/(\d+)$/, (m) => viewProduct(m[1])],
  [/^\/products\/(\d+)\/edit$/, (m, q) => viewProductForm(m[1], q)],
  [/^\/map$/, viewMap],
  [/^\/trip$/, () => viewTrip()],
  [/^\/trip\/new$/, () => viewTripUpload()],
  [/^\/trip\/(\d+)$/, (m) => viewTrip(m[1])],
  [/^\/trip\/(\d+)\/edit$/, (m) => viewTripEdit(m[1])],
  [/^\/account$/, viewAccount],
  [/^\/admin$/, (m, q) => viewAdmin(q)],
  [/^\/admin\/models$/, viewModelTest],
];

async function router() {
  const nav = ++navSeq;
  closeLightbox({ fromHistory: true }); // trocou de tela: a foto em tela cheia não pode ficar por cima
  const raw = location.hash.slice(1) || '/ranking';
  const [path, qs] = raw.split('?');
  const query = new URLSearchParams(qs || '');
  if (!state.me) {
    try { state.me = await fetch('/api/me').then((r) => (r.ok ? r.json() : null)); } catch { state.me = null; }
  }
  const match = routes.find(([re]) => re.test(path));
  if (!match) { location.hash = '#/ranking'; return; }
  const [re, view, isPublic] = match;
  if (!isPublic && !state.me) { location.hash = '#/login'; return; }
  if (isPublic && state.me) { location.hash = '#/ranking'; return; }
  window.scrollTo(0, 0);
  refreshOutboxBar();
  if (state.me && navigator.onLine && !router.flushed) { router.flushed = true; flushOutbox(); }
  try {
    await view(path.match(re), query);
  } catch (err) {
    if (err instanceof StaleNavigation || nav !== navSeq) return; // o usuário já foi para outra tela
    if (state.me) $app.innerHTML = `<div class="empty">${esc(err.message)}<br><a class="btn" href="#/ranking">Voltar</a></div>`;
  }
}

window.addEventListener('hashchange', router);
router();

// Service worker: abre o app na hora e mantém os últimos dados disponíveis sem internet.
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // Versão nova do app publicada: recarrega uma vez para usá-la (sem esperar o usuário reabrir).
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !reloaded) { reloaded = true; location.reload(); }
  });
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').then((reg) => {
    // App instalado costuma ficar aberto por dias: procura versão nova sempre que volta à tela.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {}));
}
