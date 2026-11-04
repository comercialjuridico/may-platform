// ─── Retenção: lembrete de retorno (camada 2) e resumo de segunda (camada 3) ─
// Rodam como tarefas agendadas (jobs/retencao.js). Tudo aqui é idempotente:
// cada envio primeiro "reserva" a linha no banco com um update condicional, e
// só quem conseguiu reservar envia. Assim, se mais de uma instância da May
// estiver no ar, ninguém recebe o mesmo aviso duas vezes.

const { recursosUsuario } = require('./recursos');

const DIA = 86400000;
const APP = () => (process.env.APP_URL || 'https://www.usemayapp.com').replace(/\/+$/, '');

function escapar(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function dataBR(iso, comHora = true) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo',
    ...(comHora ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

// Semana ISO no fuso de Brasília, ex.: "2026-W45".
function semanaISO(agora = new Date()) {
  const br = new Date(agora.getTime() - 3 * 3600000);
  const d = new Date(Date.UTC(br.getUTCFullYear(), br.getUTCMonth(), br.getUTCDate()));
  const dia = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dia);
  const inicioAno = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const semana = Math.ceil(((d - inicioAno) / DIA + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(semana).padStart(2, '0')}`;
}

const CAMPOS_ACESSO = 'id, name, email, plano, plano_status, plano_fim, created_at, role, stripe_subscription_id, cielo_recurrent_payment_id';
const temAcesso = u => !!u && recursosUsuario(u).audio;

// ─── Canais ─────────────────────────────────────────────────────────────────
function criarCanais({ supabase, resend, webpush }) {
  async function push(userId, payload) {
    if (!webpush || !process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) return 0;
    const { data: subs } = await supabase.from('push_subscriptions')
      .select('endpoint, p256dh, auth').eq('user_id', userId).limit(5);
    let ok = 0;
    for (const s of subs || []) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload));
        ok++;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await supabase.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
        }
      }
    }
    return ok;
  }
  async function email(to, subject, html) {
    if (!resend || !to) return false;
    const r = await resend.emails.send({
      from: `${process.env.EMAIL_FROM_NAME || 'May'} <${process.env.EMAIL_FROM}>`, to, subject, html,
    });
    if (r?.error) { console.error('[retenção] e-mail não enviado:', r.error?.message || r.error); return false; }
    return true;
  }
  return { push, email };
}

// ─── Camada 2: lembrete de retorno ──────────────────────────────────────────
function htmlLembrete(user, lead) {
  const primeiro = escapar((user.name || '').split(' ')[0]);
  return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.55;color:#1c1533;max-width:560px">
  <p>${primeiro ? `${primeiro}, ` : ''}hoje é dia de retornar para <strong>${escapar(lead.nome_lead)}</strong>.</p>
  ${lead.proximo_passo ? `<p>O que ficou combinado: ${escapar(lead.proximo_passo)}</p>` : ''}
  ${lead.produto ? `<p>Serviço em conversa: ${escapar(lead.produto)}</p>` : ''}
  <p><a href="${APP()}/app?abrir=retornos" style="color:#7C3AED;font-weight:bold">Abrir a ficha do cliente na May</a></p>
  <p style="font-size:12px;color:#6b6385">Você recebe este aviso porque marcou uma data de retorno no briefing deste cliente.</p>
</div>`;
}

async function enviarLembretesRetorno({ supabase, canais, agora = new Date() }) {
  const { data: pendentes, error } = await supabase.from('leads')
    .select('id, closer_id, nome_lead, produto, proximo_passo, data_retorno')
    .eq('retorno_concluido', false)
    .is('retorno_lembrado_em', null)
    .not('data_retorno', 'is', null)
    .lte('data_retorno', agora.toISOString())
    .gte('data_retorno', new Date(agora.getTime() - 3 * DIA).toISOString()) // não acorda retorno muito antigo
    .limit(200);
  if (error) { console.error('[retenção] lembretes:', error.message); return { enviados: 0 }; }

  let enviados = 0;
  for (const lead of pendentes || []) {
    if (!lead.closer_id) continue;
    // Reserva: só segue quem conseguir marcar o lembrete primeiro.
    const { data: reservado } = await supabase.from('leads')
      .update({ retorno_lembrado_em: agora.toISOString() })
      .eq('id', lead.id).is('retorno_lembrado_em', null)
      .select('id').maybeSingle();
    if (!reservado) continue;

    const { data: user } = await supabase.from('users').select(CAMPOS_ACESSO).eq('id', lead.closer_id).maybeSingle();
    if (!temAcesso(user)) continue;

    await canais.push(user.id, {
      title: `Retorno de hoje: ${String(lead.nome_lead || 'cliente').slice(0, 40)}`,
      body: lead.proximo_passo ? String(lead.proximo_passo).slice(0, 120) : 'Hoje é o dia combinado para retornar.',
      url: '/app?abrir=retornos', tag: `retorno-${lead.id}`,
    });
    await canais.email(user.email, `Retorno de hoje: ${String(lead.nome_lead || 'cliente').slice(0, 60)}`, htmlLembrete(user, lead));
    enviados++;
  }
  return { enviados };
}

// ─── Camada 3: resumo de segunda-feira ──────────────────────────────────────
// Ponto fraco vem do diagnóstico (campo "dificuldades"). Quando a camada 4
// existir, passa a vir das notas por critério.
const EXERCICIOS = {
  objecoes:     { ponto: 'Responder objeções', exercicio: 'Abra o Simulador de objeções e treine as 3 objeções que mais aparecem no seu escritório. Responda cada uma em voz alta antes de escrever.', abrir: 'simulador_objecoes' },
  abordagem:    { ponto: 'Primeiro contato', exercicio: 'Peça para a May um script de primeira mensagem para o seu serviço principal e adapte ao seu jeito de falar.', abrir: 'criador_scripts' },
  qualificacao: { ponto: 'Qualificar o cliente', exercicio: 'Faça uma simulação de reunião e, antes de falar de valor, faça 4 perguntas sobre a situação do cliente.', abrir: 'simular_reuniao' },
  proposta:     { ponto: 'Apresentar a proposta', exercicio: 'Simule a parte final de uma reunião e apresente seus honorários explicando o que está incluído antes de dizer o valor.', abrir: 'simular_reuniao' },
  negociacao:   { ponto: 'Negociar sem ceder', exercicio: 'Peça para a May argumentos para o pedido de desconto mais comum que você recebe e treine a resposta sem baixar o preço.', abrir: 'negociacao' },
  follow_up:    { ponto: 'Follow-up', exercicio: 'Escolha 3 clientes que pararam de responder e peça para a May uma mensagem de retomada para cada um.', abrir: 'follow_up' },
  fechamento:   { ponto: 'Pedir o fechamento', exercicio: 'Faça uma simulação e termine pedindo o próximo passo com data, sem esperar o cliente decidir sozinho.', abrir: 'simular_reuniao' },
  mentalidade:  { ponto: 'Confiança para vender', exercicio: 'Escreva em 3 frases por que o seu serviço muda a vida do cliente e use isso na abertura da próxima reunião.', abrir: 'chat' },
};
const EXERCICIO_PADRAO = { ponto: 'Conduzir a reunião', exercicio: 'Faça uma simulação de reunião de 10 minutos e peça o feedback no final.', abrir: 'simular_reuniao' };

function exercicioDaSemana(user, semana) {
  const lista = String(user.dificuldades || '').split(',').map(s => s.trim()).filter(k => EXERCICIOS[k]);
  if (!lista.length) return EXERCICIO_PADRAO;
  const n = Number.parseInt(String(semana).split('W')[1], 10) || 0;
  return EXERCICIOS[lista[n % lista.length]]; // alterna entre as dificuldades declaradas
}

async function dadosDaSemana(supabase, user, agora) {
  const umaSemanaAtras = new Date(agora.getTime() - 7 * DIA).toISOString();
  const daquiUmaSemana = new Date(agora.getTime() + 7 * DIA).toISOString();
  const [{ data: retornos }, { data: briefings }] = await Promise.all([
    supabase.from('leads').select('id, nome_lead, proximo_passo, data_retorno')
      .eq('closer_id', user.id).eq('retorno_concluido', false)
      .not('data_retorno', 'is', null).lte('data_retorno', daquiUmaSemana)
      .order('data_retorno', { ascending: true }).limit(20),
    supabase.from('leads').select('id, status, participou_reuniao, created_at')
      .eq('closer_id', user.id).not('briefing', 'is', null).gte('created_at', umaSemanaAtras).limit(200),
  ]);
  const b = briefings || [];
  return {
    retornos: retornos || [],
    briefings: b.length,
    fechados: b.filter(l => l.status === 'ganhou').length,
    negociando: b.filter(l => l.status === 'negociando').length,
    perdidos: b.filter(l => l.status === 'perdeu').length,
  };
}

function htmlResumo(user, d, ex, agora) {
  const primeiro = escapar((user.name || '').split(' ')[0]);
  const atrasados = d.retornos.filter(r => Date.parse(r.data_retorno) < agora.getTime());
  const proximos  = d.retornos.filter(r => Date.parse(r.data_retorno) >= agora.getTime());
  const item = r => `<li><strong>${escapar(r.nome_lead)}</strong> · ${dataBR(r.data_retorno)}${r.proximo_passo ? ` · ${escapar(r.proximo_passo)}` : ''}</li>`;
  return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.55;color:#1c1533;max-width:560px">
  <p>${primeiro ? `Bom começo de semana, ${primeiro}.` : 'Bom começo de semana.'} Este é o seu resumo da May.</p>
  <h3 style="font-size:16px;margin:18px 0 6px">Retornos para fazer</h3>
  ${d.retornos.length ? `
    ${atrasados.length ? `<p style="margin:4px 0">Atrasados (${atrasados.length}):</p><ul>${atrasados.map(item).join('')}</ul>` : ''}
    ${proximos.length ? `<p style="margin:4px 0">Nesta semana (${proximos.length}):</p><ul>${proximos.map(item).join('')}</ul>` : ''}`
    : '<p>Nenhum retorno marcado. Depois de cada reunião, registre o próximo passo e a data no briefing para a May te lembrar.</p>'}
  <h3 style="font-size:16px;margin:18px 0 6px">Sua semana passada</h3>
  <p>${d.briefings ? `${d.briefings} briefing${d.briefings > 1 ? 's' : ''} preparado${d.briefings > 1 ? 's' : ''}: ${d.fechados} fechou, ${d.negociando} em negociação, ${d.perdidos} não fechou.` : 'Nenhum briefing preparado. Antes da próxima reunião, gere um em 2 minutos.'}</p>
  <h3 style="font-size:16px;margin:18px 0 6px">Ponto para treinar: ${escapar(ex.ponto)}</h3>
  <p>${escapar(ex.exercicio)} Leva 10 minutos.</p>
  <p><a href="${APP()}/app?abrir=${encodeURIComponent(ex.abrir)}" style="color:#7C3AED;font-weight:bold">Fazer o exercício agora</a></p>
  <p style="font-size:12px;color:#6b6385;margin-top:22px">Para não receber mais este resumo, desligue em Memória do escritório, dentro da May.</p>
</div>`;
}

async function enviarRitualSemanal({ supabase, canais, agora = new Date(), lote = 500 }) {
  const semana = semanaISO(agora);
  let enviados = 0, pagina = 0;
  for (;;) {
    const { data: users, error } = await supabase.from('users')
      .select(`${CAMPOS_ACESSO}, dificuldades, ritual_semanal, ritual_ultima_semana`)
      .eq('ritual_semanal', true)
      .order('id', { ascending: true })
      .range(pagina * lote, pagina * lote + lote - 1);
    if (error) { console.error('[retenção] ritual:', error.message); break; }
    if (!users?.length) break;

    for (const user of users) {
      if (user.ritual_ultima_semana === semana || !temAcesso(user)) continue;
      // Reserva desta semana: só envia quem conseguir gravar primeiro.
      const { data: reservado } = await supabase.from('users')
        .update({ ritual_ultima_semana: semana })
        .eq('id', user.id)
        .or(`ritual_ultima_semana.is.null,ritual_ultima_semana.neq.${semana}`)
        .select('id').maybeSingle();
      if (!reservado) continue;

      const d  = await dadosDaSemana(supabase, user, agora);
      const ex = exercicioDaSemana(user, semana);
      const atrasados = d.retornos.filter(r => Date.parse(r.data_retorno) < agora.getTime()).length;
      await canais.push(user.id, {
        title: 'Seu resumo da semana',
        body: `${d.retornos.length ? `${d.retornos.length} retorno${d.retornos.length > 1 ? 's' : ''} para fazer${atrasados ? ` (${atrasados} atrasado${atrasados > 1 ? 's' : ''})` : ''}. ` : ''}Treino da semana: ${ex.ponto}.`,
        url: `/app?abrir=${encodeURIComponent(ex.abrir)}`, tag: `ritual-${semana}`,
      });
      await canais.email(user.email, 'Seu resumo da semana na May', htmlResumo(user, d, ex, agora));
      enviados++;
    }
    if (users.length < lote) break;
    pagina++;
  }
  return { enviados, semana };
}

module.exports = {
  semanaISO, exercicioDaSemana, criarCanais, enviarLembretesRetorno, enviarRitualSemanal,
  htmlResumo, htmlLembrete, EXERCICIOS,
};
