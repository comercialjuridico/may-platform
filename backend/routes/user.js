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
// Salva o diagnóstico de maturidade comercial (0-5) e gera trilha + meta
router.put('/diagnostico', authMiddleware, async (req, res) => {
  try {
    const {
      tempo_experiencia,
      contratos_mes,
      dificuldades,        // string: ex "objecoes,follow_up,fechamento"
      quero_melhorar,
      leads_semana,
      modelo_cobranca,     // exito | inicial | misto
      faturamento_mensal,  // fat_10k | fat_11_20k | fat_21_35k | fat_36_55k | fat_10_20k | fat_20_35k | fat_35_50k | fat_60k_mais
    } = req.body;

    if (!tempo_experiencia || !contratos_mes || !dificuldades || !quero_melhorar || !leads_semana) {
      return res.status(400).json({ erro: 'Todos os campos são obrigatórios.' });
    }

    // ── Cálculo de maturidade comercial (0-5) ──────────────────────────────
    // Score máximo: 4+4+3+4 = 15 → normalizado para 0-5

    // Pontos por tempo de experiência (0-4)
    const ptExp = {
      'nunca':  0,
      'menos6': 1,
      '6a12':   2,
      '1a3':    3,
      'mais3':  4,
    }[tempo_experiencia] ?? 0;

    // Pontos por contratos fechados/mês (0-4)
    const ptContr = {
      '0':     0,
      '1a2':   1,
      '3a5':   2,
      '6a9':   3,
      '10mais':4,
    }[contratos_mes] ?? 0;

    // Pontos por leads/semana (0-3)
    const ptLeads = {
      '0a3':   0,
      '4a10':  1,
      '11a20': 2,
      '21mais':3,
    }[leads_semana] ?? 0;

    // Pontos por faturamento mensal (0-4)
    const ptFat = {
      'fat_10k':     0,
      'fat_11_20k':  1,
      'fat_10_20k':  1,
      'fat_21_35k':  2,
      'fat_20_35k':  2,
      'fat_36_55k':  3,
      'fat_35_50k':  3,
      'fat_60k_mais':4,
    }[faturamento_mensal] ?? 0;

    const scoreBruto = ptExp + ptContr + ptLeads + ptFat; // 0-15
    const maturidade = Math.min(5, Math.round(scoreBruto / 15 * 5));

    // ── Trilha baseada na dificuldade principal ────────────────────────────
    const dificArr   = dificuldades.split(',').filter(Boolean);
    const trilhaMap  = {
      objecoes:      'Quebrando Objeções',
      abordagem:     'Primeiros Contatos',
      qualificacao:  'Qualificação de Leads',
      proposta:      'Proposta que Fecha',
      negociacao:    'Negociação sem Ceder',
      follow_up:     'Follow-up Estratégico',
      fechamento:    'Técnicas de Fechamento',
    };
    const trilhaPrincipal = dificArr[0] ? (trilhaMap[dificArr[0]] || 'Fundamentos Comerciais') : 'Fundamentos Comerciais';

    // ── Meta semanal por nível ─────────────────────────────────────────────
    const metas = [
      'Fazer 1 atendimento completo usando o Clean Script da May',
      'Treinar 3 objeções na May e fazer 2 atendimentos reais com o script',
      'Fechar 1 contrato e fazer follow-up em todos os leads em aberto',
      'Fechar 2 contratos e treinar 1 simulação de negociação',
      'Fechar 3 contratos e identificar o maior gargalo do funil',
      'Fechar 4+ contratos e estruturar processo para replicar com equipe',
    ];
    const meta_semanal = metas[maturidade];

    const { data, error } = await supabase
      .from('users')
      .update({
        tempo_experiencia,
        contratos_mes,
        dificuldades,
        quero_melhorar,
        leads_semana,
        modelo_cobranca:    modelo_cobranca    || null,
        faturamento_mensal: faturamento_mensal || null,
        maturidade,
        meta_semanal,
        trilha_ativa:       trilhaPrincipal,
        diagnostico_completo: true,
      })
      .eq('id', req.user.id)
      .select('id, maturidade, meta_semanal, trilha_ativa, diagnostico_completo')
      .single();

    if (error) throw error;

    res.json({
      mensagem:    'Diagnóstico salvo.',
      maturidade,
      meta_semanal,
      trilha_ativa: trilhaPrincipal,
      dificuldades: dificArr,
      user: data,
    });
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
