const { test } = require('node:test');
const assert = require('node:assert/strict');
const { database, loadRoute, withApp } = require('./helpers.cjs');

function routeFixture(path, tables, acting = { id: 'alice', empresa_id: 'firm-a', role: 'membro' }) {
  const db = database(tables);
  const router = loadRoute(path, {
    '../services/supabase': { supabase: db },
    '../middleware/auth': { authMiddleware(req, res, next) { req.user = acting; next(); } },
    openai: class { constructor() { this.chat = { completions: { create() { throw Error('Unexpected AI call'); } } }; } },
  });
  return { db, router };
}

test('follow-up update and delete never alter a colleague or another firm', async () => {
  const f = routeFixture('backend/routes/followups.js', {
    followups: [
      { id: 'own', empresa_id: 'firm-a', usuario_id: 'alice', concluido: false },
      { id: 'colleague', empresa_id: 'firm-a', usuario_id: 'bob', concluido: false },
      { id: 'foreign', empresa_id: 'firm-b', usuario_id: 'carol', concluido: false },
    ],
  });
  await withApp(f.router, async request => {
    for (const id of ['colleague', 'foreign', 'missing']) {
      assert.equal((await request('/' + id, { concluido: true }, {}, 'PATCH')).status, 404);
      assert.equal((await request('/' + id, {}, {}, 'DELETE')).status, 404);
    }
    assert.equal((await request('/own', { concluido: true }, {}, 'PATCH')).status, 200);
    assert.equal((await request('/own', {}, {}, 'DELETE')).status, 200);
  });
  assert.equal(f.db.tables.followups.length, 2);
  assert.equal(f.db.tables.followups.find(x => x.id === 'colleague').concluido, false);
  assert.equal(f.db.tables.followups.find(x => x.id === 'foreign').concluido, false);
});

test('lead status and edit updates require company ownership', async () => {
  const f = routeFixture('backend/routes/leads.js', {
    leads: [
      { id: 'own', empresa_id: 'firm-a', nome_lead: 'Own', status: 'novo', sdr_id: 'alice' },
      { id: 'foreign', empresa_id: 'firm-b', nome_lead: 'Private', status: 'novo', sdr_id: 'carol' },
    ], vendas: [],
  });
  await withApp(f.router, async request => {
    assert.equal((await request('/foreign/status', { status: 'ganhou', valor_fechado: 3000 }, {}, 'PATCH')).status, 404);
    assert.equal((await request('/foreign', { nome_lead: 'Tampered' }, {}, 'PATCH')).status, 404);
    assert.equal((await request('/foreign', {}, {}, 'DELETE')).status, 404);
    assert.equal((await request('/own/status', { status: 'ganhou', valor_fechado: 3000 }, {}, 'PATCH')).status, 200);
  });
  assert.equal(f.db.tables.leads.find(l => l.id === 'foreign').nome_lead, 'Private');
  assert.equal(f.db.tables.leads.find(l => l.id === 'foreign').status, 'novo');
  assert.equal(f.db.tables.vendas.length, 1);
  assert.equal(f.db.tables.vendas[0].empresa_id, 'firm-a');
});

test('lead deletion grants creator, not unrelated member, and scopes deletion by firm', async () => {
  const f = routeFixture('backend/routes/leads.js', {
    leads: [
      { id: 'colleague', empresa_id: 'firm-a', sdr_id: 'bob' },
      { id: 'own', empresa_id: 'firm-a', sdr_id: 'alice' },
      { id: 'foreign', empresa_id: 'firm-b', sdr_id: 'alice' },
    ],
  });
  await withApp(f.router, async request => {
    assert.equal((await request('/colleague', {}, {}, 'DELETE')).status, 403);
    assert.equal((await request('/foreign', {}, {}, 'DELETE')).status, 404);
    assert.equal((await request('/own', {}, {}, 'DELETE')).status, 200);
  });
  assert.equal(f.db.tables.leads.length, 2);
});

test('briefing feedback and regeneration cannot mutate a lead in another firm', async () => {
  const f = routeFixture('backend/routes/briefing.js', {
    leads: [{ id: 'foreign', empresa_id: 'firm-b', nome_lead: 'Private', status: 'novo', contexto: 'private' }],
  });
  await withApp(f.router, async request => {
    assert.equal((await request('/foreign/feedback', { nota: 5, resultado: 'fechou' })).status, 404);
    assert.equal((await request('/foreign/regerar', { contexto_extra: 'x' })).status, 404);
  });
  assert.equal(f.db.tables.leads[0].status, 'novo');
  assert.equal(f.db.tables.leads[0].briefing_nota, undefined);
});
