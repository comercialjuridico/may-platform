const { testeGratuitoAtivo } = require('./limites');
const FALHAS = new Set(['pagamento_pendente', 'pagamento_falhou', 'cancelado', 'expirado']);
function recursosUsuario(user, agora = Date.now()) {
  const teste = testeGratuitoAtivo(user, agora);
  const pago = /^(mensal|anual|start(?:_mensal|_anual)?|equipe(?:_mensal|_anual)?|pro(?:_mensal|_anual)?|prof(?:_mensal|_anual)?)$/.test(user.plano || '') &&
    !FALHAS.has(user.plano_status) && (!user.plano_fim || Date.parse(user.plano_fim) > agora);
  const acesso = user.role === 'admin' || teste || pago;
  return { audio: acesso, importacao_whatsapp: acesso, teste_ativo: teste,
    teste_fim: teste ? new Date(Date.parse(user.created_at) + 7 * 86400000).toISOString() : null };
}
function exigirMidias(req, res, next) {
  if (!recursosUsuario(req.user).audio) return res.status(403).json({
    erro: 'Áudio e importação com mídias estão disponíveis durante os 7 dias de teste e em assinaturas ativas.', code: 'ACESSO_MIDIAS' });
  next();
}
module.exports = { recursosUsuario, exigirMidias };
