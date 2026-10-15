const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadRoute, database, withApp } = require('./helpers.cjs');

function fixture() {
  const db = database({ conversations: [
    { id: 'own', user_id: 'alice' }, { id: 'foreign', user_id: 'bob' },
  ], messages: [
    ...Array.from({ length: 30 }, (_, i) => ({ conversation_id: 'own', user_id: 'alice', role: 'user', content: `msg-${i}`, created_at: i })),
    { conversation_id: 'foreign', user_id: 'bob', role: 'user', content: 'PRIVATE', created_at: 0 },
    { conversation_id: 'own', user_id: 'bob', role: 'user', content: 'INCONSISTENT', created_at: 31 },
  ] });
  const calls = [];
  class OpenAI { constructor() { this.chat = { completions: { create: async args => {
    calls.push(args); return (async function* () { yield { choices: [{ delta: { content: 'safe' } }] }; })();
  } } }; } }
  const router = loadRoute('backend/routes/chat.js', {
    openai: OpenAI, '../services/supabase': { supabase: db },
    '../middleware/auth': { authMiddleware(req, res, next) { req.user = { id: 'alice' }; next(); }, verificarLimite(req, res, next) { next(); } },
    '../services/may': { buildSystemPrompt: () => 'test' },
  });
  return { db, calls, router };
}

test('foreign/missing conversations are denied before SSE, mutation or AI', async () => {
  const f = fixture();
  await withApp(f.router, async request => {
    for (const id of ['foreign', 'missing']) {
      const r = await request('/stream', { mensagem: 'hi', conversa_id: id });
      assert.equal(r.status, 404); assert.match(r.type, /application\/json/);
    }
  });
  assert.equal(f.calls.length, 0);
  assert(!f.db.events.some(e => e.op !== 'read' || e.table === 'messages'));
});

test('database authorization failure fails closed', async () => {
  const f = fixture(); f.db.error = { code: '08006', message: 'offline' };
  await withApp(f.router, async request => assert.equal((await request('/stream', { mensagem: 'hi', conversa_id: 'own' })).status, 503));
  assert.equal(f.calls.length, 0);
});

test('owned chat uses latest messages in chronological order and excludes other users', async () => {
  const f = fixture();
  await withApp(f.router, async request => {
    const r = await request('/stream', { mensagem: 'current', conversa_id: 'own' });
    assert.equal(r.status, 200); assert.match(r.data, /"tipo":"fim"/);
  });
  const messages = f.calls[0].messages;
  assert.equal(messages[1].content, 'msg-10');
  assert.equal(messages[20].content, 'msg-29');
  assert.equal(messages[21].content, 'current');
  assert(!messages.some(m => ['PRIVATE', 'INCONSISTENT'].includes(m.content)));
});

test('new conversation still streams and records only the authenticated owner', async () => {
  const f = fixture();
  await withApp(f.router, async request => {
    const r = await request('/stream', { mensagem: 'new conversation' });
    assert.equal(r.status, 200); assert.match(r.data, /conversa_criada/);
  });
  assert.equal(f.db.tables.conversations.at(-1).user_id, 'alice');
  assert.equal(f.db.tables.messages.at(-1).user_id, 'alice');
});

test('invalid and oversized message types are rejected without calling AI', async () => {
  const f = fixture();
  await withApp(f.router, async request => {
    for (const mensagem of [null, 1, {}, ' ', 'x'.repeat(50001)]) assert.equal((await request('/stream', { mensagem })).status, 400);
  });
  assert.equal(f.calls.length, 0);
});
