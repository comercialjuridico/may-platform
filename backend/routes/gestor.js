// ─── Rotas do Painel do Gestor ─────────────────────────────────────────────────
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../services/supabase');
const { authMiddleware } = require('../middleware/auth');

// Middleware: verifica se usuário é gestor
async function gestorMiddleware(req, res, next) {
  if (req.user.role !== 'gestor') {
    return res.status(403).json({ erro: 'Acesso restrito a gestores.' });
  }
  next();
}

// ─── POST /api/gestor/empresa ───────────────────────────────────────────────
// Cria uma empresa e torna o usuário gestor
router.post('/empresa', authMiddleware, async (req, res) => {
  const { nome } = req.body;
  if (!nome) return res.status(400).json({ erro: 'Nome da empresa é obrigatório.' });

  // Verifica se já tem empresa
  if (req.user.empresa_id) {
    return res.status(400).json({ erro: 'Você já tem uma equipe criada.' });
  }

  try {
    const { data: empresa, error } = await supabase
      .from('empresas')
      .insert({ nome, gestor_id: req.user.id, max_membros: 5 })
      .select('id, nome')
      .single();

    if (error) throw error;

    // Atualiza usuário como gestor vinculado à empresa
    await supabase.from('users').update({
      empresa_id: empresa.id,
      role: 'gestor',
    }).eq('id', req.user.id);

    res.json({ mensagem: 'Equipe criada com sucesso.', empresa });
  } catch (err) {
    console.error('Erro ao criar empresa:', err.message);
    res.status(500).json({ erro: 'Erro ao criar equipe.' });
  }
});

// ─── GET /api/gestor/equipe ─────────────────────────────────────────────────
// Retorna membros da equipe com stats completos
router.get('/equipe', authMiddleware, gestorMiddleware, async (req, res) => {
  try {
    const { data: membros, error } = await supabase
      .from('users')
      .select(`
        id, name, email, plano, created_at, mensagens_mes,
        streak (
          dias_seguidos, maior_streak, ultimo_treino, xp_total,
          nivel_conexao, nivel_objecao, nivel_proposta,
          nivel_negociacao, nivel_fechamento, nivel_follow_up
        )
      `)
      .eq('empresa_id', req.user.empresa_id)
      .neq('id', req.user.id)
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Enriquece com dados calculados
    const agora = new Date();
    const membrosEnriquecidos = membros.map(m => {
      const streak = m.streak || {};
      const ultimoTreino = streak.ultimo_treino ? new Date(streak.ultimo_treino) : null;
      const diasSemTreinar = ultimoTreino
        ? Math.floor((agora - ultimoTreino) / (1000 * 60 * 60 * 24))
        : null;

      const niveis = [
        streak.nivel_conexao, streak.nivel_objecao, streak.nivel_proposta,
        streak.nivel_negociacao, streak.nivel_fechamento, streak.nivel_follow_up,
      ].filter(Boolean);

      const mediaGeral = niveis.length
        ? Math.round(niveis.reduce((a, b) => a + b, 0) / niveis.length * 10) / 10
        : 0;

      return {
        id: m.id,
        name: m.name,
        email: m.email,
        plano: m.plano,
        mensagens_mes: m.mensagens_mes || 0,
        criado_em: m.created_at,
        dias_sem_treinar: diasSemTreinar,
        inativo: diasSemTreinar === null || diasSemTreinar > 5,
        streak: streak.dias_seguidos || 0,
        maior_streak: streak.maior_streak || 0,
        xp_total: streak.xp_total || 0,
        media_geral: mediaGeral,
        habilidades: {
          conexao:    streak.nivel_conexao    || 1,
          objecao:    streak.nivel_objecao    || 1,
          proposta:   streak.nivel_proposta   || 1,
          negociacao: streak.nivel_negociacao || 1,
          fechamento: streak.nivel_fechamento || 1,
          follow_up:  streak.nivel_follow_up  || 1,
        },
      };
    });

    // Stats gerais da equipe
    const totalAtivos = membrosEnriquecidos.filter(m => !m.inativo).length;
    const mediaEquipe = membrosEnriquecidos.length
      ? Math.round(membrosEnriquecidos.reduce((a, m) => a + m.media_geral, 0) / membrosEnriquecidos.length * 10) / 10
      : 0;
    const inativos = membrosEnriquecidos.filter(m => m.inativo);

    res.json({
      empresa: { id: req.user.empresa_id },
      stats: {
        total_membros: membrosEnriquecidos.length,
        ativos_semana: totalAtivos,
        inativos: inativos.length,
        media_equipe: mediaEquipe,
      },
      membros: membrosEnriquecidos,
      alertas: inativos.map(m => ({
        nome: m.name,
        dias_sem_treinar: m.dias_sem_treinar,
        mensagem: m.dias_sem_treinar === null
          ? `${m.name} ainda não realizou nenhum treino.`
          : `${m.name} não treina há ${m.dias_sem_treinar} dias.`,
      })),
    });
  } catch (err) {
    console.error('Erro ao buscar equipe:', err.message);
    res.status(500).json({ erro: 'Erro ao buscar dados da equipe.' });
  }
});

// ─── POST /api/gestor/convidar ──────────────────────────────────────────────
// Gera link de convite para um e-mail
router.post('/convidar', authMiddleware, gestorMiddleware, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ erro: 'E-mail é obrigatório.' });

  try {
    // Verifica limite de membros
    const { count } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('empresa_id', req.user.empresa_id);

    const { data: empresa } = await supabase
      .from('empresas')
      .select('max_membros, nome')
      .eq('id', req.user.empresa_id)
      .single();

    if (count >= empresa.max_membros) {
      return res.status(400).json({
        erro: `Limite de ${empresa.max_membros} membros atingido. Faça upgrade para adicionar mais.`
      });
    }

    const token = uuidv4();

    // Salva o convite (substitui se já existir para o mesmo e-mail)
    await supabase.from('convites').upsert({
      empresa_id: req.user.empresa_id,
      email,
      token,
      aceito: false,
    }, { onConflict: 'email,empresa_id' });

    const link = `${process.env.APP_URL}/auth.html?convite=${token}`;

    res.json({
      mensagem: 'Convite gerado com sucesso.',
      link,
      email,
    });
  } catch (err) {
    console.error('Erro ao convidar:', err.message);
    res.status(500).json({ erro: 'Erro ao gerar convite.' });
  }
});

// ─── GET /api/gestor/membro/:id ─────────────────────────────────────────────
// Detalhe de um membro específico
router.get('/membro/:id', authMiddleware, gestorMiddleware, async (req, res) => {
  try {
    const { data: membro, error } = await supabase
      .from('users')
      .select(`
        id, name, email, plano, created_at, mensagens_mes,
        streak (*)
      `)
      .eq('id', req.params.id)
      .eq('empresa_id', req.user.empresa_id)
      .single();

    if (error || !membro) return res.status(404).json({ erro: 'Membro não encontrado.' });

    // Últimas 10 conversas
    const { data: conversas } = await supabase
      .from('conversations')
      .select('id, titulo, ferramenta, created_at')
      .eq('user_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(10);

    res.json({ membro, conversas: conversas || [] });
  } catch (err) {
    console.error('Erro ao buscar membro:', err.message);
    res.status(500).json({ erro: 'Erro ao buscar membro.' });
  }
});

// ─── DELETE /api/gestor/membro/:id ──────────────────────────────────────────
router.delete('/membro/:id', authMiddleware, gestorMiddleware, async (req, res) => {
  try {
    await supabase.from('users')
      .update({ empresa_id: null, role: 'membro' })
      .eq('id', req.params.id)
      .eq('empresa_id', req.user.empresa_id);

    res.json({ mensagem: 'Membro removido da equipe.' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao remover membro.' });
  }
});

// ─── GET /api/gestor/info ────────────────────────────────────────────────────
router.get('/info', authMiddleware, async (req, res) => {
  try {
    if (!req.user.empresa_id) {
      return res.json({ tem_empresa: false });
    }
    const { data: empresa } = await supabase
      .from('empresas')
      .select('id, nome, max_membros')
      .eq('id', req.user.empresa_id)
      .single();

    res.json({ tem_empresa: true, empresa, role: req.user.role });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar info.' });
  }
});

module.exports = router;
