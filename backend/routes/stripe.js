// ─── Rotas Stripe: checkout e webhook ──────────────────────────────────────────
const express = require('express');
const router = express.Router();
const Stripe = require('stripe');
const { supabase } = require('../services/supabase');
const { authMiddleware } = require('../middleware/auth');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Mapa de planos → price IDs do Stripe (configurar no .env)
const PRICE_IDS = {
  start_mensal:  process.env.STRIPE_PRICE_START_MENSAL,
  start_anual:   process.env.STRIPE_PRICE_START_ANUAL,
  equipe_mensal: process.env.STRIPE_PRICE_EQUIPE_MENSAL,
  equipe_anual:  process.env.STRIPE_PRICE_EQUIPE_ANUAL,
  pro_mensal:    process.env.STRIPE_PRICE_PRO_MENSAL,
  pro_anual:     process.env.STRIPE_PRICE_PRO_ANUAL,
  prof_mensal:   process.env.STRIPE_PRICE_PROF_MENSAL,
  prof_anual:    process.env.STRIPE_PRICE_PROF_ANUAL,
  // legado
  mensal:        process.env.STRIPE_PRICE_MENSAL,
  anual:         process.env.STRIPE_PRICE_ANUAL,
};

// ─── POST /api/stripe/checkout ──────────────────────────────────────────────
// Cria sessão de checkout do Stripe com trial de 7 dias
router.post('/checkout', authMiddleware, async (req, res) => {
  try {
    const { plano } = req.body;

    const priceId = PRICE_IDS[plano];
    if (!priceId) {
      return res.status(400).json({ erro: 'Plano inválido.' });
    }

    // Cria ou reutiliza customer no Stripe
    let customerId = req.user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.user.email,
        name:  req.user.name,
        metadata: { user_id: req.user.id },
      });
      customerId = customer.id;
      await supabase.from('users').update({ stripe_customer_id: customerId }).eq('id', req.user.id);
    }

    // Usuário já tem assinatura ativa? Não aplica trial novamente
    const jaAssinou = !!req.user.stripe_subscription_id;

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.APP_URL}/app?pagamento=sucesso`,
      cancel_url:  `${process.env.APP_URL}/index.html?pagamento=cancelado&novo-usuario=1`,
      metadata: { user_id: req.user.id, plano },
      subscription_data: {
        metadata: { user_id: req.user.id, plano },
        // Trial de 7 dias apenas para novos assinantes
        ...(jaAssinou ? {} : { trial_period_days: 7 }),
      },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Erro ao criar checkout:', err.message);
    res.status(500).json({ erro: 'Erro ao criar sessão de pagamento.' });
  }
});

// ─── GET /api/stripe/precos ─────────────────────────────────────────────────
// Retorna preços atuais dos planos (sem autenticação)
router.get('/precos', async (req, res) => {
  try {
    const [mensal, anual] = await Promise.all([
      stripe.prices.retrieve(process.env.STRIPE_PRICE_MENSAL),
      stripe.prices.retrieve(process.env.STRIPE_PRICE_ANUAL),
    ]);
    res.json({
      mensal: (mensal.unit_amount / 100).toFixed(2),
      anual:  (anual.unit_amount  / 100).toFixed(2),
    });
  } catch {
    // Fallback com preços hardcoded se Stripe falhar
    res.json({ mensal: '97.00', anual: '797.00' });
  }
});

// ─── POST /api/stripe/portal ────────────────────────────────────────────────
// Portal do cliente para gerenciar assinatura
router.post('/portal', authMiddleware, async (req, res) => {
  try {
    if (!req.user.stripe_customer_id) {
      return res.status(400).json({ erro: 'Nenhuma assinatura ativa encontrada.' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: req.user.stripe_customer_id,
      return_url: `${process.env.APP_URL}/index.html`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Erro ao criar portal:', err.message);
    res.status(500).json({ erro: 'Erro ao abrir portal de pagamento.' });
  }
});

// ─── POST /api/stripe/webhook ───────────────────────────────────────────────
// Recebe eventos do Stripe (usar raw body — configurado no server.js)
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature inválida:', err.message);
    return res.status(400).json({ erro: 'Webhook inválido.' });
  }

  // Registra o evento no banco para auditoria
  await supabase.from('subscriptions_log').insert({
    stripe_event: event.type,
    payload: event,
  });

  try {
    switch (event.type) {

      // Trial iniciado — cartão cadastrado, cobrança futura
      case 'customer.subscription.trial_will_end':
        // Stripe envia 3 dias antes do trial acabar — pode usar para enviar e-mail
        break;

      // Assinatura criada ou renovada com sucesso
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const userId = subscription.metadata.user_id;
        const plano = subscription.metadata.plano || 'start_trimestral';

        if (!userId) break;

        // Deriva tipo de conta pelo plano
        const maxMembros = plano.startsWith('prof') ? 10 : plano.startsWith('pro') ? 5 : plano.startsWith('equipe') ? 3 : 1;

        await supabase.from('users').update({
          plano,
          plano_status: 'ativo',
          plano_inicio: new Date(subscription.current_period_start * 1000).toISOString(),
          plano_fim:    new Date(subscription.current_period_end   * 1000).toISOString(),
          stripe_subscription_id: subscriptionId,
        }).eq('id', userId);

        // Atualiza max_membros da empresa se tiver
        const { data: userRow } = await supabase.from('users').select('empresa_id').eq('id', userId).single();
        if (userRow?.empresa_id) {
          await supabase.from('empresas').update({ max_membros: maxMembros }).eq('id', userRow.empresa_id);
        }

        await supabase.from('subscriptions_log')
          .update({ processado: true })
          .eq('stripe_event', event.type)
          .eq('payload->id', event.id);

        break;
      }

      // Pagamento falhou
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const userId = subscription.metadata.user_id;

        if (!userId) break;

        await supabase.from('users').update({
          plano_status: 'pagamento_falhou',
        }).eq('id', userId);
        break;
      }

      // Assinatura cancelada
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const userId = subscription.metadata.user_id;

        if (!userId) break;

        await supabase.from('users').update({
          plano: 'free',
          plano_status: 'cancelado',
          stripe_subscription_id: null,
        }).eq('id', userId);
        break;
      }

      // Assinatura atualizada (upgrade/downgrade)
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const userId = subscription.metadata.user_id;

        if (!userId) break;

        const plano = subscription.metadata.plano || 'mensal';
        const status = subscription.status === 'active' ? 'ativo' : subscription.status;

        await supabase.from('users').update({
          plano,
          plano_status: status,
          plano_fim: new Date(subscription.current_period_end * 1000).toISOString(),
        }).eq('id', userId);
        break;
      }
    }

    res.json({ recebido: true });
  } catch (err) {
    console.error('Erro ao processar webhook:', err.message);
    res.status(500).json({ erro: 'Erro ao processar evento.' });
  }
});

// ─── POST /api/stripe/cancel ────────────────────────────────────────────────
// Cancela assinatura ao fim do período + salva motivo do cancelamento
router.post('/cancel', authMiddleware, async (req, res) => {
  try {
    const { motivo, detalhes } = req.body;

    if (!req.user.stripe_subscription_id) {
      return res.status(400).json({ erro: 'Nenhuma assinatura ativa encontrada.' });
    }

    // Salva feedback antes de cancelar
    await supabase.from('cancelamentos_feedback').insert({
      user_id:   req.user.id,
      email:     req.user.email,
      plano:     req.user.plano,
      motivo:    motivo || 'Não informado',
      detalhes:  detalhes || null,
      criado_em: new Date().toISOString(),
    }).select(); // ignora erro se tabela não existir ainda

    // Cancela no Stripe ao fim do período (não imediatamente)
    await stripe.subscriptions.update(req.user.stripe_subscription_id, {
      cancel_at_period_end: true,
    });

    // Marca status no banco
    await supabase.from('users').update({ plano_status: 'cancelando' }).eq('id', req.user.id);

    res.json({ ok: true, mensagem: 'Assinatura cancelada. Você mantém acesso até o fim do período atual.' });
  } catch (err) {
    console.error('Erro ao cancelar:', err.message);
    res.status(500).json({ erro: 'Erro ao processar cancelamento. Tente novamente.' });
  }
});

module.exports = router;
