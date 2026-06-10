// ─── Rotas Stripe: checkout e webhook ──────────────────────────────────────────
const express = require('express');
const router = express.Router();
const Stripe = require('stripe');
const { supabase } = require('../services/supabase');
const { authMiddleware } = require('../middleware/auth');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ─── POST /api/stripe/checkout ──────────────────────────────────────────────
// Cria sessão de checkout do Stripe
router.post('/checkout', authMiddleware, async (req, res) => {
  try {
    const { plano } = req.body; // 'mensal' ou 'anual'

    if (!['mensal', 'anual'].includes(plano)) {
      return res.status(400).json({ erro: 'Plano inválido.' });
    }

    const priceId = plano === 'mensal'
      ? process.env.STRIPE_PRICE_MENSAL
      : process.env.STRIPE_PRICE_ANUAL;

    // Cria ou reutiliza customer no Stripe
    let customerId = req.user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.user.email,
        name: req.user.name,
        metadata: { user_id: req.user.id },
      });
      customerId = customer.id;
      await supabase.from('users').update({ stripe_customer_id: customerId }).eq('id', req.user.id);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.APP_URL}/index.html?pagamento=sucesso`,
      cancel_url: `${process.env.APP_URL}/index.html?pagamento=cancelado`,
      metadata: { user_id: req.user.id, plano },
      subscription_data: {
        metadata: { user_id: req.user.id, plano },
      },
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Erro ao criar checkout:', err.message);
    res.status(500).json({ erro: 'Erro ao criar sessão de pagamento.' });
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

      // Assinatura criada ou renovada com sucesso
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const userId = subscription.metadata.user_id;
        const plano = subscription.metadata.plano || 'mensal';

        if (!userId) break;

        await supabase.from('users').update({
          plano,
          plano_status: 'ativo',
          plano_inicio: new Date(subscription.current_period_start * 1000).toISOString(),
          plano_fim: new Date(subscription.current_period_end * 1000).toISOString(),
          stripe_subscription_id: subscriptionId,
        }).eq('id', userId);

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

module.exports = router;
