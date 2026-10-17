'use strict';

// Créditos do intérprete (pré-pagos, por empresa/CNPJ) e compra pelo Asaas (Pix ou cartão).
//
// - O saldo é a soma do extrato (credit_ledger), em segundos de áudio traduzido.
// - Compra: cria a cobrança no Asaas; o crédito entra quando o Asaas confirma o pagamento
//   (webhook PAYMENT_CONFIRMED / PAYMENT_RECEIVED). O app também confere a cobrança direto no
//   Asaas quando o usuário está na tela de pagamento, sem depender só do webhook.
// - Cada pagamento credita uma única vez (credited_at), mesmo com webhooks repetidos.
// - O administrador vê o saldo de todas as empresas, dá créditos de cortesia e define os pacotes.

const crypto = require('node:crypto');
const { wavInfo, InterpreterError, LANGS, MAX_SECONDS } = require('./interpreter');
const { AsaasError } = require('./asaas');

const DEFAULT_PACKAGES = [
  { id: 'p60', minutes: 60, price: 29 },
  { id: 'p180', minutes: 180, price: 79 },
];
const PAID = ['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH'];
const REVERSED = ['REFUNDED', 'CHARGEBACK_REQUESTED', 'CHARGEBACK_DISPUTE'];

function safeEqual(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

function registerCredits({ route, db, HttpError, str, num, now, toId, isAdmin, asaas, interpret, webhookToken, getCompany }) {
  const requireAdmin = (u) => { if (!isAdmin(u)) throw new HttpError(403, 'Apenas administradores.'); };

  async function balance(cnpj) {
    const row = await db.get('SELECT COALESCE(SUM(seconds), 0) AS s FROM credit_ledger WHERE cnpj = ?', [cnpj]);
    return Number(row?.s || 0);
  }

  async function packages() {
    const row = await db.get("SELECT value FROM app_settings WHERE key = 'interpreter_packages'");
    try {
      const list = row?.value ? JSON.parse(row.value) : null;
      if (Array.isArray(list) && list.length) return list;
    } catch { /* volta ao padrão */ }
    return DEFAULT_PACKAGES;
  }

  function paymentOut(p) {
    return {
      id: p.id, package_id: p.package_id, minutes: Number(p.minutes), value: Number(p.value), method: p.method,
      status: p.status, paid: Boolean(p.credited_at), invoice_url: p.invoice_url ?? null,
      pix: p.pix_payload ? { payload: p.pix_payload, image: p.pix_image, expires_at: p.pix_expires_at } : null,
      created_at: p.created_at, credited_at: p.credited_at ?? null,
    };
  }

  // Atualiza a cobrança com o status do Asaas e credita (uma vez) quando paga.
  async function applyStatus(p, status) {
    const t = now();
    await db.run('UPDATE credit_payments SET status = ?, updated_at = ? WHERE id = ?', [status, t, p.id]);
    if (PAID.includes(status) && !p.credited_at) {
      await db.tx(async (q) => {
        // Só credita se ainda não creditou (protege contra dois webhooks ao mesmo tempo).
        const r = await q.run('UPDATE credit_payments SET credited_at = ? WHERE id = ? AND credited_at IS NULL', [t, p.id]);
        if (!r.changes) return;
        await q.run(`INSERT INTO credit_ledger (cnpj, user_id, seconds, kind, payment_id, note, created_at)
                     VALUES (?, ?, ?, 'purchase', ?, ?, ?)`,
        [p.cnpj, p.user_id, Number(p.minutes) * 60, p.id, `Compra de ${p.minutes} min (${p.method === 'pix' ? 'Pix' : 'cartão'})`, t]);
      });
    } else if (REVERSED.includes(status) && p.credited_at) {
      await db.tx(async (q) => {
        const done = await q.get("SELECT 1 AS x FROM credit_ledger WHERE payment_id = ? AND kind = 'refund'", [p.id]);
        if (done) return;
        await q.run(`INSERT INTO credit_ledger (cnpj, user_id, seconds, kind, payment_id, note, created_at)
                     VALUES (?, ?, ?, 'refund', ?, ?, ?)`, [p.cnpj, p.user_id, -Number(p.minutes) * 60, p.id, `Estorno da compra (${status})`, t]);
      });
    }
    return db.get('SELECT * FROM credit_payments WHERE id = ?', [p.id]);
  }

  async function syncPayment(p) {
    if (!asaas || !p.asaas_id) return p;
    const remote = await asaas.getPayment(p.asaas_id);
    return remote?.status && remote.status !== p.status ? applyStatus(p, remote.status) : p;
  }

  const wrapAsaas = (fn) => fn().catch((err) => { if (err instanceof AsaasError) throw new HttpError(err.status, err.message); throw err; });

  // ---------- saldo, extrato e pacotes ----------

  route('GET', '/api/credits', async ({ user }) => {
    const [bal, ledger, pkgs, pending] = await Promise.all([
      balance(user.cnpj),
      db.all(`SELECT l.*, u.name AS user_name FROM credit_ledger l LEFT JOIN users u ON u.id = l.user_id
              WHERE l.cnpj = ? ORDER BY l.id DESC LIMIT 100`, [user.cnpj]),
      packages(),
      db.all("SELECT * FROM credit_payments WHERE cnpj = ? AND credited_at IS NULL AND status = 'PENDING' ORDER BY id DESC LIMIT 5", [user.cnpj]),
    ]);
    return {
      balance_seconds: bal,
      packages: pkgs,
      payments_enabled: Boolean(asaas),
      interpreter_enabled: Boolean(interpret),
      ledger: ledger.map((l) => ({
        id: l.id, seconds: Number(l.seconds), kind: l.kind, note: l.note ?? null, user_name: l.user_name ?? null, created_at: l.created_at,
      })),
      pending: pending.map(paymentOut),
    };
  });

  // ---------- compra pelo Asaas ----------

  route('POST', '/api/credits/checkout', async ({ user, body }) => {
    if (!asaas) throw new HttpError(503, 'Pagamento não configurado (defina ASAAS_API_KEY na Vercel).');
    const pkg = (await packages()).find((p) => p.id === body.package_id);
    if (!pkg) throw new HttpError(400, 'Pacote inválido.');
    const method = body.method === 'card' ? 'card' : 'pix';
    const company = await getCompany(user.cnpj);

    // Cliente do Asaas = a empresa (CNPJ), criado uma vez.
    let customer = company.asaas_customer_id;
    if (!customer) {
      const c = await wrapAsaas(() => asaas.createCustomer({ name: company.name || user.name, cpfCnpj: company.cnpj, email: user.email }));
      customer = c.id;
      await db.run('UPDATE companies SET asaas_customer_id = ? WHERE cnpj = ?', [customer, company.cnpj]);
    }
    const t = now();
    const row = await db.get(`INSERT INTO credit_payments (cnpj, user_id, package_id, minutes, value, method, status, created_at, updated_at)
                              VALUES (?, ?, ?, ?, ?, ?, 'PENDING', ?, ?) RETURNING *`,
    [company.cnpj, user.id, pkg.id, pkg.minutes, pkg.price, method, t, t]);
    try {
      const pay = await wrapAsaas(() => asaas.createPayment({
        customer, billingType: method === 'card' ? 'CREDIT_CARD' : 'PIX', value: Number(pkg.price),
        dueDate: new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10),
        description: `Missão China — ${pkg.minutes} minutos de intérprete`, externalReference: `credit-${row.id}`,
      }));
      let pix = null;
      if (method === 'pix') pix = await wrapAsaas(() => asaas.pixQrCode(pay.id));
      await db.run(`UPDATE credit_payments SET asaas_id = ?, status = ?, invoice_url = ?, pix_payload = ?, pix_image = ?, pix_expires_at = ?, updated_at = ?
                    WHERE id = ?`, [pay.id, pay.status || 'PENDING', pay.invoiceUrl || null, pix?.payload || null, pix?.encodedImage || null,
        pix?.expirationDate || null, now(), row.id]);
    } catch (err) {
      await db.run("UPDATE credit_payments SET status = 'FAILED', updated_at = ? WHERE id = ?", [now(), row.id]);
      throw err;
    }
    return { status: 201, body: paymentOut(await db.get('SELECT * FROM credit_payments WHERE id = ?', [row.id])) };
  });

  // Consulta a cobrança (a tela de pagamento chama a cada poucos segundos até confirmar).
  route('GET', '/api/credits/payments/:id', async ({ user, params }) => {
    let p = await db.get('SELECT * FROM credit_payments WHERE id = ? AND cnpj = ?', [toId(params.id), user.cnpj]);
    if (!p) throw new HttpError(404, 'Pagamento não encontrado.');
    if (!p.credited_at) p = await wrapAsaas(() => syncPayment(p)).catch(() => p);
    return { ...paymentOut(p), balance_seconds: await balance(user.cnpj) };
  });

  // Webhook do Asaas: confere o token e, por segurança, relê a cobrança na API antes de creditar.
  route('POST', '/api/asaas/webhook', async ({ req, body }) => {
    if (!webhookToken || !safeEqual(req.headers['asaas-access-token'], webhookToken)) throw new HttpError(401, 'Token inválido.');
    const id = body?.payment?.id;
    if (!id) return { ok: true };
    const p = await db.get('SELECT * FROM credit_payments WHERE asaas_id = ?', [String(id)]);
    if (!p) return { ok: true, ignored: true }; // cobrança que não é deste app
    try {
      await syncPayment(p);
    } catch (err) {
      // Responde 200 mesmo assim (o Asaas pausa a fila após erros); a tela de pagamento confere de novo.
      console.error('Webhook Asaas:', err.message);
    }
    return { ok: true };
  }, { pub: true });

  // ---------- intérprete (cobra os segundos de áudio) ----------

  route('POST', '/api/interpreter', async ({ user, body }) => {
    if (!interpret) throw new HttpError(503, 'Intérprete não configurado (defina AZURE_SPEECH_KEY e AZURE_SPEECH_REGION na Vercel).');
    const from = String(body.from || '');
    const to = String(body.to || '');
    if (!LANGS[from] || !LANGS[to] || from === to) throw new HttpError(400, 'Idiomas inválidos.');
    const m = /^data:audio\/(?:wav|x-wav|wave);base64,([A-Za-z0-9+/=]+)$/.exec(String(body.audio || ''));
    if (!m) throw new HttpError(400, 'Áudio inválido.');
    const wav = Buffer.from(m[1], 'base64');
    const info = wavInfo(wav);
    if (!info || info.seconds <= 0) throw new HttpError(400, 'Áudio inválido.');
    if (info.seconds > MAX_SECONDS + 1) throw new HttpError(400, `Fale no máximo ${MAX_SECONDS} segundos por vez.`);
    const seconds = Math.max(1, Math.ceil(info.seconds));
    const bal = await balance(user.cnpj);
    if (bal < seconds) throw new HttpError(402, 'Créditos do intérprete insuficientes. Compre mais minutos em Conta → Créditos do intérprete.');

    let out;
    try {
      out = await interpret(wav, from, to);
    } catch (err) {
      if (err instanceof InterpreterError) throw new HttpError(err.status, err.message);
      throw err;
    }
    // Só cobra quando houve fala reconhecida.
    if (out.source) {
      await db.run(`INSERT INTO credit_ledger (cnpj, user_id, seconds, kind, note, created_at) VALUES (?, ?, ?, 'usage', ?, ?)`,
        [user.cnpj, user.id, -seconds, `Intérprete ${LANGS[from].label} → ${LANGS[to].label}`, now()]);
    }
    return {
      source: out.source, translated: out.translated,
      audio: out.audio ? `data:audio/mpeg;base64,${out.audio.toString('base64')}` : null,
      charged_seconds: out.source ? seconds : 0,
      balance_seconds: await balance(user.cnpj),
    };
  });

  // ---------- administração ----------

  route('GET', '/api/admin/credits', async ({ user }) => {
    requireAdmin(user);
    const [rows, pkgs, payments] = await Promise.all([
      db.all(`SELECT c.cnpj, c.name,
          COALESCE((SELECT SUM(l.seconds) FROM credit_ledger l WHERE l.cnpj = c.cnpj), 0) AS balance,
          COALESCE((SELECT -SUM(l.seconds) FROM credit_ledger l WHERE l.cnpj = c.cnpj AND l.kind = 'usage'), 0) AS used,
          COALESCE((SELECT SUM(p.value) FROM credit_payments p WHERE p.cnpj = c.cnpj AND p.credited_at IS NOT NULL), 0) AS paid
        FROM companies c ORDER BY lower(COALESCE(c.name, c.cnpj))`),
      packages(),
      db.all(`SELECT p.*, c.name AS company_name FROM credit_payments p LEFT JOIN companies c ON c.cnpj = p.cnpj
              WHERE p.status <> 'FAILED' ORDER BY p.id DESC LIMIT 50`),
    ]);
    return {
      companies: rows.map((r) => ({ cnpj: r.cnpj, name: r.name, balance_seconds: Number(r.balance), used_seconds: Number(r.used), paid: Number(r.paid) })),
      packages: pkgs,
      payments: payments.map((p) => ({ ...paymentOut(p), cnpj: p.cnpj, company_name: p.company_name ?? null })),
      payments_enabled: Boolean(asaas), sandbox: Boolean(asaas?.sandbox), interpreter_enabled: Boolean(interpret),
      webhook_configured: Boolean(webhookToken),
    };
  });

  // Créditos de cortesia (ou correção, com minutos negativos).
  route('POST', '/api/admin/credits/grant', async ({ user, body }) => {
    requireAdmin(user);
    const company = await getCompany(String(body.cnpj || ''));
    if (!company) throw new HttpError(404, 'Empresa não encontrada.');
    const minutes = num(body.minutes, 'os minutos', { required: true, min: -100000 });
    if (!Number.isInteger(minutes) || minutes === 0 || Math.abs(minutes) > 100000) throw new HttpError(400, 'Minutos inválidos.');
    await db.run(`INSERT INTO credit_ledger (cnpj, user_id, seconds, kind, note, created_at) VALUES (?, ?, ?, 'grant', ?, ?)`,
      [company.cnpj, user.id, minutes * 60, str(body.note, 200) || (minutes > 0 ? 'Cortesia' : 'Ajuste'), now()]);
    return { ok: true, balance_seconds: await balance(company.cnpj) };
  });

  route('PUT', '/api/admin/credits/packages', async ({ user, body }) => {
    requireAdmin(user);
    const list = Array.isArray(body.packages) ? body.packages : [];
    if (!list.length || list.length > 6) throw new HttpError(400, 'Informe de 1 a 6 pacotes.');
    const clean = list.map((p, i) => {
      const minutes = num(p.minutes, `os minutos do pacote ${i + 1}`, { required: true, integer: true, min: 1 });
      const price = num(p.price, `o preço do pacote ${i + 1}`, { required: true, min: 1 });
      return { id: `p${minutes}`, minutes, price: Math.round(price * 100) / 100 };
    });
    if (new Set(clean.map((p) => p.id)).size !== clean.length) throw new HttpError(400, 'Dois pacotes com os mesmos minutos.');
    await db.run(`INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ('interpreter_packages', ?, ?, ?)
                  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    [JSON.stringify(clean), user.id, now()]);
    return { packages: clean };
  });
}

module.exports = { registerCredits, DEFAULT_PACKAGES };
