// ─── Cliente da API Daily.co (salas de videochamada) ───────────────────────────
// Conta grátis em https://dashboard.daily.co — a API key fica em
// Developers → API Keys. Cole em DAILY_API_KEY no .env.
const BASE_URL = 'https://api.daily.co/v1';

function headers() {
  return {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${process.env.DAILY_API_KEY}`,
  };
}

async function request(method, path, body) {
  const r = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const erro = new Error(data?.error || data?.info || `Daily respondeu ${r.status}`);
    erro.status = r.status;
    erro.body = data;
    throw erro;
  }
  return data;
}

// Cria uma sala nova. Expira sozinha depois de `expiraEmHoras` (padrão 12h) para
// não acumular salas mortas na conta grátis.
//
// Gravação em nuvem (`enable_recording: 'cloud'`) é um recurso PAGO à parte no
// Daily — sem cartão cadastrado na conta, o pedido de criação da sala inteira
// falha com 400 "cannot be set to that value with your current plan". Por
// isso vem desligada por padrão (`comGravacao: false`): a chamada em si é
// grátis (10.000 min/mês), só liga gravação depois que DAILY_BILLING_ATIVO=true
// confirmar que há cartão cadastrado — sem isso, cada reunião custaria pouco
// (± R$0,07/min gravado) mas travaria a criação da sala inteira.
async function criarSala({ nomeSala, expiraEmHoras = 12, comGravacao = process.env.DAILY_BILLING_ATIVO === 'true' }) {
  const sala = await request('POST', '/rooms', {
    name: nomeSala,
    privacy: 'public', // o link em si já funciona como convite
    properties: {
      exp: Math.floor(Date.now() / 1000) + expiraEmHoras * 3600,
      ...(comGravacao ? { enable_recording: 'cloud' } : {}),
      enable_chat: true,
      eject_at_room_exp: true,
    },
  });

  // Gravação automática: em vez de depender de alguém clicar em "gravar"
  // dentro da call (o que não estava acontecendo — ver incidente de
  // 2026-09-16, sala testada sem nenhuma gravação registrada), a sala volta
  // com um token de reunião embutido no link (`?t=...`) já configurado com
  // `start_cloud_recording: true`. Assim que a primeira pessoa entra usando
  // esse link, o Daily começa a gravar sozinho, sem clique nenhum. É esse
  // mesmo link (já com o token) que a May guarda e manda pro usuário e pro
  // cliente — não precisa de nenhuma outra mudança no resto do fluxo.
  if (comGravacao) {
    const { token } = await request('POST', '/meeting-tokens', {
      properties: {
        room_name: sala.name,
        is_owner: true,
        start_cloud_recording: true,
      },
    });
    sala.url = `${sala.url}?t=${token}`;
  }

  return sala;
}

async function buscarSala(nomeSala) {
  return request('GET', `/rooms/${nomeSala}`);
}

async function apagarSala(nomeSala) {
  return request('DELETE', `/rooms/${nomeSala}`);
}

// Gravações prontas de uma sala. Depois que a call termina, o Daily leva um
// tempo processando antes de aparecer aqui — por isso quem chama isso não é
// automático, é o botão "Processar gravação" na tela de reuniões (ver
// routes/reunioes.js), pra pessoa poder tentar de novo se ainda não tiver saído.
async function listarGravacoes(nomeSala) {
  const resp = await request('GET', `/recordings?room_name=${encodeURIComponent(nomeSala)}`);
  return resp?.data || [];
}

// Link temporário (expira, ver `expires` na resposta) pra baixar ou assistir
// uma gravação específica pelo id dela (não pelo nome da sala).
async function linkAcessoGravacao(recordingId) {
  return request('GET', `/recordings/${recordingId}/access-link`);
}

module.exports = { criarSala, buscarSala, apagarSala, listarGravacoes, linkAcessoGravacao };
