'use strict';

// Cliente mínimo da API do Asaas (cobranças por Pix e cartão).
// Variáveis de ambiente:
//   ASAAS_API_KEY        chave da API (painel do Asaas → Integrações)
//   ASAAS_ENV            "production" ou "sandbox" (padrão: deduz pela chave; "_hmlg_" = sandbox)
//   ASAAS_WEBHOOK_TOKEN  token que o Asaas envia no cabeçalho asaas-access-token dos webhooks

class AsaasError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function createAsaas({ apiKey, env, fetchImpl = globalThis.fetch } = {}) {
  if (!apiKey) return null;
  const sandbox = env ? env === 'sandbox' : /_hmlg_/.test(apiKey);
  const base = sandbox ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3';

  async function request(method, path, body) {
    let res;
    try {
      res = await fetchImpl(base + path, {
        method,
        headers: { access_token: apiKey, 'Content-Type': 'application/json', 'User-Agent': 'MissaoChina' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      console.error('Asaas:', err.message);
      throw new AsaasError(502, 'Pagamento indisponível agora. Tente de novo em instantes.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.errors?.map((e) => e.description).join(' ') || `HTTP ${res.status}`;
      console.error('Asaas:', method, path, res.status, msg);
      if (res.status === 401) throw new AsaasError(503, 'Pagamento com chave do Asaas inválida.');
      throw new AsaasError(res.status === 400 ? 400 : 502, `Asaas: ${msg}`);
    }
    return data;
  }

  return {
    sandbox,
    // Só confere se a chave é aceita (consulta o saldo, sem criar nada).
    ping: () => request('GET', '/finance/balance'),
    createCustomer: ({ name, cpfCnpj, email }) => request('POST', '/customers', { name, cpfCnpj, email, notificationDisabled: true }),
    // billingType: PIX ou CREDIT_CARD (o cartão é pago na página segura do Asaas — invoiceUrl).
    createPayment: ({ customer, billingType, value, dueDate, description, externalReference }) =>
      request('POST', '/payments', { customer, billingType, value, dueDate, description, externalReference }),
    getPayment: (id) => request('GET', `/payments/${encodeURIComponent(id)}`),
    pixQrCode: (id) => request('GET', `/payments/${encodeURIComponent(id)}/pixQrCode`),
  };
}

function asaasFromEnv(env = process.env) {
  return createAsaas({ apiKey: env.ASAAS_API_KEY, env: env.ASAAS_ENV });
}

module.exports = { createAsaas, asaasFromEnv, AsaasError };
