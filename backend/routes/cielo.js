// ─── Rotas Cielo: checkout recorrente e webhook ─────────────────────────────
const express = require('express');
const router  = express.Router();

// Novas compras usam Stripe; clientes Cielo mantêm webhook e cancelamento.
router.use(['/pre-validar', '/ativar', '/checkout'], (req, res) => {
  res.status(410).json({ erro: 'O pagamento foi atualizado. Recarregue o App May para assinar pelo Stripe.' });
});
const { reconciliarCielo, segredoConfere } = require('../services/cieloWebhook');
const { supabase }          = require('../services/supabase');
const { authMiddleware }    = require('../middleware/auth');
const { criarRecorrencia, consultarPagamento, consultarRecorrencia, cancelarRecorrencia, valorPlano } = require('../services/cielo');

// Planos válidos e suas durações em meses
// Modelo por assento: R$97/mês base (1 usuário) + R$47/usuário adicional (gerenciado internamente)
const PLANOS_CONFIG = {
  solo_mensal:   { meses: 1,  maxMembros: 1,  valor: '97.00'  },
  solo_anual:    { meses: 12, maxMembros: 1,  valor: '936.00' }, // R$78/mês · 20% off
  equipe_mensal: { meses: 1,  maxMembros: 10, valor: '97.00'  }, // base; usuários adicionais cobrados separadamente
  equipe_anual:  { meses: 12, maxMembros: 10, valor: '936.00' }, // base anual
  // legado (manter compatibilidade com contas antigas)
  mensal:        { meses: 1,  maxMembros: 1,  valor: '97.00'  },
  anual:         { meses: 12, maxMembros: 1,  valor: '936.00' },
  start_mensal:  { meses: 1,  maxMembros: 1,  valor: '97.00'  },
  pro_mensal:    { meses: 1,  maxMembros: 10, valor: '97.00'  },
};

// ─── GET /api/cielo/precos ──────────────────────────────────────────────────
router.get('/precos', (req, res) => {
  res.json({
    solo_mensal:      '97.00',
    solo_anual:       '936.00',
    equipe_mensal:    '97.00',
    equipe_anual:     '936.00',
    extra_usuario_m:  '47.00',  // por usuário adicional, mensal
    extra_usuario_a:  '38.00',  // por usuário adicional, anual (20% off × 12 / 12 ≈ R$38)
  });
});

// ─── POST /api/cielo/pre-validar ────────────────────────────────────────────
// Valida cartão SEM criar conta — chamado antes do registro
// Cria recorrência com AuthorizeNow:false (trial 7 dias), retorna orderId temporário
router.post('/pre-validar', async (req, res) => {
  try {
    const { plano, cartao, cpf } = req.body;
    if (!PLANOS_CONFIG[plano]) return res.status(400).json({ erro: 'Plano inválido.' });
    if (!cartao?.numero || !cartao?.titular || !cartao?.validade || !cartao?.cvv) {
      return res.status(400).json({ erro: 'Dados do cartão incompletos.' });
    }

    const orderId = require('crypto').randomUUID();
    const resultado = await criarRecorrencia({
      plano,
      cartao,
      cliente: { nome: 'Pendente', email: 'pendente@usemayapp.com', cpf },
      userId: orderId,
      comPeriodoGratis: true,
    });

    const pagamento = resultado.body?.Payment;
    const statusOk  = [0, 1, 2].includes(pagamento?.Status);
    if (!pagamento || !statusOk) {
      const erroReq = Array.isArray(resultado.body) ? resultado.body[0] : null;
      const logPayload = {
        origem:        'pre-validar',
        httpStatus:    resultado.status,
        paymentStatus: pagamento?.Status,
        returnCode:    pagamento?.ReturnCode,
        returnMessage: pagamento?.ReturnMessage,
        erroCielo:     erroReq || undefined,
        bodyRaw:       JSON.stringify(resultado.body || null).slice(0, 1000),
      };
      console.error('[cielo] recusa no pre-validar:', JSON.stringify(logPayload));
      await supabase.from('subscriptions_log').insert({
        stripe_event: 'pre-validar.recusado',
        payload:      logPayload,
        processado:   false,
      }).catch(() => {});

      if (erroReq) {
        return res.status(502).json({
          erro:   `A Cielo recusou a requisição: ${erroReq.Message || 'sem detalhe'}`,
          codigo: erroReq.Code,
          origem: 'requisicao',
        });
      }

      const motivo = pagamento?.ReturnMessage || 'Cartão não autorizado. Verifique os dados.';
      return res.status(402).json({
        erro:   motivo,
        codigo: pagamento?.ReturnCode,
        origem: 'cartao',
      });
    }

    // Log de sucesso
    await supabase.from('subscriptions_log').insert({
      stripe_event: 'pre-validar.agendado',
      payload:      { origem: 'pre-validar', orderId, plano, recurrentId: resultado.body?.Payment?.RecurrentPayment?.RecurrentPaymentId },
      processado:   true,
    }).catch(() => {});

    // Salva temporariamente no banco para vincular após registro
    await supabase.from('pre_checkouts').insert({
      order_id:             orderId,
      plano,
      cielo_recurrent_id:   pagamento.RecurrentPayment?.RecurrentPaymentId,
      expires_at:           new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 min
    }).catch(() => {});

    res.json({ ok: true, orderId });
  } catch (err) {
    console.error('Erro pre-validar Cielo:', err.message);
    if (String(err.message).startsWith('CIELO_NAO_CONFIGURADA')) {
      return res.status(503).json({
        erro: 'Pagamento indisponível: a integração com a Cielo não está configurada.',
        code: 'CIELO_NAO_CONFIGURADA',
      });
    }
    res.status(500).json({ erro: `Erro ao validar cartão: ${err.message}` });
  }
});

// ─── POST /api/cielo/ativar ──────────────────────────────────────────────────
// Vincula o pre-checkout ao usuário recém-criado
router.post('/ativar', authMiddleware, async (req, res) => {
  try {
    const { orderId, plano } = req.body;

    const { data: pre } = await supabase
      .from('pre_checkouts')
      .select('*')
      .eq('order_id', orderId)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (!pre) return res.status(400).json({ erro: 'Sessão de pagamento expirada. Tente novamente.' });

    // O plano do cliente não pode alterar a duração já contratada.
    const cfg = PLANOS_CONFIG[pre.plano];
    if (!cfg) return res.status(400).json({ erro: 'Plano inválido.' });
    const agora = new Date();
    const inicioCobranca = new Date(agora);
    inicioCobranca.setDate(inicioCobranca.getDate() + 7);
    const fimPlano = new Date(inicioCobranca);
    fimPlano.setMonth(fimPlano.getMonth() + cfg.meses);

    await supabase.from('users').update({
      plano:                      pre.plano,
      plano_status:               'periodo_gratis',
      plano_inicio:               agora.toISOString(),
      plano_fim:                  fimPlano.toISOString(),
      periodo_gratis_inicio:      agora.toISOString(),
      periodo_gratis_fim:         inicioCobranca.toISOString(),
      cielo_recurrent_payment_id: pre.cielo_recurrent_id,
    }).eq('id', req.user.id);

    const { data: userRow } = await supabase.from('users').select('empresa_id').eq('id', req.user.id).single();
    if (userRow?.empresa_id) {
      await supabase.from('empresas').update({ max_membros: cfg.maxMembros }).eq('id', userRow.empresa_id);
    }

    await supabase.from('pre_checkouts').delete().eq('order_id', orderId).catch(() => {});

    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ativar Cielo:', err.message);
    res.status(500).json({ erro: 'Erro ao ativar assinatura.' });
  }
});

// ─── POST /api/cielo/checkout ───────────────────────────────────────────────
// 7 dias GRÁTIS: cartão cadastrado agora, primeira cobrança em D+7 (AuthorizeNow: false)
router.post('/checkout', authMiddleware, async (req, res) => {
  try {
    const { plano, cartao, cpf } = req.body;

    if (!PLANOS_CONFIG[plano]) {
      return res.status(400).json({ erro: 'Plano inválido.' });
    }
    if (!cartao?.numero || !cartao?.titular || !cartao?.validade || !cartao?.cvv) {
      return res.status(400).json({ erro: 'Dados do cartão incompletos.' });
    }

    // Usuário já usou o período gratuito? Cobra imediatamente
    const jaUsouPeriodoGratis = !!req.user.periodo_gratis_inicio;

    const resultado = await criarRecorrencia({
      plano,
      cartao,
      cliente: { nome: req.user.name, email: req.user.email, cpf },
      userId: req.user.id,
      comPeriodoGratis: !jaUsouPeriodoGratis,
    });

    const pagamento = resultado.body?.Payment;

    // Com período grátis (AuthorizeNow: false): Cielo retorna Status 0 ou 1 (agendado)
    // Sem período grátis (AuthorizeNow: true): Status 2 = aprovado
    const statusOk = jaUsouPeriodoGratis
      ? pagamento?.Status === 2
      : [0, 1, 2].includes(pagamento?.Status);

    if (!pagamento || !statusOk) {
      const erroReq = Array.isArray(resultado.body) ? resultado.body[0] : null;
      const logPayload = {
        origem:        'checkout',
        userId:        req.user.id,
        email:         req.user.email,
        plano,
        httpStatus:    resultado.status,
        paymentStatus: pagamento?.Status,
        returnCode:    pagamento?.ReturnCode,
        returnMessage: pagamento?.ReturnMessage,
        erroCielo:     erroReq || undefined,
        bodyRaw:       JSON.stringify(resultado.body || null).slice(0, 1000),
      };
      console.error('[cielo] recusa no checkout:', JSON.stringify(logPayload));
      await supabase.from('subscriptions_log').insert({
        user_id:      req.user.id,
        stripe_event: 'checkout.recusado',
        payload:      logPayload,
        processado:   false,
      }).catch(() => {});

      if (erroReq) {
        return res.status(502).json({
          erro:   `A Cielo recusou a requisição: ${erroReq.Message || 'sem detalhe'}`,
          codigo: erroReq.Code,
          origem: 'requisicao',
        });
      }

      const motivo = pagamento?.ReturnMessage || 'Cartão não autorizado. Verifique os dados.';
      return res.status(402).json({
        erro:    motivo,
        status:  pagamento?.Status,
        codigo:  pagamento?.ReturnCode,
        origem:  'cartao',
      });
    }

    const cfg      = PLANOS_CONFIG[plano];
    const agora    = new Date();

    // plano_fim = D+7 (período grátis) + duração do plano
    const inicioCobranca = new Date(agora);
    if (!jaUsouPeriodoGratis) inicioCobranca.setDate(inicioCobranca.getDate() + 7);

    const fimPlano = new Date(inicioCobranca);
    fimPlano.setMonth(fimPlano.getMonth() + cfg.meses);

    await supabase.from('users').update({
      plano,
      plano_status:                   jaUsouPeriodoGratis ? 'ativo' : 'periodo_gratis',
      plano_inicio:                   agora.toISOString(),
      plano_fim:                      fimPlano.toISOString(),
      periodo_gratis_inicio:          jaUsouPeriodoGratis ? req.user.periodo_gratis_inicio : agora.toISOString(),
      periodo_gratis_fim:             jaUsouPeriodoGratis ? null : inicioCobranca.toISOString(),
      cielo_recurrent_payment_id:     pagamento.RecurrentPayment?.RecurrentPaymentId,
    }).eq('id', req.user.id);

    // Atualiza max_membros da empresa
    const { data: userRow } = await supabase.from('users').select('empresa_id').eq('id', req.user.id).single();
    if (userRow?.empresa_id) {
      await supabase.from('empresas').update({ max_membros: cfg.maxMembros }).eq('id', userRow.empresa_id);
    }

    // Registra no log
    await supabase.from('subscriptions_log').insert({
      user_id:     req.user.id,
      cielo_event: jaUsouPeriodoGratis ? 'checkout.aprovado' : 'checkout.periodo_gratis_iniciado',
      payload:     resultado.body,
      processado:  true,
    }).catch(() => {});

    res.json({
      ok:                true,
      plano,
      periodo_gratis:    !jaUsouPeriodoGratis,
      inicio_cobranca:   jaUsouPeriodoGratis ? null : inicioCobranca.toISOString(),
      fim:               fimPlano.toISOString(),
    });

  } catch (err) {
    console.error('Erro ao criar recorrência Cielo:', err.message);
    if (String(err.message).startsWith('CIELO_NAO_CONFIGURADA')) {
      return res.status(503).json({
        erro: 'Pagamento indisponível no momento: a integração com a Cielo não está configurada neste ambiente.',
        code: 'CIELO_NAO_CONFIGURADA',
      });
    }
    res.status(500).json({ erro: 'Erro ao processar pagamento. Tente novamente.' });
  }
});

// ─── POST /api/cielo/cancelar ───────────────────────────────────────────────
// Cancela assinatura (desativa recorrência na Cielo)
router.post('/cancelar', authMiddleware, async (req, res) => {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('cielo_recurrent_payment_id, plano')
      .eq('id', req.user.id)
      .single();

    if (!user?.cielo_recurrent_payment_id) {
      return res.status(400).json({ erro: 'Nenhuma assinatura ativa encontrada.' });
    }

    const resultado = await cancelarRecorrencia(user.cielo_recurrent_payment_id);
    if (!resultado || resultado.status < 200 || resultado.status >= 300) {
      return res.status(502).json({ erro: 'A Cielo não confirmou o cancelamento. Tente novamente ou contate o suporte.' });
    }

    const salvamento = await supabase.from('users').update({
      plano_status: 'cancelando',
    }).eq('id', req.user.id).eq('cielo_recurrent_payment_id', user.cielo_recurrent_payment_id);
    if (salvamento.error) throw salvamento.error;
    res.json({ ok: true, mensagem: 'Renovação cancelada. Você mantém acesso até o fim do período atual.' });
  } catch (err) {
    console.error('Erro ao cancelar recorrência:', err.message);
    res.status(500).json({ erro: 'Erro ao cancelar assinatura.' });
  }
});

// Webhook: os dados recebidos nunca são autoridade para alterar a conta.
router.post('/webhook', async (req, res) => {
  const secret = process.env.CIELO_WEBHOOK_SECRET;
  if (secret && !segredoConfere(req.headers['x-cielo-webhook-secret'], secret)) {
    return res.status(401).json({ erro: 'Notificação não autorizada.' });
  }
  try {
    await reconciliarCielo(req.body || {}, { supabase, consultarPagamento, consultarRecorrencia, valorPlano });
    res.status(200).send('ok');
  } catch (err) {
    console.error('Falha na conciliação Cielo:', err.message);
    // Indisponibilidade precisa permitir retentativa do provedor.
    res.status(err.status || 503).json({ erro: 'Não foi possível confirmar a notificação.' });
  }
});

module.exports = router;
