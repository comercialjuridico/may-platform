// ─── Rotas Cielo: checkout recorrente e webhook ─────────────────────────────
const express = require('express');
const router  = express.Router();
const { supabase }          = require('../services/supabase');
const { authMiddleware }    = require('../middleware/auth');
const { criarRecorrencia, consultarPagamento, cancelarRecorrencia } = require('../services/cielo');

const VALORES = {
  mensal: ((parseInt(process.env.CIELO_VALOR_MENSAL) || 9700) / 100).toFixed(2),
  anual:  ((parseInt(process.env.CIELO_VALOR_ANUAL)  || 79700) / 100).toFixed(2),
};

// ─── GET /api/cielo/precos ──────────────────────────────────────────────────
router.get('/precos', (req, res) => {
  res.json(VALORES);
});

// ─── POST /api/cielo/checkout ───────────────────────────────────────────────
// Cria assinatura recorrente via Cielo (primeira cobrança + configura recorrência automática)
router.post('/checkout', authMiddleware, async (req, res) => {
  try {
    const { plano, cartao, cpf } = req.body;

    if (!['mensal', 'anual'].includes(plano)) {
      return res.status(400).json({ erro: 'Plano inválido.' });
    }
    if (!cartao?.numero || !cartao?.titular || !cartao?.validade || !cartao?.cvv) {
      return res.status(400).json({ erro: 'Dados do cartão incompletos.' });
    }

    const resultado = await criarRecorrencia({
      plano,
      cartao,
      cliente: { nome: req.user.name, email: req.user.email, cpf },
      userId: req.user.id,
    });

    const pagamento = resultado.body?.Payment;

    // Pagamento recusado
    if (!pagamento || pagamento.Status !== 2) {
      const motivo = pagamento?.ReturnMessage || 'Cartão não autorizado.';
      return res.status(402).json({ erro: motivo, status: pagamento?.Status });
    }

    // Ativa plano imediatamente
    const agora = new Date();
    const fim   = new Date(agora);
    if (plano === 'mensal') fim.setMonth(fim.getMonth() + 1);
    else                    fim.setFullYear(fim.getFullYear() + 1);

    await supabase.from('users').update({
      plano,
      plano_status:               'ativo',
      plano_inicio:               agora.toISOString(),
      plano_fim:                  fim.toISOString(),
      cielo_recurrent_payment_id: pagamento.RecurrentPayment?.RecurrentPaymentId,
    }).eq('id', req.user.id);

    // Registra no log
    await supabase.from('subscriptions_log').insert({
      user_id:    req.user.id,
      cielo_event: 'checkout.aprovado',
      payload:    resultado.body,
      processado: true,
    }).catch(() => {});

    res.json({ ok: true, plano, fim: fim.toISOString() });

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
        const novoFim = new Date(user.plano_fim || new Date());
        if (user.plano === 'mensal') novoFim.setMonth(novoFim.getMonth() + 1);
        else                         novoFim.setFullYear(novoFim.getFullYear() + 1);

        await supabase.from('users').update({
          plano_status: 'ativo',
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
