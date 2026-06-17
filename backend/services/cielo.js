// ─── Cliente da API Cielo e-Commerce 3.0 ────────────────────────────────────
const https = require('https');

const SANDBOX = process.env.CIELO_SANDBOX !== 'false';

const BASE_URL   = SANDBOX
  ? 'apisandbox.cieloecommerce.cielo.com.br'
  : 'api.cieloecommerce.cielo.com.br';

const QUERY_URL  = SANDBOX
  ? 'apiquerysandbox.cieloecommerce.cielo.com.br'
  : 'apiquery.cieloecommerce.cielo.com.br';

function headers() {
  return {
    'Content-Type':  'application/json',
    'MerchantId':    process.env.CIELO_MERCHANT_ID,
    'MerchantKey':   process.env.CIELO_MERCHANT_KEY,
    'RequestId':     Math.random().toString(36).slice(2),
  };
}

function request(host, method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const h = {
      ...headers(),
      ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
    };
    const req = https.request({ host, path, method, headers: h }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// Detecta bandeira pelo número do cartão
function detectarBandeira(numero) {
  const n = numero.replace(/\D/g, '');
  if (/^4/.test(n))                         return 'Visa';
  if (/^5[1-5]/.test(n))                   return 'Master';
  if (/^3[47]/.test(n))                    return 'Amex';
  if (/^6(?:011|5)/.test(n))               return 'Discover';
  if (/^(?:2131|1800|35)/.test(n))         return 'JCB';
  if (/^3(?:0[0-5]|[68])/.test(n))         return 'Diners';
  if (/^(?:506699|5067|4576|4011)/.test(n)) return 'Elo';
  if (/^(?:60420|60423|60425)/.test(n))    return 'Hipercard';
  return 'Visa'; // fallback
}

// Cria pagamento recorrente (primeira cobrança + configura recorrência automática)
async function criarRecorrencia({ plano, cartao, cliente, userId }) {
  const valores = {
    mensal: parseInt(process.env.CIELO_VALOR_MENSAL) || 9700,  // em centavos
    anual:  parseInt(process.env.CIELO_VALOR_ANUAL)  || 79700,
  };
  const intervalos = { mensal: 'Monthly', anual: 'Annual' };

  const body = {
    MerchantOrderId: `MAY-${userId}-${Date.now()}`,
    Customer: {
      Name:         cliente.nome,
      Email:        cliente.email,
      Identity:     cliente.cpf?.replace(/\D/g, ''),
      IdentityType: 'CPF',
    },
    Payment: {
      Type:         'CreditCard',
      Amount:       valores[plano],
      Currency:     'BRL',
      Country:      'BRA',
      Installments: 1,
      Capture:      true,
      RecurrentPayment: {
        AuthorizeNow: true,
        EndDate:      '2099-12-31',
        Interval:     intervalos[plano],
      },
      CreditCard: {
        CardNumber:     cartao.numero.replace(/\D/g, ''),
        Holder:         cartao.titular,
        ExpirationDate: cartao.validade, // MM/AAAA
        SecurityCode:   cartao.cvv,
        Brand:          detectarBandeira(cartao.numero),
        SaveCard:       false,
      },
    },
  };

  return request(BASE_URL, 'POST', '/1/sales/', body);
}

// Consulta transação pelo PaymentId
async function consultarPagamento(paymentId) {
  return request(QUERY_URL, 'GET', `/1/sales/${paymentId}`, null);
}

// Desativa recorrência (cancela assinatura)
async function cancelarRecorrencia(recurrentPaymentId) {
  return request(BASE_URL, 'PUT', `/1/RecurrentPayment/${recurrentPaymentId}/Deactivate`, null);
}

module.exports = { criarRecorrencia, consultarPagamento, cancelarRecorrencia, detectarBandeira };
