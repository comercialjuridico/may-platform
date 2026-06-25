// ─── Rotas Cielo: checkout recorrente e webhook ─────────────────────────────
const express = require('express');
const router  = express.Router();
const { supabase }          = require('../services/supabase');
const { authMiddleware }    = require('../middleware/auth');
const { criarRecorrencia, consultarPagamento, cancelarRecorrencia } = require('../services/cielo');

// Planos válidos e suas durações em meses (para calcular plano_fim depois do trial)
const PLANOS_CONFIG = {
  start_mensal:  { meses: 1,  maxMembros: 1  },
  start_anual:   { meses: 12, maxMembros: 1  },
  equipe_mensal: { meses: 1,  maxMembros: 3  },
  equipe_anual:  { meses: 12, maxMembros: 3  },
  pro_mensal:    { meses: 1,  maxMembros: 5  },
  pro_anual:     { meses: 12, maxMembros: 5  },
  prof_mensal:   { meses: 1,  maxMembros: 10 },
  prof_anual:    { meses: 12, maxMembros: 10 },
  // legado
  mensal: { meses: 1,  maxMembros: 1 },
  anual:  { meses: 12, maxMembros: 1 },
};

// ─── GET /api/cielo/precos ──────────────────────────────────────────────────
router.get('/precos', (req, res) => {
  res.json({
    start_mensal:  '97.00',
    start_anual:   '936.00',
    equipe_mensal: '227.00',
    equipe_anual:  '2184.00',
    pro_mensal:    '397.00',
    pro_anual:     '3816.00',
    prof_mensal:   '897.00',
    prof_anual:    '8616.00',
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

    const orderId = `PRE-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
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
      const motivo = pagamento?.ReturnMessage || 'Cartão não autorizado. Verifique os dados.';
      return res.status(402).json({ erro: motivo });
    }

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
    res.status(500).json({ erro: 'Erro ao validar cartão. Tente novamente.' });
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

    const cfg   = PLANOS_CONFIG[plano] || PLANOS_CONFIG[pre.plano];
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
      const motivo = pagamento?.ReturnMessage || 'Cartão não autorizado. Verifique os dados.';
      return res.status(402).json({ erro: motivo, status: pagamento?.Status });
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

    await cancelarRecorrencia(user.cielo_recurrent_payment_id);

    await supabase.from('users').update({
      plano:                      'free',
      plano_status:               'cancelado',
      cielo_recurrent_payment_id: null,
    }).eq('id', req.user.id);

    res.json({ ok: true });
  } catch (err) {
    console.error('Erro ao cancelar recorrência:', err.message);
    res.status(500).json({ erro: 'Erro ao cancelar assinatura.' });
  }
});

// ─── POST /api/cielo/webhook ────────────────────────────────────────────────
// Recebe notificações automáticas da Cielo (configurar URL no painel Cielo)
// Formato esperado: POST com form-encoded body contendo PaymentId e ChangeType
router.post('/webhook', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const { PaymentId, RecurrentPaymentId, ChangeType } = req.body;

    // Registra notificação
    await supabase.from('subscriptions_log').insert({
      cielo_event: `webhook.changetype.${ChangeType}`,
      payload:     req.body,
    }).catch(() => {});

    // ChangeType 2 = recorrência criada (já tratamos no checkout)
    // ChangeType 7 = cobrança recorrente executada (renovação)
    if (ChangeType === '7' || ChangeType === 2 || ChangeType === 7) {
      if (!PaymentId) return res.status(200).send('ok');

      // Consulta o pagamento para obter status e dados completos
      const { body } = await consultarPagamento(PaymentId);
      const pagamento = body?.Payment;
      if (!pagamento) return res.status(200).send('ok');

      // Busca usuário pelo RecurrentPaymentId
      const rpId = RecurrentPaymentId || pagamento.RecurrentPayment?.RecurrentPaymentId;
      if (!rpId) return res.status(200).send('ok');

      const { data: user } = await supabase
        .from('users')
        .select('id, plano, plano_fim')
        .eq('cielo_recurrent_payment_id', rpId)
        .single();

      if (!user) return res.status(200).send('ok');

      if (pagamento.Status === 2) {
        // Pagamento confirmado — renova o plano
        const cfg      = PLANOS_CONFIG[user.plano] || { meses: 1 };
        const novoFim  = new Date(user.plano_fim || new Date());
        novoFim.setMonth(novoFim.getMonth() + cfg.meses);

        await supabase.from('users').update({
          plano_status: 'ativo',
          trial_fim:    null,     // trial encerrou, agora é assinatura ativa
          plano_fim:    novoFim.toISOString(),
        }).eq('id', user.id);

      } else if ([3, 13, 14].includes(pagamento.Status)) {
        // Negado / não autorizado — marca como falha
        await supabase.from('users').update({
          plano_status: 'pagamento_falhou',
        }).eq('id', user.id);
      }
    }

    // ChangeType 3 = recorrência desativada
    if (ChangeType === '3' || ChangeType === 3) {
      if (RecurrentPaymentId) {
        await supabase.from('users').update({
          plano:                      'free',
          plano_status:               'cancelado',
          cielo_recurrent_payment_id: null,
        }).eq('cielo_recurrent_payment_id', RecurrentPaymentId);
      }
    }

    res.status(200).send('ok');
  } catch (err) {
    console.error('Erro no webhook Cielo:', err.message);
    res.status(200).send('ok'); // sempre 200 para Cielo não retentar
  }
});

module.exports = router;
