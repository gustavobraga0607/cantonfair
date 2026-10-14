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
  toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
}
document.getElementById('toast').addEventListener('click', (e) => { e.currentTarget.hidden = true; });

// rotateToFit: com o celular em pé e a imagem deitada (ex.: cartão de visitas),
// gira a imagem 90° para ela ocupar a tela inteira.
function openLightbox(src, { rotateToFit = false } = {}) {
  const lb = document.getElementById('lightbox');
  const img = lb.querySelector('img');
  lb.classList.remove('rotated');
  img.onload = () => {
    const portrait = window.innerHeight > window.innerWidth;
    lb.classList.toggle('rotated', rotateToFit && portrait && img.naturalWidth > img.naturalHeight);
  };
  img.src = src;
  lb.hidden = false;
}
document.getElementById('lightbox').addEventListener('click', (e) => { e.currentTarget.hidden = true; });

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
  document.title = title ? `${title} · Canton Fair Buyer` : 'Canton Fair Buyer by BR Trading';
  document.getElementById('topbar').hidden = auth;
  document.getElementById('tabbar').hidden = auth || form;
  document.body.classList.toggle('has-tabs', !auth && !form);
  document.body.classList.toggle('has-fab', fab);
  document.getElementById('page-title').textContent = title || 'Canton Fair Buyer';
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

async function getSuppliers(company) {
  return api('/api/suppliers' + (company ? `?company=${encodeURIComponent(company)}` : scopeQS()));
}

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
        <h1>Canton Fair Buyer</h1>
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
    <div class="toolbar"><input type="search" id="q" placeholder="Buscar fornecedor, contato, stand"></div>
    <div class="list" id="list"></div>
    <a class="fab" href="#/suppliers/new" aria-label="Novo fornecedor">+</a>`;
  const render = (q = '') => {
    const term = q.trim().toLowerCase();
    const rows = list.filter((s) => !term || [s.name, s.booth, s.contact_name, s.phone]
      .some((v) => (v || '').toLowerCase().includes(term)));
    document.getElementById('list').innerHTML = rows.length
      ? rows.map((s) => `
        <a class="item" href="#/suppliers/${s.id}">
          <img class="thumb" src="${esc(s.card_photo)}" alt="" loading="lazy">
          <div class="item-body">
            <div class="item-title">${esc(s.name)}</div>
            <div class="item-sub">${s.contact_name ? esc(s.contact_name) + ' · ' : ''}${s.booth ? 'Stand ' + esc(s.booth) : 'Sem stand'} · ${s.product_count} produto(s)</div>
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
    <div class="detail-photo" id="card-photo"><img src="${esc(s.card_photo)}" alt="Cartão de visitas"></div>
    <div class="card stack" style="margin-top:14px">
      <div><div class="item-sub">Nome</div><div class="item-title">${esc(s.name)}</div></div>
      ${s.contact_name ? `<div><div class="item-sub">Contato</div><div>${esc(s.contact_name)}</div></div>` : ''}
      ${s.phone ? `<div><div class="item-sub">Telefone</div><div class="phone-line">
        <a href="tel:${esc(s.phone.replace(/[^0-9+]/g, ''))}">${esc(s.phone)}</a>
        ${s.phone.replace(/\D/g, '').length >= 8 ? `<a class="btn small" target="_blank" rel="noopener" href="https://wa.me/${esc(s.phone.replace(/\D/g, ''))}">WhatsApp</a>` : ''}
      </div></div>` : ''}
      <div><div class="item-sub">Stand</div><div>${esc(s.booth || '—')}</div></div>
      ${isAdmin() ? `<div><div class="item-sub">Empresa</div><div>${esc(s.company_name || companyLabel(s.company_cnpj))}</div></div>` : ''}
      ${s.notes ? `<div><div class="item-sub">Observações</div><div style="white-space:pre-wrap">${esc(s.notes)}</div></div>` : ''}
      <div class="actions">
        <a class="btn" href="#/suppliers/${s.id}/edit">Editar</a>
        <a class="btn primary" href="#/products/new?supplier=${s.id}&company=${encodeURIComponent(s.company_cnpj)}">+ Produto</a>
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

// Lê o cartão de visita pela API e preenche os campos que ainda estão vazios.
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
      if (!value || el.value.trim()) return;
      el.value = value;
      el.classList.add('autofilled');
      filled.push(label);
    };
    fill('name', card.company_name || card.company_name_local, 'nome');
    fill('contact_name', card.contact_name, 'contato');
    fill('phone', card.phone || card.whatsapp, 'telefone');
    fill('booth', card.booth, 'stand');

    // Demais informações do cartão vão para as observações.
    const extras = [
      ['Empresa (nome local)', card.company_name && card.company_name_local],
      ['E-mail', card.email],
      ['WeChat', card.wechat],
      ['WhatsApp', card.whatsapp && card.whatsapp !== form.phone.value ? card.whatsapp : ''],
      ['Outros telefones', card.other_phones],
      ['Site', card.website],
      ['Endereço', card.address],
      ['Produtos', card.products],
    ].filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`)
      .filter((line) => !form.notes.value.includes(line));
    if (extras.length) {
      form.notes.value = [form.notes.value.trim(), ...extras].filter(Boolean).join('\n');
      form.notes.classList.add('autofilled');
      filled.push('observações');
    }
    box.className = 'ocr-status ok';
    box.textContent = filled.length
      ? `✓ Cartão lido: ${filled.join(', ')} preenchido(s). Confira antes de salvar.`
      : 'Cartão lido, mas nenhum campo vazio para preencher.';
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
  const companyField = !isAdmin() ? ''
    : editing
      ? `<div><label>Empresa</label><div>${esc(s.company_name || companyLabel(s.company_cnpj))}</div></div>`
      : `<div><label for="company">Empresa</label><select id="company" name="company">${companyOptions(defaultCompany())}</select>
          <div class="hint">Como administrador, você pode cadastrar para qualquer empresa.</div></div>`;
  $app.innerHTML = `
    <form class="card stack" id="f" novalidate>
      ${companyField}
      <div><label>Foto do cartão de visitas <span class="req">*</span></label>
        <div id="photo">${photoInputHtml(s.card_photo, state.me?.features?.card_ocr ? 'Fotografe o cartão ou escolha da galeria — os dados serão preenchidos automaticamente' : 'Fotografe o cartão ou escolha da galeria')}</div></div>
      <div class="ocr-status" id="ocr-status" hidden></div>
      <div><label for="name">Nome do fornecedor <span class="req">*</span></label><input id="name" name="name" value="${esc(s.name)}" required></div>
      <div><label for="contact_name">Nome de contato</label><input id="contact_name" name="contact_name" value="${esc(s.contact_name)}" autocomplete="off"></div>
      <div class="row stack-sm">
        <div><label for="phone">Telefone</label><input id="phone" name="phone" type="tel" value="${esc(s.phone)}" placeholder="+86 …"></div>
        <div><label for="booth">Nº do stand</label><input id="booth" name="booth" value="${esc(s.booth)}" placeholder="ex.: 11.2 C23"></div>
      </div>
      <div><label for="notes">Observações</label><textarea id="notes" name="notes">${esc(s.notes)}</textarea></div>
      <div class="error-box" id="err" hidden></div>
      <div class="actions form-actions">
        ${editing ? '<button type="button" class="btn danger" id="del">Excluir</button>' : ''}
        <button class="btn primary" type="submit">Salvar</button>
      </div>
    </form>`;
  const form = document.getElementById('f');
  bindPhotoInput(document.getElementById('photo'), (d) => { cardPhoto = d; readBusinessCard(form, d); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const box = document.getElementById('err');
    box.hidden = true;
    if (!form.name.value.trim()) { box.textContent = 'Informe o nome do fornecedor.'; box.hidden = false; return; }
    if (!editing && !cardPhoto) { box.textContent = 'A foto do cartão de visitas é obrigatória.'; box.hidden = false; return; }
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const body = {
        name: form.name.value, contact_name: form.contact_name.value, phone: form.phone.value,
        booth: form.booth.value, notes: form.notes.value,
      };
      if (cardPhoto) body.card_photo = cardPhoto;
      if (form.company) body.company = form.company.value;
      const saved = await api(editing ? `/api/suppliers/${id}` : '/api/suppliers', { method: editing ? 'PUT' : 'POST', body });
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
  const list = await api('/api/products' + scopeQS());
  $app.innerHTML = `
    ${scopeBarHtml()}
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

  $app.innerHTML = `
    <form class="stack" id="f" novalidate>
      ${companyField}
      <div class="card stack">
        <div><label>Foto do produto</label><div id="photo">${photoInputHtml(p.photo, 'Tire uma foto ou escolha da galeria')}</div>
          ${p.photo ? '<button type="button" class="btn small danger" id="rm-photo" style="margin-top:8px">Remover foto</button>' : ''}</div>
        <div><label for="name">Nome do produto <span class="req">*</span></label><input id="name" name="name" value="${esc(p.name)}" required></div>
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

  bindPhotoInput(document.getElementById('photo'), (d) => { photo = d; });
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
    return s ? s.name + (s.booth ? ` — ${s.booth}` : '') : '';
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
    if (isAdmin() && !editing) body.company = company;
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
        ${it.photo ? `<img class="thumb" src="${esc(it.photo)}" alt="" loading="lazy">` : '<div class="thumb">📦</div>'}
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
const TRIP_ICONS = { location: '📍', transport: '🚆', hotel: '🏨', contact: '👤', notes: '📝' };
// Ícone da atividade. Olha primeiro o texto da atividade ("Trem para Shenzhen" → 🚆) e só usa
// o tipo da legenda de cores quando o texto não indica nada — o tipo costuma ser genérico,
// ex.: "Deslocamento (voo, trem, transfer)".
const ICON_RULES = [
  [/transfer|translado|\bcarro\b|\bvan\b|t[aá]xi/, '🚐'], // antes do voo: "Transfer para o aeroporto" é 🚐
  [/\bvoo\b|\bvoos\b|aeroporto|\bflight|airport/, '✈️'],
  [/\btrem\b|\btrens\b|\btrain|metr[oô]/, '🚆'],
  [/deslocamento/, '🚐'],
  [/\bfeira\b|\bfair\b|\bexpo\b/, '🏛️'],
  [/f[aá]brica|factory|visita/, '🏭'],
  [/\bhotel\b|check-?in/, '🏨'],
  [/\blivre\b|descanso|\bfree\b/, '☀️'],
];
const iconFor = (text) => ICON_RULES.find(([re]) => re.test(String(text || '').toLowerCase()))?.[1] || '';
const tripIcon = (it) => iconFor(it.activity) || iconFor(it.category);
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

const subnavHtml = (active) => `<nav class="subnav subnav-page" aria-label="Viagem">
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
    <div class="trip-line"><span aria-hidden="true">${TRIP_ICONS[f]}</span><span>${esc(it[f])}</span>${f === 'location'
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
      <div class="actions" style="margin-top:10px">
        <a class="btn small" href="/api/itineraries/${it.id}/file" download>⬇ Planilha original</a>
        ${isAdmin() ? `<a class="btn small" href="#/trip/${it.id}/edit">✎ Editar</a>` : ''}
      </div>
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
  $app.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast('Endereço copiado.'); } catch { toast('Não foi possível copiar.'); }
  }));
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
    <h2>Equipe (${company.members.length})</h2>
    <div class="card"><ul class="members">${company.members.map((m) => `<li><b>${esc(m.name)}</b><span class="item-sub">${esc(m.email)}</span></li>`).join('')}</ul>
      <p class="hint">Novos colegas podem se cadastrar com o mesmo CNPJ para acessar os mesmos fornecedores e produtos.</p></div>
    <button class="btn block" id="logout" style="margin-top:20px">Sair</button>
    <div class="signature"><img class="brand-logo" src="/brand/logo.png" alt="BR Trading"><span>Canton Fair Buyer by BR Trading</span></div>`;
  renderMyCard();
  renderRateCard();
  renderFreightCard();
  if (location.hash.includes('cambio')) document.getElementById('cambio').scrollIntoView();
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
  [/^\/map$/, viewMap],
  [/^\/trip$/, () => viewTrip()],
  [/^\/trip\/new$/, () => viewTripUpload()],
  [/^\/trip\/(\d+)$/, (m) => viewTrip(m[1])],
  [/^\/trip\/(\d+)\/edit$/, (m) => viewTripEdit(m[1])],
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
