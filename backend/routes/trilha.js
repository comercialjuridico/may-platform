// ─── Rotas de Progresso da Trilha ───────────────────────────────────────────
const express = require('express');
const router  = express.Router();
const { supabase }       = require('../services/supabase');
const { authMiddleware } = require('../middleware/auth');

// GET /api/trilha — carrega progresso do usuário
router.get('/', authMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('trilha_progresso')
    .eq('id', req.user.id)
    .single();

  if (error) return res.status(500).json({ erro: 'Erro ao buscar progresso.' });

  res.json({ progresso: data?.trilha_progresso || {} });
});

// POST /api/trilha — salva progresso completo
router.post('/', authMiddleware, async (req, res) => {
  const { progresso } = req.body;
  if (!progresso || typeof progresso !== 'object') {
    return res.status(400).json({ erro: 'Progresso inválido.' });
  }

  const { error } = await supabase
    .from('users')
    .update({ trilha_progresso: progresso })
    .eq('id', req.user.id);

  if (error) return res.status(500).json({ erro: 'Erro ao salvar progresso.' });

  res.json({ ok: true });
});

// PATCH /api/trilha/exercicio — marca um exercício como feito/não feito
router.patch('/exercicio', authMiddleware, async (req, res) => {
  const { fase_id, exercicio_id, feito } = req.body;
  if (!fase_id || !exercicio_id) {
    return res.status(400).json({ erro: 'fase_id e exercicio_id obrigatórios.' });
  }

  // Busca progresso atual
  const { data, error: errBusca } = await supabase
    .from('users')
    .select('trilha_progresso')
    .eq('id', req.user.id)
    .single();

  if (errBusca) return res.status(500).json({ erro: 'Erro ao buscar progresso.' });

  const progresso = data?.trilha_progresso || {};
  if (!progresso[fase_id]) progresso[fase_id] = {};
  progresso[fase_id][exercicio_id] = !!feito;

  const { error } = await supabase
    .from('users')
    .update({ trilha_progresso: progresso })
    .eq('id', req.user.id);

  if (error) return res.status(500).json({ erro: 'Erro ao salvar exercício.' });

  res.json({ ok: true, progresso });
});

module.exports = router;
