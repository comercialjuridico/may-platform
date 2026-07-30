// ─── Rotas de Notificações Push ──────────────────────────────────────────────
const express   = require('express');
const router    = express.Router();
const webpush   = require('web-push');
const { supabase } = require('../services/supabase');
const { authMiddleware } = require('../middleware/auth');

webpush.setVapidDetails(
  'mailto:comercialjuridico1@gmail.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// ─── GET /api/notificacoes/vapid-public ──────────────────────────────────────
// Retorna a chave pública para o frontend assinar
router.get('/vapid-public', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// ─── POST /api/notificacoes/subscribe ────────────────────────────────────────
// Salva ou atualiza a subscription do usuário
router.post('/subscribe', authMiddleware, async (req, res) => {
  const { subscription } = req.body;
  if (!subscription?.endpoint) return res.status(400).json({ erro: 'Subscription inválida.' });

  const userId = req.user.id;

  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({
      user_id:  userId,
      endpoint: subscription.endpoint,
      p256dh:   subscription.keys?.p256dh,
      auth:     subscription.keys?.auth,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,endpoint' });

  if (error) {
    console.error('Erro ao salvar subscription:', error.message);
    return res.status(500).json({ erro: 'Erro ao registrar notificação.' });
  }

  res.json({ ok: true });
});

// ─── POST /api/notificacoes/unsubscribe ──────────────────────────────────────
router.post('/unsubscribe', authMiddleware, async (req, res) => {
  const { endpoint } = req.body;
  await supabase
    .from('push_subscriptions')
    .delete()
    .eq('user_id', req.user.id)
    .eq('endpoint', endpoint);
  res.json({ ok: true });
});

// ─── POST /api/notificacoes/enviar-cron (interno — sem auth) ─────────────────
// Disparado por cron job interno; protegido por CRON_SECRET
router.post('/enviar-cron', async (req, res) => {
  const secret = req.headers['x-cron-secret'];
  if (secret !== process.env.CRON_SECRET) return res.status(401).json({ erro: 'Não autorizado.' });

  const { tipo } = req.body; // 'diario' | 'semanal'

  try {
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('user_id, endpoint, p256dh, auth')
      .limit(500);

    if (!subs?.length) return res.json({ enviados: 0 });

    const payload = tipo === 'semanal' ? payloadSemanal() : payloadDiario();
    let enviados = 0, erros = 0;

    await Promise.allSettled(
      subs.map(async sub => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify(payload)
          );
          enviados++;
        } catch (err) {
          erros++;
          // Remove subscriptions expiradas (410 Gone)
          if (err.statusCode === 410 || err.statusCode === 404) {
            await supabase.from('push_subscriptions')
              .delete().eq('endpoint', sub.endpoint);
          }
        }
      })
    );

    console.log(`Push ${tipo}: ${enviados} enviados, ${erros} erros`);
    res.json({ enviados, erros });
  } catch (err) {
    console.error('Erro no cron push:', err.message);
    res.status(500).json({ erro: err.message });
  }
});

// ─── POST /api/notificacoes/testar ───────────────────────────────────────────
// Envia notificação de teste para o usuário logado
router.post('/testar', authMiddleware, async (req, res) => {
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', req.user.id)
    .limit(5);

  if (!subs?.length) return res.status(404).json({ erro: 'Nenhuma subscription encontrada. Ative as notificações primeiro.' });

  const payload = {
    title: '🔔 May — Notificações ativas!',
    body:  'Você vai receber lembretes diários de prática. Bom treino!',
    url:   '/app',
    tag:   'may-teste',
  };

  let ok = 0;
  await Promise.allSettled(
    subs.map(async s => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload)
        );
        ok++;
      } catch {}
    })
  );

  res.json({ ok, total: subs.length });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function payloadDiario() {
  const frases = [
    'Você treinou hoje? 5 minutos de simulação podem mudar sua próxima reunião.',
    'Uma prática por dia faz você fechar mais. Sua trilha está esperando.',
    'Advogados que treinam vendem mais. Seu próximo exercício leva 5 minutos.',
    'Sua meta da semana ainda não foi cumprida. Que tal agora?',
    'O ranking atualiza toda semana. Vale a pena treinar hoje.',
  ];
  return {
    title: '📚 May — Hora de praticar',
    body:  frases[Math.floor(Math.random() * frases.length)],
    url:   '/app',
    tag:   'may-diario',
  };
}

function payloadSemanal() {
  return {
    title: '📊 May — Resumo da semana',
    body:  'Veja seu progresso, sua posição no ranking e a meta desta semana.',
    url:   '/app',
    tag:   'may-semanal',
  };
}

module.exports = router;
