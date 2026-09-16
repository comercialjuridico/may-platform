// ─── Webhook do Daily.co — processa a reunião sozinha quando a gravação fica pronta ──
// Endpoint público (sem authMiddleware — quem chama aqui é o Daily, não um
// usuário logado da May). A segurança vem da assinatura HMAC que o Daily manda
// em cada chamada (ver DAILY_WEBHOOK_SECRET), não de um token de sessão.
//
// Fluxo: assim que uma gravação termina de processar do lado do Daily, ele
// dispara esse webhook com o evento "recording.ready-to-download". A partir
// daí a May já busca o link, transcreve com Whisper, gera a nota com GPT e
// avisa por e-mail quem criou a reunião — sem precisar do botão manual
// "Processar gravação" (que continua existindo em routes/reunioes.js como
// caminho alternativo, caso o webhook falhe ou demore).
const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();
const { Resend }    = require('resend');
const { supabase }  = require('../services/supabase');
const daily          = require('../services/daily');
const { transcrever }     = require('../services/transcricao');
const { analisarReuniao } = require('../services/analiseReuniao');

const resend = new Resend(process.env.RESEND_API_KEY);

// Confere a assinatura HMAC do Daily. A fórmula é: base64(hmac_sha256(secret,
// timestamp + "." + corpo_cru)) — precisa ser o corpo EXATO que o Daily
// mandou (req.rawBody, capturado em server.js), não uma reserialização do
// req.body já parseado, porque a ordem/espaçamento do JSON mudaria o hash.
function assinaturaValida(req) {
  const secret = process.env.DAILY_WEBHOOK_SECRET;
  if (!secret || !req.rawBody) return false;

  const timestamp = req.headers['x-webhook-timestamp'];
  const recebida   = req.headers['x-webhook-signature'];
  if (!timestamp || !recebida) return false;

  try {
    const base = `${timestamp}.${req.rawBody}`;
    const hmac = crypto.createHmac('sha256', Buffer.from(secret, 'base64'));
    const esperada = hmac.update(base).digest('base64');
    const a = Buffer.from(esperada);
    const b = Buffer.from(recebida);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// ─── POST /api/webhooks/daily ──────────────────────────────────────────────
router.post('/daily', async (req, res) => {
  // Responde 200 logo de cara — o Daily reenvia em retry se não receber OK
  // rápido, e o processamento (transcrição + IA) pode levar dezenas de
  // segundos. Erros daqui pra frente só vão pro log, não pra resposta.
  res.status(200).json({ recebido: true });

  try {
    if (!assinaturaValida(req)) {
      console.warn('[webhook daily] assinatura inválida ou ausente — ignorando chamada.');
      return;
    }

    const { type, payload } = req.body || {};
    if (type !== 'recording.ready-to-download' || !payload?.room_name || !payload?.recording_id) return;

    const { data: reuniao } = await supabase
      .from('reunioes_ia')
      .select('*')
      .eq('room_name', payload.room_name)
      .single();

    // Sala não é de uma reunião da May (ex: sala de teste avulsa), ou essa
    // reunião já foi processada antes (o Daily pode reenviar o mesmo evento).
    if (!reuniao || reuniao.status === 'finalizada') return;

    const { download_link } = await daily.linkAcessoGravacao(payload.recording_id);
    const transcricao = await transcrever(download_link);
    const analise      = await analisarReuniao(transcricao);

    const { data: atualizada, error } = await supabase
      .from('reunioes_ia')
      .update({
        daily_recording_id: payload.recording_id,
        transcricao,
        resumo_ia:          analise.resumo,
        nota_ia:             analise.nota,
        sentimento:          analise.sentimento,
        riscos:              analise.riscos,
        proximos_passos:     analise.proximos_passos,
        duracao_min:         payload.duration ? Math.round(payload.duration / 60) : null,
        status:              'finalizada',
        finalizada_em:       new Date().toISOString(),
      })
      .eq('id', reuniao.id)
      .select()
      .single();

    if (error) throw error;

    console.log(`[webhook daily] reunião ${reuniao.id} processada automaticamente.`);

    // Avisa por e-mail quem criou a reunião — mesmo canal já usado pro
    // convite (routes/reunioes.js), sem depender de push/sininho.
    const { data: criador } = await supabase
      .from('users')
      .select('email, name')
      .eq('id', reuniao.criado_por)
      .single();

    if (criador?.email) {
      const r = await resend.emails.send({
        from:    `${process.env.EMAIL_FROM_NAME} <${process.env.EMAIL_FROM}>`,
        to:      criador.email,
        subject: `Nota da reunião pronta: ${atualizada.titulo}`,
        html: `<p>Oi${criador.name ? ', ' + criador.name : ''}!</p>
               <p>A gravação de "<strong>${atualizada.titulo}</strong>" já foi processada automaticamente.</p>
               <p>Nota, resumo, riscos e próximos passos já estão prontos dentro da May, em <strong>Reuniões com IA</strong>.</p>`,
      });
      if (r?.error) console.error('[webhook daily] falha ao enviar e-mail de aviso:', JSON.stringify(r.error));
    }
  } catch (err) {
    console.error('[webhook daily] erro ao processar:', err.message);
  }
});

module.exports = router;
