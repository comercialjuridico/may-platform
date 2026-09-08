// ─── Briefing de Reuniões ─────────────────────────────────────────────────────
// Tela dedicada dentro do app: a pessoa cadastra o lead, a May gera o relatório
// de preparação para a reunião e depois ela registra como o briefing ajudou.
//
// Usa a mesma tabela `leads` do funil, mas com uma API própria e enxuta, para
// não depender do módulo de gestão (que saiu do produto no lançamento).
const express = require('express');
const router  = express.Router();
const OpenAI  = require('openai');
const { supabase }       = require('../services/supabase');
const { authMiddleware } = require('../middleware/auth');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Colunas de feedback são opcionais: se a migração ainda não rodou no banco,
// a tela continua funcionando sem elas em vez de quebrar inteira.
const CAMPOS_BASE = `
  id, nome_lead, empresa_lead, whatsapp, produto, valor_honorarios,
  origem, origem_canal, contexto, objecao_inicial, status, resultado,
  briefing, data_reuniao, local_reuniao, participou_reuniao,
  fechado_em, created_at
`;
const CAMPOS_FEEDBACK = `, briefing_nota, briefing_feedback, briefing_feedback_em`;

let _temColunasFeedback = null; // null = ainda não testado

function semEmpresa(req, res) {
  if (req.user.empresa_id) return false;
  res.status(400).json({
    erro: 'Sua conta ainda não está vinculada a um escritório. Saia e entre de novo, ou fale com o suporte.',
    code: 'SEM_EMPRESA',
  });
  return true;
}

// ─── GET /api/briefing ────────────────────────────────────────────────────────
// Histórico: todos os briefings já gerados pelo escritório
router.get('/', authMiddleware, async (req, res) => {
  try {
    if (semEmpresa(req, res)) return;

    const buscar = (comFeedback) => supabase
      .from('leads')
      .select(CAMPOS_BASE + (comFeedback ? CAMPOS_FEEDBACK : ''))
      .eq('empresa_id', req.user.empresa_id)
      .not('briefing', 'is', null)
      .order('created_at', { ascending: false })
      .limit(200);

    let { data, error } = await buscar(_temColunasFeedback !== false);

    if (error && _temColunasFeedback !== false) {
      // Provável ausência das colunas de feedback — repete sem elas
      _temColunasFeedback = false;
      ({ data, error } = await buscar(false));
    } else if (!error) {
      _temColunasFeedback = _temColunasFeedback ?? true;
    }

    if (error) throw error;

    res.json({ briefings: data || [], feedback_disponivel: _temColunasFeedback !== false });
  } catch (err) {
    console.error('Erro ao listar briefings:', err.message);
    res.status(500).json({ erro: 'Erro ao carregar seus briefings.' });
  }
});

// ─── GET /api/briefing/:id ────────────────────────────────────────────────────
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    if (semEmpresa(req, res)) return;

    const buscar = (comFeedback) => supabase
      .from('leads')
      .select(CAMPOS_BASE + (comFeedback ? CAMPOS_FEEDBACK : ''))
      .eq('id', req.params.id)
      .eq('empresa_id', req.user.empresa_id)
      .single();

    let { data, error } = await buscar(_temColunasFeedback !== false);
    if (error && _temColunasFeedback !== false) {
      _temColunasFeedback = false;
      ({ data, error } = await buscar(false));
    }

    if (error || !data) return res.status(404).json({ erro: 'Briefing não encontrado.' });
    res.json(data);
  } catch (err) {
    console.error('Erro ao buscar briefing:', err.message);
    res.status(500).json({ erro: 'Erro ao buscar o briefing.' });
  }
});

// ─── POST /api/briefing ───────────────────────────────────────────────────────
// Cadastra o cliente e gera o relatório de preparação
router.post('/', authMiddleware, async (req, res) => {
  try {
    if (semEmpresa(req, res)) return;

    const {
      nome_lead, empresa_lead, whatsapp, produto, valor_honorarios,
      origem_canal, data_reuniao, local_reuniao, contexto, objecao_inicial,
    } = req.body;

    if (!nome_lead || !String(nome_lead).trim()) {
      return res.status(400).json({ erro: 'Informe o nome do cliente.' });
    }

    const briefing = await gerarBriefing({
      nome_lead,
      empresa_lead,
      produto,
      valor_honorarios,
      origem: origem_canal,
      data_reuniao,
      local_reuniao,
      contexto: contexto || 'Sem contexto adicional informado.',
      objecao_inicial,
      user: req.user,
    });

    const { data: lead, error } = await supabase
      .from('leads')
      .insert({
        empresa_id:       req.user.empresa_id,
        sdr_id:           req.user.id,
        closer_id:        req.user.id,
        nome_lead:        String(nome_lead).trim(),
        empresa_lead:     empresa_lead || null,
        whatsapp:         whatsapp || null,
        produto:          produto || null,
        valor_honorarios: valor_honorarios || null,
        origem:           origem_canal || 'não informada',
        origem_canal:     origem_canal || null,
        contexto:         contexto || 'Sem contexto adicional informado.',
        objecao_inicial:  objecao_inicial || null,
        data_reuniao:     data_reuniao || null,
        local_reuniao:    local_reuniao || null,
        status:           'briefing_gerado',
        briefing,
      })
      .select()
      .single();

    if (error) throw error;

    res.json({ ok: true, lead });
  } catch (err) {
    console.error('Erro ao gerar briefing:', err.message, err.details || '', err.hint || '');
    res.status(500).json({ erro: `Não consegui gerar o briefing: ${err.message || 'erro desconhecido'}` });
  }
});

// ─── POST /api/briefing/:id/regerar ───────────────────────────────────────────
router.post('/:id/regerar', authMiddleware, async (req, res) => {
  try {
    if (semEmpresa(req, res)) return;

    const { contexto_extra } = req.body;

    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', req.params.id)
      .eq('empresa_id', req.user.empresa_id)
      .single();

    if (!lead) return res.status(404).json({ erro: 'Briefing não encontrado.' });

    const briefing = await gerarBriefing({
      nome_lead:        lead.nome_lead,
      empresa_lead:     lead.empresa_lead,
      produto:          lead.produto,
      valor_honorarios: lead.valor_honorarios,
      origem:           lead.origem_canal || lead.origem,
      data_reuniao:     lead.data_reuniao,
      local_reuniao:    lead.local_reuniao,
      contexto:         lead.contexto + (contexto_extra ? `\n\nInformação nova: ${contexto_extra}` : ''),
      objecao_inicial:  lead.objecao_inicial,
      user:             req.user,
    });

    await supabase.from('leads').update({ briefing }).eq('id', req.params.id);

    res.json({ ok: true, briefing });
  } catch (err) {
    console.error('Erro ao regerar briefing:', err.message);
    res.status(500).json({ erro: 'Não consegui gerar o briefing de novo. Tente em instantes.' });
  }
});

// ─── PATCH /api/briefing/:id ──────────────────────────────────────────────────
// Edição dos dados do cliente (data da reunião, contato, etc)
router.patch('/:id', authMiddleware, async (req, res) => {
  try {
    if (semEmpresa(req, res)) return;

    const permitidos = [
      'nome_lead', 'empresa_lead', 'whatsapp', 'produto', 'valor_honorarios',
      'origem_canal', 'data_reuniao', 'local_reuniao', 'contexto', 'objecao_inicial',
    ];

    const updates = {};
    permitidos.forEach(c => {
      if (req.body[c] !== undefined) updates[c] = req.body[c] === '' ? null : req.body[c];
    });

    if (!Object.keys(updates).length) return res.status(400).json({ erro: 'Nada para atualizar.' });

    const { data, error } = await supabase
      .from('leads')
      .update(updates)
      .eq('id', req.params.id)
      .eq('empresa_id', req.user.empresa_id)
      .select()
      .single();

    if (error) throw error;
    res.json({ ok: true, lead: data });
  } catch (err) {
    console.error('Erro ao atualizar briefing:', err.message);
    res.status(500).json({ erro: 'Erro ao salvar as alterações.' });
  }
});

// ─── POST /api/briefing/:id/feedback ──────────────────────────────────────────
// Como a reunião foi e o quanto o briefing ajudou
const RESULTADOS = {
  fechou:       { status: 'ganhou',     participou: true  },
  negociando:   { status: 'negociando', participou: true  },
  nao_fechou:   { status: 'perdeu',     participou: true  },
  nao_compareceu: { status: null,       participou: false },
};

router.post('/:id/feedback', authMiddleware, async (req, res) => {
  try {
    if (semEmpresa(req, res)) return;

    const { nota, resultado, comentario } = req.body;

    const n = parseInt(nota, 10);
    if (!n || n < 1 || n > 5) {
      return res.status(400).json({ erro: 'Dê uma nota de 1 a 5 para o briefing.' });
    }
    if (!RESULTADOS[resultado]) {
      return res.status(400).json({ erro: 'Informe como a reunião terminou.' });
    }

    const { data: lead } = await supabase
      .from('leads')
      .select('id, empresa_id')
      .eq('id', req.params.id)
      .eq('empresa_id', req.user.empresa_id)
      .single();

    if (!lead) return res.status(404).json({ erro: 'Briefing não encontrado.' });

    const mapa    = RESULTADOS[resultado];
    const updates = { participou_reuniao: mapa.participou };
    if (mapa.status) {
      updates.status = mapa.status;
      if (['ganhou', 'perdeu'].includes(mapa.status)) updates.fechado_em = new Date().toISOString();
    }

    // Primeiro o que sempre existe no banco
    const { error: erroBase } = await supabase.from('leads').update(updates).eq('id', req.params.id);
    if (erroBase) throw erroBase;

    // Depois as colunas de feedback, que dependem da migração
    const { error: erroFeedback } = await supabase
      .from('leads')
      .update({
        briefing_nota:        n,
        briefing_feedback:    comentario || null,
        briefing_feedback_em: new Date().toISOString(),
      })
      .eq('id', req.params.id);

    if (erroFeedback) {
      _temColunasFeedback = false;
      console.error('Feedback do briefing não gravado (falta migração?):', erroFeedback.message);
      return res.json({
        ok: true,
        parcial: true,
        aviso: 'O resultado da reunião foi salvo, mas a nota e o comentário precisam da atualização do banco.',
      });
    }

    _temColunasFeedback = true;
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao salvar feedback:', err.message);
    res.status(500).json({ erro: 'Erro ao salvar seu feedback.' });
  }
});

// ─── DELETE /api/briefing/:id ─────────────────────────────────────────────────
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    if (semEmpresa(req, res)) return;

    const { error } = await supabase
      .from('leads')
      .delete()
      .eq('id', req.params.id)
      .eq('empresa_id', req.user.empresa_id);

    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao excluir briefing:', err.message);
    res.status(500).json({ erro: 'Erro ao excluir o briefing.' });
  }
});

// ─── Geração do relatório pela May ────────────────────────────────────────────
function formatarData(iso) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
    });
  } catch { return null; }
}

async function gerarBriefing(dados) {
  const { user } = dados;
  const quando   = formatarData(dados.data_reuniao);

  const perfil = [
    user?.name          ? `- Quem vai conduzir a reunião: ${user.name}`               : null,
    user?.nicho         ? `- Área de atuação do escritório: ${user.nicho}`            : null,
    user?.produto       ? `- Serviço que costuma vender: ${user.produto}`             : null,
    user?.publico_alvo  ? `- Público que o escritório atende: ${user.publico_alvo}`   : null,
    user?.nivel         ? `- Experiência em vendas de quem vai atender: ${user.nivel}`: null,
  ].filter(Boolean).join('\n') || '- Sem informações de perfil preenchidas.';

  const prompt = `Você é May, assistente comercial jurídica treinada com o Método Comercial Jurídico de Mayra Alves.

Você vai preparar o relatório de briefing de uma reunião de vendas que ainda vai acontecer. Quem vai ler é o advogado ou o comercial do escritório, minutos antes de entrar na reunião. O relatório precisa ser prático a ponto de a pessoa conseguir conduzir a conversa lendo só isso.

ESCRITÓRIO
${perfil}

CLIENTE DESTA REUNIÃO
- Nome: ${dados.nome_lead}
- Empresa ou vínculo: ${dados.empresa_lead || 'não informado'}
- Serviço em discussão: ${dados.produto || 'não informado'}
- Valor de honorários previsto: ${dados.valor_honorarios ? 'R$ ' + dados.valor_honorarios : 'não informado'}
- De onde veio: ${dados.origem || 'não informada'}
- Quando é a reunião: ${quando || 'não informada'}
- Onde é a reunião: ${dados.local_reuniao || 'não informado'}
- O que já se sabe do caso: ${dados.contexto}
- Resistência já demonstrada: ${dados.objecao_inicial || 'nenhuma até agora'}

COMO ESCREVER
Fale como uma pessoa experiente em vendas falaria com um colega, em português brasileiro simples e direto.
Nada de linguagem de robô, nada de frase de efeito, nada de elogio ao cliente.
Não use travessão. Não use emoji fora dos títulos das seções.
Frases curtas. Cada linha precisa servir para alguma coisa dentro da reunião.
Quando faltar informação, trabalhe com a hipótese mais provável para o perfil e diga que é uma hipótese a confirmar na conversa.

ESTRUTURA EXATA DA RESPOSTA, sem texto antes nem depois:

🎯 QUEM É ESSE CLIENTE
Três linhas no máximo: a situação dele, a dor que traz ele até aqui e o nível de urgência que dá para presumir.

💬 COMO ABRIR A CONVERSA
Uma frase pronta de abertura, do jeito que deve ser falada, retomando o que já se sabe do caso.
Logo depois, a primeira pergunta de diagnóstico que faz o cliente falar do problema.

🔍 PERGUNTAS QUE PRECISAM SER FEITAS
Quatro perguntas, uma por linha, na ordem em que devem aparecer na conversa.

⚡ PONTOS DE ATENÇÃO
Três bullets: o que pode travar essa venda e o que fazer quando acontecer.

🛡️ OBJEÇÕES PROVÁVEIS E RESPOSTA
Duas objeções mais prováveis para esse perfil. Para cada uma, a resposta pronta, em uma ou duas frases, sem dar desconto e sem prometer resultado.

💰 COMO FALAR DE VALOR
Como apresentar os honorários nesse caso, o que precisa estar claro antes de falar o preço e o que não deve ser dito.

✅ OBJETIVO DESTA REUNIÃO
Uma linha com o próximo passo concreto que precisa sair combinado ao final, e como pedir esse passo.`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 1100,
    temperature: 0.7,
    messages: [{ role: 'user', content: prompt }],
  });

  return completion.choices[0]?.message?.content
      || 'Não consegui montar o briefing agora. Tente gerar de novo em instantes.';
}

module.exports = router;
