// Checkout hospedado: dados de cartão permanecem no Stripe.
const express = require('express');
const router = express.Router();
const Stripe = require('stripe');
const { supabase } = require('../services/supabase');
const { authMiddleware } = require('../middleware/auth');
const { API_VERSION, createBilling, objectId, assertPrice, priceFor } = require('../services/stripeBilling');
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: API_VERSION, maxNetworkRetries: 2 }) : null;
const billing = createBilling({ stripe, supabase });

function fail(res, error) {
  console.error('Falha Stripe:', Number.isInteger(error.statusCode) ? error.statusCode : 'operacao');
  const safe = error.billingError === true && Number.isInteger(error.status) && error.status >= 400 && error.status < 600;
  return res.status(safe ? error.status : 502).json({ erro: safe ? error.message : 'Não foi possível concluir a operação. Tente novamente ou contate o suporte.' });
}
router.post('/checkout', authMiddleware, async (req, res) => {
  try { res.json(await billing.checkout(req.user, req.body.plano)); } catch (e) { fail(res, e); }
});
router.post('/confirmar', authMiddleware, async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ erro: 'Pagamento indisponível.' });
    res.json(await billing.confirm(req.user, req.body.session_id));
  } catch (e) { fail(res, e); }
});
router.post('/portal', authMiddleware, async (req, res) => {
  try { const session = await billing.portal(req.user); res.json({ url: session.url }); } catch (e) { fail(res, e); }
});
router.get('/precos', async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ erro: 'Pagamento indisponível.' });
    for (const plan of ['mensal', 'anual']) assertPrice(await stripe.prices.retrieve(priceFor(plan)), plan);
    res.json({ mensal: '97.00', anual: '936.00' });
  } catch (err) {
    const status = Number.isInteger(err?.statusCode) ? err.statusCode : null;
    const codigo = status === 401 ? 'STRIPE_AUTENTICACAO'
      : status === 403 ? 'STRIPE_SEM_PERMISSAO'
      : status === 404 ? 'STRIPE_PRECO_NAO_ENCONTRADO' : 'STRIPE_INDISPONIVEL';
    console.error('Falha na consulta de preços Stripe:', { codigo, status });
    res.status(503).json({ erro: 'Não foi possível consultar os planos de pagamento.', codigo });
  }
});
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(503).json({ erro: 'Pagamento indisponível.' });
  let event;
  try { event = stripe.webhooks.constructEvent(req.rawBody || req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET); }
  catch { return res.status(400).json({ erro: 'Webhook inválido.' }); }
  try {
    const obj = event.data.object;
    let subId, customerId;
    if (['customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'customer.subscription.paused', 'customer.subscription.resumed'].includes(event.type)) {
      subId = obj.id; customerId = objectId(obj.customer);
    } else if (['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'invoice.paid', 'invoice.payment_succeeded', 'invoice.payment_failed'].includes(event.type)) {
      subId = objectId(obj.subscription) || objectId(obj.parent?.subscription_details?.subscription);
      customerId = objectId(obj.customer);
    }
    // Cada tentativa consulta o estado atual no provedor. Repetição e entrega
    // fora de ordem não acrescentam dias nem confiam no status do evento antigo.
    const checkoutEvent = event.type.startsWith('checkout.session.');
    const checkoutPaid = ['paid', 'no_payment_required'].includes(obj.payment_status);
    if (subId && (!checkoutEvent || checkoutPaid)) await billing.syncSubscription(subId, customerId);
    const { error } = await supabase.from('subscriptions_log').insert({
      stripe_event: event.type, processado: true,
      payload: { id: event.id, type: event.type, subscription_id: subId || null },
    });
    if (error) throw error;
    res.json({ recebido: true });
  } catch (e) { fail(res, e); }
});
router.post('/cancel', authMiddleware, async (req, res) => {
  try {
    const user = req.user;
    if (!stripe || !user.stripe_subscription_id || !user.stripe_customer_id || user.cielo_recurrent_payment_id) return res.status(400).json({ erro: 'Nenhuma assinatura Stripe encontrada.' });
    const sub = await stripe.subscriptions.retrieve(user.stripe_subscription_id);
    if (objectId(sub.customer) !== user.stripe_customer_id || sub.metadata?.user_id !== user.id) return res.status(403).json({ erro: 'Assinatura não pertence à sua conta.' });
    await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });
    await billing.syncSubscription(sub.id, user.stripe_customer_id, user.id);
    // Feedback não impede cancelamento já confirmado pelo provedor.
    try { await supabase.from('cancelamentos_feedback').insert({
      user_id: user.id, email: user.email, plano: user.plano,
      motivo: String(req.body.motivo || 'Não informado').slice(0, 200),
      detalhes: String(req.body.detalhes || '').slice(0, 2000) || null,
      criado_em: new Date().toISOString(),
    }); } catch { /* Feedback indisponível não desfaz cancelamento confirmado. */ }
    res.json({ ok: true, mensagem: 'Renovação cancelada. Você mantém acesso até o fim do período atual.' });
  } catch (e) { fail(res, e); }
});
module.exports = router;
