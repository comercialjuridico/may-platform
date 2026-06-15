// ─── Metas Comerciais — CRUD gestor + progresso por usuário ──────────────────
const express = require('express');
const router  = express.Router();
const { supabase }       = require('../services/supabase');
const { authMiddleware } = require('../middleware/auth');

const PERIODOS = ['semanal','mensal','bimestral','trimestral','semestral','anual'];

// ── Calcula datas de início/fim a partir do tipo de período ──────────────────
function calcularPeriodo(periodo, dataInicio) {
  const inicio = new Date(dataInicio + 'T00:00:00');
  const fim    = new Date(inicio);
  switch (periodo) {
    case 'semanal':     fim.setDate(fim.getDate() + 6);      break;
    case 'mensal':      fim.setMonth(fim.getMonth() + 1);    fim.setDate(fim.getDate() - 1); break;
    case 'bimestral':   fim.setMonth(fim.getMonth() + 2);    fim.setDate(fim.getDate() - 1); break;
    case 'trimestral':  fim.setMonth(fim.getMonth() + 3);    fim.setDate(fim.getDate() - 1); break;
    case 'semestral':   fim.setMonth(fim.getMonth() + 6);    fim.setDate(fim.getDate() - 1); break;
    case 'anual':       fim.setFullYear(fim.getFullYear()+1); fim.setDate(fim.getDate() - 1); break;
    default:            fim.setMonth(fim.getMonth() + 1);    fim.setDate(fim.getDate() - 1);
  }
  return { inicio: inicio.toISOString().slice(0,10), fim: fim.toISOString().slice(0,10) };
}

// ── Calcula progresso de uma lista de vendas para um indicador ───────────────
function calcularProgresso(vendas, indicador) {
  if (indicador === 'faturamento') {
    return (vendas||[]).reduce((s, v) => s + (parseFloat(v.valor) || 0), 0);
  }
  return (vendas||[]).length; // contratos
}

// ── Determina nível atingido e percentuais ───────────────────────────────────
function calcularNivel(atual, m1, m2, m3) {
  const nivel = atual >= m3 ? 3 : atual >= m2 ? 2 : atual >= m1 ? 1 : 0;
  return {
    nivel_atingido: nivel,
    pct_meta1: Math.min(100, Math.round((atual / m1) * 100)),
    pct_meta2: Math.min(100, Math.round((atual / m2) * 100)),
    pct_meta3: Math.min(100, Math.round((atual / m3) * 100)),
  };
}

// ─── GET /api/metas — metas visíveis para o usuário logado ──────────────────
router.get('/', authMiddleware, async (req, res) => {
  const corteData = new Date(Date.now() - 30*86400000).toISOString().slice(0,10);

  try {
    let metas = [];

    if (req.user.empresa_id) {
      // Usuário em equipe → metas da empresa
      const { data, error } = await supabase
        .from('metas')
        .select('*')
        .eq('empresa_id', req.user.empresa_id)
        .gte('data_fim', corteData)
        .order('data_inicio', { ascending: false });
      if (error) throw error;
      metas = (data||[]).filter(m => !m.user_ids || m.user_ids.includes(req.user.id));
    } else {
      // Usuário solo → metas individuais (empresa_id nulo, user_ids contém o usuário)
      const { data, error } = await supabase
        .from('metas')
        .select('*')
        .is('empresa_id', null)
        .contains('user_ids', [req.user.id])
        .gte('data_fim', corteData)
        .order('data_inicio', { ascending: false });
      if (error) throw error;
      metas = data || [];
    }

    const minhas = metas;

    if (!minhas.length) return res.json({ metas: [] });

    // Busca vendas de todas as metas em lote (período mais amplo)
    const minData = minhas.reduce((a,m) => m.data_inicio < a ? m.data_inicio : a, minhas[0].data_inicio);
    const maxData = minhas.reduce((a,m) => m.data_fim    > a ? m.data_fim    : a, minhas[0].data_fim);

    const { data: vendas } = await supabase
      .from('vendas')
      .select('user_id, valor, created_at')
      .eq('user_id', req.user.id)
      .gte('created_at', minData + 'T00:00:00')
      .lte('created_at', maxData + 'T23:59:59');

    // Monta resposta com progresso
    const resultado = minhas.map(m => {
      const vendasMeta = (vendas||[]).filter(v => {
        const d = v.created_at.slice(0,10);
        return d >= m.data_inicio && d <= m.data_fim;
      });
      const atual = calcularProgresso(vendasMeta, m.indicador);
      return { ...m, progresso_atual: atual, ...calcularNivel(atual, m.meta_1, m.meta_2, m.meta_3) };
    });

    res.json({ metas: resultado });
  } catch (err) {
    console.error('Erro ao buscar metas:', err.message);
    res.status(500).json({ erro: 'Erro ao buscar metas.' });
  }
});

// ─── GET /api/metas/gestor — todas as metas + progresso de cada membro ───────
router.get('/gestor', authMiddleware, async (req, res) => {
  if (req.user.role !== 'gestor' && req.user.role !== 'admin') return res.status(403).json({ erro: 'Restrito ao gestor.' });
  if (!req.user.empresa_id)       return res.status(400).json({ erro: 'Sem equipe.' });

  try {
    const { data: metas, error } = await supabase
      .from('metas')
      .select('*')
      .eq('empresa_id', req.user.empresa_id)
      .gte('data_fim', new Date(Date.now() - 30*86400000).toISOString().slice(0,10))
      .order('data_inicio', { ascending: false });

    if (error) throw error;
    if (!metas?.length) return res.json({ metas: [], membros: [] });

    const minData = metas.reduce((a,m) => m.data_inicio < a ? m.data_inicio : a, metas[0].data_inicio);
    const maxData = metas.reduce((a,m) => m.data_fim    > a ? m.data_fim    : a, metas[0].data_fim);

    const [{ data: vendas }, { data: membros }] = await Promise.all([
      supabase.from('vendas')
        .select('user_id, valor, created_at')
        .eq('empresa_id', req.user.empresa_id)
        .gte('created_at', minData + 'T00:00:00')
        .lte('created_at', maxData + 'T23:59:59'),
      supabase.from('users')
        .select('id, name, avatar_url')
        .eq('empresa_id', req.user.empresa_id),
    ]);

    // Para cada meta, calcula progresso por membro
    const resultado = (metas||[]).map(m => {
      const usuarios = m.user_ids
        ? (membros||[]).filter(u => m.user_ids.includes(u.id))
        : (membros||[]);

      const progressoPorMembro = usuarios.map(u => {
        const vendasMeta = (vendas||[]).filter(v => {
          const d = v.created_at.slice(0,10);
          return v.user_id === u.id && d >= m.data_inicio && d <= m.data_fim;
        });
        const atual = calcularProgresso(vendasMeta, m.indicador);
        return { ...u, progresso_atual: atual, ...calcularNivel(atual, m.meta_1, m.meta_2, m.meta_3) };
      }).sort((a,b) => b.progresso_atual - a.progresso_atual);

      // Progresso consolidado da equipe
      const totalEquipe = progressoPorMembro.reduce((s,u) => s + u.progresso_atual, 0);
      const mediaEquipe = progressoPorMembro.length ? totalEquipe / progressoPorMembro.length : 0;

      return {
        ...m,
        membros:         progressoPorMembro,
        total_equipe:    totalEquipe,
        media_equipe:    Math.round(mediaEquipe * 10) / 10,
        ...calcularNivel(mediaEquipe, m.meta_1, m.meta_2, m.meta_3),
      };
    });

    res.json({ metas: resultado, membros: membros||[] });
  } catch (err) {
    console.error('Erro ao buscar metas gestor:', err.message);
    res.status(500).json({ erro: 'Erro ao buscar metas.' });
  }
});

// ─── POST /api/metas — gestor ou usuário solo cria meta ──────────────────────
router.post('/', authMiddleware, async (req, res) => {
  const isGestorOuAdmin = req.user.role === 'gestor' || req.user.role === 'admin';
  // Vendedores de equipe não podem criar metas para a equipe
  if (!isGestorOuAdmin && req.user.empresa_id) {
    return res.status(403).json({ erro: 'Apenas o gestor pode criar metas para a equipe.' });
  }

  const { titulo, descricao, indicador, periodo, data_inicio, meta_1, meta_2, meta_3, user_ids } = req.body;

  if (!titulo)      return res.status(400).json({ erro: 'Título obrigatório.' });
  if (!periodo || !PERIODOS.includes(periodo)) return res.status(400).json({ erro: 'Período inválido.' });
  if (!data_inicio) return res.status(400).json({ erro: 'Data de início obrigatória.' });
  if (!meta_1 || !meta_2 || !meta_3) return res.status(400).json({ erro: 'As 3 metas são obrigatórias.' });

  const { fim } = calcularPeriodo(periodo, data_inicio);

  // Usuário solo: meta individual (sem empresa, apenas para si)
  const empresaId  = isGestorOuAdmin ? req.user.empresa_id : null;
  const membros    = isGestorOuAdmin && user_ids?.length ? user_ids : [req.user.id];

  try {
    const { data, error } = await supabase
      .from('metas')
      .insert({
        empresa_id:  empresaId,
        created_by:  req.user.id,
        titulo,
        descricao:   descricao || null,
        indicador:   indicador || 'contratos',
        periodo,
        data_inicio,
        data_fim:    fim,
        meta_1:      parseFloat(meta_1),
        meta_2:      parseFloat(meta_2),
        meta_3:      parseFloat(meta_3),
        user_ids:    membros,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ meta: data });
  } catch (err) {
    console.error('Erro ao criar meta:', err.message);
    res.status(500).json({ erro: 'Erro ao criar meta.' });
  }
});

// ─── PUT /api/metas/:id — gestor ou dono da meta individual edita ────────────
router.put('/:id', authMiddleware, async (req, res) => {
  const isGestorOuAdmin = req.user.role === 'gestor' || req.user.role === 'admin';

  // Verifica se o usuário tem permissão: gestor/admin da empresa OU criador da meta individual
  const { data: metaExistente } = await supabase.from('metas').select('empresa_id, created_by').eq('id', req.params.id).single();
  const ehDonoDaMeta = metaExistente?.created_by === req.user.id && !metaExistente?.empresa_id;
  if (!isGestorOuAdmin && !ehDonoDaMeta) return res.status(403).json({ erro: 'Sem permissão para editar esta meta.' });

  const { titulo, descricao, indicador, periodo, data_inicio, meta_1, meta_2, meta_3, user_ids } = req.body;
  const updates = { updated_at: new Date().toISOString() };

  if (titulo)      updates.titulo      = titulo;
  if (descricao !== undefined) updates.descricao = descricao;
  if (indicador)   updates.indicador   = indicador;
  if (meta_1)      updates.meta_1      = parseFloat(meta_1);
  if (meta_2)      updates.meta_2      = parseFloat(meta_2);
  if (meta_3)      updates.meta_3      = parseFloat(meta_3);
  if (isGestorOuAdmin && user_ids !== undefined) updates.user_ids = user_ids?.length ? user_ids : null;

  if (periodo && data_inicio) {
    updates.periodo     = periodo;
    updates.data_inicio = data_inicio;
    updates.data_fim    = calcularPeriodo(periodo, data_inicio).fim;
  }

  try {
    const { data, error } = await supabase
      .from('metas')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json({ meta: data });
  } catch (err) {
    console.error('Erro ao editar meta:', err.message);
    res.status(500).json({ erro: 'Erro ao editar meta.' });
  }
});

// ─── DELETE /api/metas/:id ───────────────────────────────────────────────────
router.delete('/:id', authMiddleware, async (req, res) => {
  const isGestorOuAdmin = req.user.role === 'gestor' || req.user.role === 'admin';
  const { data: metaExistente } = await supabase.from('metas').select('empresa_id, created_by').eq('id', req.params.id).single();
  const ehDonoDaMeta = metaExistente?.created_by === req.user.id && !metaExistente?.empresa_id;
  if (!isGestorOuAdmin && !ehDonoDaMeta) return res.status(403).json({ erro: 'Sem permissão para excluir esta meta.' });

  try {
    const { error } = await supabase
      .from('metas')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao excluir meta.' });
  }
});

module.exports = router;
