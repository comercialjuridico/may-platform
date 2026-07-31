// ─── Rotas do Ranking de Vendas ──────────────────────────────────────────────
const express = require('express');
const router  = express.Router();
const { supabase }       = require('../services/supabase');
const { authMiddleware } = require('../middleware/auth');

// ─── GET /api/ranking-vendas ─────────────────────────────────────────────────
// Retorna ranking da empresa com totais por vendedor
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { periodo = 'mes' } = req.query; // mes | semana | total
    const empresa_id = req.user.empresa_id;
    if (!empresa_id) return res.json({ ranking: [], minha_posicao: null });

    // Calcula data de início baseado no período
    const agora = new Date();
    let dataInicio = null;
    if (periodo === 'mes') {
      dataInicio = new Date(agora.getFullYear(), agora.getMonth(), 1).toISOString();
    } else if (periodo === 'semana') {
      const d = new Date(agora);
      d.setDate(d.getDate() - d.getDay()); // início da semana (domingo)
      d.setHours(0, 0, 0, 0);
      dataInicio = d.toISOString();
    }

    let query = supabase
      .from('ranking_lancamentos')
      .select('id, user_id, cliente, valor, descricao, created_at, users(id, name, avatar_url)')
      .eq('empresa_id', empresa_id)
      .order('created_at', { ascending: false });

    if (dataInicio) query = query.gte('created_at', dataInicio);

    const { data: lancamentos, error } = await query;
    if (error) throw error;

    // Agrupa por vendedor
    const porVendedor = {};
    for (const l of (lancamentos || [])) {
      const uid = l.user_id;
      if (!porVendedor[uid]) {
        porVendedor[uid] = {
          user_id:    uid,
          name:       l.users?.name || 'Vendedor',
          avatar_url: l.users?.avatar_url || null,
          total:      0,
          qtd:        0,
          lancamentos: [],
        };
      }
      porVendedor[uid].total += Number(l.valor) || 0;
      porVendedor[uid].qtd   += 1;
      porVendedor[uid].lancamentos.push(l);
    }

    const ranking = Object.values(porVendedor)
      .sort((a, b) => b.total - a.total)
      .map((v, i) => ({ ...v, posicao: i + 1 }));

    const minha_posicao = ranking.find(r => r.user_id === req.user.id) || null;

    res.json({ ranking, minha_posicao, periodo });
  } catch (err) {
    console.error('Erro no ranking-vendas GET:', err.message);
    res.status(500).json({ erro: 'Erro ao buscar ranking.' });
  }
});

// ─── POST /api/ranking-vendas ─────────────────────────────────────────────────
// Lança uma venda no ranking
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { cliente, valor, descricao } = req.body;
    if (!cliente || !valor) {
      return res.status(400).json({ erro: 'Cliente e valor são obrigatórios.' });
    }
    if (!req.user.empresa_id) {
      return res.status(400).json({ erro: 'Você precisa estar em uma equipe para lançar vendas.' });
    }

    const { data, error } = await supabase
      .from('ranking_lancamentos')
      .insert({
        empresa_id: req.user.empresa_id,
        user_id:    req.user.id,
        cliente,
        valor:      Number(String(valor).replace(/\D/g, '')) / 100,
        descricao:  descricao || null,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ lancamento: data });
  } catch (err) {
    console.error('Erro no ranking-vendas POST:', err.message);
    res.status(500).json({ erro: 'Erro ao registrar venda.' });
  }
});

// ─── DELETE /api/ranking-vendas/:id ──────────────────────────────────────────
// Remove um lançamento (só o próprio vendedor ou gestor)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const filtro = { id: req.params.id, empresa_id: req.user.empresa_id };
    if (!['gestor', 'admin'].includes(req.user.role)) {
      filtro.user_id = req.user.id; // membro só apaga o próprio
    }
    const { error } = await supabase.from('ranking_lancamentos').delete().match(filtro);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro no ranking-vendas DELETE:', err.message);
    res.status(500).json({ erro: 'Erro ao remover lançamento.' });
  }
});

module.exports = router;
