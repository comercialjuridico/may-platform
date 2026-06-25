// ─── Cron Job: Relatório Semanal — Sextas 17h (BRT = UTC-3 → 20h UTC) ────────
const cron = require('node-cron');
const { enviarTodosRelatorios } = require('../services/relatorio-semanal');

function registrarCronRelatorio() {
  // Sexta-feira às 20h UTC = 17h BRT
  // Formato: minuto hora dia_mes mês dia_semana
  // dia_semana: 5 = sexta-feira
  cron.schedule('0 20 * * 5', async () => {
    console.log('[Cron] Iniciando relatório semanal — sexta 17h BRT...');
    await enviarTodosRelatorios();
  }, {
    timezone: 'America/Sao_Paulo', // garante o fuso correto
  });

  console.log('[Cron] Relatório semanal agendado: sextas-feiras às 17h (BRT)');
}

module.exports = { registrarCronRelatorio };
