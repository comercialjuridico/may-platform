const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const { loadRoute, database, withApp } = require('./helpers.cjs');
process.env.JWT_SECRET = 'test-access-key-not-a-real-credential';
process.env.JWT_REFRESH_SECRET = 'test-refresh-key-not-a-real-credential';

function fixture(enabled = true, staleEnabled = enabled) {
  const secret = speakeasy.generateSecret().base32;
  const user = { id: 'alice', email: 'alice@example.invalid', name: 'Alice', plano: 'mensal', totp_enabled: enabled, totp_secret: secret, refresh_token: 'previous-session' };
  const db = database({ users: [user] });
  const router = loadRoute('backend/routes/twofa.js', {
    '../services/supabase': { supabase: db },
    '../middleware/auth': { authMiddleware(req, res, next) { req.user = { id: user.id, email: user.email, totp_enabled: staleEnabled }; next(); } },
    '../middleware/auditLog': { registrarAuditoria: async () => {} },
  });
  return { router, user, db, secret, codigo: () => speakeasy.totp({ secret: user.totp_secret, encoding: 'base32' }), token: () => jwt.sign({ id: 'alice', tipo: '2fa_pendente' }, process.env.JWT_SECRET, { expiresIn: '5m' }) };
}

test('active 2FA setup cannot overwrite the secret, including stale session state', async () => {
  for (const stale of [true, false]) {
    const f = fixture(true, stale);
    await withApp(f.router, async request => assert([400, 409].includes((await request('/setup', {})).status)));
    assert.equal(f.user.totp_secret, f.secret);
  }
});

test('setup and activation require current TOTP and persist verified state', async () => {
  const f = fixture(false);
  await withApp(f.router, async request => {
    assert.equal((await request('/setup', {})).status, 200);
    assert.notEqual(f.user.totp_secret, f.secret);
    assert.equal((await request('/ativar', { codigo: 'abc123' })).status, 400);
    assert.equal(f.user.totp_enabled, false);
    assert.equal((await request('/ativar', { codigo: f.codigo() })).status, 200);
    assert.equal(f.user.totp_enabled, true);
    assert.equal(f.user.refresh_token, null);
  });
});

test('disabling 2FA rejects invalid code and clears secret only on valid code', async () => {
  const f = fixture();
  await withApp(f.router, async request => {
    assert.equal((await request('/desativar', { codigo: 'bad' })).status, 400);
    assert.equal(f.user.totp_enabled, true);
    assert.equal((await request('/desativar', { codigo: f.codigo() })).status, 200);
    assert.equal(f.user.totp_enabled, false); assert.equal(f.user.totp_secret, null);
  });
});

test('second stage rejects access tokens and authenticates only with pending token plus TOTP', async () => {
  const f = fixture();
  await withApp(f.router, async request => {
    const access = jwt.sign({ id: 'alice' }, process.env.JWT_SECRET);
    assert.equal((await request('/validar', { temp_token: access, codigo: f.codigo() })).status, 401);
    const r = await request('/validar', { temp_token: f.token(), codigo: f.codigo() });
    assert.equal(r.status, 200); assert.equal(r.data.user.totp_enabled, true);
    assert(!Object.hasOwn(r.data.user, 'totp_secret')); assert(!Object.hasOwn(r.data.user, 'refresh_token'));
    assert.equal(jwt.verify(r.data.accessToken, process.env.JWT_SECRET).id, 'alice');
  });
});

test('TOTP attempts are limited by verified account even across pending tokens', async () => {
  const f = fixture();
  await withApp(f.router, async request => {
    for (let i = 0; i < 10; i++) {
      const token = jwt.sign({ id: 'alice', tipo: '2fa_pendente', jti: String(i) }, process.env.JWT_SECRET);
      assert.equal((await request('/validar', { temp_token: token, codigo: 'bad' })).status, 400);
    }
    assert.equal((await request('/validar', { temp_token: f.token(), codigo: f.codigo() })).status, 429);
  });
});

test('database failures never claim that 2FA setup succeeded', async () => {
  const f = fixture(false); f.db.error = { message: 'offline' };
  await withApp(f.router, async request => assert.equal((await request('/setup', {})).status, 500));
});
