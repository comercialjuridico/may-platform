// API version explicitamente compatível com stripe-node 16.x.
const API_VERSION = '2024-06-20';
const DAY = 24 * 60 * 60 * 1000;
const PLANS = {
  mensal: { amount: 9700, interval: 'month', priceVars: ['STRIPE_PRICE_MENSAL', 'STRIPE_PRICE_START_MENSAL'] },
  anual: { amount: 93600, interval: 'year', priceVars: ['STRIPE_PRICE_ANUAL', 'STRIPE_PRICE_START_ANUAL'] },
};

function billingError(status, code, message) {
  const e = new Error(message); e.status = status; e.code = code; return e;
}
function planFor(value) {
  if (typeof value !== 'string') return null;
  if (['mensal', 'start_mensal', 'solo_mensal'].includes(value)) return 'mensal';
  if (['anual', 'start_anual', 'solo_anual'].includes(value)) return 'anual';
  return null;
}
function priceFor(plan) { return PLANS[plan]?.priceVars.map(k => process.env[k]).find(Boolean) || null; }
function assertConfigured(stripe, plan) {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET || !priceFor(plan)) {
    throw billingError(503, 'STRIPE_NAO_CONFIGURADO', 'Pagamento indisponível no momento. Entre em contato com o suporte.');
  }
  try {
    const url = new URL(process.env.APP_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw Error();
  } catch { throw billingError(503, 'STRIPE_NAO_CONFIGURADO', 'Pagamento indisponível no momento. Entre em contato com o suporte.'); }
}
function objectId(value) { return typeof value === 'string' ? value : value?.id; }
function assertPrice(price, plan, requireActive = true) {
  const expected = PLANS[plan];
  if (!expected || !price || price.id !== priceFor(plan) || (requireActive && price.active !== true) ||
      price.currency !== 'brl' || price.unit_amount !== expected.amount ||
      price.recurring?.interval !== expected.interval || price.recurring?.interval_count !== 1) {
    throw billingError(503, 'PRECO_DIVERGENTE', 'Este plano está temporariamente indisponível. Entre em contato com o suporte.');
  }
}
function trialEnd(user, now = Date.now()) {
  if (user.periodo_gratis_inicio || user.stripe_subscription_id || user.cielo_recurrent_payment_id || user.plano !== 'free') return null;
  const created = Date.parse(user.created_at);
  if (!Number.isFinite(created) || created > now) return null;
  const end = created + 7 * DAY;
  // Não cria uma segunda semana a partir do checkout.
  return end > now ? Math.floor(end / 1000) : null;
}
function checkoutSubscriptionData(user, now = Date.now()) {
  const end = trialEnd(user, now);
  const metadata = { user_id: user.id, app_trial_end: end ? String(end) : '' };
  if (!end) return { metadata };
  if (end * 1000 <= now + 31 * 60000) throw billingError(409, 'TESTE_FINALIZANDO', 'Seu teste está nos minutos finais. Conclua a assinatura após o término para evitar uma cobrança antecipada.');
  // Checkout exige ao menos 48h em trial_end. Para o final do teste, ancora
  // a primeira cobrança na data original sem cobrar período proporcional.
  if (end * 1000 > now + 2 * DAY + 31 * 60000) return { metadata, trial_end: end };
  return { metadata, billing_cycle_anchor: end, proration_behavior: 'none' };
}

function createBilling({ stripe, supabase }) {
  async function customerFor(user) {
    if (user.stripe_customer_id) {
      const customer = await stripe.customers.retrieve(user.stripe_customer_id);
      if (customer.deleted || customer.metadata?.user_id !== user.id) throw billingError(409, 'CLIENTE_DIVERGENTE', 'Não foi possível conferir sua assinatura. Entre em contato com o suporte.');
      return customer.id;
    }
    const customer = await stripe.customers.create({ email: user.email, name: user.name, metadata: { user_id: user.id } }, { idempotencyKey: `may-customer-${user.id}` });
    const { error } = await supabase.from('users').update({ stripe_customer_id: customer.id }).eq('id', user.id);
    if (error) throw error;
    return customer.id;
  }

  async function checkout(user, selectedPlan) {
    const plan = planFor(selectedPlan);
    if (!plan) throw billingError(400, 'PLANO_INVALIDO', 'Escolha o plano mensal ou anual.');
    assertConfigured(stripe, plan);
    // Não cria outra recorrência enquanto a conta tem vínculo Cielo ou acesso
    // pago ativo por outro provedor. Migração de assinante exige conciliação.
    if (user.cielo_recurrent_payment_id ||
        (user.plano !== 'free' && Date.parse(user.plano_fim) > Date.now() && !user.stripe_subscription_id)) {
      throw billingError(409, 'ASSINATURA_EXISTENTE', 'Você já possui uma assinatura. Gerencie a assinatura atual antes de contratar outra.');
    }
    const price = await stripe.prices.retrieve(priceFor(plan));
    assertPrice(price, plan);
    const customer = await customerFor(user);
    const subscriptions = await stripe.subscriptions.list({ customer, status: 'all', limit: 100 });
    if (subscriptions.has_more || subscriptions.data.some(s => !['canceled', 'incomplete_expired'].includes(s.status))) {
      throw billingError(409, 'ASSINATURA_EXISTENTE', 'Você já possui uma assinatura. Use Gerenciar assinatura para atualizar o pagamento.');
    }
    const recent = await stripe.checkout.sessions.list({ customer, limit: 1 });
    const previous = recent.data[0];
    if (previous?.status === 'open') {
      if (previous.metadata?.user_id !== user.id || previous.metadata?.plano !== plan) throw billingError(409, 'CHECKOUT_ABERTO', 'Já existe um pagamento aberto. Conclua-o ou aguarde até 30 minutos para escolher outro plano.');
      const oldUrl = new URL(previous.url);
      if (oldUrl.protocol !== 'https:' || oldUrl.hostname !== 'checkout.stripe.com') throw billingError(502, 'CHECKOUT_INVALIDO', 'Endereço de pagamento inválido.');
      return { url: previous.url };
    }
    const now = Date.now();
    const subscriptionData = checkoutSubscriptionData(user, now);
    subscriptionData.metadata.plano = plan;
    const origin = new URL(process.env.APP_URL).origin;
    const session = await stripe.checkout.sessions.create({
      customer, client_reference_id: user.id, mode: 'subscription', locale: 'pt-BR',
      expires_at: Math.floor(now / 1000) + 30 * 60,
      payment_method_types: ['card'], line_items: [{ price: price.id, quantity: 1 }],
      success_url: `${origin}/app?pagamento=sucesso&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/app?pagamento=cancelado`,
      metadata: { user_id: user.id, plano: plan }, subscription_data: subscriptionData,
    }, { idempotencyKey: `may-checkout-${user.id}-${previous?.id || 'initial'}` });
    const url = new URL(session.url);
    if (url.protocol !== 'https:' || url.hostname !== 'checkout.stripe.com') throw billingError(502, 'CHECKOUT_INVALIDO', 'Não foi possível abrir o pagamento. Tente novamente.');
    return { url: session.url };
  }

  async function syncSubscription(subscriptionId, customerId, expectedUserId) {
    if (!subscriptionId || !customerId) throw billingError(400, 'ASSINATURA_INVALIDA', 'Assinatura inválida.');
    const { data: user, error } = await supabase.from('users')
      .select('id, plano, plano_status, plano_fim, stripe_customer_id, stripe_subscription_id, cielo_recurrent_payment_id')
      .eq('stripe_customer_id', customerId).maybeSingle();
    if (error) throw error;
    if (!user && !expectedUserId) return { confirmado: false, ignorado: true };
    if (!user || (expectedUserId && user.id !== expectedUserId)) throw billingError(403, 'CLIENTE_DIVERGENTE', 'Pagamento não pertence à sua conta.');
    if (user.stripe_subscription_id && user.stripe_subscription_id !== subscriptionId) return { confirmado: false, ignorado: true };
    if (user.cielo_recurrent_payment_id) throw billingError(409, 'ASSINATURA_EXISTENTE', 'Existe uma assinatura Cielo que precisa ser conferida.');
    // Consulta o estado atual após ler o estado do banco: eventos antigos não
    // reativam assinatura cancelada, e CAS impede sobrescrever outra atualização.
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    if (objectId(subscription.customer) !== customerId || subscription.metadata?.user_id !== user.id) throw billingError(403, 'CLIENTE_DIVERGENTE', 'Assinatura não pertence à conta.');
    const item = subscription.items?.data?.[0];
    const plan = Object.keys(PLANS).find(p => priceFor(p) && item?.price?.id === priceFor(p));
    if (!plan || subscription.items.data.length !== 1 || item.quantity !== 1) throw billingError(409, 'PLANO_DIVERGENTE', 'Plano da assinatura precisa ser conferido pelo suporte.');
    assertPrice(item.price, plan, false);
    const active = ['active', 'trialing'].includes(subscription.status);
    const start = subscription.current_period_start ?? item.current_period_start;
    const end = subscription.status === 'trialing' ? subscription.trial_end : (subscription.current_period_end ?? item.current_period_end);
    if (active && (!Number.isFinite(end) || !Number.isFinite(start))) throw billingError(502, 'PERIODO_INVALIDO', 'Período da assinatura inválido.');
    const paidOrTrial = active && end * 1000 > Date.now();
    const appTrial = Number(subscription.metadata.app_trial_end);
    const inTrial = subscription.status === 'trialing' || (Number.isFinite(appTrial) && appTrial * 1000 > Date.now());
    const updates = {
      stripe_subscription_id: ['canceled', 'incomplete_expired'].includes(subscription.status) ? null : subscription.id,
      plano: paidOrTrial ? plan : 'free',
      plano_status: paidOrTrial ? (subscription.cancel_at_period_end ? 'cancelando' : inTrial ? 'periodo_gratis' : 'ativo') : subscription.status === 'canceled' ? 'cancelado' : 'pagamento_falhou',
      plano_fim: Number.isFinite(end) ? new Date(end * 1000).toISOString() : user.plano_fim,
    };
    if (Number.isFinite(start)) updates.plano_inicio = new Date(start * 1000).toISOString();
    if (Number.isFinite(subscription.created)) updates.periodo_gratis_inicio = new Date(subscription.created * 1000).toISOString();
    let query = supabase.from('users').update(updates).eq('id', user.id).eq('stripe_customer_id', customerId);
    for (const key of ['stripe_subscription_id', 'plano_status', 'plano_fim']) query = user[key] == null ? query.is(key, null) : query.eq(key, user[key]);
    const { data: updated, error: saveError } = await query.select('id').maybeSingle();
    if (saveError) throw saveError;
    if (!updated) throw billingError(503, 'CONCORRENCIA', 'Sua assinatura está sendo atualizada. Tente novamente.');
    return { confirmado: paidOrTrial, status: updates.plano_status };
  }

  async function confirm(user, sessionId) {
    if (typeof sessionId !== 'string' || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw billingError(400, 'SESSAO_INVALIDA', 'Sessão de pagamento inválida.');
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!user.stripe_customer_id || objectId(session.customer) !== user.stripe_customer_id ||
        session.client_reference_id !== user.id || session.metadata?.user_id !== user.id) {
      throw billingError(403, 'CLIENTE_DIVERGENTE', 'Pagamento não pertence à sua conta.');
    }
    if (session.mode !== 'subscription' || session.status !== 'complete' || !['paid', 'no_payment_required'].includes(session.payment_status)) return { confirmado: false, status: 'pendente' };
    return syncSubscription(objectId(session.subscription), user.stripe_customer_id, user.id);
  }

  async function portal(user) {
    if (!stripe || !user.stripe_customer_id) throw billingError(400, 'SEM_ASSINATURA_STRIPE', 'Não há assinatura Stripe nesta conta.');
    await customerFor(user);
    const origin = new URL(process.env.APP_URL).origin;
    const session = await stripe.billingPortal.sessions.create({ customer: user.stripe_customer_id, return_url: `${origin}/app` });
    const url = new URL(session.url);
    if (url.protocol !== 'https:' || url.hostname !== 'billing.stripe.com') throw billingError(502, 'PORTAL_INVALIDO', 'Não foi possível abrir o portal.');
    return session;
  }

  return { checkout, confirm, syncSubscription, portal };
}

module.exports = { API_VERSION, PLANS, planFor, priceFor, assertPrice, checkoutSubscriptionData, createBilling, objectId, billingError };
