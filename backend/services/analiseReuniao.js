// ─── Análise de reuniões por IA ──────────────────────────────────────────────
// Recebe a transcrição de uma reunião e devolve nota, resumo, sentimento,
// riscos e próximos passos, usando o Método Comercial Jurídico como critério
// de avaliação (mesmo padrão de prompt usado em routes/briefing.js).
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function montarPrompt(transcricao) {
  return `Você avalia reuniões comerciais de escritórios de advocacia com base no Método Comercial Jurídico. Esse método cobra que o closer: entenda o contexto e a dor real do cliente antes de falar de honorários; crie urgência genuína, sem forçar; responda objeções sem ceder desconto nem prometer resultado; e feche a reunião com um próximo passo concreto e combinado, não vago.

Leia a transcrição abaixo e avalie a reunião com esses critérios.

TRANSCRIÇÃO:
"""
${transcricao}
"""

Devolva SOMENTE um JSON válido, sem nenhum texto antes ou depois, no formato exato:
{
  "nota": <inteiro de 0 a 10, nota geral da condução comercial da reunião>,
  "resumo": "<resumo direto em 3 a 4 frases: quem é o cliente, qual o caso, o que ficou combinado>",
  "sentimento": "<positivo, neutro ou negativo — como o cliente reagiu>",
  "riscos": ["<risco 1 pro fechamento, se houver>", "<risco 2, se houver>"],
  "proximos_passos": ["<passo concreto 1>", "<passo concreto 2, se houver>"]
}
Se não houver riscos ou não houver próximo passo combinado, devolva a lista vazia [] no respectivo campo — nunca invente.`;
}

async function analisarReuniao(transcricao) {
  const completion = await openai.chat.completions.create({
    model:           'gpt-4o',
    temperature:     0.3,
    max_tokens:      700,
    response_format: { type: 'json_object' },
    messages: [{ role: 'user', content: montarPrompt(transcricao) }],
  });

  const bruto = completion.choices[0]?.message?.content || '{}';
  let analise;
  try {
    analise = JSON.parse(bruto);
  } catch {
    analise = {};
  }

  return {
    nota:            Number.isInteger(analise.nota) ? analise.nota : null,
    resumo:          analise.resumo || null,
    sentimento:      analise.sentimento || null,
    riscos:          Array.isArray(analise.riscos) ? analise.riscos : [],
    proximos_passos: Array.isArray(analise.proximos_passos) ? analise.proximos_passos : [],
  };
}

module.exports = { analisarReuniao };
