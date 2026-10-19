const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadRoute, database, withApp } = require('./helpers.cjs');
process.env.STRIPE_SECRET_KEY = 'sk_test_fixture';
process.env.STRIPE_PRICE_MENSAL = 'price_month';
process.env.STRIPE_PRICE_ANUAL = 'price_year';
function router(retrieve, db) {
  return loadRoute('backend/routes/stripe.js', {
    stripe: function() { return { prices: { retrieve } }; },
    '../services/supabase': { supabase: db },
    '../middleware/auth': { authMiddleware(req, res, next) { next(); } },
  });
}
test('price query returns actual provider values instead of hardcoded annual fallback', async () => {
  const db = database({}); const calls = [];
  await withApp(router(async id => { calls.push(id); return { unit_amount: id === 'price_month' ? 9700 : 93600 }; }, db), async request => {
    const res = await request('/precos'); assert.equal(res.status, 200);
    assert.deepEqual(res.data, { mensal: '97.00', anual: '936.00' });
  });
  assert.equal(calls.length, 2); assert.equal(db.events.length, 0);
});
test('provider failures return controlled diagnostic category with HTTP503 and no fake prices', async () => {
  const original = console.error; console.error = () => {};
  try {
    for (const [statusCode, codigo] of [[401, 'STRIPE_AUTENTICACAO'], [403, 'STRIPE_SEM_PERMISSAO'], [404, 'STRIPE_PRECO_NAO_ENCONTRADO'], [500, 'STRIPE_INDISPONIVEL'], [undefined, 'STRIPE_INDISPONIVEL']]) {
      const db = database({});
      await withApp(router(async () => { throw Object.assign(new Error('provider failure'), { statusCode }); }, db), async request => {
        const res = await request('/precos'); assert.equal(res.status, 503); assert.equal(res.data.codigo, codigo);
        assert.equal(res.data.mensal, undefined); assert.equal(res.data.anual, undefined);
      });
      assert.equal(db.events.length, 0);
    }
  } finally { console.error = original; }
});
test('sensitive error messages and provider payloads never reach response or logs', async () => {
  const secret = 'sk_live_SENSITIVE_FIXTURE_NOT_A_REAL_KEY'; const messages = [];
  const original = console.error; console.error = (...args) => messages.push(args);
  try {
    const db = database({});
    await withApp(router(async () => { throw Object.assign(new Error('Invalid key ' + secret), { statusCode: 401, code: secret, raw: { secret } }); }, db), async request => {
      const res = await request('/precos'); assert.equal(JSON.stringify(res.data).includes(secret), false);
    });
    assert.equal(JSON.stringify(messages).includes(secret), false);
    assert.equal(messages[0][1].codigo, 'STRIPE_AUTENTICACAO');
  } finally { console.error = original; }
});
