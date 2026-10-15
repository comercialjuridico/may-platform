const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { loadRoute, database, withApp } = require('./helpers.cjs');
process.env.JWT_SECRET = 'test-access-key';
process.env.JWT_REFRESH_SECRET = 'test-refresh-key';

function fixture(tables) {
  const db = database(tables);
  const router = loadRoute('backend/routes/auth.js', {
    '../services/supabase': { supabase: db },
    '../middleware/auditLog': { registrarAuditoria: async () => {} },
    resend: { Resend: class { constructor() { this.emails = { send: async () => ({ data: { id: 'mail' } }) }; } } },
  });
  return { db, router };
}

test('invites reject wrong email, expiry, invalid expiry and reuse before account creation', async () => {
  for (const change of [
    { email: 'other@example.invalid' }, { expires_at: '2000-01-01T00:00:00Z' }, { expires_at: null }, { aceito: true },
  ]) {
    const invite = { id: 'inv', token: 'invite-token', email: 'alice@example.invalid', empresa_id: 'company', expires_at: '2099-01-01T00:00:00Z', aceito: false, ...change };
    const f = fixture({ users: [], convites: [invite] });
    await withApp(f.router, async request => {
      assert.equal((await request('/register', { name: 'Alice', email: 'alice@example.invalid', password: 'test-password', convite_token: 'invite-token' })).status, 400);
    });
    assert.equal(f.db.tables.users.length, 0);
  }
});

test('valid invitation still creates the intended company membership', async () => {
  const f = fixture({ users: [], convites: [{ id: 'inv', token: 'valid', email: 'alice@example.invalid', empresa_id: 'company', expires_at: '2099-01-01T00:00:00Z', aceito: false }] });
  await withApp(f.router, async request => {
    assert.equal((await request('/register', { name: 'Alice', email: 'alice@example.invalid', password: 'test-password', convite_token: 'valid' })).status, 201);
  });
  assert.equal(f.db.tables.users[0].empresa_id, 'company');
  assert.equal(f.db.tables.convites[0].aceito, true);
});

test('password reset revokes refresh token and consumes reset token exactly once', async () => {
  const user = { id: 'alice', reset_token: 'reset', reset_token_exp: '2099-01-01T00:00:00.000Z', password_hash: 'old', refresh_token: 'old-session' };
  const f = fixture({ users: [user] });
  await withApp(f.router, async request => {
    assert.equal((await request('/reset-password', { token: 'reset', password: 'new-password' })).status, 200);
    assert.equal(user.refresh_token, null); assert.equal(user.reset_token, null);
    assert.equal(await bcrypt.compare('new-password', user.password_hash), true);
    assert.equal((await request('/reset-password', { token: 'reset', password: 'another-password' })).status, 400);
  });
});

test('invalid reset expiry cannot change password', async () => {
  const user = { id: 'alice', reset_token: 'reset', reset_token_exp: 'invalid', password_hash: 'old' };
  const f = fixture({ users: [user] });
  await withApp(f.router, async request => assert.equal((await request('/reset-password', { token: 'reset', password: 'new-password' })).status, 400));
  assert.equal(user.password_hash, 'old');
});
