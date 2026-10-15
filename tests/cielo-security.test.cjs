const { test } = require('node:test');
const assert = require('node:assert/strict');
const { reconciliarCielo, fimPeriodoPago, segredoConfere } = require('../backend/services/cieloWebhook');
const { database, loadRoute, withApp } = require('./helpers.cjs');
const pay = '11111111-1111-4111-8111-111111111111';
const rp = '22222222-2222-4222-8222-222222222222';
const other = '33333333-3333-4333-8333-333333333333';

function fixture() {
  const user = { id: 'alice', plano: 'start_mensal', plano_fim: '2026-08-01T00:00:00.000Z', plano_status: 'ativo', cielo_recurrent_payment_id: rp };
  const payment = { PaymentId: pay, RecurrentPayment: { RecurrentPaymentId: rp }, Status: 2, Type: 'CreditCard', Currency: 'BRL', Amount: 9700, CapturedDate: '2026-09-01T00:00:00Z' };
  const db = database({ users: [user] });
  const deps = { supabase: db, consultarPagamento: async () => ({ status: 200, body: { Payment: payment } }), consultarRecorrencia: async () => ({ status: 200, body: { RecurrentPaymentId: rp, RecurrentTransactions: [{ TransactionId: pay }] } }), valorPlano: () => 9700 };
  return { user, payment, db, deps, body: { ChangeType: 1, PaymentId: pay, RecurrentPaymentId: rp } };
}

test('forged antifraud/cancel-like and chargeback events cannot change an account', async () => {
  const f = fixture();
  for (const ChangeType of [3, 4, 7, 25]) await reconciliarCielo({ ...f.body, ChangeType }, f.deps);
  assert.equal(f.db.events.length, 0);
});

test('notifier cannot bind another recurrence to a genuine payment', async () => {
  const f = fixture();
  await assert.rejects(reconciliarCielo({ ...f.body, RecurrentPaymentId: other }, f.deps), /divergente/);
  assert(!f.db.events.some(e => e.op === 'update'));
});

test('absent payment recurrence must be proved by provider transaction membership', async () => {
  const f = fixture(); delete f.payment.RecurrentPayment;
  await reconciliarCielo(f.body, f.deps);
  assert.equal(f.user.plano_fim, '2026-10-01T00:00:00.000Z');
  f.deps.consultarRecorrencia = async () => ({ status: 200, body: { RecurrentPaymentId: other, RecurrentTransactions: [] } });
  await assert.rejects(reconciliarCielo(f.body, f.deps), /não pertence/);
});

test('replays and older payments never add another paid period', async () => {
  const f = fixture();
  assert.equal((await reconciliarCielo(f.body, f.deps)).confirmado, true);
  const end = f.user.plano_fim;
  assert.equal((await reconciliarCielo(f.body, f.deps)).repetido, true);
  f.payment.CapturedDate = '2026-08-01T00:00:00Z';
  assert.equal((await reconciliarCielo(f.body, f.deps)).repetido, true);
  assert.equal(f.user.plano_fim, end);
});

test('rejected payment and incorrect amount cannot grant paid access', async () => {
  const f = fixture();
  f.payment.Status = 3; await reconciliarCielo(f.body, f.deps);
  assert.equal(f.user.plano_fim, '2026-08-01T00:00:00.000Z');
  f.payment.Status = 2; f.payment.Amount = 1;
  await assert.rejects(reconciliarCielo(f.body, f.deps), /Valor/);
});

test('provider failure or divergent payment identifier fails closed', async () => {
  const f = fixture();
  f.payment.PaymentId = other;
  await assert.rejects(reconciliarCielo(f.body, f.deps), /Pagamento divergente/);
  f.deps.consultarPagamento = async () => ({ status: 503 });
  await assert.rejects(reconciliarCielo(f.body, f.deps), /indisponível/);
  assert(!f.db.events.some(e => e.op === 'update'));
});

test('period calculation clamps month end and rejects missing capture date', () => {
  assert.equal(fimPeriodoPago({ CapturedDate: '2026-01-31T00:00:00Z' }, 'mensal'), '2026-02-28T00:00:00.000Z');
  assert.equal(fimPeriodoPago({ CapturedDate: '2024-02-29T00:00:00Z' }, 'anual'), '2025-02-28T00:00:00.000Z');
  assert.throws(() => fimPeriodoPago({}, 'mensal'));
});

test('configured Cielo secret is mandatory and empty secrets never match', async () => {
  assert.equal(segredoConfere(undefined, undefined), false);
  assert.equal(segredoConfere('wrong', 'expected'), false);
  assert.equal(segredoConfere('expected', 'expected'), true);
  const f = fixture(); process.env.CIELO_WEBHOOK_SECRET = 'test-only-secret';
  const router = loadRoute('backend/routes/cielo.js', {
    '../services/supabase': { supabase: f.db }, '../middleware/auth': { authMiddleware(req, res, next) { next(); } },
    '../services/cielo': { ...f.deps },
  });
  try {
    await withApp(router, async request => {
      assert.equal((await request('/webhook', f.body)).status, 401);
      assert.equal((await request('/webhook', f.body, { 'x-cielo-webhook-secret': 'test-only-secret' })).status, 200);
    });
  } finally { delete process.env.CIELO_WEBHOOK_SECRET; }
});
