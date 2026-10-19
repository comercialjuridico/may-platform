const { test } = require('node:test');
const assert = require('node:assert/strict');
const { database, loadRoute, withApp } = require('./helpers.cjs');
const { createBilling, checkoutSubscriptionData, assertPrice } = require('../backend/services/stripeBilling');
const { limiteMensagens } = require('../backend/services/limites');
const DAY = 86400000;
process.env.STRIPE_SECRET_KEY = 'sk_test_fixture';
process.env.APP_URL = 'https://may.example';
process.env.STRIPE_PRICE_MENSAL = 'price_month';
process.env.STRIPE_PRICE_ANUAL = 'price_year';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_fixture';
function fixture() {
  const user = { id: 'u1', email: 'a@example.com', name: 'A', plano: 'free', plano_status: 'expirado', plano_fim: null, stripe_customer_id: 'cus_1', stripe_subscription_id: null, cielo_recurrent_payment_id: null, periodo_gratis_inicio: null, created_at: new Date(Date.now()-8*DAY).toISOString() };
  const db = database({ users: [user], subscriptions_log: [] });
  const prices = {
    price_month: { id: 'price_month', active: true, currency: 'brl', unit_amount: 9700, recurring: { interval: 'month', interval_count: 1 } },
    price_year: { id: 'price_year', active: true, currency: 'brl', unit_amount: 93600, recurring: { interval: 'year', interval_count: 1 } },
  };
  const now = Math.floor(Date.now()/1000);
  const sub = { id: 'sub_1', customer: 'cus_1', metadata: { user_id: 'u1' }, status: 'active', created: now, current_period_start: now, current_period_end: now+30*86400, items: { data: [{ price: prices.price_month, quantity: 1 }] } };
  const session = { id: 'cs_test_1', customer: 'cus_1', client_reference_id: 'u1', mode: 'subscription', status: 'complete', payment_status: 'paid', subscription: 'sub_1', metadata: { user_id: 'u1', plano: 'mensal' }, url: 'https://checkout.stripe.com/c/pay/cs_test_1' };
  const calls = []; const subscriptions = []; const sessions = [];
  const stripe = {
    prices: { retrieve: async id => prices[id] },
    customers: { retrieve: async id => ({ id, metadata: { user_id: 'u1' } }), create: async () => ({ id: 'cus_1' }) },
    subscriptions: { list: async () => ({ data: subscriptions, has_more: false }), retrieve: async () => structuredClone(sub), update: async (id, params) => { calls.push(['cancel', id, params]); Object.assign(sub, params); return sub; } },
    checkout: { sessions: { list: async () => ({ data: sessions }), create: async (params, options) => { calls.push(['checkout', params, options]); return session; }, retrieve: async () => session } },
    billingPortal: { sessions: { create: async () => ({ url: 'https://billing.stripe.com/p/session/fixture' }) } },
  };
  return { user, db, prices, sub, session, stripe, calls, subscriptions, sessions, billing: createBilling({ stripe, supabase: db }) };
}
test('hosted checkout uses server price, fixed return origin and short expiry; aliases normalize', async () => {
  const f = fixture(); await f.billing.checkout(f.user, 'start_anual');
  const [, args] = f.calls[0];
  assert.equal(args.line_items[0].price, 'price_year'); assert.equal(args.subscription_data.metadata.plano, 'anual');
  assert.equal(args.success_url, 'https://may.example/app?pagamento=sucesso&session_id={CHECKOUT_SESSION_ID}');
  assert.equal(args.subscription_data.trial_period_days, undefined);
  assert.equal(args.expires_at - Math.floor(Date.now()/1000), 1800);
  assert.equal(JSON.stringify(args).includes('cvv'), false);
});
test('rejects incorrect price, currency or interval before creating checkout', async () => {
  for (const change of [{ unit_amount: 79700 }, { currency: 'usd' }, { active: false }, { recurring: { interval: 'month', interval_count: 1 } }]) {
    const f = fixture(); Object.assign(f.prices.price_year, change);
    await assert.rejects(f.billing.checkout(f.user, 'anual'), { code: 'PRECO_DIVERGENTE' }); assert.equal(f.calls.length, 0);
  }
});
test('preserves original trial end, including the last 48h, and never charges in its last minutes', () => {
  const now = Date.now(); const user = fixture().user;
  for (const elapsed of [DAY, 6*DAY]) {
    user.created_at = new Date(now-elapsed).toISOString(); const data = checkoutSubscriptionData(user, now);
    assert.equal(data.trial_end || data.billing_cycle_anchor, Math.floor((now-elapsed+7*DAY)/1000));
    if (elapsed === 6*DAY) assert.equal(data.proration_behavior, 'none');
  }
  user.created_at = new Date(now-7*DAY+600000).toISOString();
  assert.throws(() => checkoutSubscriptionData(user, now), { code: 'TESTE_FINALIZANDO' });
  user.created_at = new Date(now-DAY).toISOString(); user.periodo_gratis_inicio = new Date(now-DAY).toISOString();
  assert.equal(checkoutSubscriptionData(user, now).trial_end, undefined);
});
test('blocks Cielo overlap, active/pending Stripe subscription and repeated trial', async () => {
  const f = fixture(); f.user.cielo_recurrent_payment_id = 'rec_1';
  await assert.rejects(f.billing.checkout(f.user, 'mensal'), { code: 'ASSINATURA_EXISTENTE' });
  f.user.cielo_recurrent_payment_id = null; f.subscriptions.push({ status: 'incomplete' });
  await assert.rejects(f.billing.checkout(f.user, 'mensal'), { code: 'ASSINATURA_EXISTENTE' });
});
test('reuses existing checkout and gives competing plans the same idempotency key', async () => {
  const f = fixture(); await f.billing.checkout(f.user, 'mensal'); await f.billing.checkout(f.user, 'anual');
  assert.equal(f.calls[0][2].idempotencyKey, f.calls[1][2].idempotencyKey);
  f.sessions.push({ ...f.session, status: 'open' });
  assert.equal((await f.billing.checkout(f.user, 'mensal')).url, f.session.url);
  await assert.rejects(f.billing.checkout(f.user, 'anual'), { code: 'CHECKOUT_ABERTO' });
  assert.equal(f.calls.length, 2);
});
test('never continues after customer mismatch or database write failure', async () => {
  const f = fixture(); f.stripe.customers.retrieve = async () => ({ id: 'cus_1', metadata: { user_id: 'u2' } });
  await assert.rejects(f.billing.checkout(f.user, 'mensal'), { code: 'CLIENTE_DIVERGENTE' });
  f.user.stripe_customer_id = null; f.db.error = { code: 'offline' };
  await assert.rejects(f.billing.checkout(f.user, 'mensal')); assert.equal(f.calls.length, 0);
});
test('success URL alone or another account session never activates access', async () => {
  const f = fixture(); f.session.status = 'open';
  assert.equal((await f.billing.confirm(f.user, f.session.id)).confirmado, false);
  assert.equal(f.user.plano, 'free'); f.session.status = 'complete'; f.session.client_reference_id = 'u2';
  await assert.rejects(f.billing.confirm(f.user, f.session.id), { status: 403 }); assert.equal(f.user.plano, 'free');
});
test('confirmation grants provider period once; repeats and old events never add days', async () => {
  const f = fixture(); assert.equal((await f.billing.confirm(f.user, f.session.id)).confirmado, true);
  const end = f.user.plano_fim; await f.billing.syncSubscription('sub_1', 'cus_1'); assert.equal(f.user.plano_fim, end);
  f.sub.status = 'canceled'; await f.billing.syncSubscription('sub_1', 'cus_1');
  assert.equal(f.user.plano, 'free'); assert.equal(f.user.stripe_subscription_id, null);
  await f.billing.syncSubscription('sub_1', 'cus_1'); assert.equal(f.user.plano, 'free');
  f.user.stripe_subscription_id = 'sub_new'; f.user.plano = 'mensal';
  assert.equal((await f.billing.syncSubscription('sub_1', 'cus_1')).ignorado, true); assert.equal(f.user.plano, 'mensal');
});
test('payment failure revokes access; recovery restores it using current provider status', async () => {
  const f = fixture(); f.sub.status = 'past_due'; await f.billing.syncSubscription('sub_1', 'cus_1');
  assert.equal(f.user.plano, 'free'); assert.equal(f.user.plano_status, 'pagamento_falhou');
  f.sub.status = 'active'; await f.billing.syncSubscription('sub_1', 'cus_1'); assert.equal(f.user.plano, 'mensal');
});
test('concurrent database changes cannot be overwritten by a stale subscription sync', async () => {
  const f = fixture(); f.stripe.subscriptions.retrieve = async () => { f.user.stripe_subscription_id = 'sub_other'; return f.sub; };
  await assert.rejects(f.billing.syncSubscription('sub_1', 'cus_1'), { code: 'CONCORRENCIA' }); assert.equal(f.user.plano, 'free');
});
test('archived price remains synchronizable for existing customers; expired trial has no unlimited messages', async () => {
  const f = fixture(); f.prices.price_month.active = false;
  await f.billing.syncSubscription('sub_1', 'cus_1'); assert.equal(f.user.plano, 'mensal');
  const now = Date.now(); f.user.created_at = new Date(now-DAY).toISOString(); f.user.plano_status = 'cancelando';
  assert.equal(limiteMensagens(f.user, now), null);
  f.user.created_at = new Date(now-8*DAY).toISOString(); assert.equal(limiteMensagens(f.user, now), 500);
});
test('cancel route verifies ownership and provider success; provider failure is not success', async () => {
  const f = fixture(); f.user.stripe_subscription_id = 'sub_1';
  const router = loadRoute('backend/routes/stripe.js', {
    stripe: function() { return f.stripe; }, '../services/supabase': { supabase: f.db },
    '../middleware/auth': { authMiddleware(req, res, next) { req.user = f.user; next(); } },
  });
  await withApp(router, async request => {
    f.sub.metadata.user_id = 'u2'; assert.equal((await request('/cancel', {})).status, 403);
    assert.equal(f.calls.length, 0); f.sub.metadata.user_id = 'u1';
    f.stripe.subscriptions.update = async () => { throw Error('provider offline'); };
    assert.equal((await request('/cancel', {})).status, 502); assert.notEqual(f.user.plano_status, 'cancelando');
    f.stripe.subscriptions.update = async () => { f.sub.cancel_at_period_end = true; };
    assert.equal((await request('/cancel', {})).status, 200); assert.equal(f.user.plano_status, 'cancelando');
  });
});
test('Stripe is optional at startup and missing billing config fails closed', async () => {
  const f = fixture(); await assert.rejects(createBilling({ stripe: null, supabase: f.db }).checkout(f.user, 'mensal'), { status: 503 });
  const old = process.env.APP_URL; process.env.APP_URL = 'https://may.example/evil';
  try { await assert.rejects(f.billing.checkout(f.user, 'mensal'), { status: 503 }); } finally { process.env.APP_URL = old; }
});
test('signed webhooks use current subscription state and store only minimal audit data', async () => {
  const Stripe = require('stripe'); const f = fixture(); f.stripe.webhooks = Stripe.webhooks;
  const router = loadRoute('backend/routes/stripe.js', {
    stripe: function() { return f.stripe; }, '../services/supabase': { supabase: f.db },
    '../middleware/auth': { authMiddleware(req, res, next) { req.user = f.user; next(); } },
  });
  await withApp(router, async request => {
    for (const type of ['customer.subscription.created', 'checkout.session.completed', 'invoice.payment_failed', 'invoice.payment_succeeded']) {
      const object = type.startsWith('customer.') ? f.sub : { customer: 'cus_1', subscription: 'sub_1', email: 'sensitive@example.com' };
      const event = { id: 'evt_' + type, type, data: { object } };
      const sig = Stripe.webhooks.generateTestHeaderString({ payload: JSON.stringify(event), secret: process.env.STRIPE_WEBHOOK_SECRET });
      assert.equal((await request('/webhook', event, { 'stripe-signature': sig })).status, 200);
      assert.equal(f.user.plano, 'mensal'); // old failure event cannot override current paid state
    }
  }, (req, res, next) => { req.rawBody = JSON.stringify(req.body); next(); });
  assert.equal(f.db.tables.subscriptions_log.length, 4);
  assert.equal(JSON.stringify(f.db.tables.subscriptions_log).includes('sensitive@'), false);
});
test('Cielo cancellation checks provider response and preserves paid period; old checkout is disabled', async () => {
  const f = fixture(); f.user.cielo_recurrent_payment_id = 'rp_1'; f.user.plano = 'mensal'; f.user.plano_status = 'ativo'; f.user.plano_fim = new Date(Date.now()+DAY).toISOString();
  let status = 500;
  const router = loadRoute('backend/routes/cielo.js', {
    '../services/supabase': { supabase: f.db },
    '../middleware/auth': { authMiddleware(req, res, next) { req.user = f.user; next(); } },
    '../services/cielo': { cancelarRecorrencia: async () => ({ status }) },
  });
  await withApp(router, async request => {
    assert.equal((await request('/checkout', { plano: 'mensal' })).status, 410);
    assert.equal((await request('/pre-validar', {})).status, 410);
    assert.equal((await request('/cancelar', {})).status, 502); assert.equal(f.user.plano_status, 'ativo');
    status = 204; assert.equal((await request('/cancelar', {})).status, 200);
    assert.equal(f.user.plano, 'mensal'); assert.equal(f.user.plano_status, 'cancelando');
    assert.equal(f.user.cielo_recurrent_payment_id, 'rp_1'); // no second provider until reconciliation
  });
});
