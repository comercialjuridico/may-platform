// ─── Tarefas agendadas de retenção ──────────────────────────────────────────
// Só ligam com JOBS_RETENCAO=true. Essa variável deve existir apenas no
// projeto de produção do Railway (illustrious-strength): os projetos
// duplicados que ainda publicam a main não podem disparar avisos.
const cron = require('node-cron');
const { Resend } = require('resend');
const { supabase } = require('../services/supabase');
const { criarCanais, enviarLembretesRetorno, enviarRitualSemanal } = require('../services/retencao');

function iniciarJobsRetencao() {
  if (process.env.JOBS_RETENCAO !== 'true') {
    console.log('[retenção] tarefas agendadas desligadas (JOBS_RETENCAO != true).');
    return;
  }
  let webpush = null;
  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webpush = require('web-push');
    webpush.setVapidDetails(`mailto:${process.env.EMAIL_FROM || 'contato@usemayapp.com'}`,
      process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
  }
  const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
  const canais = criarCanais({ supabase, resend, webpush });

  // Lembrete de retorno: de hora em hora, das 8h às 20h de Brasília.
  cron.schedule('5 8-20 * * *', async () => {
    try {
      const r = await enviarLembretesRetorno({ supabase, canais });
      if (r.enviados) console.log(`[retenção] lembretes de retorno enviados: ${r.enviados}`);
    } catch (e) { console.error('[retenção] lembretes falharam:', e.message); }
  }, { timezone: 'America/Sao_Paulo' });

  // Resumo de segunda-feira às 8h30 de Brasília.
  cron.schedule('30 8 * * 1', async () => {
    try {
      const r = await enviarRitualSemanal({ supabase, canais });
      console.log(`[retenção] resumo da semana ${r.semana}: ${r.enviados} enviados`);
    } catch (e) { console.error('[retenção] resumo semanal falhou:', e.message); }
  }, { timezone: 'America/Sao_Paulo' });

  console.log('[retenção] lembretes de retorno (8h às 20h) e resumo de segunda (8h30) agendados.');
}

module.exports = { iniciarJobsRetencao };
