// ─── Rotas de Áreas de Trabalho ────────────────────────────────────────────────
// Limite: 3 áreas gratuitas por usuário. Acima disso, exige upgrade.
const express = require('express');
const router  = express.Router();
const { supabase }       = require('../services/supabase');
const { authMiddleware } = require('../middleware/auth');

const LIMITE_GRATUITO = 3;

// Planos que têm áreas ilimitadas (ou limite maior)
function limiteAreas(plano, plano_status) {
  const ativo = plano_status === 'ativo';
  const planospagos = ['mensal', 'anual', 'pro', 'team', 'team_pro'];
  if (ativo && planospagos.includes(plano)) {
    return 99; // ilimitado na prática
  }
  return LIMITE_GRATUITO;
}

// ─── GET /api/areas ────────────────────────────────────────────────────────────
router.get('/', authMiddleware, async (req, res) => {
  const { data, error } = await supabase
    .from('user_areas')
    .select('id, nome, descricao, icone, created_at')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ erro: 'Erro ao buscar áreas.' });

  const limite = limiteAreas(req.user.plano, req.user.plano_status);
  res.json({
    areas: data || [],
    total: data?.length || 0,
    limite,
    pode_adicionar: (data?.length || 0) < limite,
  });
});

// ─── POST /api/areas ───────────────────────────────────────────────────────────
router.post('/', authMiddleware, async (req, res) => {
  const { nome, descricao, icone } = req.body;

  if (!nome || nome.trim().length < 2) {
    return res.status(400).json({ erro: 'Nome da área inválido.' });
  }

  // Contar áreas atuais
  const { count, error: countErr } = await supabase
    .from('user_areas')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', req.user.id);

  if (countErr) return res.status(500).json({ erro: 'Erro ao verificar limite.' });

  const limite = limiteAreas(req.user.plano, req.user.plano_status);
  if (count >= limite) {
    return res.status(403).json({
      erro: 'Limite de áreas atingido.',
      limite,
      total: count,
      upgrade_necessario: true,
      mensagem: `Você atingiu o limite de ${LIMITE_GRATUITO} áreas gratuitas. Para adicionar mais, faça upgrade do plano.`,
    });
  }

  const { data, error } = await supabase
    .from('user_areas')
    .insert({
      user_id:   req.user.id,
      nome:      nome.trim(),
      descricao: descricao?.trim() || null,
      icone:     icone || '⚖️',
    })
    .select('id, nome, descricao, icone, created_at')
    .single();

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ erro: 'Você já tem uma área com esse nome.' });
    }
    return res.status(500).json({ erro: 'Erro ao criar área.' });
  }

  res.status(201).json({ area: data, mensagem: 'Área criada com sucesso!' });
});

// ─── PUT /api/areas/:id ────────────────────────────────────────────────────────
router.put('/:id', authMiddleware, async (req, res) => {
  const { nome, descricao, icone } = req.body;
  const updates = {};
  if (nome)      updates.nome      = nome.trim();
  if (descricao !== undefined) updates.descricao = descricao?.trim() || null;
  if (icone)     updates.icone     = icone;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ erro: 'Nenhum campo para atualizar.' });
  }

  const { data, error } = await supabase
    .from('user_areas')
    .update(updates)
    .eq('id', req.params.id)
    .eq('user_id', req.user.id) // garante ownership
    .select('id, nome, descricao, icone')
    .single();

  if (error || !data) return res.status(404).json({ erro: 'Área não encontrada.' });
  res.json({ area: data, mensagem: 'Área atualizada.' });
});

// ─── DELETE /api/areas/:id ────────────────────────────────────────────────────
router.delete('/:id', authMiddleware, async (req, res) => {
  const { error, count } = await supabase
    .from('user_areas')
    .delete({ count: 'exact' })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);

  if (error)    return res.status(500).json({ erro: 'Erro ao remover área.' });
  if (!count)   return res.status(404).json({ erro: 'Área não encontrada.' });
  res.json({ mensagem: 'Área removida.' });
});

module.exports = router;
