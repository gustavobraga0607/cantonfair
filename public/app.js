'use strict';

// ===================== utilidades =====================

const $app = document.getElementById('app');
const state = { me: null, suppliers: null };
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
const estimate = (priceUsd, nat, rate) => priceUsd * (1 + (nat || 0) / 100) * rate;
const dateBr = (s) => (s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '');

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

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/api/login')) {
    state.me = null;
    location.hash = '#/login';
    throw new Error(data.error || 'Sessão expirada.');
  }
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2800);
}

function openLightbox(src) {
  const lb = document.getElementById('lightbox');
  lb.querySelector('img').src = src;
  lb.hidden = false;
}
document.getElementById('lightbox').addEventListener('click', (e) => { e.currentTarget.hidden = true; });

// Reduz a foto no navegador antes do envio (economiza dados móveis na feira).
function resizeImage(file, maxSize = 1600, quality = 0.82) {
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

// Liga um <label class="photo-input"> com <input type=file> a uma prévia.
function bindPhotoInput(root, onChange) {
  const input = root.querySelector('input[type=file]');
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImage(file);
      root.querySelector('.photo-preview').innerHTML = `<img src="${dataUrl}" alt="Prévia">`;
      onChange(dataUrl);
    } catch (err) {
      toast(err.message);
    }
  });
}

function photoInputHtml(current, placeholder) {
  return `
    <label class="photo-input">
      <div class="photo-preview" style="width:100%">${current
        ? `<img src="${esc(current)}" alt="Foto atual">`
        : `<div style="padding:24px">📷<br>${esc(placeholder)}</div>`}</div>
      <input type="file" accept="image/*" capture="environment">
    </label>`;
}

function setChrome({ title, back = null, tab = null, auth = false }) {
  document.title = title ? `${title} · Canton Fair Buyer` : 'Canton Fair Buyer';
  document.getElementById('topbar').hidden = auth;
  document.getElementById('tabbar').hidden = auth;
  document.body.classList.toggle('has-tabs', !auth);
  document.getElementById('page-title').textContent = title || 'Canton Fair Buyer';
  const backBtn = document.getElementById('back-btn');
  backBtn.hidden = !back;
  backBtn.onclick = () => { location.hash = back; };
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  const chip = document.getElementById('rate-chip');
  chip.textContent = state.me ? `US$1 = ${brl(state.me.company.exchange_rate)}` : '';
  chip.hidden = !state.me;
}

const loading = () => { $app.innerHTML = '<div class="spinner">Carregando…</div>'; };

async function getSuppliers(force = false) {
  if (!state.suppliers || force) state.suppliers = await api('/api/suppliers');
  return state.suppliers;
}

// ===================== autenticação =====================

function viewLogin() {
  setChrome({ auth: true });
  $app.innerHTML = `
    <div class="auth">
      <div class="brand">
        <img src="/icon.svg" alt="">
        <h1>Canton Fair Buyer</h1>
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
        <img src="/icon.svg" alt="">
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
  setChrome({ title: 'Fornecedores', tab: 'suppliers' });
  loading();
  const list = await getSuppliers(true);
  $app.innerHTML = `
    <div class="toolbar"><input type="search" id="q" placeholder="Buscar por nome ou stand"></div>
    <div class="list" id="list"></div>
    <a class="fab" href="#/suppliers/new" aria-label="Novo fornecedor">+</a>`;
  const render = (q = '') => {
    const term = q.trim().toLowerCase();
    const rows = list.filter((s) => !term || s.name.toLowerCase().includes(term) || (s.booth || '').toLowerCase().includes(term));
    document.getElementById('list').innerHTML = rows.length
      ? rows.map((s) => `
        <a class="item" href="#/suppliers/${s.id}">
          <img class="thumb" src="${esc(s.card_photo)}" alt="" loading="lazy">
          <div class="item-body">
            <div class="item-title">${esc(s.name)}</div>
            <div class="item-sub">${s.booth ? 'Stand ' + esc(s.booth) : 'Sem stand'} · ${s.product_count} produto(s)</div>
          </div>
        </a>`).join('')
      : `<div class="empty">${list.length ? 'Nenhum fornecedor encontrado.' : 'Nenhum fornecedor cadastrado ainda.<br><a class="btn primary" href="#/suppliers/new">Cadastrar fornecedor</a>'}</div>`;
  };
  render();
  document.getElementById('q').addEventListener('input', (e) => render(e.target.value));
}

async function viewSupplier(id) {
  setChrome({ title: 'Fornecedor', back: '#/suppliers', tab: 'suppliers' });
  loading();
  const s = await api(`/api/suppliers/${id}`);
  setChrome({ title: s.name, back: '#/suppliers', tab: 'suppliers' });
  $app.innerHTML = `
    <div class="detail-photo" id="card-photo"><img src="${esc(s.card_photo)}" alt="Cartão de visitas"></div>
    <div class="card stack" style="margin-top:14px">
      <div><div class="item-sub">Nome</div><div class="item-title">${esc(s.name)}</div></div>
      <div><div class="item-sub">Stand</div><div>${esc(s.booth || '—')}</div></div>
      ${s.notes ? `<div><div class="item-sub">Observações</div><div style="white-space:pre-wrap">${esc(s.notes)}</div></div>` : ''}
      <div class="actions">
        <a class="btn" href="#/suppliers/${s.id}/edit">Editar</a>
        <a class="btn primary" href="#/products/new?supplier=${s.id}">+ Produto</a>
      </div>
      <div class="meta">Atualizado ${dateBr(s.updated_at)}${s.updated_by_name ? ' por ' + esc(s.updated_by_name) : ''}</div>
    </div>
    <h2>Produtos deste fornecedor (${s.products.length})</h2>
    <div class="list">${s.products.length ? s.products.map((p) => `
      <a class="item" href="#/products/${p.id}">
        ${p.photo ? `<img class="thumb" src="${esc(p.photo)}" alt="" loading="lazy">` : '<div class="thumb">📦</div>'}
        <div class="item-body">
          <div class="item-title">${esc(p.name)}</div>
          <div class="item-sub">${usd(p.price_usd)}${p.moq ? ' · MOQ ' + p.moq : ''}${p.incoterm ? ' · ' + esc(p.incoterm) : ''}</div>
        </div>
        <div class="item-side"><div>${brl(p.estimated_brl)}</div><div class="item-sub">estimado</div></div>
      </a>`).join('') : '<div class="empty">Nenhum produto vinculado.</div>'}
    </div>`;
  document.getElementById('card-photo').addEventListener('click', () => openLightbox(s.card_photo));
}

async function viewSupplierForm(id) {
  const editing = id != null;
  setChrome({ title: editing ? 'Editar fornecedor' : 'Novo fornecedor', back: editing ? `#/suppliers/${id}` : '#/suppliers', tab: 'suppliers' });
  loading();
  const s = editing ? await api(`/api/suppliers/${id}`) : {};
  let cardPhoto = null;
  $app.innerHTML = `
    <form class="card stack" id="f" novalidate>
      <div><label>Foto do cartão de visitas <span class="req">*</span></label>
        <div id="photo">${photoInputHtml(s.card_photo, 'Toque para fotografar o cartão')}</div></div>
      <div><label for="name">Nome do fornecedor <span class="req">*</span></label><input id="name" name="name" value="${esc(s.name)}" required></div>
      <div><label for="booth">Nº do stand</label><input id="booth" name="booth" value="${esc(s.booth)}" placeholder="ex.: 11.2 C23"></div>
      <div><label for="notes">Observações</label><textarea id="notes" name="notes">${esc(s.notes)}</textarea></div>
      <div class="error-box" id="err" hidden></div>
      <div class="actions">
        ${editing ? '<button type="button" class="btn danger" id="del">Excluir</button>' : ''}
        <button class="btn primary" type="submit">Salvar</button>
      </div>
    </form>`;
  bindPhotoInput(document.getElementById('photo'), (d) => { cardPhoto = d; });
  const form = document.getElementById('f');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const box = document.getElementById('err');
    box.hidden = true;
    if (!form.name.value.trim()) { box.textContent = 'Informe o nome do fornecedor.'; box.hidden = false; return; }
    if (!editing && !cardPhoto) { box.textContent = 'A foto do cartão de visitas é obrigatória.'; box.hidden = false; return; }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const body = { name: form.name.value, booth: form.booth.value, notes: form.notes.value };
      if (cardPhoto) body.card_photo = cardPhoto;
      const saved = await api(editing ? `/api/suppliers/${id}` : '/api/suppliers', { method: editing ? 'PUT' : 'POST', body });
      state.suppliers = null;
      toast('Fornecedor salvo.');
      location.hash = `#/suppliers/${saved.id}`;
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
        state.suppliers = null;
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
  setChrome({ title: 'Produtos', tab: 'products' });
  loading();
  const list = await api('/api/products');
  $app.innerHTML = `
    <div class="toolbar"><input type="search" id="q" placeholder="Buscar produto ou fornecedor"></div>
    <div class="list" id="list"></div>
    <a class="fab" href="#/products/new" aria-label="Novo produto">+</a>`;
  const render = (q = '') => {
    const term = q.trim().toLowerCase();
    const rows = list.filter((p) => !term || p.name.toLowerCase().includes(term) ||
      p.offers.some((o) => o.supplier_name.toLowerCase().includes(term)));
    document.getElementById('list').innerHTML = rows.length
      ? rows.map((p) => {
        const b = bestOffer(p);
        return `
        <a class="item" href="#/products/${p.id}">
          ${p.photo ? `<img class="thumb" src="${esc(p.photo)}" alt="" loading="lazy">` : '<div class="thumb">📦</div>'}
          <div class="item-body">
            <div class="item-title">${esc(p.name)}</div>
            <div class="item-sub">${p.offers.length} fornecedor(es)${b ? ' · melhor: ' + esc(b.supplier_name) : ''}</div>
            <div style="margin-top:4px">${savingBadge(p.price_brl, b?.estimated_brl)}</div>
          </div>
          <div class="item-side"><div>${b ? brl(b.estimated_brl) : '—'}</div><div class="item-sub">BR ${brl(p.price_brl)}</div></div>
        </a>`;
      }).join('')
      : `<div class="empty">${list.length ? 'Nenhum produto encontrado.' : 'Nenhum produto cadastrado ainda.<br><a class="btn primary" href="#/products/new">Cadastrar produto</a>'}</div>`;
  };
  render();
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
      <div class="compare">
        <div>Preço no Brasil<b>${brl(p.price_brl)}</b></div>
        <div>Melhor estimado<b>${b ? brl(b.estimated_brl) : '—'}</b></div>
        <div>Diferença<b>${p.price_brl && b ? brl(p.price_brl - b.estimated_brl) : '—'}</b></div>
      </div>
      <div>${savingBadge(p.price_brl, b?.estimated_brl)}</div>
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
        <div class="compare" style="grid-template-columns:repeat(4,1fr)">
          <div>US$<b>${o.price_usd.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}</b></div>
          <div>MOQ<b>${o.moq ?? '—'}</b></div>
          <div>${esc(o.incoterm || 'Incoterm')}<b>${pct(o.nationalization_pct)}</b></div>
          <div>Estimado<b>${brl(o.estimated_brl)}</b></div>
        </div>
      </a>`).join('')}
    </div>
    <p class="hint">Estimado = preço US$ × (1 + % nacionalização) × câmbio (${brl(state.me.company.exchange_rate)}). O percentual em cada oferta é o custo de nacionalização.</p>`
    : '<div class="empty">Nenhum fornecedor vinculado a este produto.</div>'}
    <div class="meta">Atualizado ${dateBr(p.updated_at)}${p.updated_by_name ? ' por ' + esc(p.updated_by_name) : ''}</div>`;
  document.getElementById('photo')?.addEventListener('click', () => openLightbox(p.photo));
}

async function viewProductForm(id, query) {
  const editing = id != null;
  setChrome({ title: editing ? 'Editar produto' : 'Novo produto', back: editing ? `#/products/${id}` : '#/products', tab: 'products' });
  loading();
  const [p, suppliers] = await Promise.all([
    editing ? api(`/api/products/${id}`) : Promise.resolve({ offers: [] }),
    getSuppliers(true),
  ]);
  const rate = state.me.company.exchange_rate;
  let photo; // undefined = sem alteração, null = remover, string = nova foto

  if (!suppliers.length) {
    $app.innerHTML = `<div class="empty">Cadastre um fornecedor antes de cadastrar produtos.<br>
      <a class="btn primary" href="#/suppliers/new">Cadastrar fornecedor</a></div>`;
    return;
  }

  const offers = p.offers.length
    ? p.offers.map((o) => ({ ...o }))
    : [{ supplier_id: Number(query.get('supplier')) || '', price_usd: '', moq: '', incoterm: 'FOB', nationalization_pct: '' }];

  $app.innerHTML = `
    <form class="stack" id="f" novalidate>
      <div class="card stack">
        <div><label>Foto do produto</label><div id="photo">${photoInputHtml(p.photo, 'Toque para fotografar o produto')}</div>
          ${p.photo ? '<button type="button" class="btn small danger" id="rm-photo" style="margin-top:8px">Remover foto</button>' : ''}</div>
        <div><label for="name">Nome do produto <span class="req">*</span></label><input id="name" name="name" value="${esc(p.name)}" required></div>
        <div><label for="price_brl">Preço no Brasil (R$)</label><input id="price_brl" name="price_brl" inputmode="decimal" value="${p.price_brl ?? ''}" placeholder="ex.: 129,90">
          <div class="hint">Preço de referência praticado no mercado brasileiro.</div></div>
        <div><label for="notes">Observações</label><textarea id="notes" name="notes">${esc(p.notes)}</textarea></div>
      </div>
      <div class="card">
        <div class="offer-head" style="margin-bottom:12px"><h3>Fornecedores e preços</h3>
          <button type="button" class="btn small" id="add-offer">+ Fornecedor</button></div>
        <div id="offers"></div>
        <p class="hint">Estimado no Brasil = US$ × (1 + % nacionalização) × câmbio ${brl(rate)}. Altere o câmbio em Conta.</p>
      </div>
      <div class="error-box" id="err" hidden></div>
      <div class="actions">
        ${editing ? '<button type="button" class="btn danger" id="del">Excluir</button>' : ''}
        <button class="btn primary" type="submit">Salvar</button>
      </div>
    </form>`;

  bindPhotoInput(document.getElementById('photo'), (d) => { photo = d; });
  document.getElementById('rm-photo')?.addEventListener('click', (e) => {
    photo = null;
    document.querySelector('#photo .photo-preview').innerHTML = '<div style="padding:24px">📷<br>Toque para fotografar o produto</div>';
    e.target.remove();
  });

  const form = document.getElementById('f');
  const offersEl = document.getElementById('offers');

  function offerCalc(o) {
    const usdV = parseNum(o.price_usd);
    const natV = parseNum(o.nationalization_pct) || 0;
    if (usdV == null || Number.isNaN(usdV)) return '<span class="item-sub">Informe o preço em US$</span>';
    const est = estimate(usdV, natV, rate);
    const br = parseNum(form.price_brl.value);
    return `<span>Estimado: <b>${brl(est)}</b></span>${br > 0 ? savingBadge(br, est) : ''}`;
  }

  function renderOffers() {
    offersEl.innerHTML = offers.map((o, i) => `
      <div class="offer" data-i="${i}">
        <div class="offer-head">
          <select data-k="supplier_id" aria-label="Fornecedor">
            <option value="">Selecione o fornecedor…</option>
            ${suppliers.map((s) => `<option value="${s.id}" ${Number(o.supplier_id) === s.id ? 'selected' : ''}>${esc(s.name)}${s.booth ? ' — ' + esc(s.booth) : ''}</option>`).join('')}
          </select>
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
          <div><label>% nacionalização</label><input data-k="nationalization_pct" inputmode="decimal" value="${esc(o.nationalization_pct ?? '')}" placeholder="ex.: 85"></div>
        </div>
        <div class="offer-calc" data-calc="${i}">${offerCalc(o)}</div>
      </div>`).join('');
  }
  renderOffers();

  offersEl.addEventListener('input', (e) => {
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

    const body = { name: form.name.value, price_brl: priceBrl, notes: form.notes.value, offers: payloadOffers };
    if (photo !== undefined) body.photo = photo;
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const saved = await api(editing ? `/api/products/${id}` : '/api/products', { method: editing ? 'PUT' : 'POST', body });
      toast('Produto salvo.');
      location.hash = `#/products/${saved.id}`;
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

// ===================== ranking =====================

let rankingMode = 'products';

async function viewRanking() {
  setChrome({ title: 'Mais vantajosos', tab: 'ranking' });
  loading();
  const r = await api('/api/ranking');
  const render = () => {
    const body = rankingMode === 'products' ? renderRankProducts(r) : renderRankSuppliers(r);
    $app.innerHTML = `
      <div class="stats">
        <div class="stat"><b>${r.summary.products}</b><span>produtos</span></div>
        <div class="stat"><b>${r.summary.compared}</b><span>comparados</span></div>
        <div class="stat"><b style="color:var(--good)">${r.summary.advantageous}</b><span>vantajosos</span></div>
      </div>
      <div class="segmented" style="margin-top:14px">
        <button data-mode="products" class="${rankingMode === 'products' ? 'active' : ''}">Por produto</button>
        <button data-mode="suppliers" class="${rankingMode === 'suppliers' ? 'active' : ''}">Melhores fornecedores</button>
      </div>
      ${body}`;
    $app.querySelectorAll('.segmented button').forEach((b) => b.addEventListener('click', () => { rankingMode = b.dataset.mode; render(); }));
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
        ${it.photo ? `<img class="thumb" src="${esc(it.photo)}" alt="" loading="lazy">` : '<div class="thumb">📦</div>'}
        <div class="item-body">
          <div class="item-title">${esc(it.name)}</div>
          <div class="item-sub">${it.best ? `★ ${esc(it.best.supplier_name)}${it.best.supplier_booth ? ' · Stand ' + esc(it.best.supplier_booth) : ''}` : 'Sem fornecedor'}</div>
          <div style="margin-top:4px">${savingBadge(it.price_brl, it.best?.estimated_brl)}${it.options.length > 1 ? ` <span class="badge">${it.options.length} fornecedores</span>` : ''}</div>
        </div>
      </div>
      <div class="compare">
        <div>Estimado<b>${it.best ? brl(it.best.estimated_brl) : '—'}</b></div>
        <div>Brasil<b>${brl(it.price_brl)}</b></div>
        <div>Economia<b style="color:${it.saving_brl > 0 ? 'var(--good)' : it.saving_brl < 0 ? 'var(--bad)' : 'inherit'}">${it.saving_brl == null ? '—' : brl(it.saving_brl)}</b></div>
      </div>
    </a>`).join('')}</div>
    <p class="hint">Ordenado pela maior economia percentual. Estimado = US$ × (1 + % nacionalização) × câmbio ${brl(r.exchange_rate)}.</p>`;
}

function renderRankSuppliers(r) {
  if (!r.suppliers.length) return '<div class="empty">Nenhum fornecedor com ofertas ainda.</div>';
  return `<div class="list">${r.suppliers.map((s, i) => `
    <a class="item" href="#/suppliers/${s.supplier_id}">
      <div class="rank-pos">${i + 1}</div>
      <div class="item-body">
        <div class="item-title">${esc(s.name)}</div>
        <div class="item-sub">${s.booth ? 'Stand ' + esc(s.booth) + ' · ' : ''}melhor opção em ${s.best_count} produto(s)</div>
      </div>
      <div class="item-side"><span class="badge good">${s.advantageous_count} vantajoso(s)</span>
        <div class="item-sub" style="margin-top:4px">economia ${brl(s.total_saving_brl)}</div></div>
    </a>`).join('')}</div>
    <p class="hint">Fornecedores ordenados pelo número de produtos em que oferecem o melhor preço estimado abaixo do preço no Brasil.</p>`;
}

// ===================== conta =====================

async function viewAccount() {
  setChrome({ title: 'Conta', tab: 'account' });
  state.me = await api('/api/me');
  setChrome({ title: 'Conta', tab: 'account' });
  const { user, company } = state.me;
  $app.innerHTML = `
    <div class="card stack">
      <div><div class="item-sub">Usuário</div><div class="item-title">${esc(user.name)}</div><div class="item-sub">${esc(user.email)}</div></div>
      <div><div class="item-sub">Empresa</div><div class="item-title">${esc(company.name || 'Empresa')}</div><div class="item-sub">CNPJ ${esc(company.cnpj_formatted)}</div></div>
    </div>
    <h2>Câmbio para estimativas</h2>
    <form class="card stack" id="rate-form">
      <div><label for="rate">R$ por US$ 1,00</label><input id="rate" name="rate" inputmode="decimal" value="${company.exchange_rate}"></div>
      <p class="hint" style="margin:0">Compartilhado com todos os usuários deste CNPJ.</p>
      <button class="btn primary" type="submit">Salvar câmbio</button>
    </form>
    <h2>Equipe (${company.members.length})</h2>
    <div class="card"><table><tbody>${company.members.map((m) => `<tr><td>${esc(m.name)}</td><td class="item-sub">${esc(m.email)}</td></tr>`).join('')}</tbody></table>
      <p class="hint">Novos colegas podem se cadastrar com o mesmo CNPJ para acessar os mesmos fornecedores e produtos.</p></div>
    <button class="btn block" id="logout" style="margin-top:20px">Sair</button>`;
  document.getElementById('rate-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = parseNum(e.target.rate.value);
    if (!(v > 0)) return toast('Câmbio inválido.');
    try {
      state.me = await api('/api/settings', { method: 'PUT', body: { exchange_rate: v } });
      setChrome({ title: 'Conta', tab: 'account' });
      toast('Câmbio atualizado.');
    } catch (err) { toast(err.message); }
  });
  document.getElementById('logout').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST', body: {} }).catch(() => {});
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
  [/^\/products\/(\d+)$/, (m) => viewProduct(m[1])],
  [/^\/products\/(\d+)\/edit$/, (m, q) => viewProductForm(m[1], q)],
  [/^\/account$/, viewAccount],
];

async function router() {
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
  try {
    await view(path.match(re), query);
  } catch (err) {
    if (state.me) $app.innerHTML = `<div class="empty">${esc(err.message)}<br><a class="btn" href="#/ranking">Voltar</a></div>`;
  }
}

window.addEventListener('hashchange', router);
router();
