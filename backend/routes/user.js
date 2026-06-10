// ─── Rotas de perfil e diagnóstico do usuário ──────────────────────────────────
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { supabase } = require('../services/supabase');
const { authMiddleware } = require('../middleware/auth');

// ─── GET /api/user/me ───────────────────────────────────────────────────────
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const { data: streak } = await supabase
      .from('streak')
      .select('*')
      .eq('user_id', req.user.id)
      .single();

    res.json({ user: req.user, streak: streak || null });
  } catch (err) {
    console.error('Erro no /me:', err.message);
    res.status(500).json({ erro: 'Erro ao buscar perfil.' });
  }
});

// ─── PUT /api/user/diagnostico ──────────────────────────────────────────────
// Salva o diagnóstico inicial do usuário
router.put('/diagnostico', authMiddleware, async (req, res) => {
  try {
    const { nicho, produto, publico_alvo, nivel, maior_dificuldade } = req.body;

    if (!nicho || !produto || !publico_alvo || !nivel || !maior_dificuldade) {
      return res.status(400).json({ erro: 'Todos os campos do diagnóstico são obrigatórios.' });
    }

    const { data, error } = await supabase
      .from('users')
      .update({
        nicho,
        produto,
        publico_alvo,
        nivel,
        maior_dificuldade,
        diagnostico_completo: true,
      })
      .eq('id', req.user.id)
      .select('id, nicho, produto, publico_alvo, nivel, maior_dificuldade, diagnostico_completo')
      .single();

    if (error) throw error;
    res.json({ mensagem: 'Diagnóstico salvo.', user: data });
  } catch (err) {
    console.error('Erro no diagnóstico:', err.message);
    res.status(500).json({ erro: 'Erro ao salvar diagnóstico.' });
  }
});

// ─── PUT /api/user/perfil ───────────────────────────────────────────────────
router.put('/perfil', authMiddleware, async (req, res) => {
  try {
    const { name, avatar_url } = req.body;
    const updates = {};
    if (name) updates.name = name;
    if (avatar_url !== undefined) updates.avatar_url = avatar_url;

    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', req.user.id)
      .select('id, name, email, avatar_url')
      .single();

    if (error) throw error;
    res.json({ mensagem: 'Perfil atualizado.', user: data });
  } catch (err) {
    console.error('Erro ao atualizar perfil:', err.message);
    res.status(500).json({ erro: 'Erro ao atualizar perfil.' });
  }
});

// ─── PUT /api/user/senha ────────────────────────────────────────────────────
router.put('/senha', authMiddleware, async (req, res) => {
  try {
    const { senha_atual, nova_senha } = req.body;
    if (!senha_atual || !nova_senha) {
      return res.status(400).json({ erro: 'Senha atual e nova senha são obrigatórias.' });
    }
    if (nova_senha.length < 8) {
      return res.status(400).json({ erro: 'A nova senha deve ter no mínimo 8 caracteres.' });
    }

    const { data: user } = await supabase
      .from('users')
      .select('password_hash')
      .eq('id', req.user.id)
      .single();

    const senhaCorreta = await bcrypt.compare(senha_atual, user.password_hash);
    if (!senhaCorreta) {
      return res.status(401).json({ erro: 'Senha atual incorreta.' });
    }

    const password_hash = await bcrypt.hash(nova_senha, 12);
    await supabase.from('users').update({ password_hash }).eq('id', req.user.id);

    res.json({ mensagem: 'Senha alterada com sucesso.' });
  } catch (err) {
    console.error('Erro ao alterar senha:', err.message);
    res.status(500).json({ erro: 'Erro ao alterar senha.' });
  }
});

// ─── GET /api/user/streak ───────────────────────────────────────────────────
router.get('/streak', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('streak')
      .select('*')
      .eq('user_id', req.user.id)
      .single();

    if (error) throw error;
    res.json({ streak: data });
  } catch (err) {
    console.error('Erro ao buscar streak:', err.message);
    res.status(500).json({ erro: 'Erro ao buscar streak.' });
  }
});

// ─── GET /api/user/uso ──────────────────────────────────────────────────────
router.get('/uso', authMiddleware, async (req, res) => {
  try {
    const limites = {
      free:   parseInt(process.env.LIMITE_FREE)   || 20,
      mensal: parseInt(process.env.LIMITE_MENSAL) || 500,
      anual:  parseInt(process.env.LIMITE_ANUAL)  || 999999,
    };
    const limite = limites[req.user.plano] || limites.free;

    res.json({
      plano: req.user.plano,
      mensagens_usadas: req.user.mensagens_mes || 0,
      limite,
      restantes: Math.max(0, limite - (req.user.mensagens_mes || 0)),
    });
  } catch (err) {
    console.error('Erro ao buscar uso:', err.message);
    res.status(500).json({ erro: 'Erro ao buscar uso.' });
  }
});

module.exports = router;
