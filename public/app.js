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
const parseNum = (v) => {
  if (v == null || String(v).trim() === '') return null;
  let t = String(v).trim().replace(/\s/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.'); // formato brasileiro 1.234,56
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};
// Estimado no Brasil (R$) = (US$ + frete por unidade) × (1 + % nacionalização) × câmbio.
// Arredonda para centavos igual ao servidor, para o valor do formulário bater com o salvo.
const estimate = (priceUsd, nat, rate, freight = 0) => Math.round((priceUsd + (freight || 0)) * (1 + (nat || 0) / 100) * rate * 100) / 100;
// Incoterms em que o preço já inclui o frete internacional (não soma o frete de novo).
const FREIGHT_INCLUDED = ['CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'];
const offerFreight = (incoterm, perUnit) => (FREIGHT_INCLUDED.includes(String(incoterm || '').toUpperCase()) ? 0 : perUnit || 0);
// Bandeiras (SVG, para aparecerem iguais em qualquer aparelho — emoji de bandeira vira "CN"/"BR" no Windows).
const FLAG_CN = '<svg class="flag" viewBox="0 0 30 20" role="img" aria-label="China"><rect width="30" height="20" fill="#EE1C25"/><polygon fill="#FFDE00" points="5.00,2.00 5.67,4.07 7.85,4.07 6.09,5.35 6.76,7.43 5.00,6.15 3.24,7.43 3.91,5.35 2.15,4.07 4.33,4.07"/><polygon fill="#FFDE00" points="9.14,2.51 9.62,1.97 9.25,1.34 9.91,1.63 10.39,1.08 10.33,1.80 11.00,2.09 10.29,2.25 10.22,2.97 9.85,2.35"/><polygon fill="#FFDE00" points="11.01,4.14 11.66,3.82 11.56,3.10 12.07,3.62 12.72,3.30 12.38,3.95 12.88,4.47 12.17,4.34 11.83,4.99 11.73,4.27"/><polygon fill="#FFDE00" points="11.04,6.73 11.76,6.70 11.96,6.00 12.21,6.68 12.94,6.66 12.37,7.10 12.62,7.79 12.01,7.38 11.44,7.83 11.64,7.13"/><polygon fill="#FFDE00" points="9.22,8.38 9.90,8.63 10.35,8.06 10.32,8.79 11.00,9.05 10.30,9.24 10.26,9.96 9.87,9.36 9.16,9.55 9.62,8.98"/></svg>';
const FLAG_BR = '<svg class="flag" viewBox="0 0 30 20" role="img" aria-label="Brasil"><rect width="30" height="20" fill="#009C3B"/><polygon fill="#FFDF00" points="15,2.2 27.6,10 15,17.8 2.4,10"/><circle cx="15" cy="10" r="4.3" fill="#002776"/><path d="M10.9 8.9a4.3 4.3 0 0 1 8.1 2.2" stroke="#fff" stroke-width=".8" fill="none"/></svg>';
const FORMULA = 'Estimado = (US$ + frete por unidade) × (1 + % nacionalização) × câmbio';
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
// Falha de rede (sem sinal): o cadastro pode ir para a fila do celular.
class OfflineError extends Error {}
// Navegação atual: se o usuário trocar de tela enquanto uma consulta (GET) está a caminho,
// a resposta atrasada é descartada em vez de sobrescrever a tela nova.
let navSeq = 0;
class StaleNavigation extends Error {}

async function api(path, { method = 'GET', body, background = false } = {}) {
  const nav = navSeq;
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new OfflineError('Sem conexão com a internet. Tente de novo quando o sinal voltar.');
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
    return items.filter((i) => i.user_id === state.me.user.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  } catch { return []; }
}
const outboxPut = (item) => outboxTx('readwrite', (st) => st.put(item));
const outboxDelete = (ref) => outboxTx('readwrite', (st) => st.delete(ref));

const OUTBOX_PATHS = { supplier: '/api/suppliers', product: '/api/products' };
const OUTBOX_KIND = { supplier: 'Fornecedor', product: 'Produto', offer: 'Oferta' };

// Cria no servidor; sem internet, guarda na fila e devolve { queued }.
async function createOrQueue(kind, body, label) {
  // Produto de um fornecedor que ainda está na fila: vai para a fila logo atrás dele.
  if (kind === 'product' && body.offers?.some((o) => o.supplier_id < 0)) {
    const queued = await queueItem({ kind, body, label }, new Error('Não foi possível guardar o cadastro neste celular.'));
    if (navigator.onLine) flushOutbox();
    return { queued };
  }
  try {
    return { saved: await api(OUTBOX_PATHS[kind], { method: 'POST', body }) };
  } catch (err) {
    if (!(err instanceof OfflineError)) throw err;
    return { queued: await queueItem({ kind, body, label }, err) };
  }
}
// Acrescenta a oferta de um fornecedor a um produto que já existe (substitui a oferta anterior dele).
async function addOfferToProduct(productId, offer, { units, background = false } = {}) {
  const p = await api(`/api/products/${productId}`, { background: true });
  const offers = p.offers.filter((o) => o.supplier_id !== offer.supplier_id).map((o) => ({
    supplier_id: o.supplier_id, price_usd: o.price_usd, moq: o.moq, incoterm: o.incoterm, nationalization_pct: o.nationalization_pct,
  }));
  offers.push(offer);
  return api(`/api/products/${productId}`, {
    method: 'PUT', background,
    body: { name: p.name, price_brl: p.price_brl, units_per_40hq: p.units_per_40hq ?? units ?? null, notes: p.notes, offers },
  });
}
async function addOfferOrQueue(productId, offer, label, opts = {}) {
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
      // Relê o item: o envio de um fornecedor pode ter atualizado os produtos que dependem dele.
      const item = await outboxTx('readonly', (st) => st.get(ref)).catch(() => null);
      if (!item) continue;
      try {
        if (item.kind === 'offer') {
          await addOfferToProduct(item.body.product_id, item.body.offer, { units: item.body.units, background: true });
        } else {
          if (item.kind === 'product' && item.body.offers?.some((o) => o.supplier_id < 0)) {
            throw new Error('O fornecedor deste produto ainda não foi enviado.');
          }
          const saved = await api(OUTBOX_PATHS[item.kind], { method: 'POST', body: item.body, background: true });
          // Produtos na fila que usam este fornecedor passam a apontar para o id real.
          if (item.kind === 'supplier') {
            for (const other of await outboxAll()) {
              if (other.kind !== 'product' || !other.body.offers?.some((o) => o.supplier_id === item.temp_id)) continue;
              other.body.offers = other.body.offers.map((o) => (o.supplier_id === item.temp_id ? { ...o, supplier_id: saved.id } : o));
              delete other.error;
              await outboxPut(other);
            }
          }
        }
        await outboxDelete(item.ref);
        sent++;
      } catch (err) {
        if (err instanceof OfflineError || !state.me) break; // sem sinal ou sessão expirada: tenta depois
        await outboxPut({ ...item, error: err.message });
      }
    }
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
    ? `⚠ ${errors} cadastro(s) com problema · ${items.length} na fila <b>Ver</b>`
    : `⏳ ${items.length} cadastro(s) aguardando internet para enviar <b>Ver</b>`;
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
const thumbImg = (url, fallback = '📦') => (url
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
        : `<div style="padding:24px">📷<br>${esc(placeholder)}</div>`}</div>
    </div>
    <div class="photo-buttons">
      <label class="btn photo-camera">📷 Câmera<input type="file" accept="image/*" capture="environment"></label>
      <label class="btn photo-gallery">🖼 Galeria<input type="file" accept="image/*"></label>
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
    ? `${fxFailing() ? '⚠ ' : ''}<span class="rate-long">US$1 = </span>${brl(state.me.company.exchange_rate)}${state.me.company.rate_mode === 'manual' ? ' <small>manual</small>' : ''}`
    : '';
  chip.classList.toggle('warn', fxFailing());
  chip.title = fxFailing() ? 'Cotação automática indisponível — toque para ajustar' : 'Câmbio usado nas estimativas — toque para ajustar';
  chip.onclick = () => { location.hash = '#/account?cambio'; };
  chip.hidden = !state.me;
}

const loading = () => { $app.innerHTML = '<div class="spinner">Carregando…</div>'; };

// Inclui os fornecedores cadastrados sem internet (ainda na fila), com id provisório negativo.
async function getSuppliers(company) {
  const [list, pending] = await Promise.all([
    api('/api/suppliers' + (company ? `?company=${encodeURIComponent(company)}` : scopeQS())),
    pendingSuppliers(company || (isAdmin() ? getScope() : null)),
  ]);
  return [...pending, ...list];
}
const pendingTag = (x) => (x.pending ? `<span class="badge ${x.error ? 'bad' : 'pending'}">${x.error ? '⚠ erro no envio' : '⏳ aguardando internet'}</span>` : '');

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
  return isAdmin() && cnpj ? `<span class="badge company" title="Empresa">🏢 ${esc(companyLabel(cnpj))}</span>` : '';
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
          ${thumbImg(s.card_photo, '📇')}
          <div class="item-body">
            <div class="item-title">${esc(s.name)}</div>
            ${pendingTag(s)}
            <div class="item-sub">${s.contact_name ? esc(s.contact_name) + ' · ' : ''}${s.phone_whatsapp || s.phone_wechat ? `<span class="msg-icons">${[s.phone_whatsapp && 'whatsapp', s.phone_wechat && 'wechat'].filter(Boolean).map((k) => `<span class="msg-badge ${k}" title="${k === 'wechat' ? 'WeChat' : 'WhatsApp'}">${MSG_ICONS[k]}</span>`).join('')}</span> · ` : ''}${s.booth ? 'Stand ' + esc(s.booth) : 'Sem stand'}${s.pending ? '' : ` · ${s.product_count} produto(s)`}</div>
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
      : `<a class="btn block" href="#/suppliers/${s.id}/edit">📇 Adicionar foto do cartão</a>`}
    <div class="card stack" style="margin-top:14px">
      <div><div class="item-sub">Nome</div><div class="item-title">${esc(s.name)}</div></div>
      ${s.contact_name ? `<div><div class="item-sub">Contato</div><div>${esc(s.contact_name)}</div></div>` : ''}
      ${s.phone ? `<div><div class="item-sub">Telefone</div><div class="phone-line">
        <a href="tel:${esc(s.phone.replace(/[^0-9+]/g, ''))}">${esc(s.phone)}</a>${msgBadges({ phone_wechat: s.phone_wechat })}
        ${s.phone.replace(/\D/g, '').length >= 8 ? `<a class="btn small${s.phone_whatsapp ? ' wa-btn' : ''}" target="_blank" rel="noopener" href="https://wa.me/${esc(s.phone.replace(/\D/g, ''))}">${s.phone_whatsapp ? MSG_ICONS.whatsapp : ''}WhatsApp</a>` : ''}
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
      ${state.me?.features?.product_ocr ? `<a class="btn block" href="#/products/scan?supplier=${s.id}&company=${encodeURIComponent(s.company_cnpj)}">📷 Produtos pela foto (catálogo, tabela de preços)</a>` : ''}
      <div class="meta">Atualizado ${dateBr(s.updated_at)}${s.updated_by_name ? ' por ' + esc(s.updated_by_name) : ''}</div>
    </div>
    <h2>Produtos deste fornecedor (${s.products.length})</h2>
    <div class="list">${s.products.length ? s.products.map((p) => `
      <a class="item" href="#/products/${p.id}">
        ${thumbImg(p.photo)}
        <div class="item-body">
          <div class="item-title">${esc(p.name)}</div>
          <div class="item-sub">${usd(p.price_usd)}${p.moq ? ' · MOQ ' + p.moq : ''}${p.incoterm ? ' · ' + esc(p.incoterm) : ''}</div>
        </div>
        <div class="item-side"><div>${brl(p.estimated_brl)}</div><div class="item-sub">estimado</div></div>
      </a>`).join('') : '<div class="empty">Nenhum produto vinculado.</div>'}
    </div>`;
  document.getElementById('card-photo')?.addEventListener('click', () => openLightbox(s.card_photo));
  bindCopyButtons();
}

// Ícones de WhatsApp e WeChat ao lado do telefone.
const MSG_ICONS = {
  whatsapp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.4.1-.7.3-.2.3-.9.9-.9 2.2s.9 2.5 1 2.7c.1.2 1.8 2.8 4.4 3.9 1.6.7 2.3.8 3.1.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z"/></svg>',
  wechat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 3.5C4.9 3.5 1.5 6.3 1.5 9.8c0 2 1.1 3.8 2.9 4.9l-.7 2.2 2.6-1.4c.9.3 1.8.4 2.7.4h.6a5.7 5.7 0 0 1-.2-1.6c0-3.4 3.2-6.1 7.2-6.1h.6C16.5 5.5 13.1 3.5 9 3.5Zm-2.6 4.4a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm5.2 0a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm10.9 6.3c0-2.9-2.9-5.3-6.4-5.3s-6.4 2.4-6.4 5.3 2.9 5.3 6.4 5.3c.7 0 1.4-.1 2.1-.3l2 1.1-.5-1.8a5 5 0 0 0 2.8-4.3Zm-8.5-.9a.9.9 0 1 1 0-1.7.9.9 0 0 1 0 1.7Zm4.3 0a.9.9 0 1 1 0-1.7.9.9 0 0 1 0 1.7Z"/></svg>',
};
const msgBadges = (s) => [s.phone_whatsapp && ['whatsapp', 'WhatsApp'], s.phone_wechat && ['wechat', 'WeChat']]
  .filter(Boolean).map(([k, label]) => `<span class="msg-badge ${k}" title="${label}">${MSG_ICONS[k]}<span>${label}</span></span>`).join('');

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
    const card = await api('/api/ocr/card', { method: 'POST', body: { image: dataUrl } });
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
    box.textContent = err.message;
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
  delPhoto.textContent = '🗑 Excluir foto do cartão';
  delPhoto.hidden = !s.card_photo;
  photoBox.append(delPhoto);
  delPhoto.addEventListener('click', () => {
    if (!confirm('Excluir a foto do cartão? Os dados do fornecedor continuam salvos.')) return;
    ocrSeq++; // descarta leitura em andamento
    cardPhoto = null;
    removePhoto = Boolean(s.card_photo);
    photoBox.querySelector('.photo-preview').innerHTML = `<div style="padding:24px">📷<br>${esc(photoHint)}</div>`;
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
  const [saved, pending] = await Promise.all([api('/api/products' + scopeQS()), pendingProducts(isAdmin() ? getScope() : null)]);
  const list = [...pending, ...saved];
  $app.innerHTML = `
    ${scopeBarHtml()}
    ${state.me?.features?.product_ocr ? '<a class="btn block scan-cta" href="#/products/scan">📷 Cadastrar pela foto <small>produto, etiqueta, catálogo ou tabela de preços</small></a>' : ''}
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
          <div class="thumb">⏳</div>
          <div class="item-body"><div class="item-title">${esc(p.name)}</div>${pendingTag(p)}</div>
        </a>`;
        }
        const b = bestOffer(p);
        return `
        <a class="item" href="#/products/${p.id}">
          ${thumbImg(p.photo)}
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
          ? ` · frete por unidade <b>${usd(freightPerUnit(p.units_per_40hq))}</b> (${brl(freightPerUnit(p.units_per_40hq) * p.exchange_rate)})` : ''}</div></div>` : ''}
      ${p.notes ? `<div><div class="item-sub">Observações</div><div style="white-space:pre-wrap">${esc(p.notes)}</div></div>` : ''}
      <a class="btn" href="#/products/${p.id}/edit">Editar</a>
    </div>
    <h2>Fornecedores (${p.offers.length})</h2>
    ${p.offers.length ? `
    <div class="list">${p.offers.map((o, i) => `
      <a class="item rank-item" href="#/suppliers/${o.supplier_id}">
        <div class="offer-head" style="margin:0">
          <div class="item-body">
            <div class="item-title">${i === 0 ? '★ ' : ''}${esc(o.supplier_name)}</div>
            <div class="item-sub">${o.supplier_booth ? 'Stand ' + esc(o.supplier_booth) : 'Sem stand'}</div>
          </div>
          ${i === 0 ? '<span class="badge good">melhor preço</span>' : ''}
        </div>
        <div class="compare four">
          <div>US$<b>${o.price_usd.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}</b></div>
          <div>MOQ<b>${o.moq ?? '—'}</b></div>
          <div>${esc(o.incoterm || 'Incoterm')}<b>${pct(o.nationalization_pct)}</b></div>
          <div>Estimado<b>${brl(o.estimated_brl)}</b></div>
        </div>
        <div class="item-sub" style="margin-top:6px">${o.freight_usd > 0 ? `Frete incluído: ${usd(o.freight_usd)}/un.`
          : FREIGHT_INCLUDED.includes(o.incoterm) && p.units_per_40hq ? `Frete já incluso no ${esc(o.incoterm)}` : 'Sem frete no cálculo'}
        </div>
      </a>`).join('')}
    </div>
    <p class="hint">${FORMULA} (${brl(p.exchange_rate)}). Frete por unidade = frete 40HQ ÷ unidades por container; não é somado quando o Incoterm já inclui o frete (CFR, CIF, CPT, CIP, DAP, DPU, DDP).</p>`
    : '<div class="empty">Nenhum fornecedor vinculado a este produto.</div>'}
    <div class="meta">Atualizado ${dateBr(p.updated_at)}${p.updated_by_name ? ' por ' + esc(p.updated_by_name) : ''}</div>`;
  document.getElementById('photo')?.addEventListener('click', () => openLightbox(p.photo));
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

async function viewProductForm(id, query) {
  const editing = id != null;
  setChrome({ title: editing ? 'Editar produto' : 'Novo produto', back: editing ? `#/products/${id}` : '#/products', tab: 'products', form: true });
  loading();
  const p = editing ? await api(`/api/products/${id}`) : { offers: [] };
  // O produto pertence a uma empresa; os fornecedores das ofertas precisam ser dela.
  const company = editing ? p.company_cnpj : isAdmin() ? query.get('company') || defaultCompany() : ownCnpj();
  const suppliers = await getSuppliers(isAdmin() ? company : null);
  const rate = editing ? p.exchange_rate : companyInfo(company)?.exchange_rate ?? state.me.company.exchange_rate;
  let photo; // undefined = sem alteração, null = remover, string = nova foto
  const formRef = newRef(); // o mesmo cadastro enviado duas vezes não duplica
  // Produtos já cadastrados (e os da fila), para avisar quando o novo parecer repetido.
  const existing = editing ? [] : await Promise.all([
    api('/api/products' + (isAdmin() ? `?company=${encodeURIComponent(company)}` : '')).catch(() => []),
    pendingProducts(isAdmin() ? company : null),
  ]).then(([a, b]) => [...b, ...a]);

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

  const offers = p.offers.length
    ? p.offers.map((o) => ({ ...o }))
    : [{ supplier_id: Number(query.get('supplier')) || '', price_usd: '', moq: '', incoterm: 'FOB', nationalization_pct: '' }];
  // Vindo do aviso de produto repetido: acrescenta (ou atualiza) a oferta do fornecedor neste produto.
  const addSupplier = Number(query.get('add_supplier'));
  if (editing && addSupplier) {
    const incoming = {
      supplier_id: addSupplier, price_usd: query.get('price') || '', moq: query.get('moq') || '',
      incoterm: query.get('incoterm') || 'FOB', nationalization_pct: query.get('nat') || '',
    };
    const cur = offers.find((o) => Number(o.supplier_id) === addSupplier);
    if (cur) for (const k of ['price_usd', 'moq', 'incoterm', 'nationalization_pct']) { if (incoming[k] !== '') cur[k] = incoming[k]; }
    else offers.push(incoming);
  }

  $app.innerHTML = `
    <form class="stack" id="f" novalidate>
      ${companyField}
      <div class="card stack">
        <div><label>Foto do produto</label><div id="photo">${photoInputHtml(p.photo, state.me?.features?.product_ocr && !editing
          ? 'Fotografe o produto, a etiqueta ou o catálogo — os dados serão preenchidos automaticamente' : 'Tire uma foto ou escolha da galeria')}</div>
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
        <p class="hint">${FORMULA} (${brl(rate)}). O frete não é somado quando o Incoterm já o inclui (CFR, CIF, CPT, CIP, DAP, DPU, DDP).</p>
      </div>
      <div class="error-box" id="err" hidden></div>
      <div class="actions form-actions">
        ${editing ? '<button type="button" class="btn danger" id="del">Excluir</button>' : ''}
        <button class="btn primary" type="submit">Salvar</button>
      </div>
    </form>`;

  bindPhotoInput(document.getElementById('photo'), (d) => { photo = d; if (!editing) readProductPhoto(d); });
  bindCompany();
  document.getElementById('rm-photo')?.addEventListener('click', (e) => {
    photo = null;
    document.querySelector('#photo .photo-preview').innerHTML = '<div style="padding:24px">📷<br>Tire uma foto ou escolha da galeria</div>';
    e.target.remove();
  });

  const form = document.getElementById('f');
  const offersEl = document.getElementById('offers');

  function offerCalc(o) {
    const usdV = parseNum(o.price_usd);
    const natV = parseNum(o.nationalization_pct) || 0;
    if (usdV == null || Number.isNaN(usdV)) return '<span class="item-sub">Informe o preço em US$</span>';
    const perUnit = freightPerUnit(parseNum(form.units_per_40hq.value)) || 0;
    const freight = offerFreight(o.incoterm, perUnit);
    const est = estimate(usdV, natV, rate, freight);
    const br = parseNum(form.price_brl.value);
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
              placeholder="🔍 Buscar fornecedor pelo nome ou stand…" autocomplete="off" role="combobox"
              aria-label="Fornecedor" aria-expanded="false" aria-autocomplete="list">
            <ul class="combo-list" role="listbox" hidden></ul>
          </div>
          ${offers.length > 1 ? `<button type="button" class="icon-btn" data-rm="${i}" aria-label="Remover">✕</button>` : ''}
        </div>
        <div class="row">
          <div><label>Preço (US$) <span class="req">*</span></label><input data-k="price_usd" inputmode="decimal" value="${esc(o.price_usd)}" placeholder="0,00"></div>
          <div><label>MOQ</label><input data-k="moq" inputmode="numeric" value="${esc(o.moq ?? '')}" placeholder="unid."></div>
        </div>
        <div class="row" style="margin-top:10px">
          <div><label>Incoterm</label><select data-k="incoterm">
            <option value="">—</option>
            ${INCOTERMS.map((t) => `<option ${o.incoterm === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select></div>
          <div><label>Nacionaliz. (%)</label><input data-k="nationalization_pct" inputmode="decimal" value="${esc(o.nationalization_pct ?? '')}" placeholder="ex.: 85"></div>
        </div>
        <div class="offer-calc" data-calc="${i}">${offerCalc(o)}</div>
      </div>`).join('');
  }
  renderOffers();

  // ---- campo de fornecedor com busca ----
  function supplierLabel(id) {
    const s = suppliers.find((x) => x.id === Number(id));
    return s ? (s.pending ? '⏳ ' : '') + s.name + (s.booth ? ` — ${s.booth}` : '') : '';
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
      ...(Number(o.supplier_id) > 0 ? { add_supplier: o.supplier_id } : {}), price: o.price_usd || '', moq: o.moq || '',
      incoterm: o.incoterm || '', nat: o.nationalization_pct || '',
    });
    dupBox.innerHTML = `<div class="dup-title">⚠ Parecido com produto já cadastrado:</div>${found.map(({ p: x }) => `
      <div class="dup-item"><span>${esc(x.name)}${x.pending ? ' <small>(aguardando envio)</small>' : ` <small>· ${x.offers.length} fornecedor(es)</small>`}</span>
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
      const { products } = await api('/api/ocr/product', { method: 'POST', body: { image: dataUrl } });
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
  function applyRead(r, box) {
    const filled = [];
    const set = (el, v, label) => { if (v == null || v === '' || String(el.value).trim()) return; el.value = v; el.classList.add('autofilled'); filled.push(label); };
    set(form.name, r.name, 'nome');
    set(form.units_per_40hq, r.units_per_40hq, 'unidades/40HQ');
    const o = offers.find((x) => !String(x.price_usd).trim()) || offers[0];
    if (r.price_usd != null && !String(o.price_usd).trim()) { o.price_usd = String(r.price_usd).replace('.', ','); filled.push('preço US$'); }
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
    document.getElementById('freight-hint').innerHTML = freightHint(parseNum(form.units_per_40hq.value), rate);
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
    const rm = e.target.dataset.rm;
    if (rm === undefined) return;
    offers.splice(Number(rm), 1);
    renderOffers();
  });
  form.units_per_40hq.addEventListener('input', () => {
    document.getElementById('freight-hint').innerHTML = freightHint(parseNum(form.units_per_40hq.value), rate);
    offers.forEach((o, i) => { offersEl.querySelector(`[data-calc="${i}"]`).innerHTML = offerCalc(o); });
  });
  form.price_brl.addEventListener('input', () => {
    offers.forEach((o, i) => { offersEl.querySelector(`[data-calc="${i}"]`).innerHTML = offerCalc(o); });
  });
  document.getElementById('add-offer').addEventListener('click', () => {
    const last = offers[offers.length - 1];
    offers.push({ supplier_id: '', price_usd: '', moq: '', incoterm: last?.incoterm || 'FOB', nationalization_pct: last?.nationalization_pct ?? '' });
    renderOffers();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const box = document.getElementById('err');
    box.hidden = true;
    const fail = (m) => { box.textContent = m; box.hidden = false; };

    if (!form.name.value.trim()) return fail('Informe o nome do produto.');
    const priceBrl = parseNum(form.price_brl.value);
    if (Number.isNaN(priceBrl)) return fail('Preço no Brasil inválido.');
    const payloadOffers = [];
    for (const [i, o] of offers.entries()) {
      const blank = !o.supplier_id && !String(o.price_usd).trim();
      if (blank && offers.length > 0) continue; // linha vazia é ignorada
      if (!o.supplier_id) return fail(`Selecione o fornecedor da linha ${i + 1}.`);
      const priceUsd = parseNum(o.price_usd);
      if (priceUsd == null || Number.isNaN(priceUsd)) return fail(`Informe o preço em US$ da linha ${i + 1}.`);
      const moq = parseNum(o.moq);
      const nat = parseNum(o.nationalization_pct);
      if (Number.isNaN(moq) || Number.isNaN(nat)) return fail(`Verifique MOQ e % da linha ${i + 1}.`);
      payloadOffers.push({ supplier_id: Number(o.supplier_id), price_usd: priceUsd, moq, incoterm: o.incoterm || null, nationalization_pct: nat ?? 0 });
    }

    const units = parseNum(form.units_per_40hq.value);
    if (units !== null && !(Number.isInteger(units) && units > 0)) return fail('Unidades por container 40HQ deve ser um número inteiro.');
    const body = { name: form.name.value, price_brl: priceBrl, units_per_40hq: units, notes: form.notes.value, offers: payloadOffers };
    if (photo !== undefined) body.photo = photo;
    if (photo) body.photo_thumb = await makeThumb(photo);
    if (isAdmin() && !editing) body.company = company;
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      if (editing) {
        const saved = await api(`/api/products/${id}`, { method: 'PUT', body });
        toast('Produto salvo.');
        location.hash = `#/products/${saved.id}`;
        return;
      }
      body.client_ref = formRef;
      const { saved } = await createOrQueue('product', body, body.name);
      if (saved) { toast('Produto salvo.'); location.hash = `#/products/${saved.id}`; return; }
      toast('Sem internet: produto guardado no celular. Ele será enviado quando a conexão voltar.');
      location.hash = '#/products';
    } catch (err) {
      fail(err.message);
    } finally {
      btn.disabled = false;
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
  const [suppliers, existing] = await Promise.all([
    getSuppliers(isAdmin() ? company : null),
    Promise.all([
      api('/api/products' + (isAdmin() ? `?company=${encodeURIComponent(company)}` : '')).catch(() => []),
      pendingProducts(isAdmin() ? company : null),
    ]).then(([a, b]) => [...b, ...a]),
  ]);
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
            `<option value="${s.id}"${s.id === Number(supplierId) ? ' selected' : ''}>${s.pending ? '⏳ ' : ''}${esc(s.name)}${s.booth ? ` — ${esc(s.booth)}` : ''}</option>`).join('')}</select>
          <div class="hint">Sem fornecedor, os produtos são salvos sem preço de oferta. <a href="#/suppliers/new">+ Novo fornecedor</a></div></div>
        <div class="row">
          <div><label for="nat">Nacionaliz. (%) para todos</label><input id="nat" inputmode="decimal" placeholder="ex.: 85"></div>
          <div><label for="incoterm-all">Incoterm padrão</label><select id="incoterm-all">${INCOTERMS.map((t) => `<option${t === 'FOB' ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
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
  document.getElementById('company')?.addEventListener('change', (e) => {
    location.hash = `#/products/scan?company=${encodeURIComponent(e.target.value)}`;
  });
  document.getElementById('supplier').addEventListener('change', (e) => { supplierId = Number(e.target.value) || ''; });

  const numText = (v) => (v == null ? '' : String(v).replace('.', ','));
  function addItems(products, photo) {
    const defaultIncoterm = document.getElementById('incoterm-all').value;
    for (const r of products) {
      const match = similarProducts(r.name, existing.filter((x) => x.id)).find((x) => x.strong);
      items.push({
        ref: newRef(), include: true, name: r.name, price_usd: numText(r.price_usd), moq: r.moq ?? '',
        incoterm: r.incoterm || defaultIncoterm, units_per_40hq: r.units_per_40hq ?? '',
        notes: [r.name_original && `Nome original: ${r.name_original}`, r.price_note && `Preço: ${r.price_note}`, r.specs].filter(Boolean).join('\n'),
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
          <div><label>Preço (US$)</label><input data-k="price_usd" inputmode="decimal" value="${esc(it.price_usd)}" placeholder="0,00"></div>
          <div><label>MOQ</label><input data-k="moq" inputmode="numeric" value="${esc(it.moq)}" placeholder="unid."></div>
        </div>
        <div class="row">
          <div><label>Incoterm</label><select data-k="incoterm"><option value="">—</option>${INCOTERMS.map((t) => `<option${it.incoterm === t ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
          <div><label>Unid. / 40HQ</label><input data-k="units_per_40hq" inputmode="numeric" value="${esc(it.units_per_40hq)}"></div>
        </div>
        <div><label>Observações</label><textarea data-k="notes" rows="2">${esc(it.notes)}</textarea></div>
        ${similar.length ? `<div class="dup-box"><div class="dup-title">⚠ Parecido com produto já cadastrado</div>
          <select data-k="target"><option value="">Criar produto novo</option>${similar.map(({ p }) =>
            `<option value="${p.id}"${Number(it.target) === p.id ? ' selected' : ''}>Adicionar a oferta em: ${esc(p.name)}</option>`).join('')}</select></div>` : ''}
        ${it.target ? '' : `<label class="scan-check"><input type="checkbox" data-k="use_photo"${it.use_photo ? ' checked' : ''}> Usar esta foto como foto do produto</label>`}
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
  itemsEl.addEventListener('change', (e) => {
    const k = e.target.dataset.k;
    if (k === 'target') { items[Number(e.target.closest('.scan-item').dataset.i)].target = e.target.value; render(); }
    if (k === 'name') render(); // atualiza o aviso de parecido
  });
  itemsEl.addEventListener('click', (e) => {
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
      const { products } = await api('/api/ocr/product', { method: 'POST', body: { image: dataUrl } });
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
    const nat = parseNum(document.getElementById('nat').value);
    if (Number.isNaN(nat)) { err.textContent = 'Nacionalização (%) inválida.'; err.hidden = false; return; }
    const sid = Number(supplierId) || null;

    // Confere tudo antes de enviar o primeiro.
    const jobs = [];
    for (const [i, it] of items.entries()) {
      if (!it.include) continue;
      const fail = (m) => { err.textContent = `Produto ${i + 1} (${it.name || 'sem nome'}): ${m}`; err.hidden = false; itemsEl.children[i]?.scrollIntoView({ block: 'center' }); };
      if (!String(it.name).trim()) return fail('informe o nome.');
      const price = parseNum(it.price_usd);
      const moq = parseNum(it.moq);
      const units = parseNum(it.units_per_40hq);
      if (Number.isNaN(price) || Number.isNaN(moq) || Number.isNaN(units)) return fail('verifique preço, MOQ e unidades.');
      if (units !== null && !(Number.isInteger(units) && units > 0)) return fail('unidades por 40HQ deve ser um número inteiro.');
      const offer = sid && price != null
        ? { supplier_id: sid, price_usd: price, moq: moq != null ? Math.round(moq) : null, incoterm: it.incoterm || null, nationalization_pct: nat ?? 0 } : null;
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
        } else {
          const body = { name: it.name.trim(), price_brl: null, units_per_40hq: units, notes: it.notes, offers: offer ? [offer] : [], client_ref: it.ref };
          if (it.use_photo) Object.assign(body, { photo: it.photo, photo_thumb: await makeThumb(it.photo) });
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
        <div class="thumb">${i.error ? '⚠️' : '⏳'}</div>
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
          <div class="item-sub">${it.best ? `★ ${esc(it.best.supplier_name)}${it.best.supplier_booth ? ' · Stand ' + esc(it.best.supplier_booth) : ''}` : 'Sem fornecedor'}</div>
          <div style="margin-top:4px">${savingBadge(it.price_brl, it.best?.estimated_brl)}${it.options.length > 1 ? ` <span class="badge">${it.options.length} fornecedores</span>` : ''} ${companyTag(it.company_cnpj)}</div>
        </div>
      </div>
      <div class="compare">
        <div>${FLAG_CN} Estimado<b>${it.best ? brl(it.best.estimated_brl) : '—'}</b></div>
        <div>${FLAG_BR} Brasil<b>${brl(it.price_brl)}</b></div>
        <div>Economia<b style="color:${it.saving_brl > 0 ? 'var(--good)' : it.saving_brl < 0 ? 'var(--bad)' : 'inherit'}">${it.saving_brl == null ? '—' : brl(it.saving_brl)}</b></div>
      </div>
    </a>`).join('')}</div>
    <p class="hint">Ordenado pela maior economia percentual. ${FORMULA} ${isAdmin() && !r.company ? 'de cada empresa' : `(${brl(r.exchange_rate)})`}.</p>`;
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
const TRIP_ICONS = { location: '📍', hotel: '🏨', contact: '👤', notes: '📝' };
// Meios de transporte. A ordem importa: "Transfer para o aeroporto" é 🚐, não ✈️.
// O texto é comparado sem acentos e em minúsculas ("Vôo", "AÉREA", "Ônibus" também valem).
const TRANSPORT_RULES = [
  [/transfer|tra[n]?slado|\bcarro\b|\bvan\b|\btaxi|\bdidi\b|\buber\b|motorista|\bcar\b|专车|接送|出租/, '🚐'],
  [/\bvoo|\bvoa|aviao|aere[oa]|aeroporto|\bflight|\bfly|airport|airline|航班|飞机/, '✈️'],
  [/\btre[mn]|alta velocidade|high.?speed|\bcrh\b|\bg\d{1,4}\b|\bmetro\b|subway|高铁|动车|火车|地铁/, '🚆'],
  [/onibus|\bbus\b|\bcoach\b|巴士|大巴/, '🚌'],
  [/\bbarco\b|balsa|ferry|\bboat\b|轮渡/, '⛴️'],
  [/a pe\b|caminhada|\bwalk/, '🚶'],
];
// Ícone da atividade. Olha primeiro o texto da atividade ("Trem para Shenzhen" → 🚆), depois o
// campo Transporte, e só usa o tipo da legenda de cores quando nada indica — o tipo costuma ser
// genérico, ex.: "Deslocamento (voo, trem, transfer)".
const ICON_RULES = [
  ...TRANSPORT_RULES,
  [/deslocamento/, '🚐'],
  [/\bfeira\b|\bfair\b|\bexpo\b/, '🏛️'],
  [/fabrica|factory|visita/, '🏭'],
  [/\bhotel\b|check-?in/, '🏨'],
  [/\blivre\b|descanso|\bfree\b/, '☀️'],
];
const plain = (text) => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const matchIcon = (rules, text) => { const t = plain(text); return rules.find(([re]) => re.test(t))?.[1] || ''; };
const iconFor = (text) => matchIcon(ICON_RULES, text);
// Ícone da linha "Transporte": conforme o meio informado; 🚗 quando não dá para saber.
// Número de voo no formato da companhia: "CZ3456", "MU 5102" (em maiúsculas, como no bilhete).
const FLIGHT_NO = /\b[A-Z][A-Z0-9]\s?\d{3,4}\b/;
const transportIcon = (text) => matchIcon(TRANSPORT_RULES, text) || (FLIGHT_NO.test(text) ? '✈️' : '🚗');
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
  <a href="#/trip" class="${active === 'trip' ? 'active' : ''}">Roteiro</a><a href="#/map" class="${active === 'map' ? 'active' : ''}">Mapa da feira</a></nav>`;

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
    ${isAdmin() ? '<a class="btn primary block" href="#/trip/new" style="margin-bottom:14px">⬆ Enviar roteiro (Excel)</a>' : ''}
    <div class="list">${list.length ? list.map((it) => `
      <a class="item" href="#/trip/${it.id}">
        <div class="thumb">✈️</div>
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
        <a class="btn small" href="/api/itineraries/${it.id}/file" download>⬇ Planilha original</a>
        <a class="btn small" href="#/trip/${it.id}/edit">✎ Editar</a>
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
        ${cities.length || d.sheet ? `<div class="badges" style="margin:0 0 6px">${cities.map((c) => `<span class="badge city">📍 ${esc(c)}</span>`).join('')}</div>` : ''}
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
        <button type="button" class="btn primary" id="my-card-share">↗ Compartilhar</button>
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
    const v = parseNum(e.target.freight.value);
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
        ${u.is_self ? '' : `<button type="button" class="icon-btn danger-icon" data-del-user="${u.id}" aria-label="Excluir usuário" title="Excluir usuário">🗑</button>`}
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
          aria-label="Excluir empresa" title="${c.users ? 'Exclua os usuários primeiro' : 'Excluir empresa'}">🗑</button>
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
        <span class="item-sub">US$ 1,00 =</span>
        <b>R$ ${fmtRate(company.exchange_rate)}</b>
        <span class="item-sub">${quoteInfo}</span>
      </div>
      ${failing ? `<div class="error-box">⚠ ${esc(fx.error)} Estamos usando o último valor disponível.
        Tente atualizar de novo ou informe o câmbio manualmente abaixo.</div>` : ''}
      ${auto ? `
        <p class="hint" style="margin:0">Atualizado sozinho a cada 30 minutos pela PTAX (taxa de venda) do Banco Central,
          com AwesomeAPI e ExchangeRate-API como reserva.</p>
        <button type="button" class="btn" id="fx-refresh">↻ Atualizar agora</button>` : ''}
      <form class="stack" id="rate-form" ${auto && !failing ? 'hidden' : ''}>
        <div><label for="rate">${auto ? 'Informar manualmente (R$ por US$ 1,00)' : 'R$ por US$ 1,00'}</label>
          <input id="rate" name="rate" inputmode="decimal" value="${fmtRate(company.exchange_rate)}"></div>
        <button class="btn primary" type="submit">Usar este valor</button>
        ${!auto && fx?.rate ? `<p class="hint" style="margin:0">Cotação do dia: ${brl(fx.rate)} (${esc(fx.source)}).</p>` : ''}
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
      box.querySelector('#rate').focus();
    }
  }));
  box.querySelector('#fx-refresh')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Atualizando…';
    try {
      state.me = await api('/api/fx/refresh', { method: 'POST', body: {} });
      setChrome({ title: 'Conta', tab: 'account' });
      renderRateCard();
      toast(fxFailing() ? 'Não foi possível atualizar a cotação.' : `Cotação atualizada: ${brl(state.me.company.exchange_rate)}`);
    } catch (err) {
      toast(err.message);
      e.target.disabled = false;
      e.target.textContent = '↻ Atualizar agora';
    }
  });
  box.querySelector('#rate-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = parseNum(e.target.rate.value);
    if (!(v > 0)) return toast('Câmbio inválido.');
    save({ exchange_rate: v }, 'Câmbio manual salvo.');
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
    <h2 id="cambio">Câmbio para estimativas</h2>
    <div id="rate-card"></div>
    <div id="freight-card"></div>
    ${user.is_admin ? `<h2>Administração</h2>
      <a class="item" href="#/admin"><div class="thumb">👥</div><div class="item-body">
        <div class="item-title">Usuários e empresas</div>
        <div class="item-sub">Ver todos os cadastros, mudar a empresa de um usuário, excluir usuários e empresas</div></div></a>` : ''}
    <h2>Equipe (${company.members.length})</h2>
    <div class="card"><ul class="members">${company.members.map((m) => `<li><b>${esc(m.name)}</b><span class="item-sub">${esc(m.email)}</span></li>`).join('')}</ul>
      <p class="hint">Novos colegas podem se cadastrar com o mesmo CNPJ para acessar os mesmos fornecedores e produtos.</p></div>
    <button class="btn block" id="logout" style="margin-top:20px">Sair</button>
    <div class="signature"><img class="brand-logo" src="/brand/logo.png" alt="BR Trading"><span>Missão China by BR Trading</span></div>`;
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
  [/^\/outbox$/, viewOutbox],
  [/^\/products\/(\d+)$/, (m) => viewProduct(m[1])],
  [/^\/products\/(\d+)\/edit$/, (m, q) => viewProductForm(m[1], q)],
  [/^\/map$/, viewMap],
  [/^\/trip$/, () => viewTrip()],
  [/^\/trip\/new$/, () => viewTripUpload()],
  [/^\/trip\/(\d+)$/, (m) => viewTrip(m[1])],
  [/^\/trip\/(\d+)\/edit$/, (m) => viewTripEdit(m[1])],
  [/^\/account$/, viewAccount],
  [/^\/admin$/, (m, q) => viewAdmin(q)],
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
