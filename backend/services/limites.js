const DURACAO_TESTE_MS = 7 * 24 * 60 * 60 * 1000;

function testeGratuitoAtivo(user, agora = Date.now()) {
  if (['periodo_gratis', 'cancelando'].includes(user.plano_status) && user.stripe_subscription_id &&
      Date.parse(user.plano_fim) > agora && Date.parse(user.created_at) <= agora &&
      agora < Date.parse(user.created_at) + DURACAO_TESTE_MS) return true;
  if (user.plano !== 'free' || user.plano_status === 'expirado' ||
      user._trial_expirado || user.cielo_recurrent_payment_id ||
      user.stripe_subscription_id || !user.created_at) return false;

  const decorrido = agora - new Date(user.created_at).getTime();
  return Number.isFinite(decorrido) && decorrido >= 0 && decorrido < DURACAO_TESTE_MS;
}

// null representa ausência de teto, inclusive na resposta JSON da API.
function limiteMensagens(user, agora = Date.now()) {
  if (testeGratuitoAtivo(user, agora)) return null;
  if (user.role === 'admin') return 999999;

  const limites = {
    free: parseInt(process.env.LIMITE_FREE) || 20,
    mensal: parseInt(process.env.LIMITE_MENSAL) || 500,
    anual: parseInt(process.env.LIMITE_ANUAL) || 999999,
  };
  return limites[user.plano] || limites.free;
}

module.exports = { testeGratuitoAtivo, limiteMensagens };
