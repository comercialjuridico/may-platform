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

// Tabela de planos: valor (centavos) e intervalo Cielo
const PLANOS = {
  start_mensal:  { valor:  9700,  intervalo: 'Monthly' },
  start_anual:   { valor: 93600,  intervalo: 'Annual'  }, // R$78 × 12
  equipe_mensal: { valor: 22700,  intervalo: 'Monthly' },
  equipe_anual:  { valor: 218400, intervalo: 'Annual'  }, // R$182 × 12
  pro_mensal:    { valor: 39700,  intervalo: 'Monthly' },
  pro_anual:     { valor: 381600, intervalo: 'Annual'  }, // R$318 × 12
  prof_mensal:   { valor: 89700,  intervalo: 'Monthly' },
  prof_anual:    { valor: 861600, intervalo: 'Annual'  }, // R$718 × 12
  // legado
  mensal: { valor: 9700,  intervalo: 'Monthly' },
  anual:  { valor: 93600, intervalo: 'Annual'  },
};

// Calcula data de início do trial (hoje + 7 dias) no formato YYYY-MM-DD
function dataTrialFim() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

// Cria recorrência COM 7 dias por nossa conta:
// cartão cadastrado agora, primeira cobrança em D+7 (AuthorizeNow: false)
async function criarRecorrencia({ plano, cartao, cliente, userId, comPeriodoGratis = true }) {
  const cfg = PLANOS[plano];
  if (!cfg) throw new Error(`Plano desconhecido: ${plano}`);

  // Sem credencial não adianta chamar a Cielo: ela recusa e o erro chega
  // ao usuário como "cartão não autorizado", escondendo o problema real.
  if (!process.env.CIELO_MERCHANT_ID || !process.env.CIELO_MERCHANT_KEY) {
    throw new Error('CIELO_NAO_CONFIGURADA: falta CIELO_MERCHANT_ID e/ou CIELO_MERCHANT_KEY no ambiente.');
  }

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
      Amount:       cfg.valor,
      Currency:     'BRL',
      Country:      'BRA',
      Installments: 1,
      Capture:      true,
      RecurrentPayment: {
        AuthorizeNow:        !comPeriodoGratis,   // false = sem cobrança imediata
        EndDate:             '2099-12-31',
        Interval:            cfg.intervalo,
        ...(comPeriodoGratis ? { StartRecurrentDate: dataTrialFim() } : {}),
      },
      CreditCard: {
        CardNumber:     cartao.numero.replace(/\D/g, ''),
        Holder:         cartao.titular,
        ExpirationDate: cartao.validade,
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

function cieloStatus() {
  return {
    configurada: !!(process.env.CIELO_MERCHANT_ID && process.env.CIELO_MERCHANT_KEY),
    ambiente:    SANDBOX ? 'sandbox' : 'producao',
  };
}

module.exports = { criarRecorrencia, consultarPagamento, cancelarRecorrencia, detectarBandeira , cieloStatus };
