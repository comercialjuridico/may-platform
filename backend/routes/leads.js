// ─── Rotas de Leads — Funil SDR → IA → Closer ───────────────────────────────
const express = require('express');
const router  = express.Router();
const OpenAI  = require('openai');
const { supabase }       = require('../services/supabase');
const { authMiddleware } = require('../middleware/auth');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── GET /api/leads/agenda ───────────────────────────────────────────────────
// Reuniões da semana (ou semana específica)
router.get('/agenda', authMiddleware, async (req, res) => {
  try {
    const semana = req.query.semana; // YYYY-MM-DD (qualquer dia da semana ou primeiro dia do mês)
    const fimQs  = req.query.fim;    // YYYY-MM-DD opcional (para vista mensal)
    const ref    = semana ? new Date(semana) : new Date();

    let inicio, fim;
    if (fimQs) {
      // Vista mensal: inicio e fim passados diretamente
      inicio = new Date(semana);
      inicio.setHours(0, 0, 0, 0);
      fim = new Date(fimQs);
      fim.setHours(23, 59, 59, 999);
    } else {
      // Vista semanal: calcular seg-dom
      const dow  = ref.getDay();
      const diff = (dow === 0 ? -6 : 1 - dow);
      inicio = new Date(ref);
      inicio.setDate(ref.getDate() + diff);
      inicio.setHours(0, 0, 0, 0);
      fim = new Date(inicio);
      fim.setDate(inicio.getDate() + 6);
      fim.setHours(23, 59, 59, 999);
    }

    const { data, error } = await supabase
      .from('leads')
      .select(`
        id, nome_lead, empresa_lead, contexto, objecao_inicial, origem,
        status, briefing, data_reuniao, local_reuniao, valor_estimado,
        sdr:sdr_id(id, name),
        closer:closer_id(id, name)
      `)
      .eq('empresa_id', req.user.empresa_id)
      .not('data_reuniao', 'is', null)
      .gte('data_reuniao', inicio.toISOString())
      .lte('data_reuniao', fim.toISOString())
      .order('data_reuniao', { ascending: true });

    if (error) throw error;

    res.json({
      semana_inicio: inicio.toISOString(),
      semana_fim:    fim.toISOString(),
      reunioes:      data || [],
    });
  } catch (err) {
    console.error('Erro ao buscar agenda:', err.message);
    res.status(500).json({ erro: 'Erro ao buscar agenda.' });
  }
});

// ─── GET /api/leads ──────────────────────────────────────────────────────────
// Lista leads da empresa do usuário
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { status, closer_id } = req.query;

    let query = supabase
      .from('leads')
      .select(`
        id, nome_lead, empresa_lead, whatsapp, produto, valor_honorarios,
        prioridade, origem, origem_canal, contexto, objecao_inicial,
        status, resultado, valor_estimado, valor_fechado, briefing,
        data_reuniao, local_reuniao, participou_reuniao, fechado_em, created_at,
        sdr:sdr_id(id, name),
        closer:closer_id(id, name)
      `)
      .eq('empresa_id', req.user.empresa_id)
      .order('created_at', { ascending: false });

    if (status)    query = query.eq('status', status);
    if (closer_id) query = query.eq('closer_id', closer_id);

    const { data, error } = await query.limit(100);
    if (error) throw error;

    res.json({ leads: data || [] });
  } catch (err) {
    console.error('Erro ao listar leads:', err.message);
    res.status(500).json({ erro: 'Erro ao buscar leads.' });
  }
});

// ─── POST /api/leads ─────────────────────────────────────────────────────────
// SDR registra novo lead + May gera briefing automaticamente
router.post('/', authMiddleware, async (req, res) => {
  try {
    const {
      nome_lead, empresa_lead, contexto, objecao_inicial, origem, closer_id,
      valor_estimado, whatsapp, produto, valor_honorarios, prioridade,
      origem_canal, data_reuniao, local_reuniao, status, fechado_em,
      participou_reuniao, _sem_briefing,
    } = req.body;

    if (!nome_lead) {
      return res.status(400).json({ erro: 'Nome do lead é obrigatório.' });
    }

    if (!req.user.empresa_id) {
      return res.status(400).json({ erro: 'Usuário não vinculado a uma empresa. Fale com o gestor.' });
    }

    const textoContexto = contexto || 'Registrado manualmente.';

    // Gera briefing com May (opcional)
    let briefing = null;
    if (!_sem_briefing) {
      briefing = await gerarBriefing({ nome_lead, empresa_lead, contexto: textoContexto, objecao_inicial, origem: origem_canal || origem }).catch(() => null);
    }

    const { data: lead, error } = await supabase
      .from('leads')
      .insert({
        empresa_id:        req.user.empresa_id,
        sdr_id:            req.user.id,
        closer_id:         closer_id || null,
        nome_lead,
        empresa_lead:      empresa_lead || null,
        whatsapp:          whatsapp || null,
        produto:           produto || null,
        valor_honorarios:  valor_honorarios || null,
        prioridade:        prioridade || 'media',
        origem:            origem_canal || origem || 'não informada',
        origem_canal:      origem_canal || null,
        contexto:          textoContexto,
        objecao_inicial:   objecao_inicial || null,
        valor_estimado:    valor_estimado || null,
        data_reuniao:      data_reuniao || null,
        local_reuniao:     local_reuniao || null,
        participou_reuniao: participou_reuniao !== undefined ? participou_reuniao : null,
        status:            'briefing_gerado',
        fechado_em:        fechado_em || null,
        briefing,
      })
      .select()
      .single();

    if (error) throw error;

    res.json({ ok: true, lead });
  } catch (err) {
    console.error('Erro ao criar lead:', err.message, err.details, err.hint);
    res.status(500).json({ erro: `Erro ao registrar lead: ${err.message || err}` });
  }
});

// ─── PATCH /api/leads/:id/status ─────────────────────────────────────────────
// Closer atualiza status + registra resultado pós-reunião
router.patch('/:id/status', authMiddleware, async (req, res) => {
  try {
    const { status, resultado, valor_fechado, data_reuniao, local_reuniao } = req.body;

    const statusValidos = ['novo', 'briefing_gerado', 'reuniao_agendada', 'negociando', 'ganhou', 'perdeu'];
    if (!statusValidos.includes(status)) {
      return res.status(400).json({ erro: 'Status inválido.' });
    }

    // Verifica se lead é da empresa do usuário
    const { data: lead } = await supabase
      .from('leads')
      .select('id, empresa_id, sdr_id, closer_id')
      .eq('id', req.params.id)
      .single();

    if (!lead || lead.empresa_id !== req.user.empresa_id) {
      return res.status(404).json({ erro: 'Lead não encontrado.' });
    }

    const updates = { status };
    if (resultado)     updates.resultado     = resultado;
    if (valor_fechado) updates.valor_fechado = valor_fechado;
    if (data_reuniao)  updates.data_reuniao  = data_reuniao;
    if (local_reuniao) updates.local_reuniao = local_reuniao;

    // Se ganhou/perdeu, registra data
    if (['ganhou', 'perdeu'].includes(status)) {
      updates.fechado_em = new Date().toISOString();

      // Se ganhou, registra como venda
      if (status === 'ganhou' && valor_fechado) {
        await supabase.from('vendas').insert({
          user_id:     req.user.id,
          empresa_id:  req.user.empresa_id,
          valor:       valor_fechado,
          descricao:   `Lead: ${lead.nome_lead || 'fechamento via funil'}`,
          data_venda:  new Date().toISOString(),
        }).catch(() => {});
      }
    }

    const { data: updated, error } = await supabase
      .from('leads')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;

    res.json({ ok: true, lead: updated });
  } catch (err) {
    console.error('Erro ao atualizar lead:', err.message);
    res.status(500).json({ erro: 'Erro ao atualizar lead.' });
  }
});

// ─── POST /api/leads/:id/rebriefing ──────────────────────────────────────────
// Closer pede novo briefing com contexto adicional
router.post('/:id/rebriefing', authMiddleware, async (req, res) => {
  try {
    const { contexto_extra } = req.body;

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', req.params.id)
      .eq('empresa_id', req.user.empresa_id)
      .single();

    if (!lead) return res.status(404).json({ erro: 'Lead não encontrado.' });

    const contextoCompleto = lead.contexto + (contexto_extra ? `\n\nContexto adicional: ${contexto_extra}` : '');

    const briefing = await gerarBriefing({
      nome_lead:       lead.nome_lead,
      empresa_lead:    lead.empresa_lead,
      contexto:        contextoCompleto,
      objecao_inicial: lead.objecao_inicial,
      origem:          lead.origem,
    });

    await supabase.from('leads').update({ briefing }).eq('id', req.params.id);

    res.json({ ok: true, briefing });
  } catch (err) {
    console.error('Erro ao regerar briefing:', err.message);
    res.status(500).json({ erro: 'Erro ao gerar briefing.' });
  }
});

// ─── GET /api/leads/funil ────────────────────────────────────────────────────
// Dados do funil para o painel do gestor
router.get('/funil', authMiddleware, async (req, res) => {
  try {
    const { data: leads } = await supabase
      .from('leads')
      .select('status, valor_fechado, sdr_id, closer_id, created_at, fechado_em')
      .eq('empresa_id', req.user.empresa_id);

    const todos       = leads || [];
    const total       = todos.length;
    const reunioes    = todos.filter(l => ['reuniao_agendada','negociando','ganhou','perdeu'].includes(l.status)).length;
    const ganhos      = todos.filter(l => l.status === 'ganhou').length;
    const perdidos    = todos.filter(l => l.status === 'perdeu').length;
    const negociando  = todos.filter(l => l.status === 'negociando').length;
    const valorTotal  = todos.filter(l => l.status === 'ganhou').reduce((s, l) => s + (parseFloat(l.valor_fechado) || 0), 0);

    const taxaReuniao    = total    > 0 ? ((reunioes / total) * 100).toFixed(1)   : '0.0';
    const taxaFechamento = reunioes > 0 ? ((ganhos / reunioes) * 100).toFixed(1)  : '0.0';
    const taxaGeral      = total    > 0 ? ((ganhos / total) * 100).toFixed(1)     : '0.0';

    // Ranking dos closers
    const closers = {};
    todos.forEach(l => {
      if (!l.closer_id) return;
      if (!closers[l.closer_id]) closers[l.closer_id] = { reunioes: 0, ganhos: 0, perdidos: 0 };
      if (['reuniao_agendada','negociando','ganhou','perdeu'].includes(l.status)) closers[l.closer_id].reunioes++;
      if (l.status === 'ganhou') closers[l.closer_id].ganhos++;
      if (l.status === 'perdeu') closers[l.closer_id].perdidos++;
    });

    res.json({
      funil: { total, reunioes, ganhos, perdidos, negociando, valorTotal },
      taxas: { taxaReuniao, taxaFechamento, taxaGeral },
      closers,
    });
  } catch (err) {
    console.error('Erro ao buscar funil:', err.message);
    res.status(500).json({ erro: 'Erro ao buscar dados do funil.' });
  }
});

// ─── DELETE /api/leads/:id ────────────────────────────────────────────────────
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const { data: lead } = await supabase
      .from('leads')
      .select('id, empresa_id, sdr_id')
      .eq('id', req.params.id)
      .single();

    if (!lead || lead.empresa_id !== req.user.empresa_id) {
      return res.status(404).json({ erro: 'Lead não encontrado.' });
    }

    // Só o SDR que criou ou gestor pode deletar
    if (lead.sdr_id !== req.user.id && req.user.papel !== 'gestor') {
      return res.status(403).json({ erro: 'Sem permissão.' });
    }

    await supabase.from('leads').delete().eq('id', req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao remover lead.' });
  }
});

// ─── Geração de briefing via May ─────────────────────────────────────────────
async function gerarBriefing({ nome_lead, empresa_lead, contexto, objecao_inicial, origem }) {
  const prompt = `Você é May, assistente comercial jurídica da Comercial Jurídico.

Um SDR qualificou o seguinte lead e passou para o closer. Gere um briefing objetivo e prático para o closer entrar na reunião preparado.

DADOS DO LEAD:
- Nome: ${nome_lead}
- Empresa/Escritório: ${empresa_lead || 'não informado'}
- Origem: ${origem || 'não informada'}
- Contexto levantado pelo SDR: ${contexto}
- Objeção inicial (se houver): ${objecao_inicial || 'nenhuma relatada'}

ESTRUTURA DO BRIEFING (responda exatamente neste formato, sem introdução):

🎯 PERFIL DO LEAD
[2-3 linhas: quem é, qual dor principal, nível de urgência estimado]

💬 ABERTURA SUGERIDA
[1 frase de abertura que retoma o que o SDR deixou + pergunta de diagnóstico poderosa]

⚡ PONTOS DE ATENÇÃO
[2-3 bullets: o que pode travar esse lead + como antecipar]

🛡️ COMO TRATAR A OBJEÇÃO PRINCIPAL
[Se houver objeção inicial: resposta direta e objetiva. Se não houver: aponte a objeção mais provável dado o perfil]

✅ OBJETIVO DA REUNIÃO
[1 linha: qual é o próximo passo concreto que o closer deve conseguir ao final da reunião]`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }],
  });

  return completion.choices[0]?.message?.content || 'Briefing não gerado. Tente novamente.';
}

// ─── PATCH /api/leads/:id ─────────────────────────────────────────────────────
// Atualização completa de campos do lead (edição inline na tabela)
router.patch('/:id', authMiddleware, async (req, res) => {
  try {
    const camposPermitidos = [
      'nome_lead', 'empresa_lead', 'whatsapp', 'produto', 'valor_honorarios',
      'prioridade', 'origem_canal', 'sdr_id', 'closer_id',
      'data_reuniao', 'local_reuniao', 'participou_reuniao',
      'status', 'resultado', 'valor_fechado', 'fechado_em',
      'contexto', 'objecao_inicial',
    ];

    const updates = {};
    camposPermitidos.forEach(c => {
      if (req.body[c] !== undefined) updates[c] = req.body[c] === '' ? null : req.body[c];
    });

    if (!Object.keys(updates).length) return res.status(400).json({ erro: 'Nenhum campo para atualizar.' });

    // Se está marcando como ganhou/perdeu, registra data de fechamento
    if (updates.status === 'ganhou' && !updates.fechado_em) {
      updates.fechado_em = new Date().toISOString();
    }

    const { data: lead } = await supabase
      .from('leads').select('id, empresa_id').eq('id', req.params.id).single();

    if (!lead || lead.empresa_id !== req.user.empresa_id) {
      return res.status(404).json({ erro: 'Lead não encontrado.' });
    }

    const { data: updated, error } = await supabase
      .from('leads').update(updates).eq('id', req.params.id).select().single();

    if (error) throw error;

    // Se fechou com valor, registra como venda
    if (updates.status === 'ganhou' && updates.valor_fechado) {
      await supabase.from('vendas').insert({
        user_id:    req.user.id,
        empresa_id: req.user.empresa_id,
        valor:      updates.valor_fechado,
        descricao:  `Lead fechado: ${updated.nome_lead}`,
        data_venda: updates.fechado_em || new Date().toISOString(),
      }).catch(() => {});
    }

    res.json({ ok: true, lead: updated });
  } catch (err) {
    console.error('Erro ao atualizar lead:', err.message);
    res.status(500).json({ erro: 'Erro ao atualizar lead.' });
  }
});

// ─── GET /api/leads/relatorio ─────────────────────────────────────────────────
// Relatório completo: no-show, fechamento, tempo médio, rankings, origens
router.get('/relatorio', authMiddleware, async (req, res) => {
  try {
    const { data_inicio, data_fim } = req.query;

    let query = supabase
      .from('leads')
      .select(`
        id, status, created_at, fechado_em, data_reuniao, participou_reuniao,
        origem, origem_canal, produto, valor_honorarios, valor_fechado,
        sdr:sdr_id(id, name),
        closer:closer_id(id, name)
      `)
      .eq('empresa_id', req.user.empresa_id);

    if (data_inicio) query = query.gte('created_at', data_inicio);
    if (data_fim)    query = query.lte('created_at', data_fim + 'T23:59:59Z');

    const { data: leads, error } = await query;
    if (error) throw error;

    const todos          = leads || [];
    const comReuniao     = todos.filter(l => l.data_reuniao);
    const noShow         = comReuniao.filter(l => l.participou_reuniao === false);
    const participaram   = comReuniao.filter(l => l.participou_reuniao === true);
    const ganhos         = todos.filter(l => l.status === 'ganhou');
    const perdidos       = todos.filter(l => l.status === 'perdeu');

    // Tempo médio de fechamento (dias)
    const tempos = ganhos
      .filter(l => l.created_at && l.fechado_em)
      .map(l => (new Date(l.fechado_em) - new Date(l.created_at)) / (1000 * 60 * 60 * 24));
    const tempoMedio = tempos.length ? (tempos.reduce((a, b) => a + b, 0) / tempos.length).toFixed(1) : null;

    // Taxas
    const taxaNoShow      = comReuniao.length  > 0 ? ((noShow.length / comReuniao.length) * 100).toFixed(1)      : '0.0';
    const taxaFechamento  = participaram.length > 0 ? ((ganhos.length / participaram.length) * 100).toFixed(1)    : '0.0';
    const taxaGeralLead   = todos.length        > 0 ? ((ganhos.length / todos.length) * 100).toFixed(1)           : '0.0';

    // Ranking SDR (quem mais agenda reuniões)
    const rankingSdr = {};
    comReuniao.forEach(l => {
      const k = l.sdr?.id;
      if (!k) return;
      if (!rankingSdr[k]) rankingSdr[k] = { nome: l.sdr.name, reunioes: 0 };
      rankingSdr[k].reunioes++;
    });
    const topSdr = Object.values(rankingSdr).sort((a, b) => b.reunioes - a.reunioes);

    // Ranking Closer (quem mais fecha)
    const rankingCloser = {};
    ganhos.forEach(l => {
      const k = l.closer?.id;
      if (!k) return;
      if (!rankingCloser[k]) rankingCloser[k] = { nome: l.closer.name, fechamentos: 0, valor: 0 };
      rankingCloser[k].fechamentos++;
      rankingCloser[k].valor += parseFloat(l.valor_fechado || l.valor_honorarios || 0);
    });
    const topCloser = Object.values(rankingCloser).sort((a, b) => b.fechamentos - a.fechamentos);

    // Origem que mais fecha
    const origens = {};
    ganhos.forEach(l => {
      const k = l.origem_canal || l.origem || 'não informada';
      if (!origens[k]) origens[k] = { origem: k, fechamentos: 0, valor: 0 };
      origens[k].fechamentos++;
      origens[k].valor += parseFloat(l.valor_fechado || l.valor_honorarios || 0);
    });
    const topOrigens = Object.values(origens).sort((a, b) => b.fechamentos - a.fechamentos);

    // Produto mais vendido
    const produtos = {};
    ganhos.forEach(l => {
      const k = l.produto || 'não informado';
      if (!produtos[k]) produtos[k] = { produto: k, total: 0 };
      produtos[k].total++;
    });
    const topProdutos = Object.values(produtos).sort((a, b) => b.total - a.total);

    // Receita total
    const receitaTotal = ganhos.reduce((s, l) => s + parseFloat(l.valor_fechado || l.valor_honorarios || 0), 0);

    res.json({
      resumo: {
        total_leads:    todos.length,
        com_reuniao:    comReuniao.length,
        no_show:        noShow.length,
        participaram:   participaram.length,
        ganhos:         ganhos.length,
        perdidos:       perdidos.length,
        receita_total:  receitaTotal,
        tempo_medio_fechamento: tempoMedio,
      },
      taxas: { taxaNoShow, taxaFechamento, taxaGeralLead },
      rankings: { sdr: topSdr, closer: topCloser },
      origens:  topOrigens,
      produtos: topProdutos,
    });
  } catch (err) {
    console.error('Erro no relatório:', err.message);
    res.status(500).json({ erro: 'Erro ao gerar relatório.' });
  }
});

module.exports = router;
