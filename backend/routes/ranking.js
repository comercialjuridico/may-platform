// ─── Ranking de Vendas — Leaderboard, Dashboard Gestor, Resumo Semanal ────────
const express = require('express');
const router  = express.Router();
const { supabase }       = require('../services/supabase');
const { authMiddleware } = require('../middleware/auth');

const TRIAL_DIAS = 7;

const ORIGENS_LABEL = {
  indicacao:      'Indicação',
  instagram:      'Instagram',
  trafego_meta:   'Meta Ads',
  trafego_google: 'Google Ads',
  grupo_whatsapp: 'WhatsApp',
  parceria:       'Parceria',
  tiktok:         'TikTok',
  outro:          'Outro',
};

const DIFIC_FERRAMENTA = {
  objecoes:     'Simulador de Objeções',
  abordagem:    'Primeiros Contatos',
  proposta:     'Gerador de Proposta',
  negociacao:   'Negociação sem Ceder',
  follow_up:    'Follow-up Estratégico',
  fechamento:   'Técnicas de Fechamento',
  qualificacao: 'Qualificação de Leads',
  mentalidade:  'Mentalidade Comercial',
};

// ── Trial: verifica / inicia acesso ao ranking ──────────────────────────────
async function verificarAcesso(empresa_id) {
  const { data: emp } = await supabase
    .from('empresas')
    .select('ranking_ativo, ranking_trial_inicio')
    .eq('id', empresa_id)
    .single();

  if (!emp) return { acesso: false, motivo: 'sem_empresa' };
  if (emp.ranking_ativo) return { acesso: true, trial: false };

  if (!emp.ranking_trial_inicio) {
    await supabase.from('empresas')
      .update({ ranking_trial_inicio: new Date().toISOString() })
      .eq('id', empresa_id);
    return { acesso: true, trial: true, dias_restantes: TRIAL_DIAS };
  }

  const diasPassados  = Math.floor((Date.now() - new Date(emp.ranking_trial_inicio)) / 86400000);
  const diasRestantes = Math.max(0, TRIAL_DIAS - diasPassados);

  return diasRestantes > 0
    ? { acesso: true,  trial: true,  dias_restantes: diasRestantes }
    : { acesso: false, trial: false, motivo: 'trial_expirado', dias_restantes: 0 };
}

// ── Início do período ────────────────────────────────────────────────────────
function inicioPeriodo(periodo) {
  const d = new Date();
  if (periodo === 'semana') {
    const dow = d.getDay();
    d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  } else {
    d.setDate(1);
  }
  d.setHours(0, 0, 0, 0);
  return d;
}

// ── Agrega vendas por usuário ────────────────────────────────────────────────
function agregarVendas(vendas) {
  const map = {};
  for (const v of (vendas || [])) {
    if (!map[v.user_id]) map[v.user_id] = { total: 0, count: 0, diasFech: [], origens: {} };
    const s = map[v.user_id];
    s.total += parseFloat(v.valor) || 0;
    s.count++;
    if (v.data_contato && v.data_fechamento) {
      const dias = Math.round(
        (new Date(v.data_fechamento) - new Date(v.data_contato)) / 86400000
      );
      if (dias >= 0) s.diasFech.push(dias);
    }
    if (v.origem) s.origens[v.origem] = (s.origens[v.origem] || 0) + 1;
  }
  return map;
}

// ─── GET /api/ranking/leaderboard?periodo=mes|semana ─────────────────────────
router.get('/leaderboard', authMiddleware, async (req, res) => {
  if (!req.user.empresa_id) return res.status(400).json({ erro: 'Sem equipe.' });

  const acesso = await verificarAcesso(req.user.empresa_id);
  if (!acesso.acesso) return res.status(403).json({ acesso, erro: 'Acesso ao ranking expirado.' });

  const periodo = req.query.periodo || 'mes';
  const inicio  = inicioPeriodo(periodo);

  try {
    const [{ data: vendas }, { data: membros }] = await Promise.all([
      supabase.from('vendas')
        .select('user_id, valor, data_contato, data_fechamento, origem, created_at')
        .eq('empresa_id', req.user.empresa_id)
        .gte('created_at', inicio.toISOString()),
      supabase.from('users')
        .select('id, name, email, avatar_url, mensagens_mes, maturidade, dificuldades, streak(dias_seguidos, xp_total, ultimo_treino)')
        .eq('empresa_id', req.user.empresa_id),
    ]);

    const statsMap = agregarVendas(vendas);
    const agora    = new Date();

    const ranking = (membros || []).map(m => {
      const s      = statsMap[m.id] || { total: 0, count: 0, diasFech: [], origens: {} };
      const streak = (Array.isArray(m.streak) ? m.streak[0] : m.streak) || {};
      const ultiTr = streak.ultimo_treino ? new Date(streak.ultimo_treino) : null;
      const semTr  = ultiTr ? Math.floor((agora - ultiTr) / 86400000) : null;
      const tmFech = s.diasFech.length
        ? Math.round(s.diasFech.reduce((a, b) => a + b, 0) / s.diasFech.length)
        : null;
      const origemTop = Object.entries(s.origens).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

      return {
        user_id:                m.id,
        name:                   m.name,
        email:                  m.email,
        avatar_url:             m.avatar_url,
        total_mes:              s.total,
        count_mes:              s.count,
        ticket_medio:           s.count > 0 ? Math.round(s.total / s.count) : 0,
        tempo_medio_fechamento: tmFech,
        origem_top:             origemTop ? ORIGENS_LABEL[origemTop] : null,
        xp_total:               streak.xp_total      || 0,
        streak:                 streak.dias_seguidos  || 0,
        treinos_mes:            m.mensagens_mes       || 0,
        dias_sem_treinar:       semTr,
        maturidade:             m.maturidade          || 0,
      };
    })
    .sort((a, b) => b.count_mes - a.count_mes || b.total_mes - a.total_mes)
    .map((r, i) => ({ ...r, posicao: i + 1 }));

    // ── Stats do time ──────────────────────────────────────────────────────
    const totalFaturado  = (vendas || []).reduce((s, v) => s + (parseFloat(v.valor) || 0), 0);
    const totalContratos = vendas?.length || 0;
    const ticketMedio    = totalContratos > 0 ? totalFaturado / totalContratos : 0;

    const todosDias = (vendas || [])
      .filter(v => v.data_contato && v.data_fechamento)
      .map(v => Math.round((new Date(v.data_fechamento) - new Date(v.data_contato)) / 86400000))
      .filter(d => d >= 0);
    const tempoMedioGeral = todosDias.length
      ? Math.round(todosDias.reduce((a, b) => a + b, 0) / todosDias.length)
      : null;

    const origensCount = {};
    (vendas || []).forEach(v => { if (v.origem) origensCount[v.origem] = (origensCount[v.origem] || 0) + 1; });
    const melhorOrigem = Object.entries(origensCount).sort((a, b) => b[1] - a[1])[0];

    res.json({
      ranking, acesso, periodo,
      periodo_inicio: inicio.toISOString(),
      stats_time: {
        total_faturado:         totalFaturado,
        total_contratos:        totalContratos,
        ticket_medio:           Math.round(ticketMedio),
        tempo_medio_fechamento: tempoMedioGeral,
        melhor_origem:          melhorOrigem ? ORIGENS_LABEL[melhorOrigem[0]] : null,
        melhor_origem_count:    melhorOrigem?.[1] || 0,
        top_vendedor:           ranking[0]?.name || null,
      },
    });
  } catch (err) {
    console.error('Erro leaderboard:', err.message);
    res.status(500).json({ erro: 'Erro ao buscar ranking.' });
  }
});

// ─── GET /api/ranking/dashboard — gestor ─────────────────────────────────────
router.get('/dashboard', authMiddleware, async (req, res) => {
  if (!req.user.empresa_id || req.user.role !== 'gestor') {
    return res.status(403).json({ erro: 'Acesso restrito ao gestor.' });
  }
  const acesso = await verificarAcesso(req.user.empresa_id);

  const inicioMes  = inicioPeriodo('mes');
  const inicioSem  = inicioPeriodo('semana');
  const inicioSemAnt = new Date(inicioSem);
  inicioSemAnt.setDate(inicioSemAnt.getDate() - 7);

  try {
    const [{ data: vendasMes }, { data: vendasSemAnt }, { data: membros }] = await Promise.all([
      supabase.from('vendas')
        .select('user_id, valor, data_contato, data_fechamento, origem, descricao, created_at')
        .eq('empresa_id', req.user.empresa_id)
        .gte('created_at', inicioMes.toISOString()),
      supabase.from('vendas')
        .select('user_id, valor')
        .eq('empresa_id', req.user.empresa_id)
        .gte('created_at', inicioSemAnt.toISOString())
        .lt('created_at', inicioSem.toISOString()),
      supabase.from('users')
        .select('id, name, maturidade, dificuldades, mensagens_mes, streak(dias_seguidos, xp_total, ultimo_treino)')
        .eq('empresa_id', req.user.empresa_id),
    ]);

    const statsMes = agregarVendas(vendasMes);
    const statsAnt = agregarVendas(vendasSemAnt);
    const agora    = new Date();

    // Vendas da semana atual (subset do mês)
    const vendasSemAtual = (vendasMes || []).filter(v => new Date(v.created_at) >= inicioSem);
    const statsSemAtual  = agregarVendas(vendasSemAtual);

    const colaboradores = (membros || []).map(m => {
      const sM     = statsMes[m.id]       || { total: 0, count: 0, diasFech: [], origens: {} };
      const sSA    = statsAnt[m.id]       || { total: 0, count: 0 };
      const sSAtu  = statsSemAtual[m.id]  || { total: 0, count: 0 };
      const streak = (Array.isArray(m.streak) ? m.streak[0] : m.streak) || {};
      const ultiTr = streak.ultimo_treino ? new Date(streak.ultimo_treino) : null;
      const semTr  = ultiTr ? Math.floor((agora - ultiTr) / 86400000) : null;
      const tmFech = sM.diasFech.length
        ? Math.round(sM.diasFech.reduce((a, b) => a + b, 0) / sM.diasFech.length)
        : null;
      const varContr = sSA.count > 0
        ? Math.round(((sSAtu.count - sSA.count) / sSA.count) * 100)
        : null;
      const origemTopKey = Object.entries(sM.origens).sort((a, b) => b[1] - a[1])[0]?.[0];

      // Insight automático
      const insights = [];
      let status = 'ok';

      if (sM.count === 0) {
        status = 'atencao';
        insights.push('Nenhuma venda registrada este mês');
      } else if (varContr !== null && varContr < -25) {
        status = 'queda';
        insights.push(`Queda de ${Math.abs(varContr)}% vs semana anterior`);
      } else if (varContr !== null && varContr > 25) {
        status = 'destaque';
        insights.push(`+${varContr}% vs semana anterior — em alta!`);
      }

      if (semTr !== null && semTr > 5) {
        if (status === 'ok') status = 'atencao';
        insights.push(`Sem treinar há ${semTr} dias`);
      }
      if (tmFech !== null && tmFech > 14) {
        insights.push(`Ciclo de fechamento longo (${tmFech} dias) — focar em follow-up`);
      }
      if (insights.length === 0) {
        insights.push('Ritmo consistente. Manter o foco!');
      }

      // O que treinar
      const dificArr = m.dificuldades ? m.dificuldades.split(',').filter(Boolean) : [];
      const oQueTreinar = dificArr.slice(0, 2).map(d => DIFIC_FERRAMENTA[d]).filter(Boolean);
      if (tmFech > 14 && !oQueTreinar.includes('Técnicas de Fechamento')) {
        oQueTreinar.push('Técnicas de Fechamento');
      }

      return {
        user_id:                m.id,
        name:                   m.name,
        contratos_mes:          sM.count,
        faturamento_mes:        sM.total,
        ticket_medio:           sM.count > 0 ? Math.round(sM.total / sM.count) : 0,
        tempo_medio_fechamento: tmFech,
        variacao_contratos:     varContr,
        maturidade:             m.maturidade || 0,
        dias_sem_treinar:       semTr,
        treinos_mes:            m.mensagens_mes || 0,
        origem_top:             origemTopKey ? ORIGENS_LABEL[origemTopKey] : null,
        status,
        insights,
        o_que_treinar: oQueTreinar.length > 0 ? oQueTreinar : ['Simulador de Objeções'],
      };
    }).sort((a, b) => b.contratos_mes - a.contratos_mes);

    // Alertas do time
    const semVendas = colaboradores.filter(c => c.contratos_mes === 0).map(c => c.name);
    const semTrein  = colaboradores.filter(c => c.dias_sem_treinar !== null && c.dias_sem_treinar > 5).map(c => c.name);
    const emDestaque = colaboradores.filter(c => c.status === 'destaque').map(c => c.name);

    // Distribuição por origem
    const origensGlobal = {};
    (vendasMes || []).forEach(v => {
      if (v.origem) origensGlobal[v.origem] = (origensGlobal[v.origem] || 0) + 1;
    });
    const origensRanking = Object.entries(origensGlobal)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => ({ origem: ORIGENS_LABEL[k] || k, count: v }));

    res.json({
      acesso,
      colaboradores,
      origens_time: origensRanking,
      alertas: [
        semVendas.length  ? { tipo: 'atencao', msg: `${semVendas.join(', ')} sem nenhuma venda este mês.` } : null,
        semTrein.length   ? { tipo: 'aviso',   msg: `${semTrein.join(', ')} sem treinar há mais de 5 dias.` } : null,
        emDestaque.length ? { tipo: 'destaque', msg: `${emDestaque.join(', ')} em alta esta semana! 🚀` } : null,
      ].filter(Boolean),
    });
  } catch (err) {
    console.error('Erro dashboard gestor:', err.message);
    res.status(500).json({ erro: 'Erro ao buscar dashboard.' });
  }
});

// ─── GET /api/ranking/minha-semana ────────────────────────────────────────────
router.get('/minha-semana', authMiddleware, async (req, res) => {
  if (!req.user.empresa_id) return res.status(400).json({ erro: 'Sem equipe.' });

  const inicioSem    = inicioPeriodo('semana');
  const inicioSemAnt = new Date(inicioSem);
  inicioSemAnt.setDate(inicioSemAnt.getDate() - 7);

  try {
    const [{ data: vendasSem }, { data: vendasAnt }, { data: todasSem }] = await Promise.all([
      supabase.from('vendas')
        .select('id, valor, descricao, origem, data_contato, data_fechamento, created_at')
        .eq('user_id', req.user.id)
        .gte('created_at', inicioSem.toISOString())
        .order('created_at', { ascending: false }),
      supabase.from('vendas')
        .select('valor')
        .eq('user_id', req.user.id)
        .gte('created_at', inicioSemAnt.toISOString())
        .lt('created_at', inicioSem.toISOString()),
      supabase.from('vendas')
        .select('user_id')
        .eq('empresa_id', req.user.empresa_id)
        .gte('created_at', inicioSem.toISOString()),
    ]);

    const totalSem   = (vendasSem || []).reduce((s, v) => s + (parseFloat(v.valor) || 0), 0);
    const countSem   = vendasSem?.length || 0;
    const totalAnt   = (vendasAnt || []).reduce((s, v) => s + (parseFloat(v.valor) || 0), 0);
    const countAnt   = vendasAnt?.length || 0;

    const diasFech = (vendasSem || [])
      .filter(v => v.data_contato && v.data_fechamento)
      .map(v => Math.round((new Date(v.data_fechamento) - new Date(v.data_contato)) / 86400000))
      .filter(d => d >= 0);
    const tempoMedio = diasFech.length
      ? Math.round(diasFech.reduce((a, b) => a + b, 0) / diasFech.length)
      : null;

    // Posição no ranking da semana (por contratos)
    const contagemTime = {};
    (todasSem || []).forEach(v => { contagemTime[v.user_id] = (contagemTime[v.user_id] || 0) + 1; });
    const sortedTime = Object.entries(contagemTime).sort((a, b) => b[1] - a[1]);
    const posicao    = sortedTime.findIndex(([uid]) => uid === req.user.id) + 1 || null;

    // O que treinar
    const dificArr    = req.user.dificuldades ? req.user.dificuldades.split(',').filter(Boolean) : [];
    let oQueTreinar   = dificArr.slice(0, 2).map(d => DIFIC_FERRAMENTA[d]).filter(Boolean);
    if (tempoMedio && tempoMedio > 14 && !oQueTreinar.includes('Técnicas de Fechamento'))
      oQueTreinar.push('Técnicas de Fechamento');
    if (oQueTreinar.length === 0)
      oQueTreinar = ['Simulador de Objeções', 'Follow-up Estratégico'];

    // Insight motivacional
    let insight = '';
    if (countSem === 0 && countAnt === 0) {
      insight = 'Essa semana é a hora de registrar sua primeira venda! Treine antes de cada atendimento.';
    } else if (countSem > countAnt) {
      insight = `Você fechou mais contratos do que na semana passada. Continue o ritmo — consistência é tudo!`;
    } else if (countSem < countAnt && countAnt > 0) {
      insight = `Semana mais fraca que a anterior. Revise o que mudou e treine as principais dificuldades.`;
    } else {
      insight = `Semana consistente. Hora de pressionar e superar seu recorde!`;
    }

    res.json({
      semana: {
        contratos:              countSem,
        faturamento:            totalSem,
        ticket_medio:           countSem > 0 ? Math.round(totalSem / countSem) : 0,
        tempo_medio_fechamento: tempoMedio,
      },
      semana_anterior: { contratos: countAnt, faturamento: totalAnt },
      variacao: {
        contratos:   countAnt > 0 ? Math.round(((countSem - countAnt) / countAnt) * 100) : null,
        faturamento: totalAnt > 0 ? Math.round(((totalSem - totalAnt) / totalAnt) * 100) : null,
      },
      posicao_semana: posicao,
      o_que_treinar:  oQueTreinar,
      insight,
      ultimas_vendas: (vendasSem || []).slice(0, 5).map(v => ({
        descricao: v.descricao,
        valor:     v.valor,
        origem:    v.origem ? ORIGENS_LABEL[v.origem] : null,
        data:      v.data_fechamento || v.created_at?.slice(0, 10),
      })),
    });
  } catch (err) {
    console.error('Erro minha-semana:', err.message);
    res.status(500).json({ erro: 'Erro ao buscar resumo semanal.' });
  }
});

module.exports = router;
