'use strict';

// Gestão de sourcing: operações de compra acompanhadas pela equipe do Brasil (administradores)
// e pelos operadores da empresa na China (role 'operator', criados pelo administrador).
//
// Quem faz o quê:
// - administrador: cria/edita/exclui operações, lança receitas, conclui ou reabre, cria operadores;
// - operador: vê só as operações atribuídas a ele; lança despesas e tax refund, envia os documentos
//   finais e marca as etapas "Produção" e "Pronto" (operação concluída fica só para consulta e chat);
// - os dois conversam no chat da operação.

const STAGES = ['confirmed', 'production', 'ready', 'concluded'];
const STAGE_DATE = { production: 'production_on', ready: 'ready_on', concluded: 'concluded_on' };
const KINDS = ['revenue', 'expense', 'refund'];
const CURRENCIES = ['USD', 'CNY', 'BRL'];
const DOC_KINDS = ['invoice', 'packing'];
// A Vercel limita a requisição a 4,5 MB; em base64 o arquivo cresce ~33%.
const MAX_FILE = Math.floor(2.9 * 1024 * 1024);

// Arredonda para centavos tratando o meio-centavo (1050 × 0,1429 = 150,045 → 150,05).
const round2 = (n) => Math.round(n * 100 + Math.sign(n) * 1e-7) / 100;
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

function sniffFile(buf) {
  if (buf.length > 4 && buf.slice(0, 4).toString() === '%PDF') return 'application/pdf';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  return null;
}

function registerSourcing({ route, db, HttpError, str, num, now, toId, isAdmin, auth, RAW, securityHeaders }) {
  const isOperator = (u) => u.role === 'operator';
  const requireAdmin = (u) => { if (!isAdmin(u)) throw new HttpError(403, 'Apenas administradores.'); };
  const requireTeam = (u) => { if (!isAdmin(u) && !isOperator(u)) throw new HttpError(403, 'Acesso restrito à equipe de sourcing.'); };
  const today = () => new Date().toISOString().slice(0, 10);

  async function loadOp(user, id) {
    requireTeam(user);
    const op = await db.get(`SELECT o.*, u.name AS operator_name FROM sourcing_ops o LEFT JOIN users u ON u.id = o.operator_id
                             WHERE o.id = ?`, [toId(id)]);
    if (!op || (!isAdmin(user) && op.operator_id !== user.id)) throw new HttpError(404, 'Operação não encontrada.');
    return op;
  }
  // Operador não altera operação concluída.
  function requireOpen(user, op) {
    if (op.status === 'concluded' && !isAdmin(user)) throw new HttpError(403, 'Operação concluída: só o chat continua aberto.');
  }

  const fileUrl = (id) => (id ? `/api/sourcing/files/${id}` : null);
  function opOut(o, totals) {
    return {
      id: o.id, code: o.code, client_name: o.client_name, title: o.title, request_ref: o.request_ref ?? null,
      supplier_name: o.supplier_name ?? null, supplier_local: o.supplier_local ?? null,
      operator_id: o.operator_id ?? null, operator_name: o.operator_name ?? null,
      product: o.product ?? null, product_desc: o.product_desc ?? null,
      quantity: o.quantity == null ? null : Number(o.quantity), unit: o.unit ?? null,
      purchase_value: o.purchase_value == null ? null : Number(o.purchase_value),
      confirmed_on: o.confirmed_on, production_on: o.production_on ?? null, ready_on: o.ready_on ?? null,
      concluded_on: o.concluded_on ?? null, expected_on: o.expected_on ?? null, status: o.status,
      created_by_name: o.created_by_name ?? null, created_at: o.created_at, updated_at: o.updated_at,
      ...(totals ? { totals } : {}),
    };
  }
  function entryOut(e) {
    return {
      id: e.id, kind: e.kind, entry_on: e.entry_on, description: e.description,
      amount: Number(e.amount), currency: e.currency, rate_usd: Number(e.rate_usd), amount_usd: Number(e.amount_usd),
      received: e.received == null ? null : Number(e.received), pct: e.pct == null ? null : Number(e.pct),
      expected_on: e.expected_on ?? null, received_on: e.received_on ?? null,
      status: e.kind === 'refund' ? (e.received_on ? 'received' : 'pending') : null,
      file: e.file_id ? { id: e.file_id, url: fileUrl(e.file_id), name: e.file_name } : null,
      created_by: e.created_by ?? null, created_at: e.created_at,
    };
  }
  // Resultado = receitas + tax refund recebido − despesas (tudo em US$).
  function totalsOf(entries) {
    const sum = (k, f = (e) => e.amount_usd) => round2(entries.filter((e) => e.kind === k).reduce((s, e) => s + f(e), 0));
    const revenue = sum('revenue');
    const expense = sum('expense');
    const refundReceived = sum('refund', (e) => (e.received_on ? (e.received ?? e.amount_usd) : 0));
    const refundExpected = sum('refund');
    const count = (k) => entries.filter((e) => e.kind === k).length;
    return {
      revenue, expense, refund_received: refundReceived, refund_expected: refundExpected,
      result: round2(revenue + refundReceived - expense),
      counts: { revenue: count('revenue'), expense: count('expense'), refund: count('refund') },
    };
  }

  // Arquivo enviado como { name, data: "data:...;base64,..." }.
  async function saveFile(q, opId, kind, file, userId) {
    const m = /^data:[\w./+-]*;base64,([A-Za-z0-9+/=]+)$/.exec(String(file?.data || ''));
    if (!m) throw new HttpError(400, 'Arquivo inválido.');
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length > MAX_FILE) throw new HttpError(413, 'Arquivo muito grande (máximo 2,9 MB). Fotos são reduzidas automaticamente; PDFs precisam ser menores.');
    const mime = sniffFile(buf);
    if (!mime) throw new HttpError(400, 'Envie PDF, JPG ou PNG.');
    const name = (str(file.name, 120) || `arquivo.${mime.split('/')[1].replace('jpeg', 'jpg')}`).replace(/[\\/\r\n"]/g, '_');
    const row = await q.get(`INSERT INTO sourcing_files (op_id, kind, name, mime, size, data, created_by, created_at)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`, [opId, kind, name, mime, buf.length, buf, userId, now()]);
    return row.id;
  }

  async function opDetail(user, op) {
    const [entries, docs, operators] = await Promise.all([
      db.all(`SELECT e.*, f.name AS file_name FROM sourcing_entries e LEFT JOIN sourcing_files f ON f.id = e.file_id
              WHERE e.op_id = ? ORDER BY e.entry_on, e.id`, [op.id]),
      db.all(`SELECT id, kind, name, mime, size, created_at FROM sourcing_files WHERE op_id = ? AND kind IN ('invoice', 'packing')`, [op.id]),
      isAdmin(user) ? db.all("SELECT id, name, email FROM users WHERE role = 'operator' ORDER BY lower(name)") : null,
    ]);
    const creator = op.created_by ? await db.get('SELECT name FROM users WHERE id = ?', [op.created_by]) : null;
    const out = entries.map(entryOut);
    return {
      ...opOut({ ...op, created_by_name: creator?.name }, totalsOf(out)),
      entries: out,
      documents: Object.fromEntries(DOC_KINDS.map((k) => {
        const d = docs.find((x) => x.kind === k);
        return [k, d ? { id: d.id, name: d.name, size: Number(d.size), url: fileUrl(d.id), created_at: d.created_at } : null];
      })),
      operators,
      can: {
        edit: isAdmin(user), revenue: isAdmin(user), conclude: isAdmin(user),
        write: isAdmin(user) || op.status !== 'concluded',
      },
    };
  }

  // ---------- operadores (contas da empresa na China) ----------

  route('GET', '/api/sourcing/operators', async ({ user }) => {
    requireAdmin(user);
    const rows = await db.all(`SELECT u.id, u.name, u.email, u.created_at,
        (SELECT COUNT(*) FROM sourcing_ops o WHERE o.operator_id = u.id) AS op_count
      FROM users u WHERE u.role = 'operator' ORDER BY lower(u.name)`);
    return rows.map((r) => ({ ...r, op_count: Number(r.op_count) }));
  });

  route('POST', '/api/sourcing/operators', async ({ user, body }) => {
    requireAdmin(user);
    const name = str(body.name, 120);
    const email = str(body.email, 200).toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';
    if (!name) throw new HttpError(400, 'Informe o nome.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'E-mail inválido.');
    if (password.length < 8 || password.length > 200) throw new HttpError(400, 'A senha deve ter pelo menos 8 caracteres.');
    if (await db.get('SELECT 1 AS x FROM users WHERE email = ?', [email])) throw new HttpError(409, 'Já existe uma conta com este e-mail.');
    // O operador fica vinculado à empresa do administrador (exigência do banco), mas só acessa o sourcing.
    const row = await db.get(`INSERT INTO users (name, email, password_hash, cnpj, role, created_at)
                              VALUES (?, ?, ?, ?, 'operator', ?) RETURNING id`, [name, email, await auth.hashPassword(password), user.cnpj, now()])
      .catch((err) => { if (/unique|duplicate/i.test(err.message)) throw new HttpError(409, 'Já existe uma conta com este e-mail.'); throw err; });
    return { status: 201, body: { id: row.id, name, email, op_count: 0 } };
  });

  // Nova senha para o operador (quando ele esquecer).
  route('PUT', '/api/sourcing/operators/:id', async ({ user, params, body }) => {
    requireAdmin(user);
    const op = await db.get("SELECT id FROM users WHERE id = ? AND role = 'operator'", [toId(params.id)]);
    if (!op) throw new HttpError(404, 'Operador não encontrado.');
    const password = typeof body.password === 'string' ? body.password : '';
    if (password.length < 8 || password.length > 200) throw new HttpError(400, 'A senha deve ter pelo menos 8 caracteres.');
    await db.run('UPDATE users SET password_hash = ? WHERE id = ?', [await auth.hashPassword(password), op.id]);
    await db.run('DELETE FROM sessions WHERE user_id = ?', [op.id]); // sai dos aparelhos onde estava logado
    return { ok: true };
  });

  // ---------- operações ----------

  route('GET', '/api/sourcing/ops', async ({ user }) => {
    requireTeam(user);
    const ops = await db.all(`SELECT o.*, u.name AS operator_name,
        (SELECT MAX(m.created_at) FROM sourcing_messages m WHERE m.op_id = o.id) AS last_message_at
      FROM sourcing_ops o LEFT JOIN users u ON u.id = o.operator_id
      ${isAdmin(user) ? '' : 'WHERE o.operator_id = ?'} ORDER BY o.id DESC`, isAdmin(user) ? [] : [user.id]);
    if (!ops.length) return [];
    const entries = (await db.all(`SELECT kind, op_id, amount_usd, received, received_on FROM sourcing_entries
      WHERE op_id IN (${ops.map(() => '?').join(', ')})`, ops.map((o) => o.id))).map((e) => ({
      ...e, amount_usd: Number(e.amount_usd), received: e.received == null ? null : Number(e.received),
    }));
    return ops.map((o) => ({ ...opOut(o, totalsOf(entries.filter((e) => e.op_id === o.id))), last_message_at: o.last_message_at ?? null }));
  });

  function opFields(body) {
    const client = str(body.client_name, 120);
    const title = str(body.title, 150);
    if (!client) throw new HttpError(400, 'Informe o cliente.');
    if (!title) throw new HttpError(400, 'Informe o nome da operação (ex.: o produto).');
    const confirmed = str(body.confirmed_on, 10);
    if (!isDate(confirmed)) throw new HttpError(400, 'Informe a data de confirmação do pedido.');
    const expected = str(body.expected_on, 10) || null;
    if (expected && !isDate(expected)) throw new HttpError(400, 'Previsão de conclusão inválida.');
    const quantity = num(body.quantity, 'Quantidade', { integer: true });
    const value = num(body.purchase_value, 'Valor da compra');
    return {
      client_name: client, title, request_ref: str(body.request_ref, 150) || null,
      supplier_name: str(body.supplier_name, 200) || null, supplier_local: str(body.supplier_local, 200) || null,
      operator_id: body.operator_id ? toId(body.operator_id) : null,
      product: str(body.product, 150) || null, product_desc: str(body.product_desc, 300) || null,
      quantity, unit: str(body.unit, 20) || null, purchase_value: value, confirmed_on: confirmed, expected_on: expected,
    };
  }
  async function checkOperator(id) {
    if (id && !(await db.get("SELECT 1 AS x FROM users WHERE id = ? AND role = 'operator'", [id]))) {
      throw new HttpError(400, 'Operador não encontrado.');
    }
  }

  route('POST', '/api/sourcing/ops', async ({ user, body }) => {
    requireAdmin(user);
    const f = opFields(body);
    await checkOperator(f.operator_id);
    const t = now();
    const id = await db.tx(async (q) => {
      const row = await q.get(`INSERT INTO sourcing_ops (client_name, title, request_ref, supplier_name, supplier_local, operator_id, product,
          product_desc, quantity, unit, purchase_value, confirmed_on, expected_on, status, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?) RETURNING id`,
      [f.client_name, f.title, f.request_ref, f.supplier_name, f.supplier_local, f.operator_id, f.product, f.product_desc,
        f.quantity, f.unit, f.purchase_value, f.confirmed_on, f.expected_on, user.id, t, t]);
      // Código legível: OP-<ano>-<id com 5 dígitos>.
      await q.run('UPDATE sourcing_ops SET code = ? WHERE id = ?', [`OP-${t.slice(0, 4)}-${String(row.id).padStart(5, '0')}`, row.id]);
      return row.id;
    });
    return { status: 201, body: await opDetail(user, await loadOp(user, id)) };
  });

  route('GET', '/api/sourcing/ops/:id', async ({ user, params }) => opDetail(user, await loadOp(user, params.id)));

  route('PUT', '/api/sourcing/ops/:id', async ({ user, params, body }) => {
    requireAdmin(user);
    const op = await loadOp(user, params.id);
    const f = opFields(body);
    await checkOperator(f.operator_id);
    await db.run(`UPDATE sourcing_ops SET client_name = ?, title = ?, request_ref = ?, supplier_name = ?, supplier_local = ?, operator_id = ?,
        product = ?, product_desc = ?, quantity = ?, unit = ?, purchase_value = ?, confirmed_on = ?, expected_on = ?, updated_at = ? WHERE id = ?`,
    [f.client_name, f.title, f.request_ref, f.supplier_name, f.supplier_local, f.operator_id, f.product, f.product_desc,
      f.quantity, f.unit, f.purchase_value, f.confirmed_on, f.expected_on, now(), op.id]);
    return opDetail(user, await loadOp(user, op.id));
  });

  route('DELETE', '/api/sourcing/ops/:id', async ({ user, params }) => {
    requireAdmin(user);
    const op = await loadOp(user, params.id);
    await db.tx(async (q) => {
      for (const t of ['sourcing_messages', 'sourcing_entries', 'sourcing_files']) await q.run(`DELETE FROM ${t} WHERE op_id = ?`, [op.id]);
      await q.run('DELETE FROM sourcing_ops WHERE id = ?', [op.id]);
    });
    return { ok: true };
  });

  // Etapas: Produção e Pronto (operador ou administrador, sempre para a frente); Concluído e
  // reabrir só o administrador. O administrador pode voltar a qualquer etapa.
  route('POST', '/api/sourcing/ops/:id/stage', async ({ user, params, body }) => {
    const op = await loadOp(user, params.id);
    const stage = String(body.stage || '');
    if (!STAGES.includes(stage)) throw new HttpError(400, 'Etapa inválida.');
    if (!isAdmin(user)) {
      requireOpen(user, op);
      if (stage === 'concluded') throw new HttpError(403, 'Só a equipe do Brasil conclui a operação.');
      if (STAGES.indexOf(stage) <= STAGES.indexOf(op.status)) throw new HttpError(400, 'A operação já passou desta etapa.');
    }
    const date = str(body.date, 10) || today();
    if (!isDate(date)) throw new HttpError(400, 'Data inválida.');
    const idx = STAGES.indexOf(stage);
    // Marca a etapa (e as anteriores sem data); limpa as datas das etapas seguintes.
    const sets = {};
    for (const [s, col] of Object.entries(STAGE_DATE)) {
      const i = STAGES.indexOf(s);
      if (i === idx) sets[col] = date;
      else if (i < idx) sets[col] = op[col] || date;
      else sets[col] = null;
    }
    await db.run(`UPDATE sourcing_ops SET status = ?, production_on = ?, ready_on = ?, concluded_on = ?, updated_at = ? WHERE id = ?`,
      [stage, sets.production_on, sets.ready_on, sets.concluded_on, now(), op.id]);
    return opDetail(user, await loadOp(user, op.id));
  });

  // ---------- receitas, despesas e tax refund ----------

  function entryFields(kind, body) {
    const description = str(body.description, 200);
    // Receita não precisa de descrição (despesa e tax refund precisam).
    if (!description && kind !== 'revenue') throw new HttpError(400, 'Informe a descrição.');
    const entryOn = str(body.entry_on, 10);
    if (!isDate(entryOn)) throw new HttpError(400, 'Data inválida.');
    const currency = String(body.currency || 'USD').toUpperCase();
    if (!CURRENCIES.includes(currency)) throw new HttpError(400, 'Moeda inválida.');
    const amount = num(body.amount, kind === 'refund' ? 'o valor estimado' : 'o valor', { required: true });
    if (!(amount > 0) || amount > 1e10) throw new HttpError(400, 'Valor inválido.');
    const rate = currency === 'USD' ? 1 : num(body.rate_usd, 'o câmbio para dólar', { required: true });
    if (!(rate > 0) || rate > 10) throw new HttpError(400, 'Câmbio para dólar inválido.');
    const f = { entry_on: entryOn, description, amount: round2(amount), currency, rate_usd: rate, amount_usd: round2(amount * rate),
      received: null, pct: null, expected_on: null, received_on: null };
    if (kind === 'refund') {
      f.received = num(body.received, 'o valor recebido');
      f.pct = num(body.pct, 'o percentual');
      if (f.pct != null && f.pct > 100) throw new HttpError(400, 'Percentual inválido.');
      f.expected_on = str(body.expected_on, 10) || null;
      f.received_on = str(body.received_on, 10) || null;
      for (const d of [f.expected_on, f.received_on]) if (d && !isDate(d)) throw new HttpError(400, 'Data inválida.');
      // Recebido em US$ (mesma moeda convertida do estimado).
      if (f.received != null) f.received = round2(f.received * rate);
    }
    return f;
  }
  function checkKindAllowed(user, kind) {
    if (!KINDS.includes(kind)) throw new HttpError(400, 'Tipo de lançamento inválido.');
    if (kind === 'revenue' && !isAdmin(user)) throw new HttpError(403, 'Receitas são lançadas pela equipe do Brasil.');
  }

  route('POST', '/api/sourcing/ops/:id/entries', async ({ user, params, body }) => {
    const op = await loadOp(user, params.id);
    requireOpen(user, op);
    const kind = String(body.kind || '');
    checkKindAllowed(user, kind);
    const f = entryFields(kind, body);
    const t = now();
    await db.tx(async (q) => {
      const fileId = body.file ? await saveFile(q, op.id, 'receipt', body.file, user.id) : null;
      await q.run(`INSERT INTO sourcing_entries (op_id, kind, entry_on, description, amount, currency, rate_usd, amount_usd, received, pct,
          expected_on, received_on, file_id, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [op.id, kind, f.entry_on, f.description, f.amount, f.currency, f.rate_usd, f.amount_usd, f.received, f.pct, f.expected_on, f.received_on,
        fileId, user.id, t, t]);
      await q.run('UPDATE sourcing_ops SET updated_at = ? WHERE id = ?', [t, op.id]);
    });
    return { status: 201, body: await opDetail(user, await loadOp(user, op.id)) };
  });

  async function loadEntry(user, id) {
    const e = await db.get('SELECT * FROM sourcing_entries WHERE id = ?', [toId(id)]);
    if (!e) throw new HttpError(404, 'Lançamento não encontrado.');
    const op = await loadOp(user, e.op_id);
    requireOpen(user, op);
    checkKindAllowed(user, e.kind);
    return { e, op };
  }

  route('PUT', '/api/sourcing/entries/:id', async ({ user, params, body }) => {
    const { e, op } = await loadEntry(user, params.id);
    const f = entryFields(e.kind, body);
    const t = now();
    await db.tx(async (q) => {
      let fileId = e.file_id;
      if (body.file) fileId = await saveFile(q, op.id, 'receipt', body.file, user.id);
      else if (body.remove_file) fileId = null;
      await q.run(`UPDATE sourcing_entries SET entry_on = ?, description = ?, amount = ?, currency = ?, rate_usd = ?, amount_usd = ?,
          received = ?, pct = ?, expected_on = ?, received_on = ?, file_id = ?, updated_at = ? WHERE id = ?`,
      [f.entry_on, f.description, f.amount, f.currency, f.rate_usd, f.amount_usd, f.received, f.pct, f.expected_on, f.received_on, fileId, t, e.id]);
      if (e.file_id && fileId !== e.file_id) await q.run('DELETE FROM sourcing_files WHERE id = ?', [e.file_id]);
      await q.run('UPDATE sourcing_ops SET updated_at = ? WHERE id = ?', [t, op.id]);
    });
    return opDetail(user, await loadOp(user, op.id));
  });

  route('DELETE', '/api/sourcing/entries/:id', async ({ user, params }) => {
    const { e, op } = await loadEntry(user, params.id);
    await db.tx(async (q) => {
      await q.run('DELETE FROM sourcing_entries WHERE id = ?', [e.id]);
      if (e.file_id) await q.run('DELETE FROM sourcing_files WHERE id = ?', [e.file_id]);
      await q.run('UPDATE sourcing_ops SET updated_at = ? WHERE id = ?', [now(), op.id]);
    });
    return opDetail(user, await loadOp(user, op.id));
  });

  // ---------- documentos finais (Invoice e Packing List) ----------

  route('POST', '/api/sourcing/ops/:id/documents', async ({ user, params, body }) => {
    const op = await loadOp(user, params.id);
    requireOpen(user, op);
    const kind = String(body.kind || '');
    if (!DOC_KINDS.includes(kind)) throw new HttpError(400, 'Documento inválido.');
    await db.tx(async (q) => {
      await q.run('DELETE FROM sourcing_files WHERE op_id = ? AND kind = ?', [op.id, kind]); // substitui o anterior
      await saveFile(q, op.id, kind, body.file, user.id);
      await q.run('UPDATE sourcing_ops SET updated_at = ? WHERE id = ?', [now(), op.id]);
    });
    return opDetail(user, await loadOp(user, op.id));
  });

  route('DELETE', '/api/sourcing/ops/:id/documents/:kind', async ({ user, params }) => {
    const op = await loadOp(user, params.id);
    requireOpen(user, op);
    if (!DOC_KINDS.includes(params.kind)) throw new HttpError(400, 'Documento inválido.');
    await db.run('DELETE FROM sourcing_files WHERE op_id = ? AND kind = ?', [op.id, params.kind]);
    return opDetail(user, await loadOp(user, op.id));
  });

  route('GET', '/api/sourcing/files/:id', async ({ user, params, res }) => {
    const f = await db.get('SELECT id, op_id, name, mime, data FROM sourcing_files WHERE id = ?', [toId(params.id)]);
    if (!f) throw new HttpError(404, 'Arquivo não encontrado.');
    await loadOp(user, f.op_id); // mesmo acesso da operação
    const data = Buffer.from(f.data);
    res.writeHead(200, {
      ...securityHeaders, 'Content-Type': f.mime, 'Content-Length': data.length, 'Cache-Control': 'private, max-age=86400',
      'Content-Disposition': `inline; filename="${encodeURIComponent(f.name)}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    });
    res.end(data);
    return RAW;
  });

  // ---------- chat ----------

  function messageOut(m) {
    return {
      id: m.id, user_id: m.user_id ?? null, user_name: m.user_name, body: m.body ?? '',
      file: m.file_id ? { id: m.file_id, url: fileUrl(m.file_id), name: m.file_name, mime: m.file_mime } : null,
      created_at: m.created_at,
    };
  }

  // ?after=<id> devolve só as mensagens novas (o app consulta a cada poucos segundos).
  route('GET', '/api/sourcing/ops/:id/messages', async ({ user, params, query }) => {
    const op = await loadOp(user, params.id);
    const after = Number(query.get('after')) || 0;
    const rows = await db.all(`SELECT m.*, f.name AS file_name, f.mime AS file_mime FROM sourcing_messages m
      LEFT JOIN sourcing_files f ON f.id = m.file_id WHERE m.op_id = ? AND m.id > ? ORDER BY m.id LIMIT 500`, [op.id, after]);
    return rows.map(messageOut);
  });

  route('POST', '/api/sourcing/ops/:id/messages', async ({ user, params, body }) => {
    const op = await loadOp(user, params.id);
    const text = str(body.body, 4000);
    if (!text && !body.file) throw new HttpError(400, 'Escreva a mensagem ou anexe um arquivo.');
    const t = now();
    const id = await db.tx(async (q) => {
      const fileId = body.file ? await saveFile(q, op.id, 'chat', body.file, user.id) : null;
      const row = await q.get(`INSERT INTO sourcing_messages (op_id, user_id, user_name, body, file_id, created_at)
                               VALUES (?, ?, ?, ?, ?, ?) RETURNING id`, [op.id, user.id, user.name, text || null, fileId, t]);
      return row.id;
    });
    const m = await db.get(`SELECT m.*, f.name AS file_name, f.mime AS file_mime FROM sourcing_messages m
      LEFT JOIN sourcing_files f ON f.id = m.file_id WHERE m.id = ?`, [id]);
    return { status: 201, body: messageOut(m) };
  });
}

// Rotas que o operador da China pode usar (o resto do app é da equipe de compras no Brasil).
const OPERATOR_PATHS = /^\/api\/(me|logout|sourcing\/.*|fx\/rates)$/;

module.exports = { registerSourcing, OPERATOR_PATHS, sniffFile, MAX_FILE };
