// ─── Memória do escritório ──────────────────────────────────────────────────
// O que a May sabe sobre o escritório: serviços, honorários, cliente típico,
// objeções reais e scripts que funcionam. Entra em toda resposta e em todo
// briefing. É o que o cliente perde se cancelar: recomeçar em outra IA é
// explicar tudo de novo.

const CAMPOS_TEXTO = {
  servicos:         { max: 2000, rotulo: 'Serviços que o escritório oferece' },
  honorarios:       { max: 1500, rotulo: 'Honorários e como cobra' },
  formas_pagamento: { max: 800,  rotulo: 'Formas de pagamento' },
  perfil_cliente:   { max: 1500, rotulo: 'Cliente típico' },
  diferenciais:     { max: 1500, rotulo: 'Diferenciais do escritório' },
  tom:              { max: 600,  rotulo: 'Jeito de falar com o cliente' },
};
const MAX_ITENS = 30;
const MAX_SUGESTOES = 20;
const MAX_PROMPT = 6000; // caracteres da memória dentro do prompt

const texto = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function limparObjecoes(lista) {
  if (!Array.isArray(lista)) return [];
  return lista
    .map(o => ({ texto: texto(o?.texto, 300), resposta: texto(o?.resposta, 1000) }))
    .filter(o => o.texto)
    .slice(0, MAX_ITENS);
}

function limparScripts(lista) {
  if (!Array.isArray(lista)) return [];
  return lista
    .map(s => ({ titulo: texto(s?.titulo, 120), texto: texto(s?.texto, 2000) }))
    .filter(s => s.titulo && s.texto)
    .slice(0, MAX_ITENS);
}

// Recebe o corpo enviado pela tela e devolve só o que pode ser gravado.
// Campo ausente não é alterado; campo vazio apaga.
function limparMemoria(body = {}) {
  const out = {};
  for (const [campo, cfg] of Object.entries(CAMPOS_TEXTO)) {
    if (body[campo] !== undefined) out[campo] = texto(body[campo], cfg.max) || null;
  }
  if (body.objecoes !== undefined) out.objecoes = limparObjecoes(body.objecoes);
  if (body.scripts  !== undefined) out.scripts  = limparScripts(body.scripts);
  return out;
}

function memoriaVazia(mem) {
  if (!mem) return true;
  return !Object.keys(CAMPOS_TEXTO).some(c => mem[c]) &&
    !(mem.objecoes || []).length && !(mem.scripts || []).length;
}

// Quanto da memória está preenchido (0 a 100), para a tela mostrar progresso.
function completude(mem) {
  if (!mem) return 0;
  const partes = [
    ...Object.keys(CAMPOS_TEXTO).map(c => !!mem[c]),
    (mem.objecoes || []).length >= 3,
    (mem.scripts || []).length >= 1,
  ];
  return Math.round(100 * partes.filter(Boolean).length / partes.length);
}

// Bloco que entra no system prompt e no briefing.
function textoMemoria(mem) {
  if (memoriaVazia(mem)) return '';
  const linhas = ['MEMÓRIA DO ESCRITÓRIO (dados reais informados pelo próprio escritório)'];
  for (const [campo, cfg] of Object.entries(CAMPOS_TEXTO)) {
    if (mem[campo]) linhas.push(`- ${cfg.rotulo}: ${mem[campo]}`);
  }
  if ((mem.objecoes || []).length) {
    linhas.push('- Objeções que os clientes deste escritório costumam levantar:');
    mem.objecoes.forEach(o => linhas.push(`  • "${o.texto}"${o.resposta ? ` → resposta que o escritório usa: ${o.resposta}` : ''}`));
  }
  if ((mem.scripts || []).length) {
    linhas.push('- Scripts aprovados pelo escritório (use como referência de tom e estrutura):');
    mem.scripts.forEach(s => linhas.push(`  • ${s.titulo}: ${s.texto}`));
  }
  linhas.push(
    'Como usar: personalize toda resposta com estes dados (serviço, valores, cliente, objeções e tom do escritório).',
    'Não invente serviços, valores ou condições que não estejam aqui. Se faltar uma informação importante, pergunte.',
  );
  let bloco = linhas.join('\n');
  if (bloco.length > MAX_PROMPT) bloco = bloco.slice(0, MAX_PROMPT) + '\n[memória resumida por tamanho]';
  return bloco;
}

async function carregarMemoria(supabase, empresaId) {
  if (!empresaId) return null;
  try {
    const { data, error } = await supabase
      .from('memoria_escritorio')
      .select('*')
      .eq('empresa_id', empresaId)
      .maybeSingle();
    if (error) return null; // tabela ainda não criada: segue sem memória
    return data || null;
  } catch { return null; }
}

// ─── Aprendizado a partir das conversas ─────────────────────────────────────
// A May lê o trecho recente de uma conversa real e sugere o que vale guardar.
// Nada entra na memória sem a pessoa aprovar na tela.
const PROMPT_EXTRACAO = `Você analisa uma conversa entre um profissional de escritório de advocacia e a assistente May.
Extraia SOMENTE fatos sobre o escritório do profissional que ele mesmo afirmou e que ainda não estão na memória atual:
serviços que vende, valores de honorários, formas de pagamento, perfil dos clientes, diferenciais, objeções reais que clientes levantaram (e a resposta que ele usa, se disse).
Ignore exemplos hipotéticos, simulações, sugestões da May e qualquer dado pessoal de clientes (nomes, telefones, CPF, detalhes do caso).
Responda só em JSON, no formato:
{"sugestoes":[{"campo":"servicos|honorarios|formas_pagamento|perfil_cliente|diferenciais|objecao","texto":"...","resposta":"(só para objecao, opcional)"}]}
Se não houver nada novo, responda {"sugestoes":[]}. No máximo 4 sugestões, cada uma com até 200 caracteres.`;

const CAMPOS_SUGESTAO = new Set(['servicos', 'honorarios', 'formas_pagamento', 'perfil_cliente', 'diferenciais', 'objecao']);

function limparSugestoes(lista) {
  if (!Array.isArray(lista)) return [];
  return lista
    .filter(s => s && CAMPOS_SUGESTAO.has(s.campo) && typeof s.texto === 'string' && s.texto.trim())
    .map(s => ({
      campo: s.campo,
      texto: s.texto.trim().slice(0, 300),
      ...(s.campo === 'objecao' && typeof s.resposta === 'string' && s.resposta.trim()
        ? { resposta: s.resposta.trim().slice(0, 600) } : {}),
    }))
    .slice(0, 4);
}

async function extrairSugestoes(openai, mensagens, mem) {
  const conversa = mensagens.slice(-12)
    .map(m => `${m.role === 'user' ? 'PROFISSIONAL' : 'MAY'}: ${String(m.content).slice(0, 1500)}`)
    .join('\n');
  const r = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 400,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: PROMPT_EXTRACAO },
      { role: 'user', content: `MEMÓRIA ATUAL:\n${textoMemoria(mem) || '(vazia)'}\n\nCONVERSA:\n${conversa}` },
    ],
  }, { timeout: 30000, maxRetries: 0 });
  let json;
  try { json = JSON.parse(r.choices[0]?.message?.content || '{}'); } catch { return []; }
  return limparSugestoes(json.sugestoes);
}

// Junta sugestões novas às pendentes, sem repetir texto e com teto.
function juntarSugestoes(pendentes, novas) {
  const vistos = new Set((pendentes || []).map(s => `${s.campo}|${s.texto.toLowerCase()}`));
  const lista = [...(pendentes || [])];
  for (const s of novas) {
    const chave = `${s.campo}|${s.texto.toLowerCase()}`;
    if (!vistos.has(chave)) { vistos.add(chave); lista.push({ ...s, criado_em: new Date().toISOString() }); }
  }
  return lista.slice(-MAX_SUGESTOES);
}

// Aplica uma sugestão aprovada à memória (texto vai para o fim do campo).
function aplicarSugestao(mem, sug) {
  const novo = {};
  if (sug.campo === 'objecao') {
    novo.objecoes = limparObjecoes([...(mem?.objecoes || []), { texto: sug.texto, resposta: sug.resposta || '' }]);
  } else if (CAMPOS_TEXTO[sug.campo]) {
    const atual = mem?.[sug.campo] ? `${mem[sug.campo]}\n` : '';
    novo[sug.campo] = (atual + sug.texto).slice(0, CAMPOS_TEXTO[sug.campo].max);
  }
  return novo;
}

module.exports = {
  CAMPOS_TEXTO, limparMemoria, memoriaVazia, completude, textoMemoria, carregarMemoria,
  extrairSugestoes, juntarSugestoes, aplicarSugestao, limparSugestoes,
};
