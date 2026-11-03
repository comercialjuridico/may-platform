const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { loadRoute, database, withApp } = require('./helpers.cjs');
const { hashRefreshToken, refreshTokenConfere } = require('../backend/services/sessionTokens');

process.env.JWT_SECRET = 'session-access-test-key';
process.env.JWT_REFRESH_SECRET = 'session-refresh-test-key';

function fixture(user) {
  const db = database({ users: [user] });
  const router = loadRoute('backend/routes/auth.js', {
    '../services/supabase': { supabase: db },
    '../middleware/auditLog': { registrarAuditoria: async () => {} },
    resend: { Resend: class { constructor() { this.emails = { send: async () => ({ data: { id: 'ok' } }) }; } } },
  });
  return { db, router };
}

test('refresh verifiers are hashed and do not match other tokens', () => {
  const token = 'test-jwt-token';
  assert.equal(hashRefreshToken(token).startsWith('sha256:'), true);
  assert.notEqual(hashRefreshToken(token), token);
  assert.equal(refreshTokenConfere(hashRefreshToken(token), token), true);
  assert.equal(refreshTokenConfere(hashRefreshToken(token), 'another'), false);
  assert.equal(refreshTokenConfere(token, token), true); // legacy migration
  assert.equal(refreshTokenConfere(null, token), false);
  assert.equal(refreshTokenConfere(token, {}), false);
});

test('login persists only a hashed refresh verifier and issues distinct tokens', async () => {
  const password_hash = await bcrypt.hash('test-password-1', 4);
  const f = fixture({ id: 'alice', email: 'alice@example.invalid', password_hash, plano: 'mensal', totp_enabled: false });
  let first, second;
  await withApp(f.router, async request => {
    first = await request('/login', { email: 'alice@example.invalid', password: 'test-password-1' });
    second = await request('/login', { email: 'alice@example.invalid', password: 'test-password-1' });
  });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.notEqual(first.data.refreshToken, second.data.refreshToken);
  assert.equal(f.db.tables.users[0].refresh_token, hashRefreshToken(second.data.refreshToken));
});

test('refresh rotates once, rejects replay and keeps the previous session invalidated', async () => {
  const old = jwt.sign({ id: 'alice', jti: 'old-unique-id' }, process.env.JWT_REFRESH_SECRET);
  const f = fixture({ id: 'alice', email: 'alice@example.invalid', plano: 'mensal', refresh_token: hashRefreshToken(old) });
  let next;
  await withApp(f.router, async request => {
    next = await request('/refresh', { refreshToken: old });
    assert.equal(next.status, 200);
    assert.equal((await request('/refresh', { refreshToken: old })).status, 401);
    assert.equal((await request('/refresh', { refreshToken: 123 })).status, 400);
    assert.equal((await request('/refresh', { refreshToken: next.data.refreshToken })).status, 200);
  });
  assert.notEqual(next.data.refreshToken, old);
  assert.notEqual(f.db.tables.users[0].refresh_token, old);
});

test('legacy plaintext refresh verifier is migrated to a hash at first rotation', async () => {
  const old = jwt.sign({ id: 'alice' }, process.env.JWT_REFRESH_SECRET);
  const f = fixture({ id: 'alice', email: 'alice@example.invalid', plano: 'mensal', refresh_token: old });
  await withApp(f.router, async request => {
    const r = await request('/refresh', { refreshToken: old });
    assert.equal(r.status, 200);
    assert.equal(f.db.tables.users[0].refresh_token, hashRefreshToken(r.data.refreshToken));
    assert.equal((await request('/refresh', { refreshToken: old })).status, 401);
  });
});

test('a concurrent refresh update fails closed if the session changed before commit', async () => {
  const old = jwt.sign({ id: 'alice', jti: 'initial' }, process.env.JWT_REFRESH_SECRET);
  const f = fixture({ id: 'alice', email: 'alice@example.invalid', plano: 'mensal', refresh_token: hashRefreshToken(old) });
  // Simulate a revocation after the initial lookup and before conditional update.
  const originalFrom = f.db.from.bind(f.db);
  let reads = 0;
  f.db.from = table => {
    const query = originalFrom(table);
    if (table === 'users') {
      const originalSingle = query.single.bind(query);
      query.single = () => {
        reads++;
        const pending = originalSingle();
        if (reads === 1) return pending.then(value => {
          f.db.tables.users[0].refresh_token = 'revoked-by-another-request';
          return value;
        });
        return pending;
      };
    }
    return query;
  };
  await withApp(f.router, async request => {
    assert.equal((await request('/refresh', { refreshToken: old })).status, 401);
  });
});
