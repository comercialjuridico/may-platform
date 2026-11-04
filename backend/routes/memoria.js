// ─── /api/memoria — memória do escritório e preferências de retenção ────────
const express = require('express');
const router  = express.Router();
const { supabase }       = require('../services/supabase');
const { authMiddleware } = require('../middleware/auth');
const {
  limparMemoria, completude, carregarMemoria, aplicarSugestao, CAMPOS_TEXTO,
} = require('../services/memoria');

function semEmpresa(req, res) {
  if (req.user.empresa_id) return false;
  res.status(400).json({ erro: 'Sua conta ainda não está vinculada a um escritório. Saia e entre de novo, ou fale com o suporte.', code: 'SEM_EMPRESA' });
  return true;
}

function faltaMigracao(error) {
  return error && (error.code === '42P01' || error.code === '42703' || /does not exist|schema cache/i.test(error.message || ''));
}

function resposta(mem, user) {
  const m = mem || { objecoes: [], scripts: [], sugestoes: [] };
  return {
    memoria: {
      ...Object.fromEntries(Object.keys(CAMPOS_TEXTO).map(c => [c, m[c] || ''])),
      objecoes: m.objecoes || [], scripts: m.scripts || [],
      atualizado_em: m.atualizado_em || null,
    },
    sugestoes: m.sugestoes || [],
    completude: completude(m),
    ritual_semanal: user?.ritual_semanal !== false,
  };
}

async function gravar(req, campos) {
  return supabase.from('memoria_escritorio').upsert({
    empresa_id: req.user.empresa_id,
    ...campos,
    atualizado_por: req.user.id,
    atualizado_em: new Date().toISOString(),
  }, { onConflict: 'empresa_id' }).select('*').single();
}

async function ritualDoUsuario(userId) {
  const { data } = await supabase.from('users').select('ritual_semanal').eq('id', userId).maybeSingle();
  return data || {};
}

// ─── GET /api/memoria ────────────────────────────────────────────────────────
router.get('/', authMiddleware, async (req, res) => {
  if (semEmpresa(req, res)) return;
  const mem = await carregarMemoria(supabase, req.user.empresa_id);
  res.json(resposta(mem, await ritualDoUsuario(req.user.id).catch(() => ({}))));
});

// ─── PUT /api/memoria ────────────────────────────────────────────────────────
router.put('/', authMiddleware, async (req, res) => {
  if (semEmpresa(req, res)) return;
  const campos = limparMemoria(req.body || {});
  if (!Object.keys(campos).length) return res.status(400).json({ erro: 'Nada para salvar.' });
  try {
    const { data, error } = await gravar(req, campos);
    if (faltaMigracao(error)) return res.status(503).json({ erro: 'A memória do escritório precisa da atualização do banco. Fale com o suporte.', code: 'FALTA_MIGRACAO' });
    if (error) throw error;
    res.json(resposta(data, await ritualDoUsuario(req.user.id).catch(() => ({}))));
  } catch (err) {
    console.error('Erro ao salvar memória:', err.message);
    res.status(500).json({ erro: 'Não consegui salvar a memória agora.' });
  }
});

// ─── POST /api/memoria/sugestoes/:i (aceitar) e DELETE (descartar) ───────────
async function tratarSugestao(req, res, aceitar) {
  if (semEmpresa(req, res)) return;
  const i = Number.parseInt(req.params.i, 10);
  const mem = await carregarMemoria(supabase, req.user.empresa_id);
  const lista = mem?.sugestoes || [];
  if (!Number.isInteger(i) || i < 0 || i >= lista.length) return res.status(404).json({ erro: 'Sugestão não encontrada.' });
  const sug = lista[i];
  const campos = { sugestoes: lista.filter((_, k) => k !== i), ...(aceitar ? aplicarSugestao(mem, sug) : {}) };
  try {
    const { data, error } = await gravar(req, campos);
    if (error) throw error;
    res.json(resposta(data, await ritualDoUsuario(req.user.id).catch(() => ({}))));
  } catch (err) {
    console.error('Erro ao tratar sugestão:', err.message);
    res.status(500).json({ erro: 'Não consegui salvar agora.' });
  }
}
router.post('/sugestoes/:i', authMiddleware, (req, res) => tratarSugestao(req, res, true));
router.delete('/sugestoes/:i', authMiddleware, (req, res) => tratarSugestao(req, res, false));

// ─── PUT /api/memoria/ritual — liga ou desliga o resumo de segunda-feira ─────
router.put('/ritual', authMiddleware, async (req, res) => {
  if (typeof req.body?.ativo !== 'boolean') return res.status(400).json({ erro: 'Informe ativo: true ou false.' });
  const { error } = await supabase.from('users').update({ ritual_semanal: req.body.ativo }).eq('id', req.user.id);
  if (faltaMigracao(error)) return res.status(503).json({ erro: 'Esta opção precisa da atualização do banco.', code: 'FALTA_MIGRACAO' });
  if (error) return res.status(500).json({ erro: 'Não consegui salvar a preferência.' });
  res.json({ ok: true, ritual_semanal: req.body.ativo });
});

module.exports = router;
