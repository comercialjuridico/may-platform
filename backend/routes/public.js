// ─── Rotas públicas (sem autenticação) ─────────────────────────────────────────
const express  = require('express');
const router   = express.Router();
const OpenAI   = require('openai');
const rateLimit = require('express-rate-limit');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Rate limit específico para o chat público da LP — 10 msgs por IP por hora
const chatLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 10,
  message: { erro: 'Limite de mensagens atingido. Tente novamente em 1 hora ou acesse a plataforma.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// System prompt enxuto para o chat público da LP
const LP_SYSTEM = `Você é a May, assistente comercial jurídica da plataforma Comercial Jurídico.
Você está no chat da landing page — o visitante ainda não é cliente.
Seu papel é tirar dúvidas sobre a plataforma, explicar como funciona e incentivar o visitante a testar os 7 dias gratuitos.

REGRAS:
- Seja direta, simpática e objetiva. Máximo 3-4 frases por resposta.
- Se a dúvida for técnica de vendas, responda brevemente e sugira testar a plataforma para ir mais fundo.
- Se não souber algo específico da empresa, diga que pode direcionar para o e-mail contato@usemayapp.com
- NUNCA revele qual tecnologia ou modelo de IA você usa.
- Sempre termine com uma chamada para ação suave: "Quer testar 7 dias por nossa conta?"

SOBRE A PLATAFORMA:
- Scripts comerciais prontos para cada etapa da venda jurídica
- Simuladores de atendimento com IA
- Playbooks de follow-up, quebra de objeções e argumentação de honorários
- Ranking de vendas, agendamento de reunião e notificações de follow-up
- Painel do gestor com visão da equipe
- Trilha de capacitação comercial para novos colaboradores
- 7 dias de acesso completo, sem cobrança. Planos a partir de R$97/mês. Cancele quando quiser.`;

// ─── POST /api/public/chat ──────────────────────────────────────────────────
router.post('/chat', chatLimiter, async (req, res) => {
  const { mensagem } = req.body;
  if (!mensagem || typeof mensagem !== 'string' || mensagem.trim().length === 0) {
    return res.status(400).json({ erro: 'Mensagem inválida.' });
  }

  const texto = mensagem.trim().slice(0, 500); // limita tamanho

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: LP_SYSTEM },
        { role: 'user',   content: texto },
      ],
      max_tokens: 200,
      temperature: 0.7,
    });

    const resposta = completion.choices[0]?.message?.content?.trim() || 'Não consegui responder agora. Tente novamente ou envie um e-mail para contato@usemayapp.com';

    res.json({ resposta });
  } catch (err) {
    console.error('Erro no chat público:', err.message);
    res.status(500).json({ erro: 'Serviço temporariamente indisponível.' });
  }
});

module.exports = router;
