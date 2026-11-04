// Retenção, camadas 1 a 3: memória do escritório, retorno do cliente e resumo
// de segunda. Banco, IA, e-mail e push simulados; nenhum dado real.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { loadRoute, database, withApp } = require('./helpers.cjs');
const memoriaSvc = require('../backend/services/memoria');
const retencao = require('../backend/services/retencao');

const DIA = 86400000;
const ativo = (id, extra = {}) => ({ id, empresa_id: 'emp-' + id, name: 'Ana Teste', email: `${id}@example.com`, plano: 'free', plano_status: null, created_at: new Date(Date.now() - DIA).toISOString(), ...extra });
const vencido = (id, extra = {}) => ativo(id, { created_at: new Date(Date.now() - 30 * DIA).toISOString(), ...extra });
const authCom = user => ({ authMiddleware(req, res, next) { req.user = { ...user }; next(); }, verificarLimite(req, res, next) { next(); } });

async function req(router, method, url, body) {
  let out;
  const express = require('express');
  const app = express(); app.use(express.json()); app.use(router);
  const server = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    out = { status: res.status, data };
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
  return out;
}

// ─── Camada 1: serviço da memória ───────────────────────────────────────────
test('memória: limpa campos, corta tamanhos e ignora o que não é da memória', () => {
  const m = memoriaSvc.limparMemoria({
    servicos: 'x'.repeat(5000), empresa_id: 'outra', atualizado_por: 'hacker',
    objecoes: [{ texto: 'Vou pensar', resposta: 'ok' }, { texto: '' }, 'lixo'],
    scripts: Array.from({ length: 40 }, (_, i) => ({ titulo: 'T' + i, texto: 'texto' })),
  });
  assert.equal(m.servicos.length, 2000);
  assert.equal(m.empresa_id, undefined); assert.equal(m.atualizado_por, undefined);
  assert.deepEqual(m.objecoes, [{ texto: 'Vou pensar', resposta: 'ok' }]);
  assert.equal(m.scripts.length, 30);
});

test('memória: bloco do prompt traz os dados, proíbe inventar e tem teto de tamanho', () => {
  assert.equal(memoriaSvc.textoMemoria(null), '');
  const t = memoriaSvc.textoMemoria({ servicos: 'Aposentadoria rural', honorarios: '30% do retroativo', objecoes: [{ texto: 'Está caro', resposta: 'Explico o retroativo' }], scripts: [] });
  assert.match(t, /Aposentadoria rural/); assert.match(t, /30% do retroativo/); assert.match(t, /Está caro/);
  assert.match(t, /Não invente/);
  const grande = memoriaSvc.textoMemoria({ scripts: Array.from({ length: 30 }, (_, i) => ({ titulo: 'S' + i, texto: 'y'.repeat(2000) })) });
  assert(grande.length <= 6100);
});

test('memória: entra no system prompt de toda ferramenta, inclusive simulação', () => {
  const { buildSystemPrompt } = require('../backend/services/may');
  for (const f of ['chat', 'simular_reuniao', 'criador_scripts']) {
    const p = buildSystemPrompt({ diagnostico_completo: false }, f, null, { servicos: 'Revisão da vida toda' });
    assert.match(p, /MEMÓRIA DO ESCRITÓRIO/, f); assert.match(p, /Revisão da vida toda/, f);
  }
  assert.doesNotMatch(buildSystemPrompt({}, 'chat', null, null), /MEMÓRIA DO ESCRITÓRIO/);
});

test('memória: sugestões não repetem, têm teto e só aceitam campos conhecidos', () => {
  const limpas = memoriaSvc.limparSugestoes([{ campo: 'objecao', texto: 'Vou pensar' }, { campo: 'cpf', texto: '123' }, { campo: 'servicos', texto: '' }]);
  assert.deepEqual(limpas.map(s => s.campo), ['objecao']);
  const j = memoriaSvc.juntarSugestoes([{ campo: 'objecao', texto: 'Vou pensar' }], [{ campo: 'objecao', texto: 'VOU PENSAR' }, { campo: 'servicos', texto: 'BPC' }]);
  assert.equal(j.length, 2);
  const novo = memoriaSvc.aplicarSugestao({ servicos: 'Aposentadoria', objecoes: [] }, { campo: 'servicos', texto: 'BPC' });
  assert.equal(novo.servicos, 'Aposentadoria\nBPC');
});

// ─── Camada 1: rota /api/memoria ────────────────────────────────────────────
function memoriaRouter(user, tabelas = {}) {
  const db = database({ memoria_escritorio: [], users: [{ id: user.id, ritual_semanal: true }], ...tabelas });
  return { db, router: loadRoute('backend/routes/memoria.js', { '../services/supabase': { supabase: db }, '../middleware/auth': authCom(user) }) };
}

test('rota memória: salva no escritório da conta, mesmo se o corpo tentar outro', async () => {
  const f = memoriaRouter(ativo('a'));
  const r = await req(f.router, 'PUT', '/', { servicos: 'BPC/LOAS', empresa_id: 'emp-b', objecoes: [{ texto: 'Está caro' }] });
  assert.equal(r.status, 200);
  assert.equal(f.db.tables.memoria_escritorio.length, 1);
  assert.equal(f.db.tables.memoria_escritorio[0].empresa_id, 'emp-a');
  assert.equal(r.data.memoria.servicos, 'BPC/LOAS');
  assert(r.data.completude > 0);
});

test('rota memória: um escritório não lê a memória de outro', async () => {
  const f = memoriaRouter(ativo('b'), { memoria_escritorio: [{ empresa_id: 'emp-a', servicos: 'SEGREDO', objecoes: [], scripts: [], sugestoes: [] }] });
  const r = await req(f.router, 'GET', '/');
  assert.equal(r.status, 200);
  assert.equal(r.data.memoria.servicos, '');
  assert(!JSON.stringify(r.data).includes('SEGREDO'));
});

test('rota memória: sugestão aprovada entra na memória; descartada some', async () => {
  const f = memoriaRouter(ativo('c'), { memoria_escritorio: [{ empresa_id: 'emp-c', objecoes: [], scripts: [],
    sugestoes: [{ campo: 'objecao', texto: 'Vou falar com meu marido' }, { campo: 'servicos', texto: 'Auxílio-doença' }] }] });
  let r = await req(f.router, 'POST', '/sugestoes/0');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.memoria.objecoes.map(o => o.texto), ['Vou falar com meu marido']);
  assert.equal(r.data.sugestoes.length, 1);
  r = await req(f.router, 'DELETE', '/sugestoes/0');
  assert.equal(r.data.sugestoes.length, 0);
  assert.equal(r.data.memoria.servicos, '');
  assert.equal((await req(f.router, 'POST', '/sugestoes/9')).status, 404);
});

test('rota memória: liga e desliga o resumo de segunda só da própria conta', async () => {
  const f = memoriaRouter(ativo('d'));
  f.db.tables.users.push({ id: 'outra', ritual_semanal: true });
  assert.equal((await req(f.router, 'PUT', '/ritual', { ativo: 'sim' })).status, 400);
  assert.equal((await req(f.router, 'PUT', '/ritual', { ativo: false })).status, 200);
  assert.equal(f.db.tables.users.find(u => u.id === 'd').ritual_semanal, false);
  assert.equal(f.db.tables.users.find(u => u.id === 'outra').ritual_semanal, true);
});

// ─── Camada 1: memória no chat e no briefing ────────────────────────────────
function chatRouter(user, { mensagens = [], ferramenta } = {}) {
  const calls = [], prompts = [];
  class OpenAI { constructor() { this.chat = { completions: { create: async args => {
    calls.push(args);
    if (args.response_format) return { choices: [{ message: { content: JSON.stringify({ sugestoes: [{ campo: 'honorarios', texto: 'Cobra 30% do retroativo' }] }) } }] };
    return (async function* () { yield { choices: [{ delta: { content: 'ok' } }] }; })();
  } } }; } }
  const db = database({
    conversations: [{ id: 'conv', user_id: user.id, ferramenta: ferramenta || 'chat' }],
    messages: mensagens.map((c, i) => ({ conversation_id: 'conv', user_id: user.id, role: i % 2 ? 'assistant' : 'user', content: c, created_at: i })),
    uploads: [],
    memoria_escritorio: [{ empresa_id: user.empresa_id, servicos: 'Aposentadoria especial', objecoes: [], scripts: [], sugestoes: [] }],
  });
  const router = loadRoute('backend/routes/chat.js', {
    openai: OpenAI, '../services/supabase': { supabase: db }, '../middleware/auth': authCom(user),
    '../services/may': { buildSystemPrompt: (u, f, a, m) => { prompts.push(m); return 'test'; } },
  });
  return { calls, prompts, db, router };
}

const esperar = ms => new Promise(r => setTimeout(r, ms));

test('chat: usa a memória do escritório e aprende a cada 6 mensagens, aguardando aprovação', async () => {
  const anteriores = Array.from({ length: 10 }, (_, i) => `m${i}`); // 5 do usuário + 5 da May
  const f = chatRouter(ativo('chat1'), { mensagens: anteriores });
  await withApp(f.router, async request => {
    assert.equal((await request('/stream', { mensagem: 'cobro 30% do retroativo', conversa_id: 'conv' })).status, 200);
  });
  await esperar(50);
  assert.equal(f.prompts[0].servicos, 'Aposentadoria especial');
  const extracoes = f.calls.filter(c => c.response_format);
  assert.equal(extracoes.length, 1);
  const mem = f.db.tables.memoria_escritorio[0];
  assert.equal(mem.sugestoes[0].texto, 'Cobra 30% do retroativo');
  assert.equal(mem.honorarios, undefined, 'sugestão não entra na memória sem aprovação');
});

test('chat: simulação não alimenta a memória (cliente fictício)', async () => {
  const f = chatRouter(ativo('chat2'), { mensagens: Array.from({ length: 10 }, (_, i) => `m${i}`), ferramenta: 'simular_reuniao' });
  await withApp(f.router, async request => {
    await request('/stream', { mensagem: 'encerrar simulação', conversa_id: 'conv', ferramenta: 'simular_reuniao' });
  });
  await esperar(50);
  assert.equal(f.calls.filter(c => c.response_format).length, 0);
});

// ─── Camada 2: retorno do cliente ───────────────────────────────────────────
function briefingRouter(user, leads = [], memoria = []) {
  const calls = [];
  class OpenAI { constructor() { this.chat = { completions: { create: async args => { calls.push(args); return { choices: [{ message: { content: 'BRIEFING' } }] }; } } }; } }
  const db = database({ leads, memoria_escritorio: memoria });
  const router = loadRoute('backend/routes/briefing.js', { openai: OpenAI, '../services/supabase': { supabase: db }, '../middleware/auth': authCom(user) });
  return { calls, db, router };
}

test('briefing: usa a memória do escritório no prompt', async () => {
  const u = ativo('brf-mem');
  const f = briefingRouter(u, [], [{ empresa_id: u.empresa_id, honorarios: 'Entrada de R$ 500 e 30% no final', objecoes: [], scripts: [] }]);
  const r = await req(f.router, 'POST', '/', { nome_lead: 'Cliente Fictício' });
  assert.equal(r.status, 200);
  assert.match(f.calls[0].messages[0].content, /Entrada de R\$ 500/);
});

test('briefing: feedback grava próximo passo e data; nova data reabre o lembrete', async () => {
  const u = ativo('brf-ret');
  const f = briefingRouter(u, [{ id: 'l1', empresa_id: u.empresa_id, closer_id: u.id, briefing: 'x', retorno_concluido: true, retorno_lembrado_em: '2026-01-01' }]);
  const quando = new Date(Date.now() + 2 * DIA).toISOString();
  const r = await req(f.router, 'POST', '/l1/feedback', { nota: 4, resultado: 'negociando', proximo_passo: 'Enviar proposta', data_retorno: quando });
  assert.equal(r.status, 200);
  const l = f.db.tables.leads[0];
  assert.equal(l.proximo_passo, 'Enviar proposta'); assert.equal(l.data_retorno, quando);
  assert.equal(l.retorno_concluido, false); assert.equal(l.retorno_lembrado_em, null);
});

test('briefing: data inválida, longe demais ou concluído com tipo errado são recusados', async () => {
  const u = ativo('brf-val');
  const f = briefingRouter(u, [{ id: 'l1', empresa_id: u.empresa_id, closer_id: u.id, briefing: 'x' }]);
  assert.equal((await req(f.router, 'PATCH', '/l1', { data_retorno: 'amanhã' })).status, 400);
  assert.equal((await req(f.router, 'PATCH', '/l1', { data_retorno: new Date(Date.now() + 400 * DIA).toISOString() })).status, 400);
  assert.equal((await req(f.router, 'PATCH', '/l1', { retorno_concluido: 'sim' })).status, 400);
  assert.equal((await req(f.router, 'PATCH', '/l1', { retorno_concluido: true })).status, 200);
  assert.equal(f.db.tables.leads[0].retorno_concluido, true);
});

test('briefing: lista de retornos traz só os do usuário, pendentes e na janela pedida', async () => {
  const u = ativo('brf-lista');
  const em = d => new Date(Date.now() + d * DIA).toISOString();
  const f = briefingRouter(u, [
    { id: 'meu-atrasado', empresa_id: u.empresa_id, closer_id: u.id, nome_lead: 'A', data_retorno: em(-1), retorno_concluido: false },
    { id: 'meu-semana', empresa_id: u.empresa_id, closer_id: u.id, nome_lead: 'B', data_retorno: em(3), retorno_concluido: false },
    { id: 'meu-longe', empresa_id: u.empresa_id, closer_id: u.id, nome_lead: 'C', data_retorno: em(20), retorno_concluido: false },
    { id: 'meu-feito', empresa_id: u.empresa_id, closer_id: u.id, nome_lead: 'D', data_retorno: em(1), retorno_concluido: true },
    { id: 'colega', empresa_id: u.empresa_id, closer_id: 'outro', nome_lead: 'E', data_retorno: em(1), retorno_concluido: false },
    { id: 'outro-escritorio', empresa_id: 'emp-x', closer_id: u.id, nome_lead: 'F', data_retorno: em(1), retorno_concluido: false },
  ]);
  const r = await req(f.router, 'GET', '/retornos?dias=7');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.retornos.map(x => x.id), ['meu-atrasado', 'meu-semana']);
});

// ─── Camadas 2 e 3: avisos agendados ────────────────────────────────────────
function canaisFalsos() {
  const push = [], email = [];
  return { push, email, canais: { push: async (id, p) => { push.push({ id, p }); return 1; }, email: async (to, s, h) => { email.push({ to, s, h }); return true; } } };
}

test('lembrete de retorno: envia uma vez só, mesmo rodando duas vezes ou em duas instâncias', async () => {
  const agora = new Date();
  const db = database({
    leads: [
      { id: 'l1', closer_id: 'u1', nome_lead: '<b>Cliente</b>', proximo_passo: 'Ligar', data_retorno: new Date(agora - 3600000).toISOString(), retorno_concluido: false, retorno_lembrado_em: null },
      { id: 'l2', closer_id: 'u1', nome_lead: 'Futuro', data_retorno: new Date(+agora + DIA).toISOString(), retorno_concluido: false, retorno_lembrado_em: null },
      { id: 'l3', closer_id: 'u1', nome_lead: 'Feito', data_retorno: new Date(agora - 3600000).toISOString(), retorno_concluido: true, retorno_lembrado_em: null },
    ],
    users: [ativo('u1')],
  });
  const c = canaisFalsos();
  const [a, b] = await Promise.all([
    retencao.enviarLembretesRetorno({ supabase: db, canais: c.canais, agora }),
    retencao.enviarLembretesRetorno({ supabase: db, canais: c.canais, agora }),
  ]);
  assert.equal(a.enviados + b.enviados, 1);
  assert.equal((await retencao.enviarLembretesRetorno({ supabase: db, canais: c.canais, agora })).enviados, 0);
  assert.equal(c.email.length, 1); assert.equal(c.push.length, 1);
  assert(!c.email[0].h.includes('<b>Cliente</b>'), 'nome do cliente vai escapado no e-mail');
});

test('lembrete de retorno: conta sem acesso ativo não recebe', async () => {
  const agora = new Date();
  const db = database({
    leads: [{ id: 'l1', closer_id: 'u2', nome_lead: 'X', data_retorno: new Date(agora - 60000).toISOString(), retorno_concluido: false, retorno_lembrado_em: null }],
    users: [vencido('u2')],
  });
  const c = canaisFalsos();
  assert.equal((await retencao.enviarLembretesRetorno({ supabase: db, canais: c.canais, agora })).enviados, 0);
  assert.equal(c.email.length, 0);
});

test('resumo de segunda: uma vez por semana, respeita quem desligou e quem está sem acesso', async () => {
  const agora = new Date();
  const db = database({
    users: [
      ativo('r1', { ritual_semanal: true, dificuldades: 'objecoes,follow_up', created_at: new Date(+agora - DIA).toISOString() }),
      ativo('r2', { ritual_semanal: false, created_at: new Date(+agora - DIA).toISOString() }),
      vencido('r3', { ritual_semanal: true }),
      ativo('r4', { ritual_semanal: true, name: '<script>x</script>', created_at: new Date(+agora - DIA).toISOString() }),
    ],
    leads: [{ id: 'l1', closer_id: 'r1', nome_lead: 'Maria', proximo_passo: 'Enviar contrato', data_retorno: new Date(+agora + DIA).toISOString(), retorno_concluido: false }],
    push_subscriptions: [],
  });
  const c = canaisFalsos();
  const r = await retencao.enviarRitualSemanal({ supabase: db, canais: c.canais, agora });
  assert.equal(r.semana, retencao.semanaISO(agora));
  assert.equal(retencao.semanaISO(new Date('2026-11-09T11:30:00Z')), '2026-W46');
  assert.equal(retencao.semanaISO(new Date('2026-11-09T02:00:00Z')), '2026-W45', 'domingo 23h em Brasília ainda é a semana anterior');
  assert.deepEqual(c.email.map(e => e.to).sort(), ['r1@example.com', 'r4@example.com']);
  assert.match(c.email.find(e => e.to === 'r1@example.com').h, /Maria/);
  assert(!c.email.find(e => e.to === 'r4@example.com').h.includes('<script>'));
  assert.equal((await retencao.enviarRitualSemanal({ supabase: db, canais: c.canais, agora })).enviados, 0, 'não repete na mesma semana');
  const proxima = await retencao.enviarRitualSemanal({ supabase: db, canais: c.canais, agora: new Date(+agora + 7 * DIA) });
  assert.equal(proxima.enviados, 2);
});

test('resumo de segunda: exercício alterna entre as dificuldades declaradas', () => {
  const u = { dificuldades: 'objecoes,follow_up' };
  const a = retencao.exercicioDaSemana(u, '2026-W46'), b = retencao.exercicioDaSemana(u, '2026-W47');
  assert.notEqual(a.ponto, b.ponto);
  assert.equal(retencao.exercicioDaSemana({}, '2026-W46').abrir, 'simular_reuniao');
});

test('tarefas agendadas só ligam com JOBS_RETENCAO=true', () => {
  const src = fs.readFileSync('backend/jobs/retencao.js', 'utf8');
  assert.match(src, /process\.env\.JOBS_RETENCAO !== 'true'/);
});

// ─── Frontend: tela da memória ──────────────────────────────────────────────
test('tela da memória: mostra dados escapados, salva o que foi digitado e aprova sugestão', async () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<div id="messages-container"></div>');
  const enviados = [];
  const resposta = {
    memoria: { servicos: '<img src=x onerror=alert(1)>', honorarios: '', formas_pagamento: '', perfil_cliente: '', diferenciais: '', tom: '', objecoes: [{ texto: 'Está caro', resposta: '' }], scripts: [] },
    sugestoes: [{ campo: 'objecao', texto: 'Vou pensar' }], completude: 25, ritual_semanal: true,
  };
  const ctx = {
    document: dom.window.document, window: {}, console,
    escapeHtml: s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    mostrarToast() {}, brfEstilo() {}, brf: { lista: [], aba: 'novo' },
    api: {
      get: async () => ({ ok: true, json: async () => resposta }),
      put: async (url, body) => { enviados.push({ url, body }); return { ok: true, json: async () => ({ ...resposta, memoria: { ...resposta.memoria, ...body } }) }; },
      post: async url => { enviados.push({ url }); return { ok: true, json: async () => ({ ...resposta, sugestoes: [] }) }; },
      delete: async () => ({ ok: true, json: async () => resposta }),
    },
  };
  vm.runInNewContext(fs.readFileSync('frontend/js/retencao.js', 'utf8'), ctx);
  await ctx.window.mostrarMemoria();
  const doc = dom.window.document;
  assert.equal(doc.querySelector('img'), null, 'HTML vindo do banco não vira elemento');
  assert.equal(doc.getElementById('mem-servicos').value, '<img src=x onerror=alert(1)>');
  doc.getElementById('mem-honorarios').value = '30% do retroativo';
  await ctx.window.memSalvar();
  assert.equal(enviados[0].url, '/memoria');
  assert.equal(enviados[0].body.honorarios, '30% do retroativo');
  assert.equal(JSON.stringify(enviados[0].body.objecoes), JSON.stringify([{ texto: 'Está caro', resposta: '' }]));
  await ctx.window.memSugestao(0, true);
  assert.equal(enviados[1].url, '/memoria/sugestoes/0');
});
