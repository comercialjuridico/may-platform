// ─── Rotas de Follow-ups / Lembretes ─────────────────────────────────────────
const express = require('express');
const router  = express.Router();
const { supabase }       = require('../services/supabase');
const { authMiddleware } = require('../middleware/auth');

// ─── GET /api/followups/agenda ────────────────────────────────────────────────
// Follow-ups da semana (mesmo intervalo da agenda de reuniões)
router.get('/agenda', authMiddleware, async (req, res) => {
  try {
    const semana = req.query.semana;
    const ref    = semana ? new Date(semana) : new Date();
    const dow    = ref.getDay();
    const diff   = (dow === 0 ? -6 : 1 - dow);
    const inicio = new Date(ref);
    inicio.setDate(ref.getDate() + diff);
    inicio.setHours(0, 0, 0, 0);
    const fim = new Date(inicio);
    fim.setDate(inicio.getDate() + 6);
    fim.setHours(23, 59, 59, 999);

    const { data, error } = await supabase
      .from('followups')
      .select('id, tipo, data_hora, descricao, nome_lead, concluido, lead_id')
      .eq('empresa_id', req.user.empresa_id)
      .eq('usuario_id', req.user.id)
      .gte('data_hora', inicio.toISOString())
      .lte('data_hora', fim.toISOString())
      .order('data_hora', { ascending: true });

    if (error) throw error;
    res.json({ followups: data || [] });
  } catch (err) {
    console.error('Erro ao buscar followups:', err.message);
    res.status(500).json({ erro: 'Erro ao buscar follow-ups.' });
  }
});

// ─── GET /api/followups/proximos ──────────────────────────────────────────────
// Próximos 5 follow-ups pendentes do usuário
router.get('/proximos', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('followups')
      .select('id, tipo, data_hora, descricao, nome_lead, lead_id')
      .eq('empresa_id', req.user.empresa_id)
      .eq('usuario_id', req.user.id)
      .eq('concluido', false)
      .gte('data_hora', new Date().toISOString())
      .order('data_hora', { ascending: true })
      .limit(5);

    if (error) throw error;
    res.json({ followups: data || [] });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar próximos follow-ups.' });
  }
});

// ─── POST /api/followups ──────────────────────────────────────────────────────
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { tipo, data_hora, descricao, nome_lead, lead_id } = req.body;

    if (!data_hora) return res.status(400).json({ erro: 'Data/hora é obrigatória.' });
    if (!req.user.empresa_id) return res.status(400).json({ erro: 'Usuário sem empresa.' });

    const { data, error } = await supabase
      .from('followups')
      .insert({
        empresa_id: req.user.empresa_id,
        usuario_id: req.user.id,
        lead_id:    lead_id || null,
        tipo:       tipo || 'ligação',
        data_hora:  new Date(data_hora).toISOString(),
        descricao:  descricao || null,
        nome_lead:  nome_lead || null,
        concluido:  false,
      })
      .select()
      .single();

    if (error) throw error;
    res.json({ ok: true, followup: data });
  } catch (err) {
    console.error('Erro ao criar followup:', err.message);
    res.status(500).json({ erro: 'Erro ao registrar follow-up.' });
  }
});

// ─── PATCH /api/followups/:id ─────────────────────────────────────────────────
// Marcar como concluído ou atualizar campos
router.patch('/:id', authMiddleware, async (req, res) => {
  try {
    const { concluido, descricao, data_hora, tipo } = req.body;
    const updates = {};
    if (concluido !== undefined) updates.concluido = concluido;
    if (descricao  !== undefined) updates.descricao = descricao;
    if (data_hora  !== undefined) updates.data_hora = new Date(data_hora).toISOString();
    if (tipo       !== undefined) updates.tipo = tipo;

    const { error } = await supabase
      .from('followups')
      .update(updates)
      .eq('id', req.params.id)
      .eq('empresa_id', req.user.empresa_id);

    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao atualizar follow-up.' });
  }
});

// ─── DELETE /api/followups/:id ────────────────────────────────────────────────
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    await supabase.from('followups').delete()
      .eq('id', req.params.id)
      .eq('empresa_id', req.user.empresa_id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao remover follow-up.' });
  }
});

module.exports = router;
