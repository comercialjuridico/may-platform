// ─── Rotas de chat com streaming SSE ───────────────────────────────────────────
const express = require('express');
const router = express.Router();
const OpenAI = require('openai');
const { supabase } = require('../services/supabase');
const { authMiddleware, verificarLimite } = require('../middleware/auth');
const { buildSystemPrompt } = require('../services/may');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Seleção inteligente de modelo por ferramenta:
// - gpt-4o-mini: alto volume, conversacional, custo ~5x menor
// - gpt-4o: análises, propostas, simulações complexas — onde qualidade importa mais
const MODELOS = {
  chat:                'gpt-4o-mini',
  simulador_objecoes:  'gpt-4o-mini',
  follow_up:           'gpt-4o-mini',
  negociacao:          'gpt-4o-mini',
  gerador_proposta:    'gpt-4o',
  diagnostico:         'gpt-4o',
  spin:                'gpt-4o',
  simulador_vendas:    'gpt-4o',
};

function getModelo(ferramenta) {
  return MODELOS[ferramenta] || 'gpt-4o-mini';
}

// ─── POST /api/chat/stream ──────────────────────────────────────────────────
// Envia uma mensagem e recebe resposta via Server-Sent Events (streaming)
router.post('/stream', authMiddleware, verificarLimite, async (req, res) => {
  const { mensagem, conversa_id, ferramenta = 'chat' } = req.body;

  if (!mensagem || mensagem.trim() === '') {
    return res.status(400).json({ erro: 'Mensagem não pode estar vazia.' });
  }

  // Configura cabeçalhos para SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Função auxiliar para enviar evento SSE
  const enviarEvento = (tipo, dados) => {
    res.write(`data: ${JSON.stringify({ tipo, ...dados })}\n\n`);
  };

  try {
    let conversaId = conversa_id;

    // Cria nova conversa se necessário
    if (!conversaId) {
      const titulo = mensagem.slice(0, 60) + (mensagem.length > 60 ? '...' : '');
      const { data: novaConversa, error } = await supabase
        .from('conversations')
        .insert({
          user_id: req.user.id,
          titulo,
          ferramenta,
        })
        .select('id')
        .single();

      if (error) throw error;
      conversaId = novaConversa.id;
      enviarEvento('conversa_criada', { conversa_id: conversaId });
    }

    // Busca histórico da conversa (últimas 20 mensagens)
    const { data: historico } = await supabase
      .from('messages')
      .select('role, content')
      .eq('conversation_id', conversaId)
      .order('created_at', { ascending: true })
      .limit(20);

    const mensagensAnteriores = (historico || []).map(m => ({
      role: m.role,
      content: m.content,
    }));

    // Adiciona mensagem atual do usuário
    mensagensAnteriores.push({ role: 'user', content: mensagem });

    // Salva mensagem do usuário no banco
    await supabase.from('messages').insert({
      conversation_id: conversaId,
      user_id: req.user.id,
      role: 'user',
      content: mensagem,
    });

    // Incrementa contador de mensagens do usuário
    await supabase.from('users').update({
      mensagens_mes: (req.user.mensagens_mes || 0) + 1,
      mes_referencia: new Date().toISOString().slice(0, 7),
    }).eq('id', req.user.id);

    // System prompt personalizado
    const systemPrompt = buildSystemPrompt(req.user, ferramenta);
    const modelo = getModelo(ferramenta);

    // Inicia streaming com OpenAI
    let respostaCompleta = '';
    let tokensUsados = 0;

    const stream = await openai.chat.completions.create({
      model: modelo,
      max_tokens: 2048,
      messages: [
        { role: 'system', content: systemPrompt },
        ...mensagensAnteriores,
      ],
      stream: true,
      stream_options: { include_usage: true },
    });

    for await (const chunk of stream) {
      const texto = chunk.choices[0]?.delta?.content || '';
      if (texto) {
        respostaCompleta += texto;
        enviarEvento('texto', { conteudo: texto });
      }
      if (chunk.usage) {
        tokensUsados = chunk.usage.completion_tokens || 0;
      }
    }

    // Salva resposta da IA no banco
    await supabase.from('messages').insert({
      conversation_id: conversaId,
      user_id: req.user.id,
      role: 'assistant',
      content: respostaCompleta,
      tokens_usados: tokensUsados,
    });

    // Atualiza updated_at da conversa
    await supabase.from('conversations').update({ updated_at: new Date() }).eq('id', conversaId);

    // Sinaliza fim do stream
    enviarEvento('fim', { conversa_id: conversaId });
    res.end();

  } catch (err) {
    console.error('Erro no chat/stream:', err.message);
    enviarEvento('erro', { mensagem: 'Erro ao processar sua mensagem.' });
    res.end();
  }
});

// ─── GET /api/chat/conversas ────────────────────────────────────────────────
// Lista conversas do usuário
router.get('/conversas', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('conversations')
      .select('id, titulo, ferramenta, created_at, updated_at')
      .eq('user_id', req.user.id)
      .eq('arquivada', false)
      .order('updated_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    res.json({ conversas: data });
  } catch (err) {
    console.error('Erro ao listar conversas:', err.message);
    res.status(500).json({ erro: 'Erro ao buscar conversas.' });
  }
});

// ─── GET /api/chat/conversa/:id ─────────────────────────────────────────────
// Busca mensagens de uma conversa
router.get('/conversa/:id', authMiddleware, async (req, res) => {
  try {
    // Verifica se a conversa pertence ao usuário
    const { data: conversa, error: errConv } = await supabase
      .from('conversations')
      .select('id, titulo, ferramenta')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();

    if (errConv || !conversa) {
      return res.status(404).json({ erro: 'Conversa não encontrada.' });
    }

    const { data: mensagens, error } = await supabase
      .from('messages')
      .select('id, role, content, created_at')
      .eq('conversation_id', req.params.id)
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json({ conversa, mensagens });
  } catch (err) {
    console.error('Erro ao buscar conversa:', err.message);
    res.status(500).json({ erro: 'Erro ao buscar conversa.' });
  }
});

// ─── DELETE /api/chat/conversa/:id ──────────────────────────────────────────
router.delete('/conversa/:id', authMiddleware, async (req, res) => {
  try {
    const { error } = await supabase
      .from('conversations')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);

    if (error) throw error;
    res.json({ mensagem: 'Conversa excluída.' });
  } catch (err) {
    console.error('Erro ao excluir conversa:', err.message);
    res.status(500).json({ erro: 'Erro ao excluir conversa.' });
  }
});

module.exports = router;
