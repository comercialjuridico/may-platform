// ─── Middleware de Audit Log ────────────────────────────────────────────────
// Registra ações sensíveis no banco para rastreabilidade e compliance.
const { supabase } = require('../services/supabase');

/**
 * Registra um evento de auditoria na tabela audit_logs.
 * Chamado explicitamente nas rotas críticas.
 */
async function registrarAuditoria({ userId, acao, recurso, detalhes = {}, req }) {
  try {
    const ip = (req?.headers['x-forwarded-for'] || req?.socket?.remoteAddress || '').split(',')[0].trim();
    const userAgent = req?.headers['user-agent'] || '';

    await supabase.from('audit_logs').insert({
      user_id:    userId || null,
      acao,                        // ex: 'login', 'logout', 'exportar_relatorio'
      recurso:    recurso || null, // ex: 'conversa:123', 'user:456'
      detalhes:   JSON.stringify(detalhes),
      ip,
      user_agent: userAgent.slice(0, 255),
    });
  } catch (err) {
    // Nunca deixar falha de auditoria derrubar a requisição
    console.error('[AuditLog] Falha ao registrar:', err.message);
  }
}

/**
 * Middleware express que grava automaticamente toda requisição autenticada.
 * Aplique apenas nas rotas que deseja monitorar (não em todas — ruído desnecessário).
 */
function auditMiddleware(acao) {
  return async (req, res, next) => {
    // Executa a rota primeiro, depois registra o resultado
    const originalJson = res.json.bind(res);
    res.json = function (body) {
      const sucesso = res.statusCode < 400;
      registrarAuditoria({
        userId:   req.user?.id,
        acao,
        recurso:  req.params?.id ? `${acao}:${req.params.id}` : null,
        detalhes: sucesso ? { status: res.statusCode } : { status: res.statusCode, erro: body?.erro },
        req,
      });
      return originalJson(body);
    };
    next();
  };
}

module.exports = { registrarAuditoria, auditMiddleware };
