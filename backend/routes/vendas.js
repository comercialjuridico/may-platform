// ─── Rotas de Vendas — Registrar e Ranking ────────────────────────────────────
const express = require('express');
const router  = express.Router();
const { supabase }       = require('../services/supabase');
const { authMiddleware } = require('../middleware/auth');

// Calcula XP por valor da venda
function calcularXP(valor) {
  if (valor < 1000)  return 50;
  if (valor < 5000)  return 150;
  if (valor < 20000) return 300;
  return 500;
}

// ─── POST /api/vendas ──────────────────────────────────────────────────────────
// Vendedor registra uma venda realizada
router.post('/', authMiddleware, async (req, res) => {
  const { valor, descricao, cliente } = req.body;
  const valorNum = parseFloat(valor);

  if (!valor || isNaN(valorNum) || valorNum <= 0) {
    return res.status(400).json({ erro: 'Valor inválido.' });
  }
  if (!req.user.empresa_id) {
    return res.status(400).json({ erro: 'Você precisa pertencer a uma equipe para registrar vendas.' });
  }

  try {
    // 1. Registra a venda
    const { data: venda, error } = await supabase
      .from('vendas')
      .insert({
        user_id:    req.user.id,
        empresa_id: req.user.empresa_id,
        valor:      valorNum,
        descricao:  descricao || null,
        cliente:    cliente   || null,
      })
      .select('id, valor, created_at')
      .single();

    if (error) throw error;

    // 2. Adiciona XP ao streak (best-effort — não falha a request se der erro)
    const xp = calcularXP(valorNum);
    try {
      const { data: streakAtual } = await supabase
        .from('streak')
        .select('xp_total')
        .eq('user_id', req.user.id)
        .single();

      if (streakAtual) {
        await supabase
          .from('streak')
          .update({ xp_total: (streakAtual.xp_total || 0) + xp })
          .eq('user_id', req.user.id);
      }
    } catch (xpErr) {
      console.error('Aviso: erro ao atualizar XP:', xpErr.message);
    }

    // 3. Calcula posição no ranking do mês
    const mesInicio = new Date();
    mesInicio.setDate(1);
    mesInicio.setHours(0, 0, 0, 0);

    const { data: vendasMes } = await supabase
      .from('vendas')
      .select('user_id, valor')
      .eq('empresa_id', req.user.empresa_id)
      .gte('created_at', mesInicio.toISOString());

    const totais = {};
    (vendasMes || []).forEach(v => {
      totais[v.user_id] = (totais[v.user_id] || 0) + parseFloat(v.valor);
    });
    const sorted   = Object.entries(totais).sort((a, b) => b[1] - a[1]);
    const posicao  = sorted.findIndex(([uid]) => uid === req.user.id) + 1;
    const totalEquipe = sorted.length;

    res.json({
      mensagem:        'Venda registrada com sucesso!',
      venda,
      xp_ganho:        xp,
      posicao_ranking: posicao,
      total_equipe:    totalEquipe,
    });
  } catch (err) {
    console.error('Erro ao registrar venda:', err.message);
    res.status(500).json({ erro: 'Erro ao registrar venda.' });
  }
});

// ─── GET /api/vendas/ranking ───────────────────────────────────────────────────
// Ranking da equipe no mês — acessível por gestor e membros da equipe
router.get('/ranking', authMiddleware, async (req, res) => {
  if (!req.user.empresa_id) {
    return res.status(400).json({ erro: 'Você não pertence a uma equipe.' });
  }

  try {
    const mesInicio = new Date();
    mesInicio.setDate(1);
    mesInicio.setHours(0, 0, 0, 0);

    // Vendas do mês
    const { data: vendasMes, error } = await supabase
      .from('vendas')
      .select('user_id, valor')
      .eq('empresa_id', req.user.empresa_id)
      .gte('created_at', mesInicio.toISOString());

    if (error) throw error;

    // Todos os membros da equipe (inclui gestor)
    const { data: membros } = await supabase
      .from('users')
      .select(`
        id, name, email, mensagens_mes,
        streak (dias_seguidos, xp_total, ultimo_treino)
      `)
      .eq('empresa_id', req.user.empresa_id);

    // Agrupa vendas por user
    const totais = {};
    (vendasMes || []).forEach(v => {
      if (!totais[v.user_id]) totais[v.user_id] = { total: 0, count: 0 };
      totais[v.user_id].total += parseFloat(v.valor);
      totais[v.user_id].count += 1;
    });

    const agora = new Date();

    // Monta ranking completo (inclui quem não vendeu)
    const ranking = (membros || [])
      .map(m => {
        const streak    = m.streak || {};
        const ultimoTr  = streak.ultimo_treino ? new Date(streak.ultimo_treino) : null;
        const diasSemTr = ultimoTr
          ? Math.floor((agora - ultimoTr) / (1000 * 60 * 60 * 24))
          : null;

        return {
          user_id:         m.id,
          name:            m.name,
          email:           m.email,
          total_mes:       totais[m.id]?.total  || 0,
          count_mes:       totais[m.id]?.count  || 0,
          streak:          streak.dias_seguidos || 0,
          xp_total:        streak.xp_total      || 0,
          treinos_mes:     m.mensagens_mes      || 0,
          dias_sem_treinar: diasSemTr,
          ativo:           diasSemTr !== null && diasSemTr <= 5,
        };
      })
      .sort((a, b) => b.total_mes - a.total_mes)
      .map((r, i) => ({ ...r, posicao: i + 1 }));

    const totalVendido = (vendasMes || []).reduce((s, v) => s + parseFloat(v.valor), 0);
    const totalVendas  = vendasMes?.length || 0;
    const ticketMedio  = totalVendas > 0 ? totalVendido / totalVendas : 0;
    const topVendedor  = ranking.find(r => r.total_mes > 0);

    res.json({
      ranking,
      stats: {
        total_vendido:  totalVendido,
        total_vendas:   totalVendas,
        ticket_medio:   Math.round(ticketMedio * 100) / 100,
        top_vendedor:   topVendedor?.name || null,
      },
      mes_referencia: mesInicio.toISOString(),
    });
  } catch (err) {
    console.error('Erro ao buscar ranking:', err.message);
    res.status(500).json({ erro: 'Erro ao buscar ranking de vendas.' });
  }
});

// ─── GET /api/vendas/meu-resumo ────────────────────────────────────────────────
// Resumo das vendas do usuário logado no mês
router.get('/meu-resumo', authMiddleware, async (req, res) => {
  try {
    const mesInicio = new Date();
    mesInicio.setDate(1);
    mesInicio.setHours(0, 0, 0, 0);

    const { data: vendas } = await supabase
      .from('vendas')
      .select('id, valor, descricao, cliente, created_at')
      .eq('user_id', req.user.id)
      .gte('created_at', mesInicio.toISOString())
      .order('created_at', { ascending: false });

    const total = (vendas || []).reduce((s, v) => s + parseFloat(v.valor), 0);

    res.json({
      vendas:    vendas || [],
      total_mes: total,
      count_mes: vendas?.length || 0,
    });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar resumo de vendas.' });
  }
});

module.exports = router;
