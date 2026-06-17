// ─── Rotas de Leads — Funil SDR → IA → Closer ───────────────────────────────
const express = require('express');
const router  = express.Router();
const OpenAI  = require('openai');
const { supabase }       = require('../services/supabase');
const { authMiddleware } = require('../middleware/auth');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── GET /api/leads ──────────────────────────────────────────────────────────
// Lista leads da empresa do usuário
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { status, closer_id } = req.query;

    let query = supabase
      .from('leads')
      .select(`
        id, nome_lead, empresa_lead, contexto, objecao_inicial, origem,
        status, resultado, valor_estimado, briefing, created_at,
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
    const { nome_lead, empresa_lead, contexto, objecao_inicial, origem, closer_id, valor_estimado } = req.body;

    if (!nome_lead || !contexto) {
      return res.status(400).json({ erro: 'Nome do lead e contexto são obrigatórios.' });
    }

    if (!req.user.empresa_id) {
      return res.status(400).json({ erro: 'Usuário não vinculado a uma empresa. Fale com o gestor.' });
    }

    // Gera briefing com May
    const briefing = await gerarBriefing({ nome_lead, empresa_lead, contexto, objecao_inicial, origem });

    const { data: lead, error } = await supabase
      .from('leads')
      .insert({
        empresa_id:     req.user.empresa_id,
        sdr_id:         req.user.id,
        closer_id:      closer_id || null,
        nome_lead,
        empresa_lead:   empresa_lead || null,
        contexto,
        objecao_inicial: objecao_inicial || null,
        origem:         origem || 'não informada',
        valor_estimado: valor_estimado || null,
        briefing,
        status:         'briefing_gerado',
      })
      .select()
      .single();

    if (error) throw error;

    res.json({ ok: true, lead });
  } catch (err) {
    console.error('Erro ao criar lead:', err.message);
    res.status(500).json({ erro: 'Erro ao registrar lead.' });
  }
});

// ─── PATCH /api/leads/:id/status ─────────────────────────────────────────────
// Closer atualiza status + registra resultado pós-reunião
router.patch('/:id/status', authMiddleware, async (req, res) => {
  try {
    const { status, resultado, valor_fechado } = req.body;

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
    if (resultado)    updates.resultado    = resultado;
    if (valor_fechado) updates.valor_fechado = valor_fechado;

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

module.exports = router;
