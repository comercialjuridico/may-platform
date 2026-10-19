const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { testeGratuitoAtivo, limiteMensagens } = require('./limites');

const agora = Date.parse('2026-10-15T15:00:00Z');
const usuario = { plano: 'free', created_at: '2026-10-14T15:00:00Z', mensagens_mes: 2000000 };

test('teste ativo não tem teto, mesmo acima de um milhão de mensagens', () => {
  assert.equal(limiteMensagens(usuario, agora), null);
  assert.equal(testeGratuitoAtivo({ ...usuario, created_at: new Date(agora).toISOString() }, agora), true);
});

test('acesso ilimitado termina exatamente ao completar sete dias', () => {
  const inicio = Date.parse(usuario.created_at);
  const fim = inicio + 7 * 24 * 60 * 60 * 1000;
  assert.equal(limiteMensagens(usuario, fim - 1), null);
  assert.notEqual(limiteMensagens(usuario, fim), null);
  assert.notEqual(limiteMensagens(usuario, fim + 1), null);
});

test('contas expiradas, datas inválidas e assinaturas não ganham teste ilimitado', () => {
  for (const alteracao of [
    { plano_status: 'expirado' }, { _trial_expirado: true },
    { created_at: null }, { created_at: 'invalida' },
    { created_at: new Date(agora + 1).toISOString() },
    { stripe_subscription_id: 'sub_teste' }, { cielo_recurrent_payment_id: 'teste' },
    { plano: 'mensal' }, { plano: 'anual' },
  ]) assert.notEqual(limiteMensagens({ ...usuario, ...alteracao }, agora), null);
});

test('middleware libera teste acima do antigo teto e continua bloqueando plano limitado', async () => {
  const modulo = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../middleware/auth'), 'utf8'), {
    module: modulo, console, Date, process,
    require(nome) {
      if (nome === 'jsonwebtoken') return {};
      if (nome === '../services/supabase') return { supabase: {} };
      if (nome === '../services/limites') return { limiteMensagens: user => limiteMensagens(user, agora) };
      throw new Error(`Dependência inesperada: ${nome}`);
    },
  });
  const mes = new Date().toISOString().slice(0, 7);
  let liberado = false;
  const req = { user: { ...usuario, mes_referencia: mes } };
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await modulo.exports.verificarLimite(req, res, () => { liberado = true; });
  assert.equal(liberado, true);
  assert.equal(req.limiteInfo.limite, null);
  liberado = false;
  req.user.created_at = '2026-01-01T00:00:00Z';
  await modulo.exports.verificarLimite(req, res, () => { liberado = true; });
  assert.equal(liberado, false);
  assert.equal(res.code, 429);
  assert.equal(res.body.code, 'LIMITE_ATINGIDO');
});

test('contador exibe infinito sem aviso de limite próximo', () => {
  const fonte = fs.readFileSync(require.resolve('../../frontend/js/app.js'), 'utf8');
  const funcao = fonte.slice(fonte.indexOf('function atualizarContadorUso()'), fonte.indexOf('// ─── Selecionar ferramenta'));
  const el = {};
  vm.runInNewContext(`${funcao}\natualizarContadorUso();`, {
    estado: { uso: { mensagens_usadas: 2000000, limite: null, restantes: null } },
    document: { getElementById: () => el },
  });
  assert.equal(el.textContent, '2000000/∞ mensagens no mês');
  assert.equal(el.className, 'usage-counter');
});
