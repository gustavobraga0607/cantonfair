'use strict';

// ===================== gestão de sourcing =====================
// Operações de compra acompanhadas pela equipe do Brasil (administradores) e pelos operadores
// da empresa na China. Usa as funções globais de app.js (api, esc, setChrome, toast…).
// Textos em português, chinês e inglês (o operador começa em chinês; a escolha fica no aparelho).

const SRC_TEXT = {
  title: ['Gestão de sourcing', '采购管理', 'Sourcing management'],
  ops: ['Operações', '订单操作', 'Operations'],
  newOp: ['Nova operação', '新建操作', 'New operation'],
  operators: ['Operadores CN', '中国操作员', 'CN operators'],
  noOps: ['Nenhuma operação ainda.', '暂无操作。', 'No operations yet.'],
  noOpsOperator: ['Nenhuma operação atribuída a você ainda.', '还没有分配给您的操作。', 'No operations assigned to you yet.'],
  operation: ['Operação', '操作', 'Operation'],
  requestRef: ['Referência da solicitação', '需求编号', 'Request reference'],
  createdBy: ['Criado por', '创建人', 'Created by'],
  lastUpdate: ['Última atualização', '最后更新', 'Last update'],
  actions: ['Ações', '操作', 'Actions'],
  conclude: ['Concluir operação', '完成操作', 'Complete operation'],
  confirmConclude: ['Concluir esta operação? O operador só poderá usar o chat.', '确定完成此操作？完成后操作员只能聊天。', 'Complete this operation? The operator will only be able to chat.'],
  reopen: ['Reabrir operação', '重新打开操作', 'Reopen operation'],
  edit: ['Editar', '编辑', 'Edit'],
  delete: ['Excluir', '删除', 'Delete'],
  confirmDeleteOp: ['Excluir esta operação com todos os lançamentos, documentos e mensagens?', '删除此操作及其所有记录、文件和消息？', 'Delete this operation with all entries, documents and messages?'],
  supplier: ['Fornecedor', '供应商', 'Supplier'],
  operator: ['Operador CN', '中国操作员', 'CN operator'],
  product: ['Produto', '产品', 'Product'],
  quantity: ['Quantidade', '数量', 'Quantity'],
  purchaseValue: ['Valor da compra', '采购金额', 'Purchase value'],
  perUnit: ['por unidade', '每件', 'per unit'],
  expected: ['Previsão de conclusão', '预计完成', 'Expected completion'],
  inDays: ['Em {n} dias', '还有 {n} 天', 'In {n} days'],
  today: ['Hoje', '今天', 'Today'],
  late: ['Atrasada {n} dias', '逾期 {n} 天', '{n} days late'],
  st_confirmed: ['Pedido confirmado', '订单确认', 'Order confirmed'],
  st_production: ['Produção', '生产中', 'Production'],
  st_ready: ['Pronto', '生产完成', 'Ready'],
  st_concluded: ['Concluído', '已完结', 'Completed'],
  badge_confirmed: ['Confirmado', '已确认', 'Confirmed'],
  badge_production: ['Em produção', '生产中', 'In production'],
  badge_ready: ['Pronto', '生产完成', 'Ready'],
  badge_concluded: ['Concluído', '已完结', 'Completed'],
  markProduction: ['Marcar Produção', '标记为生产中', 'Mark as Production'],
  markReady: ['Marcar Pronto', '标记为生产完成', 'Mark as Ready'],
  revenues: ['Receitas', '收入', 'Revenue'],
  expenses: ['Despesas', '费用', 'Expenses'],
  refunds: ['Tax Refund', '退税', 'Tax refund'],
  newRevenue: ['Nova receita', '新增收入', 'New revenue'],
  newExpense: ['Nova despesa', '新增费用', 'New expense'],
  newRefund: ['Novo tax refund', '新增退税', 'New tax refund'],
  entriesCount: ['{n} lançamento(s)', '{n} 笔记录', '{n} entries'],
  result: ['Resultado da operação', '操作结果', 'Operation result'],
  resultShort: ['Resultado', '结果', 'Result'],
  refundReceived: ['(+) Tax refund recebido', '(+) 已收退税', '(+) Tax refund received'],
  minusExpenses: ['(−) Despesas', '(−) 费用', '(−) Expenses'],
  docs: ['Documentos finais', '最终文件', 'Final documents'],
  doc_invoice: ['Invoice final', '最终发票 Invoice', 'Final invoice'],
  doc_packing: ['Packing list final', '最终装箱单 Packing list', 'Final packing list'],
  dropHint: ['Toque ou arraste o arquivo aqui', '点击或拖拽文件到此处', 'Tap or drag the file here'],
  fileTypes: ['PDF, JPG, PNG (máx. 2,9 MB)', 'PDF、JPG、PNG（最大 2.9 MB）', 'PDF, JPG, PNG (max. 2.9 MB)'],
  replace: ['Substituir', '替换', 'Replace'],
  date: ['Data', '日期', 'Date'],
  description: ['Descrição', '描述', 'Description'],
  value: ['Valor', '金额', 'Amount'],
  currency: ['Moeda', '币种', 'Currency'],
  receipt: ['Comprovante', '凭证', 'Receipt'],
  estimated: ['Valor estimado', '预计金额', 'Estimated'],
  receivedValue: ['Valor recebido', '已收金额', 'Received'],
  expectedOn: ['Data prevista', '预计日期', 'Expected date'],
  receivedOn: ['Data recebimento', '收款日期', 'Received on'],
  status: ['Status', '状态', 'Status'],
  pending: ['Pendente', '待收', 'Pending'],
  receivedSt: ['Recebido', '已收', 'Received'],
  noEntries: ['Nenhum lançamento.', '暂无记录。', 'No entries.'],
  chat: ['Chat', '聊天', 'Chat'],
  typeMsg: ['Digite sua mensagem…', '输入消息…', 'Type your message…'],
  send: ['Enviar', '发送', 'Send'],
  noMsgs: ['Nenhuma mensagem ainda.', '暂无消息。', 'No messages yet.'],
  attachFile: ['Anexar arquivo', '附件', 'Attach file'],
  attachPhoto: ['Enviar foto', '发送图片', 'Send photo'],
  save: ['Salvar', '保存', 'Save'],
  cancel: ['Cancelar', '取消', 'Cancel'],
  confirmDelete: ['Excluir este lançamento?', '删除此记录？', 'Delete this entry?'],
  rateUsd: ['Câmbio: US$ por {cur}', '汇率：1 {cur} 兑美元', 'Rate: US$ per {cur}'],
  attachReceipt: ['Comprovante (PDF, JPG ou PNG)', '凭证（PDF、JPG 或 PNG）', 'Receipt (PDF, JPG or PNG)'],
  keepReceipt: ['Comprovante atual: {name}', '当前凭证：{name}', 'Current receipt: {name}'],
  removeReceipt: ['Remover comprovante', '删除凭证', 'Remove receipt'],
  logout: ['Sair', '退出', 'Log out'],
  concludedLock: ['Operação concluída: só o chat continua aberto.', '操作已完结：仅可继续聊天。', 'Operation completed: only the chat remains open.'],
  pct: ['Alíquota (%)', '退税率 (%)', 'Rate (%)'],
  required: ['Preencha os campos obrigatórios.', '请填写必填项。', 'Please fill in the required fields.'],
  fileTooBig: ['Arquivo muito grande (máx. 2,9 MB).', '文件过大（最大 2.9 MB）。', 'File too large (max. 2.9 MB).'],
  fileType: ['Envie PDF, JPG ou PNG.', '请上传 PDF、JPG 或 PNG。', 'Please upload PDF, JPG or PNG.'],
  saved: ['Salvo.', '已保存。', 'Saved.'],
  sending: ['Enviando…', '发送中…', 'Sending…'],
  stageDate: ['Data da etapa', '阶段日期', 'Stage date'],
  you: ['Você', '我', 'You'],
};
const SRC_LANGS = [['pt', 'PT'], ['zh', '中文'], ['en', 'EN']];
function srcLang() {
  let v = null;
  try { v = localStorage.getItem('cfb.lang'); } catch { /* sem armazenamento */ }
  return SRC_LANGS.some(([k]) => k === v) ? v : isOperator() ? 'zh' : 'pt';
}
const SRC_LOCALE = { pt: 'pt-BR', zh: 'zh-CN', en: 'en-US' };
function tr(key, vars = {}) {
  const row = SRC_TEXT[key];
  const text = row ? row[{ pt: 0, zh: 1, en: 2 }[srcLang()]] : key;
  return text.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}
const srcMoney = (n, cur = 'USD') => (n == null ? '—' : `${{ USD: 'US$', CNY: '¥', BRL: 'R$' }[cur] || cur} ${Number(n).toLocaleString(SRC_LOCALE[srcLang()], { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const srcNum = (n) => (n == null ? '—' : Number(n).toLocaleString(SRC_LOCALE[srcLang()]));
const srcDate = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(SRC_LOCALE[srcLang()], { day: '2-digit', month: '2-digit', year: 'numeric' });
};
const srcDateTime = (iso) => (iso ? new Date(iso).toLocaleString(SRC_LOCALE[srcLang()], { dateStyle: 'short', timeStyle: 'short' }) : '');
const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

// Seletor de idioma + (para o operador) botão de sair.
function srcTopControls() {
  const lang = srcLang();
  return `<div class="src-top">
    <div class="segmented src-lang" role="group" aria-label="Idioma / 语言 / Language">${SRC_LANGS.map(([k, l]) =>
      `<button type="button" data-lang="${k}" class="${k === lang ? 'active' : ''}">${l}</button>`).join('')}</div>
    ${isOperator() ? `<button type="button" class="btn small" id="src-logout">${esc(tr('logout'))}</button>` : ''}
  </div>`;
}
function bindSrcTopControls(rerender) {
  $app.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => {
    try { localStorage.setItem('cfb.lang', b.dataset.lang); } catch { /* sem armazenamento */ }
    rerender();
  }));
  document.getElementById('src-logout')?.addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST', body: {} }).catch(() => {});
    clearOfflineData();
    state.me = null;
    location.hash = '#/login';
  });
}

// Lê o arquivo escolhido: foto vira JPEG reduzido; PDF vai como está. Respeita o limite do servidor.
const SRC_MAX_FILE = Math.floor(2.9 * 1024 * 1024);
async function srcReadFile(file) {
  if (!file) return null;
  let data;
  if (/^image\//.test(file.type) && !/gif|svg/.test(file.type)) data = await resizeImage(file, 1800, 0.85);
  else if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) data = await readFileAsDataUrl(file);
  else throw new Error(tr('fileType'));
  if (Math.floor((data.length - data.indexOf(',') - 1) * 0.75) > SRC_MAX_FILE) throw new Error(tr('fileTooBig'));
  const name = /^image\//.test(file.type) ? file.name.replace(/\.\w+$/, '') + '.jpg' : file.name;
  return { name, data };
}

// ---------- lista de operações ----------

async function viewSourcingList() {
  setChrome({ title: tr('title'), tab: 'account', back: isOperator() ? null : '#/account', wide: true });
  loading();
  const ops = await api('/api/sourcing/ops');
  const render = () => {
    setChrome({ title: tr('title'), tab: 'account', back: isOperator() ? null : '#/account', wide: true });
    $app.innerHTML = `
      ${srcTopControls()}
      ${isOperator() ? `<p class="hint" style="margin-top:0">${esc(state.me.user.name)} · ${esc(state.me.user.email)}</p>` : `
      <div class="actions" style="margin-bottom:14px">
        <a class="btn primary" href="#/sourcing/new">+ ${esc(tr('newOp'))}</a>
        <a class="btn" href="#/sourcing/operators">👤 ${esc(tr('operators'))}</a>
      </div>`}
      <div class="src-grid">${ops.length ? ops.map((o) => `
        <a class="card src-op-card" href="#/sourcing/${o.id}">
          <div class="src-op-head"><b>${esc(o.client_name)} - ${esc(o.title)}</b><span class="src-badge st-${o.status}">${esc(tr(`badge_${o.status}`))}</span></div>
          <div class="item-sub">${esc(tr('operation'))} #${esc(o.code)}${o.operator_name ? ` · ${esc(o.operator_name)}` : ''}</div>
          <div class="src-op-nums">
            <span><small>${esc(tr('revenues'))}</small>${srcMoney(o.totals.revenue)}</span>
            <span><small>${esc(tr('expenses'))}</small>${srcMoney(o.totals.expense)}</span>
            <span><small>${esc(tr('resultShort'))}</small><b class="${o.totals.result < 0 ? 'neg' : 'pos'}">${srcMoney(o.totals.result)}</b></span>
          </div>
          <div class="item-sub">${esc(tr('lastUpdate'))}: ${esc(srcDateTime(o.updated_at))}${o.last_message_at ? ` · 💬 ${esc(srcDateTime(o.last_message_at))}` : ''}</div>
        </a>`).join('') : `<div class="empty">${esc(tr(isOperator() ? 'noOpsOperator' : 'noOps'))}</div>`}
      </div>`;
    bindSrcTopControls(render);
  };
  render();
}

// ---------- operadores (administrador) ----------

async function viewSourcingOperators() {
  if (!isAdmin()) { location.hash = '#/sourcing'; return; }
  setChrome({ title: 'Operadores CN', tab: 'account', back: '#/sourcing' });
  loading();
  const list = await api('/api/sourcing/operators');
  $app.innerHTML = `
    <p class="hint" style="margin-top:0">Contas da equipe na China. O operador entra com e-mail e senha, vê só as operações atribuídas a ele
      e usa as telas em chinês, português ou inglês.</p>
    <div class="list">${list.length ? list.map((o) => `
      <div class="item">
        <div class="thumb">${esc(initials(o.name))}</div>
        <div class="item-body"><div class="item-title">${esc(o.name)}</div><div class="item-sub">${esc(o.email)} · ${o.op_count} operação(ões)</div></div>
        <button type="button" class="btn small" data-reset="${o.id}" data-name="${esc(o.name)}">Nova senha</button>
      </div>`).join('') : '<div class="empty">Nenhum operador cadastrado.</div>'}
    </div>
    <h2>Novo operador</h2>
    <form class="card stack" id="f" novalidate>
      <div><label for="name">Nome <span class="req">*</span></label><input id="name" name="name" placeholder="ex.: Lin Jinhe" autocomplete="off"></div>
      <div><label for="email">E-mail <span class="req">*</span></label><input id="email" name="email" type="email" autocomplete="off"></div>
      <div><label for="password">Senha inicial <span class="req">*</span></label><input id="password" name="password" type="text" autocomplete="off" placeholder="mínimo 8 caracteres">
        <div class="hint">Envie o e-mail e a senha ao operador. Ele entra pelo mesmo endereço do app.</div></div>
      <div class="error-box" id="err" hidden></div>
      <button class="btn primary" type="submit">Criar operador</button>
      <p class="hint" style="margin:0">Para excluir um operador, use Conta → Usuários e empresas.</p>
    </form>`;
  const form = document.getElementById('f');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const box = document.getElementById('err');
    box.hidden = true;
    try {
      await api('/api/sourcing/operators', { method: 'POST', body: { name: form.name.value, email: form.email.value, password: form.password.value } });
      toast('Operador criado.');
      viewSourcingOperators();
    } catch (err) { box.textContent = err.message; box.hidden = false; }
  });
  $app.querySelectorAll('[data-reset]').forEach((b) => b.addEventListener('click', async () => {
    const pwd = prompt(`Nova senha para ${b.dataset.name} (mínimo 8 caracteres). Ele será desconectado dos aparelhos.`);
    if (!pwd) return;
    try {
      await api(`/api/sourcing/operators/${b.dataset.reset}`, { method: 'PUT', body: { password: pwd } });
      toast('Senha alterada.');
    } catch (err) { toast(err.message); }
  }));
}

// ---------- cadastro da operação (administrador) ----------

async function viewSourcingForm(id) {
  if (!isAdmin()) { location.hash = '#/sourcing'; return; }
  const editing = id != null;
  setChrome({ title: editing ? 'Editar operação' : 'Nova operação', tab: 'account', back: editing ? `#/sourcing/${id}` : '#/sourcing', form: true });
  loading();
  const [op, operators] = await Promise.all([
    editing ? api(`/api/sourcing/ops/${id}`) : null,
    api('/api/sourcing/operators'),
  ]);
  const o = op || {};
  const v = (k) => esc(o[k] ?? '');
  $app.innerHTML = `
    <form class="card stack" id="f" novalidate>
      <div class="row stack-sm">
        <div><label for="client_name">Cliente <span class="req">*</span></label><input id="client_name" name="client_name" value="${v('client_name')}" placeholder="ex.: J&J"></div>
        <div><label for="title">Operação <span class="req">*</span></label><input id="title" name="title" value="${v('title')}" placeholder="ex.: Toilets"></div>
      </div>
      <div><label for="request_ref">Referência da solicitação</label><input id="request_ref" name="request_ref" value="${v('request_ref')}"></div>
      <div class="row stack-sm">
        <div><label for="supplier_local">Fornecedor (nome em chinês)</label><input id="supplier_local" name="supplier_local" value="${v('supplier_local')}" placeholder="ex.: 英洁卫浴"></div>
        <div><label for="supplier_name">Fornecedor (razão social)</label><input id="supplier_name" name="supplier_name" value="${v('supplier_name')}"></div>
      </div>
      <div><label for="operator_id">Operador CN</label><select id="operator_id" name="operator_id"><option value="">—</option>${operators.map((x) =>
        `<option value="${x.id}"${x.id === o.operator_id ? ' selected' : ''}>${esc(x.name)} — ${esc(x.email)}</option>`).join('')}</select>
        ${operators.length ? '' : '<div class="hint">Nenhum operador ainda: <a href="#/sourcing/operators">crie o login do operador</a>.</div>'}</div>
      <div class="row stack-sm">
        <div><label for="product">Produto</label><input id="product" name="product" value="${v('product')}" placeholder="ex.: Toilet"></div>
        <div><label for="product_desc">Descrição do produto</label><input id="product_desc" name="product_desc" value="${v('product_desc')}" placeholder="ex.: Full set, including seat"></div>
      </div>
      <div class="row">
        <div><label for="quantity">Quantidade</label><input id="quantity" name="quantity" inputmode="numeric" value="${v('quantity')}"></div>
        <div><label for="unit">Unidade</label><input id="unit" name="unit" value="${esc(o.unit ?? 'peças')}"></div>
      </div>
      <div><label for="purchase_value">Valor da compra (US$)</label><input id="purchase_value" name="purchase_value" inputmode="decimal" value="${o.purchase_value != null ? String(o.purchase_value).replace('.', ',') : ''}"></div>
      <div class="row">
        <div><label for="confirmed_on">Pedido confirmado em <span class="req">*</span></label><input id="confirmed_on" name="confirmed_on" type="date" value="${esc(o.confirmed_on || isoToday())}"></div>
        <div><label for="expected_on">Previsão de conclusão</label><input id="expected_on" name="expected_on" type="date" value="${v('expected_on')}"></div>
      </div>
      <div class="error-box" id="err" hidden></div>
      <div class="actions form-actions">
        ${editing ? '<button type="button" class="btn danger" id="del">Excluir</button>' : ''}
        <button class="btn primary" type="submit">Salvar</button>
      </div>
    </form>`;
  const form = document.getElementById('f');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const box = document.getElementById('err');
    box.hidden = true;
    const qty = parseNum(form.quantity.value, { thousands: true });
    const value = parseNum(form.purchase_value.value, { thousands: true });
    if (Number.isNaN(qty) || Number.isNaN(value)) { box.textContent = 'Verifique quantidade e valor.'; box.hidden = false; return; }
    const body = Object.fromEntries(['client_name', 'title', 'request_ref', 'supplier_name', 'supplier_local', 'product', 'product_desc', 'unit', 'confirmed_on', 'expected_on']
      .map((k) => [k, form[k].value]));
    Object.assign(body, { quantity: qty, purchase_value: value, operator_id: form.operator_id.value || null });
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const saved = await api(editing ? `/api/sourcing/ops/${id}` : '/api/sourcing/ops', { method: editing ? 'PUT' : 'POST', body });
      toast('Operação salva.');
      location.hash = `#/sourcing/${saved.id}`;
    } catch (err) { box.textContent = err.message; box.hidden = false; } finally { btn.disabled = false; }
  });
  document.getElementById('del')?.addEventListener('click', async () => {
    if (!confirm(tr('confirmDeleteOp'))) return;
    try {
      await api(`/api/sourcing/ops/${id}`, { method: 'DELETE' });
      toast('Operação excluída.');
      location.hash = '#/sourcing';
    } catch (err) { toast(err.message); }
  });
}

// ---------- tela da operação ----------

const SRC_STAGES = ['confirmed', 'production', 'ready', 'concluded'];
const STAGE_FIELD = { confirmed: 'confirmed_on', production: 'production_on', ready: 'ready_on', concluded: 'concluded_on' };

async function viewSourcingOp(id) {
  setChrome({ title: tr('operation'), tab: 'account', back: '#/sourcing', wide: true });
  loading();
  let op = await api(`/api/sourcing/ops/${id}`);
  let rates = null;
  const hash = location.hash;

  function daysLeft() {
    if (!op.expected_on || op.status === 'concluded') return '';
    const diff = Math.round((Date.parse(`${op.expected_on}T00:00:00`) - Date.parse(`${isoToday()}T00:00:00`)) / 86400_000);
    if (diff === 0) return `<small class="src-due">${esc(tr('today'))}</small>`;
    return diff > 0 ? `<small class="src-due">${esc(tr('inDays', { n: diff }))}</small>` : `<small class="src-due late">${esc(tr('late', { n: -diff }))}</small>`;
  }

  function stepper() {
    const cur = SRC_STAGES.indexOf(op.status);
    return `<ol class="src-steps">${SRC_STAGES.map((s, i) => `
      <li class="${i < cur ? 'done' : i === cur ? 'current' : ''}${i === cur && s === 'concluded' ? ' done' : ''}">
        <span class="dot">${i < cur || (i === cur && s === 'concluded') ? '✓' : ''}</span>
        <b>${esc(tr(`st_${s}`))}</b><small>${op[STAGE_FIELD[s]] ? esc(srcDate(op[STAGE_FIELD[s]])) : ''}</small>
      </li>`).join('')}</ol>`;
  }

  function actionsMenu() {
    const items = [];
    const idx = SRC_STAGES.indexOf(op.status);
    if (op.can.edit) items.push(`<a href="#/sourcing/${op.id}/edit">✎ ${esc(tr('edit'))}</a>`);
    if (op.can.write && idx < 1) items.push(`<button type="button" data-stage="production">🏭 ${esc(tr('markProduction'))}</button>`);
    if (op.can.write && idx < 2) items.push(`<button type="button" data-stage="ready">📦 ${esc(tr('markReady'))}</button>`);
    if (op.can.conclude && op.status === 'concluded') items.push(`<button type="button" data-stage="ready">↺ ${esc(tr('reopen'))}</button>`);
    if (op.can.edit) items.push(`<button type="button" class="danger" id="src-del-op">🗑 ${esc(tr('delete'))}</button>`);
    if (!items.length) return '';
    return `<details class="src-menu"><summary class="btn small">${esc(tr('actions'))} ▾</summary><div class="src-menu-list">${items.join('')}</div></details>`;
  }

  function entryRows(kind) {
    const list = op.entries.filter((e) => e.kind === kind);
    const canRow = op.can.write && (kind !== 'revenue' || op.can.revenue);
    const fileCell = (e) => (e.file ? `<a class="src-file" href="${esc(e.file.url)}" target="_blank" rel="noopener">📄 ${esc(e.file.name)}</a>` : '—');
    const menu = (e) => (canRow ? `<details class="src-menu row-menu"><summary aria-label="${esc(tr('actions'))}">⋯</summary><div class="src-menu-list">
      <button type="button" data-edit-entry="${e.id}">✎ ${esc(tr('edit'))}</button>
      <button type="button" class="danger" data-del-entry="${e.id}">🗑 ${esc(tr('delete'))}</button></div></details>` : '');
    if (!list.length) return `<div class="empty small">${esc(tr('noEntries'))}</div>`;
    if (kind === 'refund') {
      return `<div class="src-table-wrap"><table class="src-table"><thead><tr><th>${esc(tr('date'))}</th><th>${esc(tr('description'))}</th>
        <th class="num">${esc(tr('estimated'))}</th><th class="num">${esc(tr('receivedValue'))}</th><th class="num">%</th><th>${esc(tr('expectedOn'))}</th>
        <th>${esc(tr('receivedOn'))}</th><th>${esc(tr('status'))}</th><th>${esc(tr('receipt'))}</th><th></th></tr></thead><tbody>
        ${list.map((e) => `<tr><td>${esc(srcDate(e.entry_on))}</td><td>${esc(e.description)}</td>
          <td class="num">${srcMoney(e.amount, e.currency)}</td><td class="num">${e.received != null ? srcMoney(e.received) : '—'}</td>
          <td class="num">${e.pct != null ? srcNum(e.pct) + '%' : '—'}</td><td>${esc(srcDate(e.expected_on))}</td><td>${esc(srcDate(e.received_on))}</td>
          <td><span class="src-status ${e.status}">${e.status === 'received' ? '●' : '○'} ${esc(tr(e.status === 'received' ? 'receivedSt' : 'pending'))}</span></td>
          <td>${fileCell(e)}</td><td>${menu(e)}</td></tr>`).join('')}</tbody></table></div>`;
    }
    return `<div class="src-table-wrap"><table class="src-table"><thead><tr><th>${esc(tr('date'))}</th><th>${esc(tr('description'))}</th>
      <th class="num">${esc(tr('value'))}</th><th>${esc(tr('currency'))}</th><th>${esc(tr('receipt'))}</th><th></th></tr></thead><tbody>
      ${list.map((e) => `<tr><td>${esc(srcDate(e.entry_on))}</td><td>${esc(e.description || '—')}</td>
        <td class="num">${srcNum(e.amount.toFixed(2))}${e.currency !== 'USD' ? `<br><small class="item-sub">${srcMoney(e.amount_usd)}</small>` : ''}</td>
        <td>${esc(e.currency)}</td><td>${fileCell(e)}</td><td>${menu(e)}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function docBox(kind) {
    const d = op.documents[kind];
    return `<label class="src-drop${d ? ' has' : ''}${op.can.write ? '' : ' disabled'}" data-doc="${kind}">
      <b>${esc(tr(`doc_${kind}`))}</b>
      ${d ? `<a class="src-file" href="${esc(d.url)}" target="_blank" rel="noopener">📄 ${esc(d.name)}</a>
        <small class="item-sub">${esc(srcDateTime(d.created_at))}${op.can.write ? ` · ${esc(tr('replace'))}` : ''}</small>`
        : `<span class="src-drop-hint">⬆ ${esc(tr('dropHint'))}<small>${esc(tr('fileTypes'))}</small></span>`}
      ${op.can.write ? '<input type="file" accept="application/pdf,image/jpeg,image/png" hidden>' : ''}
    </label>`;
  }

  function render() {
    setChrome({ title: `${tr('operation')} #${op.code}`, tab: 'account', back: '#/sourcing', wide: true });
    const t = op.totals;
    const unit = op.quantity && op.purchase_value ? op.purchase_value / op.quantity : null;
    $app.innerHTML = `
      ${srcTopControls()}
      <div class="src-layout">
        <div class="src-main">
          <section class="card src-header">
            <div class="src-title">
              <div><h1>${esc(op.client_name)} - ${esc(op.title)} <span class="src-code">/ ${esc(tr('operation'))} #${esc(op.code)}</span></h1>
                <div class="item-sub">${op.request_ref ? `${esc(tr('requestRef'))}: ${esc(op.request_ref)} · ` : ''}${op.created_by_name ? `${esc(tr('createdBy'))}: ${esc(op.created_by_name)}` : ''}</div></div>
              <div class="src-title-side">
                <span class="src-badge st-${op.status}">${esc(tr(`badge_${op.status}`))}</span>
                <small class="item-sub">${esc(tr('lastUpdate'))}: ${esc(srcDateTime(op.updated_at))}</small>
              </div>
              <div class="src-title-actions">
                ${actionsMenu()}
                ${op.can.conclude && op.status !== 'concluded' ? `<button type="button" class="btn primary small" data-stage="concluded">✓ ${esc(tr('conclude'))}</button>` : ''}
              </div>
            </div>
            <div class="src-facts">
              <div><span class="ic">🏭</span><div><small>${esc(tr('supplier'))}</small><b>${esc(op.supplier_local || op.supplier_name || '—')}</b>${op.supplier_local && op.supplier_name ? `<small>${esc(op.supplier_name)}</small>` : ''}</div></div>
              <div><span class="ic">👤</span><div><small>${esc(tr('operator'))}</small><b>${esc(op.operator_name || '—')}</b></div></div>
              <div><span class="ic">📦</span><div><small>${esc(tr('product'))}</small><b>${esc(op.product || '—')}</b>${op.product_desc ? `<small>${esc(op.product_desc)}</small>` : ''}</div></div>
              <div><span class="ic">🔢</span><div><small>${esc(tr('quantity'))}</small><b>${op.quantity != null ? `${srcNum(op.quantity)} ${esc(op.unit || '')}` : '—'}</b></div></div>
              <div><span class="ic">💵</span><div><small>${esc(tr('purchaseValue'))}</small><b>${srcMoney(op.purchase_value)}</b>${unit ? `<small>(${srcMoney(unit)} ${esc(tr('perUnit'))})</small>` : ''}</div></div>
              <div><span class="ic">📅</span><div><small>${esc(tr('expected'))}</small><b>${esc(srcDate(op.expected_on))}</b>${daysLeft()}</div></div>
            </div>
            ${stepper()}
            ${op.status === 'concluded' && !op.can.edit ? `<div class="ocr-status ok">${esc(tr('concludedLock'))}</div>` : ''}
          </section>

          <section class="src-cards">
            <div class="card src-kpi rev"><div class="k-ic">💰</div><div><b>${esc(tr('revenues'))}</b><div class="k-val">${srcMoney(t.revenue)}</div>
              <small>${esc(tr('entriesCount', { n: t.counts.revenue }))}</small></div>
              ${op.can.revenue && op.can.write ? `<button type="button" class="btn small" data-new="revenue">+ ${esc(tr('newRevenue'))}</button>` : ''}</div>
            <div class="card src-kpi exp"><div class="k-ic">🧾</div><div><b>${esc(tr('expenses'))}</b><div class="k-val">${srcMoney(t.expense)}</div>
              <small>${esc(tr('entriesCount', { n: t.counts.expense }))}</small></div>
              ${op.can.write ? `<button type="button" class="btn small" data-new="expense">+ ${esc(tr('newExpense'))}</button>` : ''}</div>
            <div class="card src-kpi ref"><div class="k-ic">🔄</div><div><b>${esc(tr('refunds'))}</b><div class="k-val">${srcMoney(t.refund_expected)}</div>
              <small>${esc(tr('entriesCount', { n: t.counts.refund }))}</small></div>
              ${op.can.write ? `<button type="button" class="btn small" data-new="refund">+ ${esc(tr('newRefund'))}</button>` : ''}</div>
            <div class="card src-kpi res"><b>📊 ${esc(tr('result'))}</b>
              <div class="res-line"><span>${esc(tr('revenues'))}</span><span class="pos">${srcMoney(t.revenue)}</span></div>
              <div class="res-line"><span>${esc(tr('refundReceived'))}</span><span class="pos">${srcMoney(t.refund_received)}</span></div>
              <div class="res-line"><span>${esc(tr('minusExpenses'))}</span><span class="neg">${srcMoney(t.expense)}</span></div>
              <div class="res-line total"><span>${esc(tr('resultShort'))}</span><span class="${t.result < 0 ? 'neg' : 'pos'}">${srcMoney(t.result)}</span></div>
            </div>
          </section>

          <section class="card"><h3 class="src-h">📄 ${esc(tr('docs'))}</h3><div class="src-docs">${docBox('invoice')}${docBox('packing')}</div></section>

          ${['revenue', 'expense', 'refund'].map((k) => {
            const label = { revenue: 'revenues', expense: 'expenses', refund: 'refunds' }[k];
            const n = op.entries.filter((e) => e.kind === k).length;
            const canAdd = op.can.write && (k !== 'revenue' || op.can.revenue);
            return `<section class="card src-sec ${k}"><div class="src-sec-head"><h3 class="src-h">${esc(tr(label))} (${n})</h3>
              ${canAdd ? `<button type="button" class="btn small" data-new="${k}">+ ${esc(tr({ revenue: 'newRevenue', expense: 'newExpense', refund: 'newRefund' }[k]))}</button>` : ''}</div>
              ${entryRows(k)}</section>`;
          }).join('')}
        </div>

        <aside class="card src-chat" id="src-chat">
          <h3 class="src-h">💬 ${esc(tr('chat'))}</h3>
          <div class="src-msgs" id="src-msgs"><div class="item-sub">…</div></div>
          <form class="src-compose" id="src-compose">
            <textarea id="src-text" rows="2" placeholder="${esc(tr('typeMsg'))}"></textarea>
            <div class="src-compose-bar">
              <label class="icon-btn" title="${esc(tr('attachFile'))}">📎<input type="file" accept="application/pdf,image/jpeg,image/png" hidden id="src-attach"></label>
              <label class="icon-btn" title="${esc(tr('attachPhoto'))}">🖼<input type="file" accept="image/*" hidden id="src-photo"></label>
              <span class="item-sub" id="src-attach-name"></span>
              <button class="btn primary small" type="submit" aria-label="${esc(tr('send'))}">➤</button>
            </div>
          </form>
        </aside>
      </div>`;
    bindSrcTopControls(() => { render(); loadMessages(true); });
    bindOp();
  }

  async function refresh(next) { op = next || await api(`/api/sourcing/ops/${id}`); render(); loadMessages(true); }

  function bindOp() {
    $app.querySelectorAll('[data-stage]').forEach((b) => b.addEventListener('click', async () => {
      const stage = b.dataset.stage;
      if (stage === 'concluded' && !confirm(tr('confirmConclude'))) return;
      try { await refresh(await api(`/api/sourcing/ops/${op.id}/stage`, { method: 'POST', body: { stage } })); toast(tr('saved')); } catch (err) { toast(err.message); }
    }));
    document.getElementById('src-del-op')?.addEventListener('click', async () => {
      if (!confirm(tr('confirmDeleteOp'))) return;
      try { await api(`/api/sourcing/ops/${op.id}`, { method: 'DELETE' }); location.hash = '#/sourcing'; } catch (err) { toast(err.message); }
    });
    $app.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', () => entryDialog(b.dataset.new, null)));
    $app.querySelectorAll('[data-edit-entry]').forEach((b) => b.addEventListener('click', () => {
      entryDialog(null, op.entries.find((e) => e.id === Number(b.dataset.editEntry)));
    }));
    $app.querySelectorAll('[data-del-entry]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm(tr('confirmDelete'))) return;
      try { await refresh(await api(`/api/sourcing/entries/${b.dataset.delEntry}`, { method: 'DELETE' })); } catch (err) { toast(err.message); }
    }));
    // Menus "⋯" e "Ações": fecha os outros ao abrir um.
    $app.querySelectorAll('details.src-menu').forEach((d) => d.addEventListener('toggle', () => {
      if (d.open) $app.querySelectorAll('details.src-menu[open]').forEach((o) => { if (o !== d) o.open = false; });
    }));
    // Documentos finais: toque ou arraste.
    $app.querySelectorAll('.src-drop[data-doc]').forEach((box) => {
      const input = box.querySelector('input[type=file]');
      if (!input) return;
      const upload = async (file) => {
        try {
          const f = await srcReadFile(file);
          box.classList.add('busy');
          await refresh(await api(`/api/sourcing/ops/${op.id}/documents`, { method: 'POST', body: { kind: box.dataset.doc, file: f } }));
          toast(tr('saved'));
        } catch (err) { box.classList.remove('busy'); toast(err.message); }
      };
      input.addEventListener('change', () => { const f = input.files[0]; input.value = ''; if (f) upload(f); });
      box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('over'); });
      box.addEventListener('dragleave', () => box.classList.remove('over'));
      box.addEventListener('drop', (e) => { e.preventDefault(); box.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) upload(f); });
      // Clicar no link do arquivo abre o arquivo (não o seletor).
      box.querySelector('a.src-file')?.addEventListener('click', (e) => e.stopPropagation());
    });
    bindChat();
  }

  // ---- janela de lançamento (receita, despesa, tax refund) ----
  async function entryDialog(kind, entry) {
    kind = kind || entry.kind;
    rates ||= await api('/api/fx/rates', { background: true }).catch(() => ({ USD: null, CNY: null }));
    // /api/fx/rates dá R$ por moeda; aqui precisamos de US$ por moeda.
    const usdPer = (cur) => (cur === 'USD' ? 1 : cur === 'CNY' && rates.CNY && rates.USD ? +(rates.CNY / rates.USD).toFixed(4) : cur === 'BRL' && rates.USD ? +(1 / rates.USD).toFixed(4) : null);
    const e = entry || { entry_on: isoToday(), currency: 'USD' };
    const isRefund = kind === 'refund';
    const title = entry ? tr('edit') : tr({ revenue: 'newRevenue', expense: 'newExpense', refund: 'newRefund' }[kind]);
    const numIn = (v) => (v == null ? '' : String(v).replace('.', ','));
    const wrap = document.createElement('div');
    wrap.className = 'src-modal';
    wrap.innerHTML = `<form class="card stack src-modal-box" novalidate>
      <h3 class="src-h">${esc(title)}</h3>
      <div class="row">
        <div><label>${esc(tr('date'))} *</label><input name="entry_on" type="date" value="${esc(e.entry_on)}"></div>
        <div><label>${esc(tr('currency'))}</label><select name="currency">${['USD', 'CNY', 'BRL'].map((c) => `<option${c === e.currency ? ' selected' : ''}>${c}</option>`).join('')}</select></div>
      </div>
      <div><label>${esc(tr('description'))}${kind === 'revenue' ? '' : ' *'}</label><input name="description" value="${esc(e.description)}" autocomplete="off"></div>
      <div class="row">
        <div><label>${esc(tr(isRefund ? 'estimated' : 'value'))} *</label><input name="amount" inputmode="decimal" value="${numIn(e.amount)}"></div>
        <div class="rate-box"><label class="rate-label"></label><input name="rate_usd" inputmode="decimal"></div>
      </div>
      ${isRefund ? `
      <div class="row">
        <div><label>${esc(tr('pct'))}</label><input name="pct" inputmode="decimal" value="${numIn(e.pct)}" placeholder="13"></div>
        <div><label>${esc(tr('expectedOn'))}</label><input name="expected_on" type="date" value="${esc(e.expected_on || '')}"></div>
      </div>
      <div class="row">
        <div><label>${esc(tr('receivedValue'))}</label><input name="received" inputmode="decimal" value="${e.received != null ? numIn(+(e.received / (e.rate_usd || 1)).toFixed(2)) : ''}"></div>
        <div><label>${esc(tr('receivedOn'))}</label><input name="received_on" type="date" value="${esc(e.received_on || '')}"></div>
      </div>` : ''}
      <div><label>${esc(tr('attachReceipt'))}</label><input name="file" type="file" accept="application/pdf,image/jpeg,image/png">
        ${e.file ? `<div class="hint">${esc(tr('keepReceipt', { name: e.file.name }))} · <label class="inline"><input type="checkbox" name="remove_file"> ${esc(tr('removeReceipt'))}</label></div>` : ''}</div>
      <div class="error-box" hidden></div>
      <div class="actions"><button type="button" class="btn" data-close>${esc(tr('cancel'))}</button><button class="btn primary" type="submit">${esc(tr('save'))}</button></div>
    </form>`;
    document.body.append(wrap);
    const form = wrap.querySelector('form');
    const close = () => wrap.remove();
    wrap.addEventListener('click', (ev) => { if (ev.target === wrap || ev.target.closest('[data-close]')) close(); });
    const setRate = (keep) => {
      const cur = form.currency.value;
      const box = form.querySelector('.rate-box');
      box.hidden = cur === 'USD';
      form.querySelector('.rate-label').textContent = tr('rateUsd', { cur });
      if (!keep) form.rate_usd.value = usdPer(cur) != null ? String(usdPer(cur)).replace('.', ',') : '';
    };
    setRate(Boolean(entry));
    if (entry && entry.currency !== 'USD') form.rate_usd.value = String(entry.rate_usd).replace('.', ',');
    form.currency.addEventListener('change', () => setRate(false));
    (kind === 'revenue' ? form.amount : form.description).focus();
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const err = form.querySelector('.error-box');
      err.hidden = true;
      const amount = parseNum(form.amount.value, { thousands: true });
      if ((!form.description.value.trim() && kind !== 'revenue') || !(amount > 0) || !form.entry_on.value) { err.textContent = tr('required'); err.hidden = false; return; }
      const body = {
        kind, entry_on: form.entry_on.value, description: form.description.value, amount, currency: form.currency.value,
        rate_usd: form.currency.value === 'USD' ? 1 : parseNum(form.rate_usd.value),
      };
      if (isRefund) {
        Object.assign(body, {
          pct: parseNum(form.pct.value), expected_on: form.expected_on.value || null,
          // Na mesma moeda do valor estimado; o servidor converte para US$.
          received: form.received.value ? parseNum(form.received.value, { thousands: true }) : null,
          received_on: form.received_on.value || null,
        });
      }
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      btn.textContent = tr('sending');
      try {
        if (form.file.files[0]) body.file = await srcReadFile(form.file.files[0]);
        else if (form.remove_file?.checked) body.remove_file = true;
        const next = await api(entry ? `/api/sourcing/entries/${entry.id}` : `/api/sourcing/ops/${op.id}/entries`, { method: entry ? 'PUT' : 'POST', body });
        close();
        await refresh(next);
        toast(tr('saved'));
      } catch (e2) {
        err.textContent = e2.message;
        err.hidden = false;
        btn.disabled = false;
        btn.textContent = tr('save');
      }
    });
  }

  // ---- chat (consulta mensagens novas a cada 6 s enquanto a tela está aberta) ----
  let lastId = 0;
  let messages = [];
  let pollTimer = null;
  let attach = null;

  function messageHtml(m) {
    const mine = m.user_id === state.me.user.id;
    const file = m.file ? (/^image\//.test(m.file.mime)
      ? `<a href="${esc(m.file.url)}" class="src-msg-img" data-img="${esc(m.file.url)}"><img src="${esc(m.file.url)}" alt="${esc(m.file.name)}" loading="lazy"></a>`
      : `<a class="src-file" href="${esc(m.file.url)}" target="_blank" rel="noopener">📄 ${esc(m.file.name)}</a>`) : '';
    return `<div class="src-msg${mine ? ' mine' : ''}">
      <span class="avatar">${esc(initials(m.user_name))}</span>
      <div class="bubble"><div class="meta"><b>${esc(mine ? tr('you') : m.user_name)}</b> <small>${esc(srcDateTime(m.created_at))}</small></div>
        ${m.body ? `<div class="text">${esc(m.body)}</div>` : ''}${file}</div></div>`;
  }
  function paintMessages(scroll) {
    const box = document.getElementById('src-msgs');
    if (!box) return;
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    box.innerHTML = messages.length ? messages.map(messageHtml).join('') : `<div class="empty small">${esc(tr('noMsgs'))}</div>`;
    box.querySelectorAll('[data-img]').forEach((a) => a.addEventListener('click', (ev) => { ev.preventDefault(); openLightbox(a.dataset.img); }));
    if (scroll || nearBottom) box.scrollTop = box.scrollHeight;
  }
  async function loadMessages(full) {
    if (full) { lastId = 0; messages = []; }
    try {
      const fresh = await api(`/api/sourcing/ops/${op.id}/messages?after=${lastId}`, { background: true });
      if (fresh.length || full) {
        messages = messages.concat(fresh);
        lastId = messages.length ? messages[messages.length - 1].id : 0;
        paintMessages(full);
      }
    } catch { /* sem conexão: tenta na próxima */ }
  }
  function schedulePoll() {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      if (location.hash !== hash) return; // saiu da tela: para de consultar
      if (!document.hidden) await loadMessages(false);
      schedulePoll();
    }, 6000);
  }
  function bindChat() {
    const form = document.getElementById('src-compose');
    const text = document.getElementById('src-text');
    const nameBox = document.getElementById('src-attach-name');
    const pick = async (input) => {
      const f = input.files[0];
      input.value = '';
      if (!f) return;
      try { attach = await srcReadFile(f); nameBox.textContent = `📎 ${attach.name}`; } catch (err) { toast(err.message); }
    };
    document.getElementById('src-attach').addEventListener('change', (e) => pick(e.target));
    document.getElementById('src-photo').addEventListener('change', (e) => pick(e.target));
    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && matchMedia('(min-width: 900px)').matches) { e.preventDefault(); form.requestSubmit(); }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!text.value.trim() && !attach) return;
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      try {
        const m = await api(`/api/sourcing/ops/${op.id}/messages`, { method: 'POST', body: { body: text.value, file: attach } });
        text.value = '';
        attach = null;
        nameBox.textContent = '';
        if (!messages.some((x) => x.id === m.id)) { messages.push(m); lastId = Math.max(lastId, m.id); }
        paintMessages(true);
      } catch (err) { toast(err.message); } finally { btn.disabled = false; }
    });
  }

  render();
  await loadMessages(true);
  schedulePoll();
}
