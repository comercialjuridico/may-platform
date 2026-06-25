// ─── Middleware de autenticação JWT ────────────────────────────────────────────
const jwt = require('jsonwebtoken');
const { supabase } = require('../services/supabase');

/**
 * Verifica o access token JWT no header Authorization.
 * Injeta req.user = { id, email, plano } para as rotas protegidas.
 */
async function authMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ erro: 'Token não fornecido.' });
    }

    const token = header.split(' ')[1];

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ erro: 'Token expirado.', code: 'TOKEN_EXPIRADO' });
      }
      return res.status(401).json({ erro: 'Token inválido.' });
    }

    // Bloqueia temp_token (2FA pendente) de acessar rotas protegidas
    if (payload.tipo === '2fa_pendente') {
      return res.status(401).json({ erro: 'Autenticação incompleta. Complete o 2FA.' });
    }

    // Busca dados atualizados do usuário (plano pode ter mudado)
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, name, plano, plano_status, plano_fim, mensagens_mes, mes_referencia, diagnostico_completo, nicho, produto, publico_alvo, nivel, maior_dificuldade, role, empresa_id, cielo_recurrent_payment_id, stripe_subscription_id, created_at')
      .eq('id', payload.id)
      .single();

    if (error || !user) {
      return res.status(401).json({ erro: 'Usuário não encontrado.' });
    }

    // Verifica se o plano ainda está ativo
    if (user.plano !== 'free') {
      const agora = new Date();
      if (user.plano_fim && new Date(user.plano_fim) < agora) {
        await supabase.from('users').update({ plano: 'free', plano_status: 'expirado' }).eq('id', user.id);
        user.plano = 'free';
        user.plano_status = 'expirado';
      }
    }

    // Trial gratuito: 7 dias sem cartão para contas novas
    // Após 7 dias sem cartão cadastrado → bloqueia acesso ao chat
    if (user.plano === 'free' && !user.cielo_recurrent_payment_id && !user.stripe_subscription_id && user.created_at) {
      try {
        const criado    = new Date(user.created_at);
        const diasDesde = (Date.now() - criado.getTime()) / (1000 * 60 * 60 * 24);
        if (diasDesde > 7) {
          user._trial_expirado = true;
        } else {
          user._trial_dias_restantes = Math.ceil(7 - diasDesde);
        }
      } catch (_) { /* ignora erro de parsing de data */ }
    }

    req.user = user;
    next();
  } catch (err) {
    console.error('Erro no middleware de auth:', err.message);
    res.status(500).json({ erro: 'Erro interno de autenticação.' });
  }
}

/**
 * Verifica se o usuário tem mensagens disponíveis no mês.
 * Reseta o contador se for um novo mês.
 */
async function verificarLimite(req, res, next) {
  const user = req.user;
  const mesAtual = new Date().toISOString().slice(0, 7); // ex: 2026-06

  // Reset mensal
  if (user.mes_referencia !== mesAtual) {
    await supabase
      .from('users')
      .update({ mensagens_mes: 0, mes_referencia: mesAtual })
      .eq('id', user.id);
    user.mensagens_mes = 0;
    user.mes_referencia = mesAtual;
  }

  // Admin nunca é bloqueado
  if (user.role === 'admin') {
    req.limiteInfo = { limite: 999999, usado: user.mensagens_mes };
    return next();
  }

  // Limites por plano
  const limites = {
    free:    parseInt(process.env.LIMITE_FREE)    || 20,
    mensal:  parseInt(process.env.LIMITE_MENSAL)  || 500,
    anual:   parseInt(process.env.LIMITE_ANUAL)   || 999999,
  };

  const limite = limites[user.plano] || limites.free;

  if (user.mensagens_mes >= limite) {
    return res.status(429).json({
      erro: 'Limite de mensagens atingido para este mês.',
      code: 'LIMITE_ATINGIDO',
      plano: user.plano,
      limite,
      usado: user.mensagens_mes,
    });
  }

  req.limiteInfo = { limite, usado: user.mensagens_mes };
  next();
}

module.exports = { authMiddleware, verificarLimite };
