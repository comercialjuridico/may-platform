// Notificação é somente um aviso: identidade, valor e estado vêm da API Cielo.
// https://docs.cielo.com.br/ecommerce-cielo/docs/webhook
const crypto = require('crypto');
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function segredoConfere(recebido, esperado) {
  if (!esperado || typeof recebido !== 'string') return false;
  const a = Buffer.from(recebido), b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function falha(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

// Data determinística do período pago, nunca "validade atual + um mês".
// Repetir/reordenar um evento não pode somar períodos de acesso.
function fimPeriodoPago(pagamento, plano) {
  const raw = pagamento.CapturedDate;
  if (typeof raw !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(raw)) throw falha(502, 'Data de captura ausente.');
  // A API pode omitir o offset; datas de sua operação brasileira usam BRT.
  const date = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(raw) ? raw : raw + '-03:00');
  if (!Number.isFinite(date.getTime()) || date.getTime() > Date.now() + 300000) throw falha(502, 'Data de captura inválida.');
  const meses = plano.endsWith('anual') || plano === 'anual' ? 12 : 1;
  const dia = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + meses);
  const ultimoDia = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(dia, ultimoDia));
  return date.toISOString();
}

async function reconciliarCielo(body, { supabase, consultarPagamento, consultarRecorrencia, valorPlano }) {
  const { PaymentId, RecurrentPaymentId } = body;
  const change = Number(body.ChangeType);
  // 3 = antifraude; 7 = chargeback. Nunca significam cancelamento/renovação.
  // Ciclo de recorrência (4) exige fluxo dedicado de conciliação; não concede
  // nem remove acesso com base em uma notificação sem pagamento confirmado.
  if (![1, 2].includes(change)) return { ignorado: true };
  if (typeof PaymentId !== 'string' || !GUID.test(PaymentId)) throw falha(400, 'PaymentId inválido.');
  if (RecurrentPaymentId !== undefined && (typeof RecurrentPaymentId !== 'string' || !GUID.test(RecurrentPaymentId))) {
    throw falha(400, 'RecurrentPaymentId inválido.');
  }

  const result = await consultarPagamento(PaymentId);
  if (result.status === 404) throw falha(400, 'Pagamento não encontrado.');
  if (result.status !== 200 || !result.body?.Payment) throw falha(502, 'Consulta de pagamento indisponível.');
  const pagamento = result.body.Payment;
  if (pagamento.PaymentId?.toLowerCase() !== PaymentId.toLowerCase()) throw falha(400, 'Pagamento divergente.');
  let rpId = pagamento.RecurrentPayment?.RecurrentPaymentId;
  if (rpId && RecurrentPaymentId && rpId.toLowerCase() !== RecurrentPaymentId.toLowerCase()) {
    throw falha(400, 'Recorrência divergente.');
  }
  // Alguns retornos de pagamento não trazem o ID da recorrência. Nesse caso
  // só aceita o vínculo se a consulta da recorrência listar a transação.
  if (!rpId && RecurrentPaymentId) {
    const recorrencia = await consultarRecorrencia(RecurrentPaymentId);
    if (recorrencia.status !== 200 || !recorrencia.body) throw falha(502, 'Consulta de recorrência indisponível.');
    const r = recorrencia.body;
    if (r.RecurrentPaymentId?.toLowerCase() !== RecurrentPaymentId.toLowerCase() ||
        !Array.isArray(r.RecurrentTransactions) || !r.RecurrentTransactions.some(t =>
          t.TransactionId?.toLowerCase() === PaymentId.toLowerCase())) {
      throw falha(400, 'Transação não pertence à recorrência.');
    }
    rpId = r.RecurrentPaymentId;
  }
  if (!rpId || !GUID.test(rpId)) return { ignorado: true };

  const { data: user, error } = await supabase.from('users')
    .select('id, plano, plano_fim, plano_status')
    .eq('cielo_recurrent_payment_id', rpId).maybeSingle();
  if (error) throw error;
  if (!user) return { ignorado: true };
  // Só pagamentos capturados concedem acesso. Falha/estorno/antifraude não
  // pode retirar período pago de outra transação sem conciliação dedicada.
  if (pagamento.Status !== 2) return { ignorado: true };
  if (!Number.isSafeInteger(pagamento.Amount) || pagamento.Amount <= 0 ||
      pagamento.Currency !== 'BRL' || pagamento.Type !== 'CreditCard') {
    throw falha(400, 'Dados do pagamento inválidos.');
  }
  if (user.plano === 'free') return { ignorado: true };
  if (pagamento.Amount !== valorPlano(user.plano)) throw falha(400, 'Valor do plano divergente.');
  // Consulta do pagamento é feita com as credenciais da loja; o vínculo
  // acima usa somente informações comprovadas pelo provedor.
  const fim = fimPeriodoPago(pagamento, user.plano);
  const atual = Date.parse(user.plano_fim);
  if (Number.isFinite(atual) && Date.parse(fim) <= atual) return { repetido: true };
  let query = supabase.from('users').update({
    plano_status: user.plano_status === 'cancelando' ? 'cancelando' : 'ativo',
    plano_fim: fim,
  }).eq('id', user.id).eq('cielo_recurrent_payment_id', rpId);
  // Compare-and-set: uma consulta atrasada não sobrescreve renovação nova.
  query = user.plano_fim ? query.eq('plano_fim', user.plano_fim) : query.is('plano_fim', null);
  const { data: atualizado, error: erroUpdate } = await query
    .eq('plano_status', user.plano_status).select('id').maybeSingle();
  if (erroUpdate) throw erroUpdate;
  if (!atualizado) throw falha(503, 'Assinatura alterada durante conciliação.');
  return { confirmado: true };
}

module.exports = { reconciliarCielo, fimPeriodoPago, segredoConfere };
