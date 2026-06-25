// ─── Serviço: Relatório Semanal IA — MAY IA ULTRA ────────────────────────────
// Sextas-feiras às 17h (BRT) → gestor recebe email com:
//   • Diagnóstico individual de cada vendedor
//   • Pauta sugerida para reunião semanal
//   • Sugestão de treinamento personalizado
// Baseado na metodologia de Mayra Alves / Comercial Jurídico

const { supabase } = require('./supabase');
const { Resend }   = require('resend');
const OpenAI       = require('openai');

const resend = new Resend(process.env.RESEND_API_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Prompt da May para diagnóstico de vendedor ──────────────────────────────
function promptDiagnostico(gestor, membro, vendas, metas) {
  const habilidades = membro.habilidades || {};
  const hab = Object.entries(habilidades)
    .map(([k, v]) => `  • ${k}: nível ${v}/5`)
    .join('\n');

  const vendasSemana = vendas.filter(v => v.user_id === membro.id);
  const totalVendas  = vendasSemana.length;
  const faturamento  = vendasSemana.reduce((s, v) => s + (parseFloat(v.valor) || 0), 0);
  const metaAtiva    = metas.find(m => m.user_id === membro.id && m.periodo === 'semanal');

  return `Você é May, assistente comercial jurídica com a metodologia de Mayra Alves (Comercial Jurídico).

CONTEXTO DO GESTOR: ${gestor.name} — ${gestor.email}
ESCRITÓRIO/EMPRESA: ${gestor.empresa_nome || 'não informado'}

DADOS DO VENDEDOR ESTA SEMANA:
Nome: ${membro.name}
Nível geral de habilidades: ${membro.media_geral}/5
Habilidades detalhadas (SPIN, Clean Script, Metodologia Comercial Jurídica):
${hab}
Streak atual: ${membro.streak} dias consecutivos
Dias sem treinar: ${membro.dias_sem_treinar ?? 'nunca treinou'}
Mensagens enviadas no mês: ${membro.mensagens_mes}
Vendas registradas esta semana: ${totalVendas}
Faturamento esta semana: R$ ${faturamento.toFixed(2).replace('.', ',')}
Meta semanal: ${metaAtiva ? `${metaAtiva.indicador === 'faturamento' ? 'R$ ' + Number(metaAtiva.valor_alvo).toLocaleString('pt-BR') : metaAtiva.valor_alvo + ' contratos'}` : 'sem meta definida'}

Com base na metodologia Comercial Jurídico (5 pilares: Clareza Comercial, Conexão, Condução, Valor, Decisão), gere um diagnóstico OBJETIVO e PRÁTICO com:

1. **STATUS DA SEMANA** (1 linha — direto ao ponto)
2. **PONTOS FORTES** (máx 2 bullets — o que está funcionando)
3. **ONDE ESTÁ TRAVANDO** (máx 2 bullets — comportamento específico, não genérico)
4. **AÇÃO DA SEMANA** (1 ação concreta, mensurável, que o gestor deve cobrar)
5. **TREINAMENTO RECOMENDADO** (qual ferramenta da May focar esta semana e por quê)

Seja direto. Sem elogios genéricos. Tom de consultora sênior em vendas jurídicas.
Responda em português brasileiro.
Formato: use os títulos em negrito conforme listado acima.`;
}

// ─── Prompt para pauta da reunião ────────────────────────────────────────────
function promptPauta(gestor, membros, vendasSemana) {
  const resumo = membros.map(m => {
    const v = vendasSemana.filter(x => x.user_id === m.id);
    return `• ${m.name}: ${v.length} vendas | nível geral ${m.media_geral}/5 | ${m.dias_sem_treinar ? m.dias_sem_treinar + ' dias sem treinar' : 'ativo'}`;
  }).join('\n');

  return `Você é May, assistente comercial jurídica com a metodologia de Mayra Alves.

GESTOR: ${gestor.name}
EQUIPE DESTA SEMANA:
${resumo}

Com base nesses dados, crie uma PAUTA DE REUNIÃO SEMANAL objetiva para o gestor conduzir com a equipe.
A reunião deve durar no máximo 45 minutos.

Estrutura obrigatória:
1. **ABERTURA** (5 min) — como iniciar, tom da reunião
2. **NÚMEROS DA SEMANA** (10 min) — o que celebrar, o que revisar
3. **DESTAQUE DA EQUIPE** (5 min) — reconhecimento baseado nos dados
4. **FOCO DA SEMANA** (15 min) — 1 habilidade/comportamento para toda equipe trabalhar
5. **COMPROMISSOS** (10 min) — 1 meta individual que cada vendedor vai trazer na próxima semana

Seja prático. Inclua perguntas-chave que o gestor pode usar em cada bloco.
Português brasileiro. Tom de consultora sênior.`;
}

// ─── Chama OpenAI ─────────────────────────────────────────────────────────────
async function gerarTextoIA(prompt) {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 800,
    temperature: 0.7,
  });
  return completion.choices[0].message.content;
}

// ─── Converte markdown simples para HTML ──────────────────────────────────────
function mdParaHtml(texto) {
  return texto
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/^#{1,3} (.+)$/gm, '<h4 style="margin:12px 0 4px;color:#1e1b4b">$1</h4>')
    .replace(/^• (.+)$/gm, '<li style="margin:3px 0">$1</li>')
    .replace(/(<li.*<\/li>\n?)+/g, '<ul style="margin:6px 0 6px 16px;padding:0">$&</ul>')
    .replace(/\n\n/g, '</p><p style="margin:6px 0">')
    .replace(/\n/g, '<br>');
}

// ─── Template HTML do email ───────────────────────────────────────────────────
function gerarEmailHtml(gestor, pauta, diagnosticos, semana) {
  const diagHtml = diagnosticos.map(d => `
    <div style="background:#f8f7ff;border-left:4px solid #7c3aed;border-radius:0 8px 8px 0;padding:16px 20px;margin-bottom:16px">
      <h3 style="margin:0 0 10px;color:#4c1d95;font-size:15px">${d.nome}</h3>
      <div style="font-size:13.5px;line-height:1.7;color:#374151">${mdParaHtml(d.diagnostico)}</div>
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f4f8;font-family:'Segoe UI',Arial,sans-serif">
<div style="max-width:640px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)">

  <!-- Header -->
  <div style="background:linear-gradient(135deg,#4c1d95,#7c3aed);padding:28px 32px">
    <div style="font-size:22px;font-weight:800;color:#fff;letter-spacing:-.02em">M May</div>
    <div style="color:rgba(255,255,255,.75);font-size:13px;margin-top:4px">Relatório Semanal IA — ${semana}</div>
  </div>

  <!-- Saudação -->
  <div style="padding:28px 32px 0">
    <p style="font-size:16px;color:#1e1b4b;font-weight:600;margin:0 0 4px">Olá, ${gestor.name} 👋</p>
    <p style="font-size:14px;color:#6b7280;margin:0 0 24px">Aqui está o diagnóstico semanal da sua equipe gerado pela May com base na Metodologia Comercial Jurídico.</p>
  </div>

  <!-- Pauta -->
  <div style="padding:0 32px">
    <div style="background:#ede9fe;border-radius:12px;padding:20px 24px;margin-bottom:24px">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#7c3aed;margin-bottom:10px">📋 Pauta da Reunião Semanal</div>
      <div style="font-size:13.5px;line-height:1.75;color:#1e1b4b">${mdParaHtml(pauta)}</div>
    </div>
  </div>

  <!-- Diagnósticos individuais -->
  <div style="padding:0 32px">
    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#7c3aed;margin-bottom:14px">🔍 Diagnóstico Individual</div>
    ${diagHtml}
  </div>

  <!-- Footer -->
  <div style="padding:24px 32px;border-top:1px solid #f3f4f6;margin-top:8px">
    <p style="font-size:12px;color:#9ca3af;margin:0;text-align:center">
      Relatório gerado automaticamente pela May · Metodologia Comercial Jurídico<br>
      Para desativar, acesse o Painel do Gestor → Relatório Semanal
    </p>
  </div>

</div>
</body>
</html>`;
}

// ─── Função principal: gera e envia relatório para uma empresa ────────────────
async function enviarRelatorioEmpresa(empresaId) {
  // 1. Busca gestor da empresa
  const { data: gestor } = await supabase
    .from('users')
    .select('id, name, email, empresa_id, plano')
    .eq('empresa_id', empresaId)
    .in('role', ['gestor', 'admin'])
    .single();

  if (!gestor) throw new Error(`Gestor não encontrado para empresa ${empresaId}`);

  // Verifica se é plano ULTRA
  const plano = (gestor.plano || '').toLowerCase();
  const isUltra = plano.startsWith('prof') || plano === 'ultra';
  if (!isUltra) {
    console.log(`[Relatório] Empresa ${empresaId} não é ULTRA, pulando.`);
    return;
  }

  // 2. Busca membros com dados de streak
  const { data: membros } = await supabase
    .from('users')
    .select(`
      id, name, email, mensagens_mes,
      streak (
        dias_seguidos, maior_streak, ultimo_treino, xp_total,
        nivel_conexao, nivel_objecao, nivel_proposta,
        nivel_negociacao, nivel_fechamento, nivel_follow_up
      )
    `)
    .eq('empresa_id', empresaId)
    .neq('id', gestor.id);

  if (!membros || membros.length === 0) {
    console.log(`[Relatório] Empresa ${empresaId} sem membros, pulando.`);
    return;
  }

  // 3. Busca vendas da semana
  const inicioSemana = new Date();
  inicioSemana.setDate(inicioSemana.getDate() - 7);
  const { data: vendasSemana } = await supabase
    .from('vendas')
    .select('id, user_id, cliente, valor, created_at')
    .eq('empresa_id', empresaId)
    .gte('created_at', inicioSemana.toISOString());

  // 4. Busca metas semanais ativas
  const { data: metas } = await supabase
    .from('metas')
    .select('id, user_id, indicador, valor_alvo, periodo')
    .eq('empresa_id', empresaId)
    .eq('periodo', 'semanal');

  // 5. Enriquece membros
  const agora = new Date();
  const membrosEnriquecidos = (membros || []).map(m => {
    const s = m.streak || {};
    const ultimoTreino = s.ultimo_treino ? new Date(s.ultimo_treino) : null;
    const diasSemTreinar = ultimoTreino
      ? Math.floor((agora - ultimoTreino) / 86400000)
      : null;
    const niveis = [
      s.nivel_conexao, s.nivel_objecao, s.nivel_proposta,
      s.nivel_negociacao, s.nivel_fechamento, s.nivel_follow_up,
    ].filter(Boolean);
    const mediaGeral = niveis.length
      ? Math.round(niveis.reduce((a, b) => a + b, 0) / niveis.length * 10) / 10
      : 0;

    return {
      id: m.id,
      name: m.name,
      email: m.email,
      mensagens_mes: m.mensagens_mes || 0,
      streak: s.dias_seguidos || 0,
      media_geral: mediaGeral,
      dias_sem_treinar: diasSemTreinar,
      habilidades: {
        conexao:    s.nivel_conexao    || 1,
        objecao:    s.nivel_objecao    || 1,
        proposta:   s.nivel_proposta   || 1,
        negociacao: s.nivel_negociacao || 1,
        fechamento: s.nivel_fechamento || 1,
        'follow-up': s.nivel_follow_up || 1,
      },
    };
  });

  gestor.empresa_nome = gestor.empresa_nome || '';

  // 6. Gera pauta via IA
  console.log(`[Relatório] Gerando pauta para empresa ${empresaId}...`);
  const pauta = await gerarTextoIA(promptPauta(gestor, membrosEnriquecidos, vendasSemana || []));

  // 7. Gera diagnóstico individual via IA (paralelo)
  console.log(`[Relatório] Gerando ${membrosEnriquecidos.length} diagnósticos individuais...`);
  const diagnosticos = await Promise.all(
    membrosEnriquecidos.map(async m => ({
      nome: m.name,
      diagnostico: await gerarTextoIA(
        promptDiagnostico(gestor, m, vendasSemana || [], metas || [])
      ),
    }))
  );

  // 8. Monta e envia email
  const semanaStr = (() => {
    const hoje = new Date();
    const inicio = new Date(hoje); inicio.setDate(hoje.getDate() - 7);
    const fmt = d => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    return `${fmt(inicio)} a ${fmt(hoje)}`;
  })();

  const html = gerarEmailHtml(gestor, pauta, diagnosticos, semanaStr);

  await resend.emails.send({
    from: `${process.env.EMAIL_FROM_NAME || 'May'} <${process.env.EMAIL_FROM}>`,
    to: gestor.email,
    subject: `📊 Relatório Semanal da Equipe — ${semanaStr} | May IA`,
    html,
  });

  // 9. Atualiza último envio
  await supabase
    .from('empresas')
    .update({ relatorio_ultimo_envio: new Date().toISOString() })
    .eq('id', empresaId);

  console.log(`[Relatório] ✅ Enviado para ${gestor.email} (empresa ${empresaId})`);
  return { ok: true, destinatario: gestor.email };
}

// ─── Roda para todas as empresas ULTRA com relatório ativo ───────────────────
async function enviarTodosRelatorios() {
  console.log('[Relatório Semanal] Iniciando envio...');
  try {
    const { data: empresas } = await supabase
      .from('empresas')
      .select('id')
      .eq('relatorio_semanal_ativo', true);

    if (!empresas || empresas.length === 0) {
      console.log('[Relatório Semanal] Nenhuma empresa com relatório ativo.');
      return;
    }

    for (const empresa of empresas) {
      try {
        await enviarRelatorioEmpresa(empresa.id);
      } catch (err) {
        console.error(`[Relatório] Erro empresa ${empresa.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[Relatório Semanal] Erro geral:', err.message);
  }
}

module.exports = { enviarRelatorioEmpresa, enviarTodosRelatorios };
