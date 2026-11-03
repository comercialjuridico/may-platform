// ─── Limites por conta para rotas que chamam IA ou mandam e-mail ────────────
// Proteção contra abuso, não limite comercial: o teste de 7 dias e os planos
// continuam com as mesmas mensagens. Isto só impede rajadas que nenhum uso
// humano produz (script, aba em loop, conta usada como robô) e que custariam
// chamadas de IA ou envio de e-mail em nome do domínio da May.
//
// Contagem em memória, por instância. Com mais de uma réplica no Railway,
// migrar para armazenamento compartilhado (Redis/Supabase).
const rateLimit = require('express-rate-limit');

function numeroEnv(nome, padrao) {
  const n = parseInt(process.env[nome], 10);
  return Number.isFinite(n) && n > 0 ? n : padrao;
}

function limitePorConta({ nome, janelaMin, maxPadrao, envMax, mensagem }) {
  return rateLimit({
    windowMs: janelaMin * 60 * 1000,
    max: () => numeroEnv(envMax, maxPadrao),
    keyGenerator: req => `${nome}:${req.user?.id || 'anon'}`,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => res.status(429).json({
      erro: mensagem,
      code: 'LIMITE_TEMPORARIO',
    }),
  });
}

const limiteChat = limitePorConta({
  nome: 'chat', janelaMin: 10, maxPadrao: 40, envMax: 'LIMITE_CHAT_10MIN',
  mensagem: 'Muitas mensagens em sequência. Aguarde alguns minutos e continue.',
});

const limiteBriefing = limitePorConta({
  nome: 'briefing', janelaMin: 60, maxPadrao: 20, envMax: 'LIMITE_BRIEFING_HORA',
  mensagem: 'Você gerou muitos briefings na última hora. Aguarde um pouco para gerar outro.',
});

const limiteImagem = limitePorConta({
  nome: 'imagem', janelaMin: 60, maxPadrao: 20, envMax: 'LIMITE_IMAGEM_HORA',
  mensagem: 'Muitas imagens analisadas na última hora. Aguarde um pouco para enviar outra.',
});

const limiteReuniao = limitePorConta({
  nome: 'reuniao', janelaMin: 60, maxPadrao: 20, envMax: 'LIMITE_REUNIAO_HORA',
  mensagem: 'Muitas salas criadas ou processadas na última hora. Aguarde um pouco.',
});

const limiteConviteEmail = limitePorConta({
  nome: 'convite', janelaMin: 60, maxPadrao: 10, envMax: 'LIMITE_CONVITE_HORA',
  mensagem: 'Muitos convites enviados na última hora. Aguarde um pouco ou envie pelo WhatsApp.',
});

module.exports = { limitePorConta, limiteChat, limiteBriefing, limiteImagem, limiteReuniao, limiteConviteEmail };
