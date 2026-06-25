// ─── Rotas do Painel do Gestor ─────────────────────────────────────────────────
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../services/supabase');
const { authMiddleware } = require('../middleware/auth');

// Middleware: verifica se usuário é gestor ou admin
async function gestorMiddleware(req, res, next) {
  if (req.user.role !== 'gestor' && req.user.role !== 'admin') {
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

// ─── GET /api/gestor/convites ───────────────────────────────────────────────
// Lista convites enviados pela empresa (aceitos e pendentes)
router.get('/convites', authMiddleware, gestorMiddleware, async (req, res) => {
  try {
    const { data: convites, error } = await supabase
      .from('convites')
      .select('id, email, aceito, created_at, token')
      .eq('empresa_id', req.user.empresa_id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    // Conta membros atuais da empresa
    const { count: totalMembros } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('empresa_id', req.user.empresa_id);

    const { data: empresa } = await supabase
      .from('empresas')
      .select('max_membros, nome')
      .eq('id', req.user.empresa_id)
      .single();

    res.json({
      convites: convites || [],
      total_membros: totalMembros || 0,
      max_membros: empresa?.max_membros || 5,
      empresa_nome: empresa?.nome || '',
    });
  } catch (err) {
    console.error('Erro ao listar convites:', err.message);
    res.status(500).json({ erro: 'Erro ao buscar convites.' });
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
    const { data: userRow } = await supabase
      .from('users')
      .select('id, name, email, avatar_url, role')
      .eq('id', req.user.id)
      .single();

    if (!req.user.empresa_id) {
      return res.json({ tem_empresa: false, user: userRow });
    }
    const { data: empresa } = await supabase
      .from('empresas')
      .select('id, nome, max_membros')
      .eq('id', req.user.empresa_id)
      .single();

    res.json({ tem_empresa: true, empresa, role: req.user.role, user: userRow });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar info.' });
  }
});

// ─── GET /api/gestor/dashboard ───────────────────────────────────────────────
// Dashboard completo do gestor com KPIs, vendedores, vendas, origens e insights
router.get('/dashboard', authMiddleware, async (req, res) => {
  // Auth checks
  if (req.user.role !== 'gestor' && req.user.role !== 'admin') {
    return res.status(403).json({ erro: 'Acesso restrito a gestores.' });
  }
  if (!req.user.empresa_id) {
    return res.status(400).json({ erro: 'SEM_EMPRESA', mensagem: 'Nenhuma equipe criada ainda.' });
  }

  try {
    const agora = new Date();

    // ── Trial check para plano FREE ──────────────────────────────────────────
    // Admin nunca é bloqueado; planos pagos passam direto
    if (req.user.role !== 'admin' && req.user.plano === 'free') {
      const { data: empresaInfo } = await supabase
        .from('empresas')
        .select('created_at')
        .eq('id', req.user.empresa_id)
        .single();

      const trialInicio = empresaInfo?.created_at ? new Date(empresaInfo.created_at) : agora;
      const TRIAL_DIAS = 7;
      const diasPassados = Math.floor((agora - trialInicio) / (1000 * 60 * 60 * 24));
      const diasRestantes = Math.max(0, TRIAL_DIAS - diasPassados);
      const trialAtivo = diasPassados < TRIAL_DIAS;

      if (!trialAtivo) {
        return res.status(403).json({
          erro: 'TRIAL_EXPIRADO',
          mensagem: 'Seu período de teste gratuito de 7 dias expirou.',
          trial_expirado: true,
          upgrade_url: '/upgrade',
        });
      }

      // Trial ativo: retorna status junto com os dados
      const { data: empresaInfoFull } = await supabase
        .from('empresas')
        .select('id, nome, max_membros')
        .eq('id', req.user.empresa_id)
        .single();

      // Continua mas injeta trial_info na resposta — será adicionado ao final
      req._trialInfo = {
        trial_ativo: true,
        dias_restantes: diasRestantes,
        dias_usados: diasPassados,
      };
    }

    // ── Default date range: first day of current month → today ──────────────
    const primeiroDiaMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
    const dataInicioStr = req.query.data_inicio || primeiroDiaMes.toISOString().slice(0, 10);
    const dataFimStr    = req.query.data_fim    || agora.toISOString().slice(0, 10);

    const dataInicioISO = `${dataInicioStr}T00:00:00.000Z`;
    const dataFimISO    = `${dataFimStr}T23:59:59.999Z`;

    // Optional user filter
    const userIdsParam = req.query.user_ids;
    const userIdsArray = userIdsParam
      ? userIdsParam.split(',').map(id => id.trim()).filter(Boolean)
      : null;

    // ── 1. Busca vendas ──────────────────────────────────────────────────────
    let vendasQuery = supabase
      .from('vendas')
      .select('id, user_id, cliente, telefone, origem, descricao, valor, data_contato, data_fechamento, created_at')
      .eq('empresa_id', req.user.empresa_id)
      .gte('created_at', dataInicioISO)
      .lte('created_at', dataFimISO);

    if (userIdsArray) {
      vendasQuery = vendasQuery.in('user_id', userIdsArray);
    }

    const { data: vendasRaw, error: vendasError } = await vendasQuery;
    if (vendasError) throw vendasError;
    const vendas = vendasRaw || [];

    // ── 2. Busca usuários da empresa ─────────────────────────────────────────
    const { data: usersRaw, error: usersError } = await supabase
      .from('users')
      .select('id, name, avatar_url, mensagens_mes, maturidade, dificuldades, role')
      .eq('empresa_id', req.user.empresa_id);

    if (usersError) throw usersError;
    const users = usersRaw || [];

    // ── 3. Busca streaks de todos os usuários da empresa ─────────────────────
    const userIds = users.map(u => u.id);
    let streaksMap = {};
    if (userIds.length > 0) {
      const { data: streaksRaw } = await supabase
        .from('streak')
        .select('user_id, ultimo_treino, dias_seguidos')
        .in('user_id', userIds);

      (streaksRaw || []).forEach(s => {
        streaksMap[s.user_id] = s;
      });
    }

    // ── 4. KPIs globais ──────────────────────────────────────────────────────
    const totalContratos = vendas.length;

    const totalFaturamento = vendas.reduce((sum, v) => {
      return sum + (v.valor != null ? parseFloat(v.valor) : 0);
    }, 0);

    const ticketMedio = totalContratos > 0
      ? Math.round((totalFaturamento / totalContratos) * 100) / 100
      : 0;

    // Tempo médio de fechamento (dias entre data_contato e data_fechamento)
    const vendasComCiclo = vendas.filter(v => v.data_contato && v.data_fechamento);
    const tempMedioFechamento = vendasComCiclo.length > 0
      ? Math.round(
          vendasComCiclo.reduce((sum, v) => {
            const dias = (new Date(v.data_fechamento) - new Date(v.data_contato)) / (1000 * 60 * 60 * 24);
            return sum + dias;
          }, 0) / vendasComCiclo.length * 10
        ) / 10
      : null;

    // Top origem
    const origensCounts = {};
    vendas.forEach(v => {
      if (v.origem) {
        origensCounts[v.origem] = (origensCounts[v.origem] || 0) + 1;
      }
    });
    const topOrigem = Object.keys(origensCounts).length > 0
      ? Object.keys(origensCounts).reduce((a, b) => origensCounts[a] > origensCounts[b] ? a : b)
      : null;

    // Taxa de êxito: % de vendas onde valor NÃO é null (tem valor = fechou)
    const vendasComValor = vendas.filter(v => v.valor != null).length;
    const taxaExito = totalContratos > 0
      ? Math.round((vendasComValor / totalContratos) * 1000) / 10
      : 0;

    const kpis = {
      total_contratos: totalContratos,
      total_faturamento: Math.round(totalFaturamento * 100) / 100,
      ticket_medio: ticketMedio,
      tempo_medio_fechamento: tempMedioFechamento,
      top_origem: topOrigem,
      taxa_exito: taxaExito,
    };

    // ── 5. Stats por vendedor ─────────────────────────────────────────────────
    const usersMap = {};
    users.forEach(u => { usersMap[u.id] = u; });

    // Agrupa vendas por user_id
    const vendasPorUser = {};
    vendas.forEach(v => {
      if (!vendasPorUser[v.user_id]) vendasPorUser[v.user_id] = [];
      vendasPorUser[v.user_id].push(v);
    });

    // Filtra apenas vendedores (não-gestores) da empresa
    const vendedores = users
      .filter(u => u.role !== 'gestor')
      .map(u => {
        const uVendas = vendasPorUser[u.id] || [];
        const streak  = streaksMap[u.id] || {};

        const contratos    = uVendas.length;
        const faturamento  = uVendas.reduce((s, v) => s + (v.valor != null ? parseFloat(v.valor) : 0), 0);
        const uTicket      = contratos > 0 ? Math.round((faturamento / contratos) * 100) / 100 : 0;

        // Ciclo médio
        const uComCiclo = uVendas.filter(v => v.data_contato && v.data_fechamento);
        const uTempo = uComCiclo.length > 0
          ? Math.round(
              uComCiclo.reduce((s, v) => {
                return s + (new Date(v.data_fechamento) - new Date(v.data_contato)) / (1000 * 60 * 60 * 24);
              }, 0) / uComCiclo.length * 10
            ) / 10
          : null;

        // Dias sem treinar
        const ultimoTreino = streak.ultimo_treino ? new Date(streak.ultimo_treino) : null;
        const diasSemTreinar = ultimoTreino
          ? Math.floor((agora - ultimoTreino) / (1000 * 60 * 60 * 24))
          : null;

        // Status automático
        let status = 'ok';
        if (contratos === 0 && diasSemTreinar !== null && diasSemTreinar > 5) {
          status = 'queda';
        } else if (contratos === 0 || diasSemTreinar > 7) {
          status = 'atencao';
        } else if (
          contratos >= Math.ceil(totalContratos / Math.max(users.filter(u2 => u2.role !== 'gestor').length, 1) * 1.2)
        ) {
          status = 'destaque';
        }

        // Insights individuais
        const insights = [];
        if (diasSemTreinar === null) {
          insights.push('Nunca treinou — incentive o primeiro treino.');
        } else if (diasSemTreinar > 7) {
          insights.push(`Sem treinar há ${diasSemTreinar} dias — atenção ao engajamento.`);
        } else if (diasSemTreinar > 3) {
          insights.push(`${diasSemTreinar} dias sem treinar — considere um lembrete.`);
        }
        if (contratos === 0) {
          insights.push('Nenhuma venda no período — verificar pipeline.');
        } else if (uTicket > 0 && ticketMedio > 0 && uTicket < ticketMedio * 0.7) {
          insights.push('Ticket médio abaixo da média da equipe — foco em upsell.');
        }
        if (uTempo !== null && tempMedioFechamento !== null && uTempo > tempMedioFechamento * 1.5) {
          insights.push(`Ciclo de fechamento longo (${uTempo} dias) — considere reunião de apoio.`);
        }
        if (u.dificuldades) {
          insights.push(`Dificuldades relatadas: ${u.dificuldades}`);
        }

        return {
          user_id:               u.id,
          name:                  u.name,
          avatar_url:            u.avatar_url || null,
          contratos,
          faturamento:           Math.round(faturamento * 100) / 100,
          ticket_medio:          uTicket,
          tempo_medio_fechamento: uTempo,
          dias_sem_treinar:      diasSemTreinar,
          treinos_mes:           u.mensagens_mes || 0,
          maturidade:            u.maturidade || null,
          dificuldades:          u.dificuldades || null,
          status,
          insights,
        };
      });

    // ── 6. Vendas enriquecidas com nome/avatar ────────────────────────────────
    const vendasEnriquecidas = vendas.map(v => {
      const u = usersMap[v.user_id] || {};
      return {
        ...v,
        user_name:   u.name       || null,
        user_avatar: u.avatar_url || null,
      };
    });

    // ── 7. Origens ────────────────────────────────────────────────────────────
    const origensMap = {};
    vendas.forEach(v => {
      if (!v.origem) return;
      if (!origensMap[v.origem]) origensMap[v.origem] = { origem: v.origem, count: 0, total: 0 };
      origensMap[v.origem].count++;
      if (v.valor != null) origensMap[v.origem].total += parseFloat(v.valor);
    });
    const origens = Object.values(origensMap)
      .map(o => ({ ...o, total: Math.round(o.total * 100) / 100 }))
      .sort((a, b) => b.count - a.count);

    // ── 8. Insights do gestor ─────────────────────────────────────────────────
    const insightsGestor = [];

    const semTreinarMaisDe5 = vendedores.filter(
      v => v.dias_sem_treinar !== null && v.dias_sem_treinar > 5
    );
    if (semTreinarMaisDe5.length > 0) {
      insightsGestor.push(
        `${semTreinarMaisDe5.length} vendedor${semTreinarMaisDe5.length > 1 ? 'es' : ''} sem treinar há mais de 5 dias.`
      );
    }

    const semVendas = vendedores.filter(v => v.contratos === 0);
    if (semVendas.length > 0) {
      const nomes = semVendas.map(v => v.name).join(', ');
      insightsGestor.push(`${semVendas.length} vendedor${semVendas.length > 1 ? 'es' : ''} sem vendas no período: ${nomes}.`);
    }

    // Maior ciclo de fechamento
    const comCiclo = vendedores.filter(v => v.tempo_medio_fechamento !== null);
    if (comCiclo.length > 0) {
      const maiorCiclo = comCiclo.reduce((a, b) =>
        a.tempo_medio_fechamento > b.tempo_medio_fechamento ? a : b
      );
      if (tempMedioFechamento !== null && maiorCiclo.tempo_medio_fechamento > tempMedioFechamento * 1.4) {
        insightsGestor.push(
          `${maiorCiclo.name} tem o maior ciclo de fechamento (${maiorCiclo.tempo_medio_fechamento} dias) — considere uma reunião de apoio.`
        );
      }
    }

    // Ticket abaixo da média
    const ticketAbaixo = vendedores.filter(
      v => v.contratos > 0 && ticketMedio > 0 && v.ticket_medio < ticketMedio * 0.7
    );
    if (ticketAbaixo.length > 0) {
      insightsGestor.push(
        `${ticketAbaixo.length} vendedor${ticketAbaixo.length > 1 ? 'es' : ''} com ticket médio abaixo de 70% da média da equipe.`
      );
    }

    if (topOrigem) {
      const topCount = origensCounts[topOrigem];
      const pct = totalContratos > 0 ? Math.round((topCount / totalContratos) * 100) : 0;
      if (pct > 50) {
        insightsGestor.push(
          `Origem "${topOrigem}" representa ${pct}% das vendas — considere diversificar canais.`
        );
      }
    }

    // ── 9. Sugestão de reunião (lógica, não IA) ───────────────────────────────
    let sugestaoReuniao = null;

    // Prioridade 1: vendedor sem vendas
    const vendedorSemVenda = vendedores.find(v => v.contratos === 0);
    if (vendedorSemVenda) {
      const pauta = ['Revisar pipeline de oportunidades em aberto.'];
      if (vendedorSemVenda.dias_sem_treinar !== null && vendedorSemVenda.dias_sem_treinar > 3) {
        pauta.push(`Retomar rotina de treinos (${vendedorSemVenda.dias_sem_treinar} dias parado).`);
      }
      if (vendedorSemVenda.dificuldades) {
        pauta.push(`Trabalhar dificuldades relatadas: ${vendedorSemVenda.dificuldades}.`);
      }
      pauta.push('Definir metas de atividade para a próxima semana.');
      pauta.push('Avaliar se o script de abordagem precisa ser ajustado.');

      sugestaoReuniao = {
        tipo:          'individual',
        vendedor_nome: vendedorSemVenda.name,
        motivo:        `${vendedorSemVenda.name} não registrou vendas no período e pode precisar de suporte.`,
        pauta,
      };
    } else {
      // Prioridade 2: média da equipe abaixo de algum limiar (ex.: ticket médio baixo ou muitos sem treino)
      const mediaContratosPorVendedor = vendedores.length > 0
        ? totalContratos / vendedores.length
        : 0;
      const precisaReuniaoTime =
        semTreinarMaisDe5.length >= Math.ceil(vendedores.length / 2) ||
        (mediaContratosPorVendedor < 2 && totalContratos < vendedores.length);

      if (precisaReuniaoTime) {
        const pauta = ['Revisão dos números do período e metas restantes do mês.'];
        if (semTreinarMaisDe5.length > 0) {
          pauta.push(`Reforçar importância dos treinos — ${semTreinarMaisDe5.length} vendedor${semTreinarMaisDe5.length > 1 ? 'es' : ''} inativos.`);
        }
        if (topOrigem) {
          pauta.push(`Avaliar qualidade dos leads de "${topOrigem}" e estratégias de diversificação.`);
        }
        pauta.push('Compartilhar boas práticas dos vendedores em destaque.');
        pauta.push('Alinhar abordagem de objeções e ciclo de fechamento.');

        sugestaoReuniao = {
          tipo:   'time',
          motivo: 'Desempenho geral abaixo do esperado — alinhamento de equipe recomendado.',
          pauta,
        };
      } else if (comCiclo.length > 0) {
        // Prioridade 3: vendedor com ciclo de fechamento muito longo
        const maiorCiclo = comCiclo.reduce((a, b) =>
          a.tempo_medio_fechamento > b.tempo_medio_fechamento ? a : b
        );
        if (tempMedioFechamento !== null && maiorCiclo.tempo_medio_fechamento > tempMedioFechamento * 1.4) {
          sugestaoReuniao = {
            tipo:          'individual',
            vendedor_nome: maiorCiclo.name,
            motivo:        `${maiorCiclo.name} tem ciclo de fechamento de ${maiorCiclo.tempo_medio_fechamento} dias, acima da média da equipe.`,
            pauta: [
              'Mapear em quais etapas o cliente trava mais.',
              'Revisar técnicas de negociação e manejo de objeções.',
              'Analisar os últimos 3 casos que demoraram mais para fechar.',
              'Definir gatilhos de urgência adequados ao perfil do cliente.',
              'Acompanhar próximas negociações em tempo real se necessário.',
            ],
          };
        }
      }
    }

    // ── Resposta final ────────────────────────────────────────────────────────
    return res.json({
      periodo:          { data_inicio: dataInicioStr, data_fim: dataFimStr },
      kpis,
      vendedores,
      vendas:           vendasEnriquecidas,
      origens,
      insights_gestor:  insightsGestor,
      sugestao_reuniao: sugestaoReuniao,
      trial_info:       req._trialInfo || null,
    });
  } catch (err) {
    console.error('Erro ao buscar dashboard do gestor:', err.message);
    res.status(500).json({ erro: 'Erro ao carregar dashboard.' });
  }
});

module.exports = router;
