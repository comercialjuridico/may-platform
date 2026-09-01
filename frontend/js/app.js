// ═══════════════════════════════════════════════════════════════════════════════
// app.js — Lógica principal do chat e da interface
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Estado global ──────────────────────────────────────────────────────────
const estado = {
  user: null,
  streak: null,
  conversaAtiva: null,
  ferramentaAtiva: 'chat',
  areaAtiva: null,        // { id, nome, icone } da área selecionada
  areas: [],              // lista de áreas do usuário
  enviando: false,
  conversas: [],
  uso: { mensagens_usadas: 0, limite: 20, restantes: 20 },
  documentosAnexados: [], // [{ upload_id, filename }] — documentos pendentes de envio
};

// ─── Controle de acesso por plano ─────────────────────────────────────────────
const PLANO_NIVEL = { free: 0, start: 1, equipe: 2, pro: 3, prof: 4 };

// Normaliza plano do usuário (ex: "start_mensal" → "start")
function planoBase(user) {
  const p = (user?.plano || 'free').toLowerCase();
  if (p.startsWith('prof')) return 'prof';
  if (p.startsWith('pro'))  return 'pro';
  if (p.startsWith('equipe') || p === 'mensal' || p === 'anual') return 'equipe';
  if (p.startsWith('start')) return 'start';
  return 'free';
}

// Plano mínimo exigido por ferramenta
const FERRAMENTA_PLANO_MIN = {
  'chat':               'start',
  'follow_up':          'start',
  'negociacao':         'start',
  'diagnostico':        'start',
  'spin':               'start',
  'simular_reuniao':    'start',
  'simulador_objecoes': 'start',
  'gerador_proposta':   'start',
  'criador_prompt':     'equipe',   // MAY IA PLUS+
  'simulador_vendas':   'start',    // consta na lista do plano vendido
};

const PLANO_NOME  = { start: 'MAY IA PLUS', equipe: 'MAY IA PLUS', pro: 'MAY IA PRO', prof: 'MAY IA ULTRA' };

// Limite de arquivos por mensagem
const LIMITE_ANEXOS_MSG = { free: 1, start: 1, equipe: 2, pro: 3, prof: 5 };
function limiteAnexosMensagem() {
  return LIMITE_ANEXOS_MSG[planoBase(estado.user)] || 1;
}
// Preço mostrado nas telas de upsell/bloqueio.
// Lê sempre de PW_PRECOS (o mesmo objeto que o checkout cobra) para que a
// plataforma nunca anuncie um valor diferente do que será cobrado de fato.
function precoPlanoUpsell() {
  return `${PW_PRECOS.mensal.preco}/mês`;
}

function temAcesso(ferramentaId, user) {
  const base = planoBase(user);
  // Usuários free = trial ativo → acesso total para conhecer a plataforma
  if (base === 'free') return true;
  const min = FERRAMENTA_PLANO_MIN[ferramentaId] || 'start';
  return PLANO_NIVEL[base] >= PLANO_NIVEL[min];
}

// ─── Onboarding + Trial + Payment Wall ───────────────────────────────────────

// Preços do payment wall — plano único
const PW_PRECOS = {
  mensal: { preco: 'R$ 97',  sub: 'cobrado mensalmente · cancele quando quiser',  checkout: 'start_mensal' },
  anual:  { preco: 'R$ 936', sub: 'cobrado anualmente · equivale a R$ 78/mês',    checkout: 'start_anual'  },
};
let _pwPeriodo = 'mensal';
let _pwPlano   = 'start'; // sempre start — único plano

function verificarFluxoOnboarding(user) {
  // Calcula dias desde criação
  const criado     = new Date(user.created_at || Date.now());
  const diasDesde  = (Date.now() - criado.getTime()) / (1000 * 60 * 60 * 24);
  const emTrial    = (user.plano === 'free' || !user.plano) &&
                     !user.cielo_recurrent_payment_id && !user.stripe_subscription_id;

  // Assinatura expirada: a plataforma carrega normal e o bloqueio
  // entra 3 segundos depois, cobrindo tudo (sem X, sem ESC).
  if (assinaturaExpirada(user)) {
    mostrarBloqueioExpirado();
    return;
  }

  // Banner verde de trial
  if (emTrial) {
    const diasRestantes = Math.ceil(7 - diasDesde);
    mostrarBannerTrial(diasRestantes);
  }

  // Onboarding obrigatório: diagnóstico
  const params = new URLSearchParams(window.location.search);
  const oShown = localStorage.getItem('onboarding_shown');
  if (!user.diagnostico_completo && !oShown && params.get('novo') === '1') {
    mostrarOnboardingWall();
  }
}

function mostrarBannerTrial(diasRestantes) {
  const bar = document.getElementById('trial-top-bar');
  if (!bar) return;
  bar.style.display = 'flex';
  document.getElementById('trial-bar-text').textContent =
    diasRestantes <= 1
      ? '⚠️ Último dia de teste — assine hoje para não perder o acesso'
      : `🎁 ${diasRestantes} dias de teste grátis restantes`;
  // Empurra o app para baixo
  const app = document.getElementById('app');
  if (app) app.style.paddingTop = '36px';
}

function mostrarOnboardingWall() {
  const wall = document.getElementById('onboarding-wall');
  if (wall) wall.style.display = 'flex';
}

function iniciarDiagnostico() {
  localStorage.setItem('onboarding_shown', '1');
  const wall = document.getElementById('onboarding-wall');
  if (wall) wall.style.display = 'none';
  // Esconde o X — diagnóstico é obrigatório no onboarding
  const btnClose = document.querySelector('#modal-diagnostico .modal-close');
  if (btnClose) btnClose.style.display = 'none';
  abrirModalDiagnostico();
}

// Intenção de plano vinda da landing page (/register?plano=anual)
function guardarPlanoEscolhido() {
  const p = new URLSearchParams(window.location.search).get('plano');
  if (p === 'anual' || p === 'mensal') localStorage.setItem('may_plano_escolhido', p);
}
function planoEscolhido() {
  return localStorage.getItem('may_plano_escolhido') === 'anual' ? 'anual' : 'mensal';
}

// ── Payment wall ──────────────────────────────────────────────────────────────
function abrirPaymentWall(bloqueante) {
  const wall = document.getElementById('payment-wall');
  if (!wall) return;
  wall.style.display = 'flex';

  // Mensagem contextual conforme o modo
  const subtitulo = wall.querySelector('#pw-subtitulo');
  if (subtitulo) {
    subtitulo.textContent = bloqueante
      ? 'Seu período gratuito terminou. Escolha um plano para continuar.'
      : 'Acesso imediato após a confirmação';
  }

  // Bloqueante = dia 8: não permite fechar clicando fora nem ESC
  if (!bloqueante) {
    wall.onclick = e => { if (e.target === wall) fecharPaymentWall(); };
  } else {
    wall.onclick = null;
  }
  // Respeita o plano que a pessoa escolheu na landing page
  pwPeriodo(planoEscolhido());
}

function fecharPaymentWall() {
  const wall = document.getElementById('payment-wall');
  if (wall) wall.style.display = 'none';
}

// ─── Bloqueio de assinatura expirada ─────────────────────────────────────────
let _bloqueioExpiradoTimer = null;

// Assinatura vencida: trial de 7 dias estourado OU plano marcado como expirado
function assinaturaExpirada(user) {
  if (!user) return false;
  if (user.plano_status === 'expirado' || user._trial_expirado) return true;

  const emTrial = (user.plano === 'free' || !user.plano) &&
                  !user.cielo_recurrent_payment_id && !user.stripe_subscription_id;
  if (!emTrial) return false;

  const criado    = new Date(user.created_at || Date.now());
  const diasDesde = (Date.now() - criado.getTime()) / (1000 * 60 * 60 * 24);
  return diasDesde >= 7;
}

// Deixa a plataforma aparecer por alguns segundos e só então bloqueia tudo
function mostrarBloqueioExpirado(delayMs) {
  const wall = document.getElementById('expired-wall');
  if (!wall || wall.classList.contains('ativo')) return;

  clearTimeout(_bloqueioExpiradoTimer);
  _bloqueioExpiradoTimer = setTimeout(() => {
    const pm = document.getElementById('exp-preco-mensal');
    const pa = document.getElementById('exp-preco-anual');
    if (pm) pm.textContent = `Renovar agora — ${PW_PRECOS.mensal.preco}/mês`;
    if (pa) pa.textContent = `Plano anual — ${PW_PRECOS.anual.preco} (economize!)`;
    wall.classList.add('ativo');
  }, delayMs == null ? 3000 : delayMs);
}

// Botões do bloqueio → payment wall (z-index maior, cobre o bloqueio)
function renovarAssinatura(periodo) {
  abrirPaymentWall(true);
  pwPeriodo(periodo || 'mensal');
}

function pwPeriodo(p) {
  _pwPeriodo = p;
  const bM = document.getElementById('pw-btn-mensal');
  const bA = document.getElementById('pw-btn-anual');
  const ativo   = 'padding:7px 22px;border-radius:8px;border:none;font-size:.8rem;font-weight:600;cursor:pointer;transition:all .2s;background:rgba(124,58,237,.8);color:#fff;';
  const inativo = 'padding:7px 22px;border-radius:8px;border:none;font-size:.8rem;font-weight:600;cursor:pointer;transition:all .2s;background:transparent;color:rgba(200,190,255,.5);';
  if (bM) bM.style.cssText = p === 'mensal' ? ativo : inativo;
  if (bA) bA.style.cssText = p === 'anual'  ? ativo : inativo;

  const dados = PW_PRECOS[p];
  const precoEl  = document.getElementById('pw-price-main');
  const subEl    = document.getElementById('pw-price-sub');
  const labelEl  = document.getElementById('pw-period-label');
  if (precoEl)  precoEl.textContent  = dados.preco;
  if (subEl)    subEl.textContent    = dados.sub;
  if (labelEl)  labelEl.textContent  = p === 'mensal' ? '/mês' : '/ano';
}

function pwAvancarPagamento() {
  document.getElementById('pw-pane1').style.display = 'none';
  document.getElementById('pw-pane2').style.display = 'block';
  document.getElementById('pw-step1-label').style.color = 'rgba(200,190,255,.4)';
  document.getElementById('pw-step2-label').style.cssText = 'font-weight:700;color:#A78BFA;';
  const dados = PW_PRECOS[_pwPeriodo];
  document.getElementById('pw-resumo-plano').textContent = 'MAY IA — Plano Completo';
  document.getElementById('pw-resumo-preco').textContent = `${dados.preco}/${_pwPeriodo === 'mensal' ? 'mês' : 'ano'}`;

  // Máscaras
  document.getElementById('pw-numero')?.addEventListener('input', e => {
    e.target.value = e.target.value.replace(/\D/g,'').slice(0,16).replace(/(.{4})/g,'$1 ').trim();
  });
  document.getElementById('pw-validade')?.addEventListener('input', e => {
    e.target.value = e.target.value.replace(/\D/g,'').slice(0,4).replace(/^(\d{2})(\d)/,'$1/$2');
  });
  document.getElementById('pw-cvv')?.addEventListener('input', e => {
    e.target.value = e.target.value.replace(/\D/g,'').slice(0,4);
  });
  document.getElementById('pw-cpf')?.addEventListener('input', e => {
    const d = e.target.value.replace(/\D/g,'').slice(0,14);
    e.target.value = d.length <= 11
      ? d.replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d{1,2})$/,'$1-$2')
      : d.replace(/(\d{2})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{4})(\d{1,2})$/,'$1/$2');
  });
}

function pwVoltarPlanos() {
  document.getElementById('pw-pane1').style.display = 'block';
  document.getElementById('pw-pane2').style.display = 'none';
  document.getElementById('pw-step1-label').style.color = '#A78BFA';
  document.getElementById('pw-step2-label').style.cssText = '';
}

async function pwSubmit(e) {
  e.preventDefault();
  const btn  = document.getElementById('pw-submit');
  const erro = document.getElementById('pw-erro');
  erro.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Validando cartão…';

  try {
    const validade = document.getElementById('pw-validade').value.trim();
    const [mm, aa] = validade.split('/');
    const planoKey = PW_PRECOS[_pwPeriodo].checkout;

    // 1. Pré-validar cartão
    const preRes = await fetch('/api/cielo/pre-validar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plano: planoKey,
        cpf:   document.getElementById('pw-cpf').value,
        cartao: {
          numero:   document.getElementById('pw-numero').value.replace(/\D/g,''),
          titular:  document.getElementById('pw-titular').value.trim(),
          validade: `${mm}/20${aa}`,
          cvv:      document.getElementById('pw-cvv').value,
        },
      }),
    });
    const preData = await preRes.json();
    if (!preRes.ok) {
      console.error('Pré-validação recusada:', preData);
      const cod = preData.codigo ? ` (código Cielo ${preData.codigo})` : '';
      const dbg = preData._debug ? `\n\nHTTP ${preData._debug.httpStatus} · ${preData._debug.body}` : '';
      throw new Error((preData.erro || 'Cartão não autorizado.') + cod + dbg);
    }

    // 2. Ativar plano (usuário já logado)
    const token = getAccessToken();
    const ativarRes = await fetch('/api/cielo/ativar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ orderId: preData.orderId }),
    });
    const ativarData = await ativarRes.json();
    if (!ativarRes.ok) throw new Error(ativarData.erro || 'Erro ao ativar assinatura.');

    // 3. Sucesso — atualiza localmente e recarrega dados do servidor
    estado.user.plano = _pwPlano;
    estado.user.plano_status = 'ativo';
    estado.user.cielo_recurrent_payment_id = preData.orderId || 'ativo';
    salvarUser(estado.user);
    fecharPaymentWall();
    const barTop = document.getElementById('trial-top-bar');
    if (barTop) barTop.style.display = 'none';

    mostrarToast(`✅ Assinatura confirmada! Bem-vindo(a) à May IA`);

    // Recarrega dados do servidor para refletir empresa_id e permissões atualizadas
    await carregarDadosIniciais();
    renderizarSidebar();
    mostrarHomeDashboard();

  } catch (err) {
    erro.textContent    = err.message;
    erro.style.whiteSpace = 'pre-wrap';
    erro.style.display  = 'block';
    btn.disabled       = false;
    btn.textContent    = '🔒 Confirmar assinatura →';
  }
}

// ─── Ferramentas disponíveis ─────────────────────────────────────────────────
const FERRAMENTAS = [
  { id: 'chat',               nome: 'Chat livre',                  icon: '💬' },
  { id: 'simular_reuniao',    nome: 'Simular reunião',             icon: '🎭' },
  { id: 'simulador_objecoes', nome: 'Simulador de objeções',       icon: '🎯' },
  { id: 'gerador_proposta',   nome: 'Gerador de proposta',         icon: '📄' },
  { id: 'follow_up',          nome: 'Script de follow-up',         icon: '🔁' },
  { id: 'negociacao',         nome: 'Argumentos de negociação',    icon: '⚖️' },
  { id: 'diagnostico',        nome: 'Diagnóstico de atendimento',  icon: '🔍' },
  { id: 'spin',               nome: 'Treino SPIN Selling',         icon: '🧠' },
  { id: 'simulador_vendas',   nome: 'Simulador de vendas',         icon: '🏋️' },
  { id: 'criador_prompt',     nome: 'Criador de prompt de IA',     icon: '🤖' },
];

// ─── Fases da Trilha ──────────────────────────────────────────────────────────
const FASES_TRILHA = [
  {
    id: 'mentalidade', nome: 'Mentalidade', icon: '🧭',
    desc: 'Supere o bloqueio de vender e defina seu posicionamento',
    exercicios: [
      { id: 'a', label: 'Aprender: Por que advogados travam na venda', tipo: 'chat', prompt: 'Me explica por que advogados têm bloqueio com vendas e como superar isso na prática. Quero entender a raiz do problema e os primeiros passos.' },
      { id: 'b', label: 'Praticar: Montar minha proposta de valor', tipo: 'chat', prompt: 'Quero montar minha proposta de valor como advogado. Me faz perguntas para eu entender o que realmente ofereço e como comunicar isso com clareza para o cliente.' },
      { id: 'c', label: 'Simular: Apresentação inicial para um lead', tipo: 'simular_reuniao', cenario: 'apresentacao_inicial' },
    ],
  },
  {
    id: 'captacao', nome: 'Captação', icon: '🎯',
    desc: 'Prospecte ativamente e use indicações de forma profissional',
    exercicios: [
      { id: 'a', label: 'Aprender: Os 3 canais de prospecção que funcionam', tipo: 'chat', prompt: 'Quais as formas de prospecção que realmente funcionam para advogados? Quero entender cada canal com exemplos práticos de como começar.' },
      { id: 'b', label: 'Praticar: Script de abordagem inicial', tipo: 'follow_up', prompt: 'Me dá um script de abordagem para um contato que ainda não é cliente — por WhatsApp. Precisa soar natural, não como vendedor.' },
      { id: 'c', label: 'Simular: Pedir indicação para um cliente satisfeito', tipo: 'simular_reuniao', cenario: 'pedir_indicacao' },
    ],
  },
  {
    id: 'qualificacao', nome: 'Qualificação', icon: '🔍',
    desc: 'Identifique quem realmente vai contratar antes de investir tempo',
    exercicios: [
      { id: 'a', label: 'Aprender: As perguntas que qualificam qualquer lead', tipo: 'spin', prompt: 'Me ensina as perguntas fundamentais para qualificar um lead no contexto jurídico. Como identificar se o cliente tem urgência, orçamento e autoridade para decidir?' },
      { id: 'b', label: 'Praticar: Roteiro de diagnóstico do cliente', tipo: 'diagnostico', prompt: 'Quero criar um roteiro de perguntas para a primeira reunião com um lead. Me ajuda a montar um diagnóstico comercial completo.' },
      { id: 'c', label: 'Simular: Primeira reunião com lead frio', tipo: 'simular_reuniao', cenario: 'primeira_reuniao' },
    ],
  },
  {
    id: 'proposta', nome: 'Proposta', icon: '💰',
    desc: 'Apresente honorários com confiança e responda objeções de preço',
    exercicios: [
      { id: 'a', label: 'Aprender: A estrutura de proposta que converte', tipo: 'chat', prompt: 'Como montar uma proposta de honorários que foque no valor e não no preço? Me dá a estrutura e os princípios para apresentar sem medo.' },
      { id: 'b', label: 'Praticar: Gerar minha proposta', tipo: 'gerador_proposta', prompt: 'Preciso montar uma proposta para um novo caso. Me ajuda a estruturar mostrando valor antes de falar em preço.' },
      { id: 'c', label: 'Simular: Responder "tá caro" do cliente', tipo: 'simular_reuniao', cenario: 'objecao_preco' },
    ],
  },
  {
    id: 'fechamento', nome: 'Fechamento', icon: '🤝',
    desc: 'Feche sem pressão e transforme clientes em fãs',
    exercicios: [
      { id: 'a', label: 'Aprender: Sinais de compra e como fechar sem pressionar', tipo: 'chat', prompt: 'Como identificar os sinais de compra e fechar a venda sem pressionar o cliente? Quero técnicas práticas para o contexto jurídico.' },
      { id: 'b', label: 'Praticar: Follow-up pós-proposta sem parecer chato', tipo: 'follow_up', prompt: 'Preciso de um script de follow-up para 4 dias após enviar a proposta. O lead não respondeu. Precisa soar natural, não insistente.' },
      { id: 'c', label: 'Simular: Negociação final com cliente indeciso', tipo: 'simular_reuniao', cenario: 'fechamento_final' },
    ],
  },
];

// ─── Cenários de simulação ───────────────────────────────────────────────────
const CENARIOS_SIMULACAO = {
  apresentacao_inicial: {
    nome: 'Apresentação inicial', icon: '🤝',
    desc: 'Você foi indicado para alguém. É a primeira ligação — o lead está cético.',
    promptSistema: 'Você é um potencial cliente que foi indicado para esse advogado. Tem uma dúvida sobre disputa trabalhista com seu antigo empregador. Está cético em contratar advogado — acha caro e não sabe se vale. Seja natural, faça perguntas, demonstre resistência inicial razoável. Quando o advogado perguntar, responda com informações reais mas não se convença fácil.',
  },
  pedir_indicacao: {
    nome: 'Pedir indicação', icon: '🌟',
    desc: 'Seu cliente ficou satisfeito. Hora de pedir indicação sem parecer chato.',
    promptSistema: 'Você é um cliente que fechou um caso com esse advogado e ficou muito satisfeito com o resultado. Estão encerrando o caso. Quando o advogado tentar pedir indicação, seja um pouco reticente a dar nomes — é algo delicado — mas aberto se a abordagem for boa e natural. Não dê a indicação sem o advogado conduzir bem.',
  },
  primeira_reuniao: {
    nome: 'Primeira reunião', icon: '🔍',
    desc: 'Lead frio que veio do Instagram. Tem problema real mas não está convicto.',
    promptSistema: 'Você é um lead que veio do Instagram do escritório. Tem um problema real: seu patrão não pagou FGTS nos últimos 2 anos. Mas você ainda não está convicto de que precisa de advogado — acha que pode resolver sozinho, tem medo do custo. Faça perguntas, demonstre dúvidas. Deixe o advogado te qualificar e descobrir a dor.',
  },
  objecao_preco: {
    nome: 'Objeção de preço', icon: '💰',
    desc: 'O cliente recebeu a proposta de R$ 3.500 e voltou dizendo "tá caro".',
    promptSistema: 'Você é um cliente que recebeu uma proposta de honorários de R$ 3.500 para uma causa trabalhista. Consultou outro escritório que cobrou R$ 2.000. Você gostou do advogado mas quer negociar ou entender por que custa mais. Mantenha a posição de que acha caro — não ceda fácil, exija bons argumentos.',
  },
  fechamento_final: {
    nome: 'Fechamento com indeciso', icon: '⏰',
    desc: 'Lead disse "vou pensar" há 1 semana. Você ligou para fazer follow-up.',
    promptSistema: 'Você é um lead que disse "vou pensar" há 1 semana após receber uma proposta. Está interessado mas com medo do custo e ainda avaliando. Quando o advogado ligar, seja educado mas um pouco esquivo. Responda mas não tome decisão fácil — exija que o advogado conduza o fechamento com cuidado.',
  },
};

// ─── Inicialização ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  aplicarTemaInicial();

  const user = getUser();
  if (!user || !getAccessToken()) {
    window.location.href = '/auth.html';
    return;
  }

  estado.user = user;
  guardarPlanoEscolhido();
  await carregarDadosIniciais(); // atualiza estado.user com dados frescos do servidor
  renderizarSidebar();

  carregarModulosHeader(); // carrega módulos ativos no topo
  verificarFluxoOnboarding(estado.user);
  verificarDiagnostico();
  verificarQueryParams();
  if (!estado.conversaAtiva) mostrarHomeDashboard();
  inicializarPushNotificacoes();
  carregarTrilhaDoServidor(); // sincroniza progresso da trilha com o banco
});

async function carregarDadosIniciais() {
  try {
    const [resMe, resConversas, resUso, resAreas] = await Promise.all([
      api.get('/user/me'),
      api.get('/chat/conversas'),
      api.get('/user/uso'),
      api.get('/areas'),
    ]);

    if (resMe?.ok) {
      const data = await resMe.json();
      estado.user   = data.user;
      estado.streak = data.streak;
      salvarUser(data.user);

      // Visibilidade dos botões contextuais é gerenciada em renderizarSidebar()

    if (resAreas?.ok) {
      const d = await resAreas.json();
      estado.areas = d.areas || [];
      // Área permanece nula (modo geral) — usuário escolhe manualmente se quiser
    }
    }

    if (resConversas?.ok) {
      const data = await resConversas.json();
      estado.conversas = data.conversas || [];
    }

    if (resUso?.ok) {
      estado.uso = await resUso.json();
    }
  } catch (err) {
    console.error('Erro ao carregar dados iniciais:', err);
  }
}

// ─── Verificar params de URL ─────────────────────────────────────────────────
function verificarQueryParams() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('pagamento') === 'sucesso') {
    mostrarToast('Assinatura ativada com sucesso! 🎉', 'sucesso');
    window.history.replaceState({}, '', '/');
    carregarDadosIniciais().then(renderizarSidebar);
  }
  if (params.get('pagamento') === 'cancelado') {
    mostrarToast('Pagamento cancelado.', 'aviso');
    window.history.replaceState({}, '', '/');
  }
}

// ─── Diagnóstico inicial ─────────────────────────────────────────────────────
function verificarDiagnostico() {
  // Se a onboarding wall está visível, não abre o modal agora —
  // o usuário vai clicar "Começar diagnóstico" que chama iniciarDiagnostico()
  const wall = document.getElementById('onboarding-wall');
  if (wall && wall.style.display === 'flex') return;
  if (!estado.user?.diagnostico_completo) {
    abrirModalDiagnostico();
  }
}

// ─── Header user dropdown ────────────────────────────────────────────────────
function toggleUserDropdown() {
  document.getElementById('user-dropdown').classList.toggle('open');
}
function fecharUserDropdown() {
  document.getElementById('user-dropdown').classList.remove('open');
}
document.addEventListener('click', e => {
  const wrap = document.getElementById('header-user-wrap');
  if (wrap && !wrap.contains(e.target)) fecharUserDropdown();
});

function _setAvatarEl(el, user) {
  if (!el) return;
  if (user?.avatar_url) {
    el.innerHTML = `<img src="${user.avatar_url}" alt="" />`;
  } else {
    el.textContent = (user?.name || 'U').charAt(0).toUpperCase();
  }
}

// ─── Render Sidebar ──────────────────────────────────────────────────────────
function renderizarSidebar() {
  const user = estado.user;

  // Avatar no header (canto superior direito)
  _setAvatarEl(document.getElementById('header-avatar'), user);

  // Dropdown: avatar, nome, role, email
  _setAvatarEl(document.getElementById('dd-avatar'), user);
  document.getElementById('dd-name').textContent  = user?.name  || '—';
  document.getElementById('dd-email').textContent = user?.email || '—';
  const roleLabel = { admin: 'Administrador', gestor: 'Gestor', membro: 'Membro' };
  document.getElementById('dd-role').textContent  = roleLabel[user?.role] || (user?.plano || 'free');

  // Compat: elementos antigos podem não existir mais
  const avatarEl = document.getElementById('user-avatar-text');
  if (avatarEl) _setAvatarEl(avatarEl, user);
  const nameEl = document.getElementById('user-name-text');
  if (nameEl) nameEl.textContent = user?.name || '';
  const badgeEl = document.getElementById('user-plan-badge');
  if (badgeEl) badgeEl.innerHTML = `<span class="badge badge-${user?.plano||'free'}">${user?.plano||'free'}</span>`;

  // Link Painel do Gestor: visível só para gestores
  const linkGestor = document.getElementById('link-painel-gestor');
  if (linkGestor) linkGestor.style.display = (['gestor','admin'].includes(user?.role)) ? 'flex' : 'none';

  // Ferramentas
  const toolList = document.getElementById('tool-list');
  toolList.innerHTML = FERRAMENTAS.map(f => {
    const bloqueado = !temAcesso(f.id, user);
    return `
    <div class="tool-item ${estado.ferramentaAtiva === f.id ? 'active' : ''} ${bloqueado ? 'tool-locked' : ''}"
         onclick="selecionarFerramenta('${f.id}')">
      <span class="tool-icon">${f.icon}</span>
      <span>${f.nome}</span>
      ${bloqueado ? '<span class="tool-lock-icon">🔒</span>' : ''}
    </div>`;
  }).join('');

  // Seletor de Área Ativa
  renderizarSeletorArea();

  // Conversas
  renderizarListaConversas();

  // Contador de uso
  atualizarContadorUso();

}

// ─── Seletor de Área Ativa ───────────────────────────────────────────────────
function renderizarSeletorArea() {
  // Busca ou cria o container na sidebar
  let container = document.getElementById('area-ativa-container');
  if (!container) return; // será criado pelo HTML

  // Áreas ocultas por padrão — modo geral ativo
  container.style.display = 'none';
  return;

  container.style.display = 'block'; // eslint-disable-line no-unreachable
  const ativa = estado.areaAtiva;

  container.innerHTML = `
    <div style="padding:0 10px;margin-bottom:4px">
      <div style="font-size:10px;font-weight:600;letter-spacing:.08em;color:var(--text-muted);margin-bottom:6px">ÁREA ATIVA</div>
      ${estado.areas.map(a => `
        <div style="display:flex;align-items:center;gap:4px;margin-bottom:3px;">
          <div onclick="selecionarArea('${a.id}')"
               style="flex:1;display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:7px;cursor:pointer;font-size:13px;transition:background .15s;
                      background:${ativa?.id === a.id ? 'rgba(249,115,22,0.15)' : 'transparent'};
                      border:1px solid ${ativa?.id === a.id ? 'rgba(249,115,22,0.35)' : 'transparent'};
                      color:${ativa?.id === a.id ? 'var(--accent)' : 'var(--text-secondary)'}">
            <span>${a.icone || '⚖️'}</span>
            <span style="font-weight:${ativa?.id === a.id ? '600' : '400'}">${escapeHtml(a.nome)}</span>
            ${ativa?.id === a.id ? '<span style="margin-left:auto;font-size:10px;opacity:.7">●</span>' : ''}
          </div>
          <button onclick="abrirArquivosArea('${a.id}','${escapeHtml(a.nome)}')"
                  title="Arquivos salvos em ${escapeHtml(a.nome)}"
                  style="flex-shrink:0;background:transparent;border:none;cursor:pointer;padding:5px 6px;border-radius:6px;font-size:13px;color:var(--text-muted);transition:all .15s;"
                  onmouseover="this.style.background='rgba(255,255,255,.08)';this.style.color='#A78BFA'"
                  onmouseout="this.style.background='transparent';this.style.color='var(--text-muted)'">📂</button>
        </div>
      `).join('')}
    </div>
  `;
}

function selecionarArea(id) {
  const area = estado.areas.find(a => a.id === id);
  if (!area) return;
  estado.areaAtiva = area;

  // Atualiza label do chat se já houver uma área
  const labelEl = document.getElementById('chat-tool-label');
  if (labelEl && estado.ferramentaAtiva === 'chat') {
    labelEl.textContent = `Área: ${area.nome}`;
  }

  renderizarSeletorArea();
  mostrarToast(`Área "${area.nome}" ativada`, 'sucesso');
}

function renderizarListaConversas() {
  const lista = document.getElementById('conv-list');
  if (!estado.conversas.length) {
    lista.innerHTML = '<p class="text-muted text-xs" style="padding:8px 10px">Nenhuma conversa ainda</p>';
    return;
  }
  lista.innerHTML = estado.conversas.map(c => `
    <div class="conv-item ${estado.conversaAtiva === c.id ? 'active' : ''}"
         onclick="carregarConversa('${c.id}')">
      <span class="conv-item-title">${escapeHtml(c.titulo)}</span>
    </div>
  `).join('');
}

function atualizarContadorUso() {
  const el = document.getElementById('usage-counter');
  if (!el) return;
  const { mensagens_usadas, limite, restantes } = estado.uso;
  el.textContent = `${mensagens_usadas}/${limite === 999999 ? '∞' : limite} mensagens`;
  el.className = 'usage-counter' +
    (restantes <= 5 ? ' danger' : restantes <= 20 ? ' warning' : '');
}

// ─── Selecionar ferramenta ───────────────────────────────────────────────────
function selecionarFerramenta(id) {
  // Bloquear ferramenta se plano insuficiente
  if (!temAcesso(id, estado.user)) {
    mostrarUpsell(id);
    return;
  }

  estado.ferramentaAtiva = id;
  estado.conversaAtiva   = null;

  const ferramenta = FERRAMENTAS.find(f => f.id === id);
  document.getElementById('chat-title').textContent = ferramenta?.nome || 'Chat';
  document.getElementById('chat-tool-label').textContent =
    id === 'chat' ? 'May — Assistente de vendas' : 'Ferramenta ativa';

  mostrarInputChat();
  if (id === 'simular_reuniao') {
    mostrarCenariosSimulacao();
  } else {
    mostrarTelaVazia(id);
  }
  renderizarSidebar();
  fecharMenuMobile();
}

// ─── Upsell wall (área bloqueada) ────────────────────────────────────────────
function mostrarUpsell(ferramentaId) {
  const ferr    = FERRAMENTAS.find(f => f.id === ferramentaId);
  const minBase = FERRAMENTA_PLANO_MIN[ferramentaId] || 'equipe';
  const nome    = PLANO_NOME[minBase]  || 'MAY IA PLUS';
  const preco   = precoPlanoUpsell();
  const userBase = planoBase(estado.user);
  const planoAtualNome = {
    free: 'Período de teste', start: 'MAY IA START',
    equipe: 'MAY IA PLUS', pro: 'MAY IA PRO', prof: 'MAY IA ULTRA',
  }[userBase] || 'seu plano atual';

  // Atualiza header
  document.getElementById('chat-title').textContent = ferr?.nome || 'Área bloqueada';
  document.getElementById('chat-tool-label').textContent = `Disponível no ${nome}`;

  // Esconde input de chat
  const wrapper = document.getElementById('chat-input-wrapper');
  if (wrapper) wrapper.style.display = 'none';

  // Marca como ativa na sidebar (sem abrir de verdade)
  estado.ferramentaAtiva = ferramentaId;
  renderizarSidebar();

  // Renderiza wall de upsell
  const container = document.getElementById('messages-container');
  container.innerHTML = `
    <div class="upsell-wall">
      <div class="upsell-overlay-icon">🔒</div>
      <div class="upsell-icon">${ferr?.icon || '🔒'}</div>
      <h3 class="upsell-titulo">${ferr?.nome || 'Esta área'}</h3>
      <p class="upsell-plano-atual">Você está no plano <strong>${planoAtualNome}</strong></p>
      <p class="upsell-desc">
        Faça upgrade para o <strong>${nome}</strong> e tenha acesso imediato e ilimitado
        a esta ferramenta.
      </p>
      <div class="upsell-preco-box">
        <span class="upsell-preco">${preco}</span>
        <span class="upsell-preco-fine">· cancele quando quiser</span>
      </div>
      <button onclick="abrirPaymentWall(false)" class="upsell-btn" style="border:none;cursor:pointer;width:100%">
        Ver planos → Acesso imediato
      </button>
      <p class="upsell-fine">✓ Acesso imediato &nbsp;·&nbsp; ✓ Sem fidelidade</p>
    </div>
  `;
  fecharMenuMobile();
}

// ─── Tela vazia com sugestões ────────────────────────────────────────────────
const TOOL_INFO = {
  chat: {
    desc: 'Pergunte qualquer coisa sobre vendas. A May responde com base no seu perfil e área de atuação.',
    dica: null,
    sugestoes: [
      'Como responder objeções de preço?',
      'Como qualificar um lead no primeiro contato?',
      'Me dá um script de abordagem para WhatsApp',
      'Como pedir indicação sem parecer chato?',
    ],
  },
  simular_reuniao: {
    desc: 'Escolha um cenário real e pratique antes de ir para o cliente. A May joga o papel do cliente — com resistências, objeções e personalidade.',
    dica: '💡 A simulação é a forma mais eficaz de treinar. Quanto mais vezes você fizer, mais natural fica na hora real.',
    sugestoes: [],
  },
  simulador_objecoes: {
    desc: 'A May cria um lead fictício com nome, situação e objeção provável. Você pratica como responderia — ela avalia e corrige em tempo real.',
    dica: '💡 Quanto mais detalhe você der sobre o tipo de objeção, mais realista fica o treino.',
    sugestoes: [
      'Iniciar simulação — nível fácil',
      'Iniciar simulação — nível médio',
      'Quero treinar a objeção "não tenho dinheiro"',
      'Treinar objeção "preciso pensar"',
      'Simular cliente que compara com concorrente',
    ],
  },
  gerador_proposta: {
    desc: 'Informe o nome do lead, o serviço contratado e o valor aproximado — a May monta uma proposta comercial completa, pronta para enviar.',
    dica: '💡 Quanto mais contexto você fornecer (nicho, situação do lead, urgência), mais personalizada fica a proposta.',
    sugestoes: [
      'Proposta para revisão de benefício INSS — honorários R$ 2.500',
      'Proposta para causa trabalhista — honorários R$ 3.000',
      'Proposta para cliente que pediu desconto',
      'Proposta para contrato de consultoria mensal',
      'Modelo de proposta para novo cliente do escritório',
    ],
  },
  follow_up: {
    desc: 'Para leads que sumiram ou não responderam. A May gera mensagens de acompanhamento naturais, sem parecer insistente ou robótico.',
    dica: '💡 Informe quantos dias passaram e qual foi o último contato para a May calibrar o tom certo.',
    sugestoes: [
      'Lead sumiu após receber a proposta há 4 dias',
      'Cliente disse "vou pensar" há uma semana',
      'Reativar lead frio que não responde há 30 dias',
      'Follow-up após reunião de diagnóstico',
      'Mensagem de reativação para ex-cliente',
    ],
  },
  negociacao: {
    desc: 'Cenários reais de objeção de preço e negociação. A May te entrega argumentos prontos, com linguagem de autoridade e sem ceder desconto desnecessário.',
    dica: '💡 Descreva o perfil do lead (resistente, ansioso, comparador) para receber os argumentos mais certeiros.',
    sugestoes: [
      'Preciso de argumentos para sustentar meu preço',
      'Lead comparou com concorrente mais barato',
      'Cliente quer parcelar além do que ofereço',
      'Como responder "tá caro" sem dar desconto',
      'Cliente quer desconto mas o caso é complexo',
    ],
  },
  diagnostico: {
    desc: 'Cole aqui um atendimento real — conversa de WhatsApp, e-mail ou anotações de reunião. A May identifica onde você perdeu pontos e o que fazer diferente.',
    dica: '💡 Quanto mais completo o histórico da conversa, mais precisa é a análise. Pode colar sem formatar.',
    sugestoes: [
      'Vou colar um atendimento que não fechou',
      'Analise essa conversa do WhatsApp com o lead',
      'O que errei nessa negociação?',
      'Diagnóstico de reunião que não converteu',
    ],
  },
  spin: {
    desc: 'Treino baseado na metodologia SPIN Selling (Situação, Problema, Implicação, Necessidade). A May simula um cliente e você pratica fazer as perguntas certas para revelar a dor e criar urgência.',
    dica: '💡 O SPIN é a técnica mais eficaz para vendas consultivas. Ideal para advogados que vendem serviços de alto valor.',
    sugestoes: [
      'Iniciar treino de SPIN Selling — nível iniciante',
      'Preciso praticar perguntas de implicação',
      'Me explica a metodologia SPIN com exemplos jurídicos',
      'Simular reunião de diagnóstico usando SPIN',
      'Como usar SPIN para vender planos de contrato?',
    ],
  },
  simulador_vendas: {
    desc: 'Simulação completa de uma venda: Abertura → Desenvolvimento → Fechamento. A May cria um lead com perfil, histórico e resistências reais. Você conduz todo o processo.',
    dica: '💡 Use depois do simulador de objeções — aqui o cenário é mais longo e você precisa conduzir todas as etapas.',
    sugestoes: [
      'Iniciar simulação completa de vendas',
      'Simular reunião de diagnóstico com lead frio',
      'Simular abordagem inicial por WhatsApp',
      'Simular cliente de alto valor — honorários acima de R$ 5.000',
    ],
  },
  criador_prompt: {
    desc: 'Crie instruções personalizadas para a May se comportar de forma específica em um contexto seu. Útil para quem quer treinar um script ou roteiro particular.',
    dica: '💡 Funcionalidade avançada. Descreva o cenário, o tom e o objetivo — a May monta o prompt pronto para usar.',
    sugestoes: [
      'Criar prompt para atendimento previdenciário',
      'Criar roteiro para vendas de contratos recorrentes',
      'Prompt para consultoria de revisão de benefício',
    ],
  },
};

function mostrarTelaVazia(ferramenta) {
  const container = document.getElementById('messages-container');
  const ferr   = FERRAMENTAS.find(f => f.id === ferramenta);
  const info   = TOOL_INFO[ferramenta] || {};
  const qs     = info.sugestoes || [];
  const desc   = info.desc || 'Selecione uma opção abaixo para começar.';
  const dica   = info.dica || null;

  container.innerHTML = `
    <div class="chat-empty">
      <div class="chat-empty-icon">${ferr?.icon || '💬'}</div>
      <h2>${ferr?.nome || 'Chat'}</h2>
      <p class="text-secondary" style="max-width:480px; margin:0 auto 4px;">${desc}</p>
      ${dica ? `<p class="tool-tip">${dica}</p>` : ''}
      ${qs.length ? `
        <div class="quick-actions">
          ${qs.map(q => `
            <button class="quick-action" onclick="enviarMensagemRapida('${escapeHtml(q)}')">
              ${escapeHtml(q)}
            </button>
          `).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

function enviarMensagemRapida(texto) {
  document.getElementById('message-input').value = texto;
  enviarMensagem();
}

// ─── Carregar conversa existente ─────────────────────────────────────────────
async function carregarConversa(id) {
  try {
    const res = await api.get(`/chat/conversa/${id}`);
    if (!res?.ok) { mostrarToast('Erro ao carregar conversa', 'erro'); return; }

    const { conversa, mensagens } = await res.json();
    estado.conversaAtiva   = id;
    estado.ferramentaAtiva = conversa.ferramenta || 'chat';

    document.getElementById('chat-title').textContent = conversa.titulo;
    document.getElementById('chat-tool-label').textContent = 'Conversa anterior';

    mostrarInputChat();
    const container = document.getElementById('messages-container');
    container.innerHTML = '';

    mensagens.forEach(m => adicionarMensagem(m.role, m.content, false));
    container.scrollTop = container.scrollHeight;

    renderizarSidebar();
    fecharMenuMobile();
  } catch (err) {
    mostrarToast('Erro ao carregar conversa', 'erro');
  }
}

// ─── Excluir conversa ────────────────────────────────────────────────────────
// Desativado: exclusão de conversas não é permitida nesta plataforma.
function excluirConversa() { /* desativado */ }

// ─── Enviar mensagem ─────────────────────────────────────────────────────────
async function enviarMensagem() {
  if (estado.enviando) return;

  const input = document.getElementById('message-input');
  const texto = input.value.trim();
  if (!texto) return;

  input.value = '';
  input.style.height = 'auto';
  estado.enviando = true;
  document.getElementById('btn-send').disabled = true;

  // Exibe mensagem do usuário
  const container = document.getElementById('messages-container');
  // Remove tela vazia / home se existir
  const vazia = container.querySelector('.chat-empty');
  if (vazia) vazia.remove();
  const home = container.querySelector('.home-hero');
  if (home) home.remove();

  adicionarMensagem('user', texto);

  // Se há documentos anexados, mostra chips no chat e inclui no payload
  let uploadIds = [];
  if (estado.documentosAnexados.length > 0) {
    uploadIds = estado.documentosAnexados.map(d => d.upload_id);

    // Mostra chips de anexo na bolha do usuário
    const container2 = document.getElementById('messages-container');
    const mensagens = container2.querySelectorAll('.message.user');
    const ultimaMensagem = mensagens[mensagens.length - 1];
    if (ultimaMensagem) {
      const bubble = ultimaMensagem.querySelector('.msg-bubble');
      if (bubble) {
        const chipsHtml = estado.documentosAnexados.map(d => `
          <div style="display:inline-flex;align-items:center;gap:5px;background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.3);border-radius:6px;padding:4px 8px;font-size:0.78rem;color:#C4B5FD;">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <span style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(d.filename)}</span>
          </div>
        `).join('');
        bubble.insertAdjacentHTML('afterbegin', `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">${chipsHtml}</div>`);
      }
    }

    // Limpa o estado de anexos
    estado.documentosAnexados = [];
    removerAnexoBadge();
    document.getElementById('message-input').placeholder = 'Pergunte algo para a May...';
  }

  // Placeholder de streaming
  const msgId = 'msg-streaming-' + Date.now();
  container.innerHTML += `
    <div class="message" id="${msgId}">
      <div class="msg-avatar may">M</div>
      <div class="msg-content">
        <div class="msg-name">May</div>
        <div class="msg-bubble">
          <div class="typing-indicator">
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
          </div>
        </div>
      </div>
    </div>
  `;
  container.scrollTop = container.scrollHeight;

  let textoResposta = '';
  const bolha = document.querySelector(`#${msgId} .msg-bubble`);

  await api.stream(
    '/chat/stream',
    {
      mensagem: texto,
      conversa_id: estado.conversaAtiva,
      ferramenta: estado.ferramentaAtiva,
      area_ativa: estado.areaAtiva ? { nome: estado.areaAtiva.nome, icone: estado.areaAtiva.icone } : null,
      ...(uploadIds.length ? { upload_ids: uploadIds } : {}),
    },
    // onChunk — recebe texto em streaming
    (chunk) => {
      textoResposta += chunk;
      bolha.innerHTML = renderMarkdown(textoResposta);
      container.scrollTop = container.scrollHeight;
    },
    // onDone
    (evento, tipo) => {
      if (tipo === 'conversa_criada' && evento.conversa_id) {
        estado.conversaAtiva = evento.conversa_id;
      }
      if (tipo === 'fim') {
        // Adiciona botões de ação pós-streaming
        const msgEl = document.getElementById(msgId);
        if (msgEl && !msgEl.querySelector('.msg-actions')) {
          msgEl.querySelector('.msg-content').insertAdjacentHTML('beforeend', msgActionButtons(msgId));
        }
        // Atualiza uso
        estado.uso.mensagens_usadas++;
        estado.uso.restantes = Math.max(0, estado.uso.restantes - 1);
        atualizarContadorUso();
        // Recarrega lista de conversas
        recarregarConversas();
        // Reabilita botão apenas ao fim do streaming
        estado.enviando = false;
        document.getElementById('btn-send').disabled = false;
        input.focus();
      }
    },
    // onError
    (msg) => {
      bolha.innerHTML = `<span style="color:var(--error)">${escapeHtml(msg)}</span>`;
      mostrarToast(msg, 'erro');
      // Reabilita botão em caso de erro também
      estado.enviando = false;
      document.getElementById('btn-send').disabled = false;
      input.focus();
    }
  );
}

// ─── Adicionar mensagem ao DOM ────────────────────────────────────────────────
function msgActionButtons(msgId) {
  const isProposal = estado.ferramentaAtiva === 'gerador_proposta';
  const proposalBtn = isProposal ? `
    <button class="msg-action-btn" style="background:rgba(124,58,237,0.15);border-color:rgba(124,58,237,0.35);color:#C4B5FD;font-weight:600" onclick="baixarPropostaPDF('${msgId}')">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
      📄 Proposta PDF
    </button>
  ` : '';

  return `<div class="msg-actions">
    ${proposalBtn}
    <button class="msg-action-btn" onclick="copiarMensagem('${msgId}')">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
      Copiar
    </button>
    <button class="msg-action-btn" onclick="salvarTemplate('${msgId}')">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
      Salvar
    </button>
    <button class="msg-action-btn" onclick="exportarDocx('${msgId}')">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
      Word
    </button>
    <button class="msg-action-btn" onclick="exportarPdf('${msgId}')">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 13h6M9 17h4"/></svg>
      PDF
    </button>
    <button class="msg-action-btn" onclick="exportarImagem('${msgId}')">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
      Imagem
    </button>
  </div>`;
}

// ─── Baixar proposta com branding do escritório ───────────────────────────────
async function baixarPropostaPDF(msgId) {
  const bolha = document.querySelector(`#${msgId} .msg-bubble`);
  if (!bolha) return;

  // Extrai texto puro da bolha (sem HTML)
  const conteudo = bolha.innerText || bolha.textContent || '';
  if (!conteudo.trim()) return;

  // Detecta título da proposta na primeira linha com #
  const primeiraLinha = conteudo.split('\n').find(l => l.trim());
  const titulo = primeiraLinha?.replace(/^#+\s*/, '').slice(0, 80) || 'Proposta Comercial';

  const btn = bolha.closest('.message')?.querySelector('button[onclick*="baixarPropostaPDF"]');
  const textoOriginal = btn?.textContent?.trim() || '📄 Proposta PDF';
  if (btn) { btn.textContent = '⏳ Gerando...'; btn.disabled = true; }

  try {
    const token = getAccessToken();
    const res = await fetch('/api/export/pdf', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ conteudo, titulo }),
    });

    if (!res.ok) { mostrarToast('Erro ao gerar PDF.', 'erro'); return; }

    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = titulo.replace(/[^a-zA-Z0-9À-ÿ\s]/g,'').replace(/\s+/g,'_').slice(0,60) + '.pdf';
    a.click();
    URL.revokeObjectURL(url);

    mostrarToast('PDF da proposta baixado! 📄', 'sucesso');
  } catch (err) {
    mostrarToast('Erro ao gerar PDF.', 'erro');
  } finally {
    if (btn) { btn.innerHTML = '📄 Proposta PDF'; btn.disabled = false; }
  }
}

function adicionarMensagem(role, conteudo, scroll = true) {
  const container = document.getElementById('messages-container');
  const isUser = role === 'user';
  const inicial = (estado.user?.name || 'V').charAt(0).toUpperCase();
  const msgId = 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2,6);

  const html = `
    <div class="message ${isUser ? 'user' : ''}" id="${msgId}">
      <div class="msg-avatar ${isUser ? 'user-av' : 'may'}">${isUser ? inicial : 'M'}</div>
      <div class="msg-content">
        <div class="msg-name">${isUser ? 'Você' : 'May'}</div>
        <div class="msg-bubble">${isUser ? escapeHtml(conteudo) : renderMarkdown(conteudo)}</div>
        ${!isUser ? msgActionButtons(msgId) : ''}
      </div>
    </div>
  `;

  container.insertAdjacentHTML('beforeend', html);
  if (scroll) container.scrollTop = container.scrollHeight;
}

// ─── Recarregar lista de conversas ──────────────────────────────────────────
async function recarregarConversas() {
  const res = await api.get('/chat/conversas');
  if (res?.ok) {
    const data = await res.json();
    estado.conversas = data.conversas || [];
    renderizarListaConversas();
  }
}

// ─── Ações de mensagem ───────────────────────────────────────────────────────
function copiarMensagem(msgId) {
  const bolha = document.querySelector(`#${msgId} .msg-bubble`);
  if (!bolha) return;
  const texto = bolha.innerText || bolha.textContent;
  navigator.clipboard.writeText(texto).then(() => mostrarToast('Copiado!', 'sucesso'));
}

async function exportarDocx(msgId) {
  const bolha = document.querySelector(`#${msgId} .msg-bubble`);
  if (!bolha) return;
  const conteudo = bolha.innerText || bolha.textContent;

  mostrarToast('Gerando Word...', 'aviso');
  const res = await api.post('/export/docx', {
    conteudo,
    titulo: `May — ${new Date().toLocaleDateString('pt-BR')}`,
  });

  if (res?.ok) {
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `may_${Date.now()}.docx`;
    a.click();
    URL.revokeObjectURL(url);
    mostrarToast('Word exportado!', 'sucesso');
  } else {
    mostrarToast('Erro ao exportar', 'erro');
  }
}

async function salvarTemplate(msgId) {
  const bolha = document.querySelector(`#${msgId} .msg-bubble`);
  if (!bolha) return;
  const conteudo = bolha.innerText || bolha.textContent;

  // Gera título automático baseado na ferramenta + data
  const ferrNome = FERRAMENTAS.find(f => f.id === estado.ferramentaAtiva)?.nome || 'Conteúdo';
  const data     = new Date().toLocaleDateString('pt-BR');
  const titulo   = `${ferrNome} — ${data}`;

  const body = {
    tipo:    estado.ferramentaAtiva,
    titulo,
    conteudo,
    area_id: estado.areaAtiva?.id || null,
  };

  const res = await api.post('/export/template', body);

  if (res?.ok) {
    const areaNome = estado.areaAtiva?.nome;
    mostrarToast(areaNome ? `Salvo em "${areaNome}"` : 'Salvo nos seus arquivos!', 'sucesso');
  } else {
    mostrarToast('Erro ao salvar', 'erro');
  }
}

// ─── Input auto-resize ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('message-input');
  if (!input) return;

  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 160) + 'px';
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      enviarMensagem();
    }
  });
});

// ─── Export PDF ──────────────────────────────────────────────────────────────
async function exportarPdf(msgId) {
  const bolha = document.querySelector(`#${msgId} .msg-bubble`);
  if (!bolha) return;
  const conteudo = bolha.innerText || bolha.textContent;

  mostrarToast('Gerando PDF...', 'aviso');
  const res = await api.post('/export/pdf', {
    conteudo,
    titulo: `May — ${new Date().toLocaleDateString('pt-BR')}`,
  });

  if (res?.ok) {
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `may_${Date.now()}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
    mostrarToast('PDF exportado!', 'sucesso');
  } else {
    mostrarToast('Erro ao gerar PDF', 'erro');
  }
}

// ─── Export Imagem (html2canvas) ─────────────────────────────────────────────
async function exportarImagem(msgId) {
  const bolha = document.querySelector(`#${msgId} .msg-bubble`);
  if (!bolha) { mostrarToast('Mensagem não encontrada', 'erro'); return; }

  if (typeof html2canvas === 'undefined') {
    mostrarToast('html2canvas não carregado', 'erro'); return;
  }

  mostrarToast('Gerando imagem...', 'aviso');
  try {
    const canvas = await html2canvas(bolha, {
      backgroundColor: '#1e1640',
      scale: 2,
      useCORS: true,
      logging: false,
    });
    const url = canvas.toDataURL('image/png');
    const a   = document.createElement('a');
    a.href = url;
    a.download = `may_${Date.now()}.png`;
    a.click();
    mostrarToast('Imagem exportada!', 'sucesso');
  } catch (err) {
    console.error('Erro ao exportar imagem:', err);
    mostrarToast('Erro ao gerar imagem', 'erro');
  }
}

// ─── Upload de arquivo ───────────────────────────────────────────────────────
async function uploadArquivo() {
  const input = document.createElement('input');
  input.type  = 'file';
  // Aceita documentos, imagens e áudio
  input.accept = '.pdf,.docx,.doc,.txt,image/jpeg,image/png,image/webp,audio/webm,audio/mp4,audio/mpeg,audio/wav,audio/ogg,audio/x-m4a';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;

    const tipo = file.type;

    // ── Imagem ────────────────────────────────────────────────────────────
    if (tipo.startsWith('image/')) {
      mostrarToast('Analisando imagem...', 'aviso');
      const form = new FormData();
      form.append('imagem', file);
      form.append('instrucao', 'Descreva detalhadamente o conteúdo desta imagem. Se houver texto, transcreva-o.');

      const res = await api.upload('/upload/imagem-chat', form);
      if (!res?.ok) { mostrarToast('Erro ao processar imagem', 'erro'); return; }

      const data = await res.json();

      // Mostra miniatura no histórico
      const container = document.getElementById('messages-container');
      const inicial = (estado.user?.name || 'V').charAt(0).toUpperCase();
      const imgId = 'msg-img-' + Date.now();
      container.insertAdjacentHTML('beforeend', `
        <div class="message user" id="${imgId}">
          <div class="msg-avatar user-av">${inicial}</div>
          <div class="msg-content">
            <div class="msg-name">Você</div>
            <div class="msg-bubble">
              <img src="${data.dataUrl}" alt="${file.name}" style="max-width:220px;border-radius:8px;display:block;margin-bottom:6px" />
              <span style="font-size:11px;opacity:.6">${file.name}</span>
            </div>
          </div>
        </div>
      `);
      container.scrollTop = container.scrollHeight;

      // Injeta análise no input
      const msgInput = document.getElementById('message-input');
      msgInput.value = `[Imagem enviada: ${file.name}]\n\nAnálise da imagem:\n${data.analise}\n\nCom base nesta imagem, `;
      msgInput.dispatchEvent(new Event('input'));
      mostrarToast('Imagem analisada!', 'sucesso');
      return;
    }

    // ── Áudio ─────────────────────────────────────────────────────────────
    if (tipo.startsWith('audio/')) {
      if (estado.user?.plano === 'free') {
        mostrarToast('Transcrição de áudio disponível nos planos pagos.', 'aviso');
        return;
      }
      mostrarToast('Transcrevendo áudio...', 'aviso');
      const form = new FormData();
      form.append('audio', file, file.name);

      const res = await api.upload('/upload/audio', form);
      if (!res?.ok) { mostrarToast('Erro ao transcrever áudio', 'erro'); return; }

      const data = await res.json();
      const msgInput = document.getElementById('message-input');
      msgInput.value = `[Áudio transcrito: ${file.name}]\n\n${data.transcricao}`;
      msgInput.dispatchEvent(new Event('input'));
      mostrarToast('Áudio transcrito!', 'sucesso');
      return;
    }

    // ── Documento (PDF, DOCX, TXT) ────────────────────────────────────────
    mostrarToast('Processando arquivo...', 'aviso');
    const form = new FormData();
    form.append('arquivo', file);

    const res = await api.upload('/upload/documento', form);
    if (!res?.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 403 && err.code === 'LIMITE_UPLOADS') {
        mostrarToast(`Limite de ${err.limite} documentos/mês atingido. Faça upgrade para continuar.`, 'erro');
        abrirPaymentWall(false);
      } else {
        mostrarToast(err.erro || 'Erro ao processar arquivo', 'erro');
      }
      return;
    }

    const data = await res.json();

    // Verifica limite de anexos por mensagem do plano
    const limiteMsg = limiteAnexosMensagem();
    if (estado.documentosAnexados.length >= limiteMsg) {
      mostrarToast(`Seu plano permite até ${limiteMsg} arquivo(s) por mensagem.`, 'aviso');
      return;
    }

    // Adiciona ao array de anexos
    estado.documentosAnexados.push({ upload_id: data.upload_id, filename: file.name });
    renderAnexosBadges();
    mostrarToast(`"${file.name}" anexado!`, 'sucesso');

    // Foca no input para o usuário digitar a pergunta
    const msgInput = document.getElementById('message-input');
    if (msgInput.value.trim() === '') {
      msgInput.placeholder = 'Pergunte algo sobre o(s) documento(s)...';
    }
    msgInput.focus();
  };
  input.click();
}

// ─── Badges de anexos de documentos ──────────────────────────────────────────
function renderAnexosBadges() {
  document.getElementById('anexos-wrap')?.remove();
  if (!estado.documentosAnexados.length) return;

  const inputEl  = document.getElementById('message-input');
  const parentEl = inputEl?.parentElement;
  if (!parentEl) return;

  const wrap = document.createElement('div');
  wrap.id = 'anexos-wrap';
  wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-bottom:6px;';

  estado.documentosAnexados.forEach((doc, idx) => {
    const badge = document.createElement('div');
    badge.style.cssText = 'display:flex;align-items:center;gap:6px;background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.35);border-radius:8px;padding:5px 10px;font-size:0.8rem;color:#C4B5FD;';
    badge.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      <span style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(doc.filename)}</span>
      <button onclick="removerAnexo(${idx})" style="background:transparent;border:none;color:rgba(196,181,253,.5);cursor:pointer;padding:0 2px;font-size:14px;line-height:1;" title="Remover">✕</button>
    `;
    wrap.appendChild(badge);
  });

  parentEl.insertAdjacentElement('beforebegin', wrap);
}

function removerAnexoBadge() {
  document.getElementById('anexos-wrap')?.remove();
}

function removerAnexo(idx) {
  if (idx === undefined) {
    estado.documentosAnexados = [];
  } else {
    estado.documentosAnexados.splice(idx, 1);
  }
  renderAnexosBadges();
  if (!estado.documentosAnexados.length) {
    const msgInput = document.getElementById('message-input');
    if (msgInput) msgInput.placeholder = 'Pergunte algo para a May...';
  }
}

// ─── Gravação de áudio ───────────────────────────────────────────────────────
let mediaRecorder = null;
let audioChunks   = [];
let gravando      = false;

async function toggleGravacao() {
  if (estado.user?.plano === 'free') {
    mostrarToast('Gravação de áudio disponível nos planos pagos.', 'aviso');
    return;
  }

  const btn = document.getElementById('btn-audio');
  if (!gravando) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks   = [];

      mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
      mediaRecorder.onstop = async () => {
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        const form = new FormData();
        form.append('audio', blob, 'gravacao.webm');

        mostrarToast('Transcrevendo...', 'aviso');
        const res = await api.upload('/upload/audio', form);
        if (!res?.ok) { mostrarToast('Erro ao transcrever áudio', 'erro'); return; }

        const data = await res.json();
        const msgInput = document.getElementById('message-input');
        msgInput.value = data.transcricao;
        msgInput.dispatchEvent(new Event('input'));
        mostrarToast('Áudio transcrito!', 'sucesso');

        stream.getTracks().forEach(t => t.stop());
      };

      mediaRecorder.start();
      gravando = true;
      btn.style.color = 'var(--error)';
      btn.title = 'Parar gravação';
      mostrarToast('Gravando... clique para parar.', 'aviso');
    } catch {
      mostrarToast('Não foi possível acessar o microfone.', 'erro');
    }
  } else {
    mediaRecorder.stop();
    gravando = false;
    btn.style.color = '';
    btn.title = 'Gravar áudio';
  }
}

// ─── Modal de diagnóstico — Maturidade Comercial ─────────────────────────────
const NIVEIS_MATURIDADE = [
  { titulo: 'Sem Experiência',    desc: 'Você está no ponto de partida. A May vai te guiar do zero com scripts prontos e treinos práticos.' },
  { titulo: 'Aprendiz',           desc: 'Você está começando a entender o processo. Vamos solidificar a base e criar consistência.' },
  { titulo: 'Desenvolvendo',      desc: 'Você já tem resultados, mas ainda é irregular. O foco agora é processo e repetição.' },
  { titulo: 'Praticante',         desc: 'Você fecha contratos com consistência. Hora de aumentar ticket e velocidade de fechamento.' },
  { titulo: 'Experiente',         desc: 'Você tem um processo que funciona. Agora é escalar e estruturar equipe.' },
  { titulo: 'Referência',         desc: 'Você é referência comercial. A May vai te ajudar a replicar e liderar seu time.' },
];

function abrirModalDiagnostico() {
  // Limpa seleções e reseta
  document.querySelectorAll('.diag-opt').forEach(b => b.classList.remove('selected'));
  document.getElementById('diag-fat').innerHTML = '';
  document.getElementById('diag-resultado').style.display = 'none';
  diagIrPara(1);
  document.getElementById('modal-diagnostico').classList.add('active');
}

function fecharDiagnostico() {
  document.getElementById('modal-diagnostico').classList.remove('active');
}

const TOTAL_PASSOS_DIAG = 6;

function diagIrPara(passo) {
  for (let i = 1; i <= TOTAL_PASSOS_DIAG; i++) {
    const el = document.getElementById(`diag-step-${i}`);
    if (el) el.style.display = i === passo ? 'block' : 'none';
  }
  document.getElementById('diag-passo-label').textContent = `Passo ${passo} de ${TOTAL_PASSOS_DIAG}`;
  document.getElementById('diag-progress').style.width    = `${Math.round(passo / TOTAL_PASSOS_DIAG * 100)}%`;

  // Passo 4 = faturamento → preenche opções dinamicamente com base no modelo (passo 2)
  if (passo === 4) mostrarOpcoesFaturamento();
}

function diagProximo(passo) {
  // Chave = destino; valida o passo ANTERIOR (origem)
  const validacoes = {
    2: () => !!document.querySelector('#diag-exp .selected'),
    3: () => !!document.querySelector('#diag-modelo .selected'),
    4: () => !!document.querySelector('#diag-contr .selected'),
    5: () => !!document.querySelector('#diag-fat .selected'),
    6: () => document.querySelectorAll('#diag-dific .selected').length > 0,
  };
  if (validacoes[passo] && !validacoes[passo]()) {
    mostrarToast('Selecione uma opção para continuar.', 'aviso');
    return;
  }
  diagIrPara(passo);
}

function mostrarOpcoesFaturamento() {
  const modelo = document.querySelector('#diag-modelo .selected')?.dataset.val;
  const container = document.getElementById('diag-fat');
  if (!container) return;

  // Mantém seleção atual se já havia
  const selecionado = container.querySelector('.selected')?.dataset.val;

  let opcoes;
  if (modelo === 'exito') {
    opcoes = [
      { val: 'fat_10k',      label: 'Até R$ 10 mil' },
      { val: 'fat_11_20k',   label: 'R$ 11 mil a R$ 20 mil' },
      { val: 'fat_21_35k',   label: 'R$ 21 mil a R$ 35 mil' },
      { val: 'fat_36_55k',   label: 'R$ 36 mil a R$ 55 mil' },
      { val: 'fat_60k_mais', label: 'Acima de R$ 60 mil' },
    ];
  } else {
    opcoes = [
      { val: 'fat_10k',      label: 'Até R$ 10 mil' },
      { val: 'fat_10_20k',   label: 'R$ 10.001 a R$ 20 mil' },
      { val: 'fat_20_35k',   label: 'R$ 20.001 a R$ 35 mil' },
      { val: 'fat_35_50k',   label: 'R$ 35.001 a R$ 50 mil' },
      { val: 'fat_60k_mais', label: 'Acima de R$ 60 mil' },
    ];
  }

  container.innerHTML = opcoes.map(o =>
    `<button class="diag-opt${o.val === selecionado ? ' selected' : ''}" data-val="${o.val}" onclick="selecionarOpcao('diag-fat',this)">${o.label}</button>`
  ).join('');
}

function diagAnterior(passo) { diagIrPara(passo); }

function selecionarOpcao(grupoId, btn) {
  document.querySelectorAll(`#${grupoId} .diag-opt`).forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
}

function toggleMulti(btn) {
  const selecionados = document.querySelectorAll('#diag-dific .selected');
  if (!btn.classList.contains('selected') && selecionados.length >= 3) {
    mostrarToast('Escolha no máximo 3 dificuldades.', 'aviso');
    return;
  }
  btn.classList.toggle('selected');
}

// Mapeamento de dificuldades → insight empático + ferramentas May
const DIFICULDADES_INFO = {
  abordagem:    { insight: 'Saber como iniciar a conversa com um novo cliente é o que separa quem fecha de quem só prospecta. Cada palavra do primeiro contato conta.', ferramentas: ['Chat livre com a May', 'Simulador de Objeções'] },
  proposta:     { insight: 'Uma proposta fraca é descartada em segundos. A forma como você apresenta o valor define se o cliente compra por preço ou por confiança.', ferramentas: ['Gerador de Proposta', 'Simulador de Negociação'] },
  objecoes:     { insight: '"Tá caro", "vou pensar", "não é o momento" — essas frases são oportunidades disfarçadas. Quem treina a resposta certa fecha onde outros desistem.', ferramentas: ['Simulador de Objeções', 'Método SPIN'] },
  negociacao:   { insight: 'Dar desconto é o caminho mais rápido para desvalorizar seu trabalho. Negociar bem é uma habilidade treinável, não um dom.', ferramentas: ['Simulador de Negociação', 'Gerador de Proposta'] },
  follow_up:    { insight: 'A maioria das vendas acontece no 5º ao 8º contato. Quem não faz follow-up estruturado está deixando dinheiro na mesa todo dia.', ferramentas: ['Gerador de Follow-up', 'Chat livre com a May'] },
  fechamento:   { insight: 'O momento do fechamento é o mais sensível da venda. Perder ali, depois de tudo construído, é frustrante — e evitável com treino.', ferramentas: ['Simulador de Vendas', 'Método SPIN'] },
  qualificacao: { insight: 'Atender quem nunca vai contratar custa tempo e energia. Identificar o cliente certo antes de investir na venda muda o jogo.', ferramentas: ['Chat livre com a May', 'Diagnóstico com a May'] },
  mentalidade:  { insight: 'Consistência vende mais do que talento. Criar uma rotina comercial e manter o ritmo nos dias difíceis é o que diferencia resultados médios dos excepcionais.', ferramentas: ['Metas semanais', 'Chat livre com a May'] },
};

async function salvarDiagnostico() {
  const exp         = document.querySelector('#diag-exp .selected')?.dataset.val;
  const modeloCobr  = document.querySelector('#diag-modelo .selected')?.dataset.val;
  const contr       = document.querySelector('#diag-contr .selected')?.dataset.val;
  const faturamento = document.querySelector('#diag-fat .selected')?.dataset.val;
  const dificEls    = document.querySelectorAll('#diag-dific .selected');
  const melhora     = document.querySelector('#diag-melhora .selected')?.dataset.val;

  if (!exp || !modeloCobr || !contr || !faturamento || !dificEls.length || !melhora) {
    mostrarToast('Complete todas as etapas antes de finalizar.', 'erro');
    return;
  }

  const dificuldades = Array.from(dificEls).map(b => b.dataset.val).join(',');

  const btn = document.getElementById('btn-finalizar-diag');
  btn.disabled = true;
  btn.textContent = 'Calculando...';

  const res = await api.put('/user/diagnostico', {
    tempo_experiencia:  exp,
    contratos_mes:      contr,
    dificuldades,
    quero_melhorar:     melhora,
    modelo_cobranca:    modeloCobr,
    faturamento_mensal: faturamento,
  });

  btn.disabled = false;
  btn.textContent = 'Calcular minha maturidade →';

  if (!res?.ok) { mostrarToast('Erro ao salvar diagnóstico', 'erro'); return; }

  const data = await res.json();
  estado.user = { ...estado.user, ...data.user, diagnostico_completo: true };
  salvarUser(estado.user);
  renderizarSidebar();

  // Mostra resultado
  const nivel     = data.maturidade ?? 0;
  const nivelInfo = NIVEIS_MATURIDADE[nivel];

  for (let i = 1; i <= TOTAL_PASSOS_DIAG; i++) {
    const el = document.getElementById(`diag-step-${i}`);
    if (el) el.style.display = 'none';
  }
  document.getElementById('diag-progress').style.width     = '100%';
  document.getElementById('diag-passo-label').textContent  = 'Diagnóstico concluído';
  document.getElementById('diag-nivel-badge').textContent  = nivel;
  document.getElementById('diag-nivel-titulo').textContent = nivelInfo.titulo;
  document.getElementById('diag-nivel-desc').textContent   = nivelInfo.desc;
  document.getElementById('diag-trilha').textContent       = data.trilha_ativa;
  document.getElementById('diag-meta').textContent         = data.meta_semanal;

  // Insight empático baseado na principal dificuldade
  const dificArr       = (data.dificuldades || []);
  const principalDific = DIFICULDADES_INFO[dificArr[0]];
  if (principalDific) {
    document.getElementById('diag-insight').textContent = principalDific.insight;
    document.getElementById('diag-ferramentas').innerHTML =
      '<strong style="font-size:0.72rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted)">Comece por aqui:</strong><br>' +
      principalDific.ferramentas.map(f => `• ${f}`).join('<br>');
  } else {
    document.getElementById('diag-insight').textContent =
      'A May tem tudo o que você precisa para criar um processo comercial que funciona. Vamos juntas.';
    document.getElementById('diag-ferramentas').innerHTML =
      '<strong style="font-size:0.72rem;text-transform:uppercase;letter-spacing:.06em;color:var(--text-muted)">Comece por aqui:</strong><br>• Chat livre com a May<br>• Simulador de Objeções';
  }

  document.getElementById('diag-resultado').style.display = 'block';

  // Restaura o X para que o usuário possa fechar após ver o resultado
  const btnClose = document.querySelector('#modal-diagnostico .modal-close');
  if (btnClose) btnClose.style.display = '';
}

// ─── Modal de perfil ─────────────────────────────────────────────────────────
function abrirModalPerfil() {
  const user = estado.user;
  document.getElementById('perfil-nome').value = user?.name || '';

  // Avatar no modal
  const inicial = document.getElementById('perfil-avatar-inicial');
  const img     = document.getElementById('perfil-avatar-img');
  if (user?.avatar_url) {
    img.src = user.avatar_url;
    img.style.display = 'block';
    inicial.style.display = 'none';
  } else {
    img.style.display = 'none';
    inicial.style.display = '';
    inicial.textContent = (user?.name || 'U').charAt(0).toUpperCase();
  }

  // Logo e cor do escritório
  const logoImg         = document.getElementById('logo-escritorio-img');
  const logoPlaceholder = document.getElementById('logo-escritorio-placeholder');
  const corInput        = document.getElementById('perfil-cor-escritorio');
  if (user?.logo_escritorio && logoImg) {
    logoImg.src = user.logo_escritorio;
    logoImg.style.display = 'block';
    if (logoPlaceholder) logoPlaceholder.style.display = 'none';
  } else {
    if (logoImg) logoImg.style.display = 'none';
    if (logoPlaceholder) logoPlaceholder.style.display = '';
  }
  if (corInput) corInput.value = user?.cor_escritorio || '#7C3AED';

  // Atualiza status 2FA
  atualizar2FAStatus();

  document.getElementById('modal-perfil').classList.add('active');
}

// ── 2FA ──────────────────────────────────────────────────────────────────────
function atualizar2FAStatus() {
  const user = estado.user;
  const ativo = user?.totp_enabled;
  document.getElementById('2fa-status-texto').textContent = ativo ? '✓ Ativado' : 'Desativado';
  document.getElementById('2fa-status-texto').style.color = ativo ? '#6EE7B7' : 'var(--text-muted)';
  document.getElementById('btn-toggle-2fa').textContent = ativo ? 'Desativar' : 'Ativar';
  document.getElementById('2fa-setup-area').style.display = 'none';
  document.getElementById('2fa-desativar-area').style.display = 'none';
}

async function toggle2FA() {
  const ativo = estado.user?.totp_enabled;
  if (ativo) {
    document.getElementById('2fa-desativar-area').style.display = 'block';
    document.getElementById('2fa-setup-area').style.display = 'none';
    document.getElementById('2fa-codigo-desativar').value = '';
    document.getElementById('2fa-codigo-desativar').focus();
  } else {
    // Inicia setup — busca QR code
    const res  = await apiFetch('/api/2fa/setup', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) { mostrarToast(data.erro || 'Erro ao iniciar 2FA', 'error'); return; }
    document.getElementById('2fa-qr-img').src = data.qrDataUrl;
    document.getElementById('2fa-setup-area').style.display = 'block';
    document.getElementById('2fa-desativar-area').style.display = 'none';
    document.getElementById('2fa-codigo-ativar').value = '';
    document.getElementById('2fa-codigo-ativar').focus();
  }
}

async function confirmar2FAAtivacao() {
  const codigo = document.getElementById('2fa-codigo-ativar').value.trim();
  if (codigo.length !== 6) { mostrarToast('Informe os 6 dígitos', 'error'); return; }
  const res  = await apiFetch('/api/2fa/ativar', { method: 'POST', body: JSON.stringify({ codigo }) });
  const data = await res.json();
  if (!res.ok) { mostrarToast(data.erro || 'Código inválido', 'error'); return; }
  estado.user.totp_enabled = true;
  localStorage.setItem('may_user', JSON.stringify(estado.user));
  atualizar2FAStatus();
  mostrarToast('2FA ativado!', 'success');
}

async function confirmar2FADesativacao() {
  const codigo = document.getElementById('2fa-codigo-desativar').value.trim();
  if (codigo.length !== 6) { mostrarToast('Informe os 6 dígitos', 'error'); return; }
  const res  = await apiFetch('/api/2fa/desativar', { method: 'POST', body: JSON.stringify({ codigo }) });
  const data = await res.json();
  if (!res.ok) { mostrarToast(data.erro || 'Código inválido', 'error'); return; }
  estado.user.totp_enabled = false;
  localStorage.setItem('may_user', JSON.stringify(estado.user));
  atualizar2FAStatus();
  mostrarToast('2FA desativado.', 'info');
}

async function uploadFotoPerfil(input) {
  const file = input.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('foto', file);

  mostrarToast('Enviando foto...', 'info');

  try {
    const token = getAccessToken();
    const res = await fetch('/api/upload/avatar', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData,
    });
    if (!res.ok) throw new Error();
    const data = await res.json();

    // Atualiza estado e UI imediatamente
    estado.user = { ...estado.user, avatar_url: data.avatar_url };
    salvarUser(estado.user);

    // Preview no modal
    const img     = document.getElementById('perfil-avatar-img');
    const inicial = document.getElementById('perfil-avatar-inicial');
    img.src = data.avatar_url;
    img.style.display = 'block';
    inicial.style.display = 'none';

    renderizarSidebar();
    mostrarToast('Foto atualizada!', 'sucesso');
  } catch {
    mostrarToast('Erro ao enviar foto.', 'erro');
  }
}

async function uploadLogoEscritorio(input) {
  const file = input.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('logo', file);

  mostrarToast('Enviando logo...', 'info');

  try {
    const token = getAccessToken();
    const res = await fetch('/api/upload/logo-escritorio', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData,
    });
    if (!res.ok) throw new Error();
    const data = await res.json();

    estado.user = { ...estado.user, logo_escritorio: data.logo_url };
    salvarUser(estado.user);

    // Preview no modal
    const logoImg         = document.getElementById('logo-escritorio-img');
    const logoPlaceholder = document.getElementById('logo-escritorio-placeholder');
    if (logoImg) { logoImg.src = data.logo_url; logoImg.style.display = 'block'; }
    if (logoPlaceholder) logoPlaceholder.style.display = 'none';

    mostrarToast('Logo atualizado!', 'sucesso');
  } catch {
    mostrarToast('Erro ao enviar logo.', 'erro');
  }
}

async function salvarPerfil() {
  const name          = document.getElementById('perfil-nome').value.trim();
  const cor_escritorio = document.getElementById('perfil-cor-escritorio')?.value || '#7C3AED';
  if (!name) { mostrarToast('Nome obrigatório.', 'erro'); return; }

  const res = await api.put('/user/perfil', { name, cor_escritorio });
  if (!res?.ok) { mostrarToast('Erro ao salvar perfil', 'erro'); return; }

  const data = await res.json();
  estado.user = { ...estado.user, ...data.user };
  salvarUser(estado.user);

  document.getElementById('modal-perfil').classList.remove('active');
  mostrarToast('Perfil atualizado!', 'sucesso');
  renderizarSidebar();
}

// ─── Planos / Checkout Cielo ─────────────────────────────────────────────────
let _planoSelecionado = 'start_trimestral';

const PLANO_LABELS = {
  start_mensal:  'Plano Mensal',
  start_anual:   'Plano Anual',
  solo_mensal:   'Plano Mensal',
  solo_anual:    'Plano Anual',
  equipe_mensal: 'Plano Mensal',
  equipe_anual:  'Plano Anual',
  mensal:        'Plano Mensal',
  anual:         'Plano Anual',
};

function iniciarCheckout(plano) {
  _planoSelecionado = plano;
  const label = PLANO_LABELS[plano] || plano;
  document.getElementById('cartao-titulo').textContent = `Assinar — ${label}`;
  document.getElementById('cartao-erro').style.display = 'none';

  // Quem já usou o período grátis é cobrado na hora (o backend manda AuthorizeNow:true).
  // O aviso precisa dizer a verdade — prometer "sem cobrança agora" para quem vai
  // pagar imediatamente é o tipo de surpresa que gera chargeback.
  const jaUsouTrial = !!estado.user?.periodo_gratis_inicio;
  const preco       = (plano || '').endsWith('anual') ? PW_PRECOS.anual.preco : PW_PRECOS.mensal.preco;

  const trialAviso    = document.getElementById('cartao-trial-aviso');
  const cobrancaAviso = document.getElementById('cartao-cobranca-aviso');
  const btnPagar      = document.getElementById('btn-pagar');

  if (trialAviso)    trialAviso.style.display    = jaUsouTrial ? 'none' : 'flex';
  if (cobrancaAviso) cobrancaAviso.style.display = jaUsouTrial ? 'flex' : 'none';

  const valorEl = document.getElementById('cartao-cobranca-valor');
  if (valorEl) valorEl.textContent = preco;

  if (btnPagar) {
    btnPagar.textContent = jaUsouTrial
      ? `Assinar agora — ${preco}`
      : 'Começar 7 dias por nossa conta';
  }

  document.getElementById('modal-planos').classList.remove('active');
  document.getElementById('modal-cartao').classList.add('active');
}

async function submeterCartao(e) {
  e.preventDefault();
  const btn  = document.getElementById('btn-pagar');
  const erro = document.getElementById('cartao-erro');
  erro.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Processando...';

  try {
    const res = await api.post('/cielo/checkout', {
      plano: _planoSelecionado,
      cpf:   document.getElementById('cartao-cpf').value,
      cartao: {
        numero:   document.getElementById('cartao-numero').value.replace(/\D/g, ''),
        titular:  document.getElementById('cartao-titular').value,
        validade: document.getElementById('cartao-validade').value, // MM/AAAA
        cvv:      document.getElementById('cartao-cvv').value,
      },
    });

    const data = await res.json();

    if (!res.ok) {
      // Mostra a mensagem e o código que a Cielo devolveu. Sem o código não dá
      // para distinguir recusa do emissor de problema de configuração da conta.
      const base   = data.erro || 'Pagamento recusado. Verifique os dados e tente novamente.';
      const codigo = data.codigo ? ` (código Cielo ${data.codigo})` : '';
      // _debug é temporário, só enquanto investigamos a recusa sem código
      const dbg = data._debug
        ? `\n\nHTTP ${data._debug.httpStatus} · ${data._debug.body}`
        : '';
      erro.textContent = base + codigo + dbg;
      erro.style.whiteSpace = 'pre-wrap';
      erro.style.display = 'block';
      console.error('Checkout recusado:', data);
      return;
    }

    // Sucesso — fecha modal, atualiza estado, exibe confirmação
    document.getElementById('modal-cartao').classList.remove('active');
    estado.user.plano = _planoSelecionado;
    estado.user.plano_status = data.periodo_gratis ? 'periodo_gratis' : 'ativo';
    renderizarSidebar();

    const label = PLANO_LABELS[_planoSelecionado] || _planoSelecionado;
    if (data.periodo_gratis) {
      const dataCobranca = new Date(data.inicio_cobranca).toLocaleDateString('pt-BR');
      mostrarToast(`🎉 7 dias por nossa conta ativados — ${label}. Cobrança inicia em ${dataCobranca}.`, 'sucesso');
    } else {
      mostrarToast(`🎉 Plano ${label} ativado com sucesso!`, 'sucesso');
    }

  } catch {
    erro.textContent = 'Erro de conexão. Tente novamente.';
    erro.style.display = 'block';
  } finally {
    btn.disabled = false;
    // Restaura o texto certo — pode ser cobrança imediata, não necessariamente trial
    const jaUsou = !!estado.user?.periodo_gratis_inicio;
    const p      = (_planoSelecionado || '').endsWith('anual') ? PW_PRECOS.anual.preco : PW_PRECOS.mensal.preco;
    btn.textContent = jaUsou ? `Assinar agora — ${p}` : 'Começar 7 dias por nossa conta';
  }
}

async function cancelarAssinatura() {
  if (!confirm('Tem certeza que deseja cancelar sua assinatura? Você perderá o acesso ao plano.')) return;
  const res = await api.post('/cielo/cancelar', {});
  if (!res?.ok) { mostrarToast('Erro ao cancelar assinatura', 'erro'); return; }
  estado.user.plano = 'free';
  estado.user.plano_status = 'cancelado';
  renderizarSidebar();
  mostrarToast('Assinatura cancelada.', 'aviso');
}

// Helpers para formatação do formulário de cartão
function formatarNumeroCartao(input) {
  let v = input.value.replace(/\D/g, '').slice(0, 16);
  input.value = v.replace(/(.{4})/g, '$1 ').trim();
  const { detectarBandeira } = window;
  // Detecta bandeira client-side
  const n = v;
  let marca = '';
  if (/^4/.test(n))                          marca = '💳 Visa';
  else if (/^5[1-5]/.test(n))               marca = '💳 Mastercard';
  else if (/^3[47]/.test(n))                marca = '💳 Amex';
  else if (/^(?:506699|5067|4576)/.test(n)) marca = '💳 Elo';
  else if (n.length >= 4)                   marca = '💳 Cartão';
  document.getElementById('cartao-bandeira').textContent = marca;
}

function formatarValidade(input) {
  let v = input.value.replace(/\D/g, '').slice(0, 6);
  if (v.length >= 3) v = v.slice(0, 2) + '/' + v.slice(2);
  input.value = v;
}

function formatarCPF(input) {
  let v = input.value.replace(/\D/g, '').slice(0, 11);
  v = v.replace(/(\d{3})(\d)/, '$1.$2');
  v = v.replace(/(\d{3})(\d)/, '$1.$2');
  v = v.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  input.value = v;
}

// ─── Logout ───────────────────────────────────────────────────────────────────
async function logout() {
  if (!confirm('Sair da plataforma?')) return;
  try {
    await api.post('/auth/logout', { refreshToken: localStorage.getItem('may_refresh') });
  } catch { /* segue mesmo se falhar */ }
  limparTokens();
  window.location.href = '/auth.html';
}

// ─── Tema claro / escuro ─────────────────────────────────────────────────────
function toggleTema() {
  const html    = document.documentElement;
  const isLight = html.getAttribute('data-theme') === 'light';
  const novoTema = isLight ? 'dark' : 'light';
  html.setAttribute('data-theme', novoTema);
  localStorage.setItem('may-tema', novoTema);

  const icon  = document.getElementById('theme-icon');
  const label = document.getElementById('theme-label');
  if (novoTema === 'light') {
    if (icon)  icon.textContent  = '☀️';
    if (label) label.textContent = 'Claro';
  } else {
    if (icon)  icon.textContent  = '🌙';
    if (label) label.textContent = 'Escuro';
  }
}

function aplicarTemaInicial() {
  const salvo = localStorage.getItem('may-tema');
  // Se nunca escolheu manualmente, respeita o tema do sistema operacional
  const temaDoSistema = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  const tema = salvo || temaDoSistema;
  document.documentElement.setAttribute('data-theme', tema);
  const icon  = document.getElementById('theme-icon');
  const label = document.getElementById('theme-label');
  if (tema === 'light') {
    if (icon)  icon.textContent  = '☀️';
    if (label) label.textContent = 'Claro';
  } else {
    if (icon)  icon.textContent  = '🌙';
    if (label) label.textContent = 'Escuro';
  }
}

// ─── Mobile sidebar ──────────────────────────────────────────────────────────
function toggleMenuMobile() {
  const sidebar  = document.getElementById('sidebar');
  const overlay  = document.getElementById('sidebar-overlay');
  const isOpen   = sidebar.classList.toggle('open');
  overlay?.classList.toggle('visible', isOpen);
}
function fecharMenuMobile() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay')?.classList.remove('visible');
}

// ─── Nova conversa ───────────────────────────────────────────────────────────
function novaConversa() {
  estado.conversaAtiva = null;
  // No chat livre, "nova conversa" volta para a tela de início
  if (!estado.ferramentaAtiva || estado.ferramentaAtiva === 'chat') {
    estado.ferramentaAtiva = 'chat';
    document.getElementById('chat-title').textContent = 'Chat livre';
    document.getElementById('chat-tool-label').textContent = 'May — Assistente de vendas';
    mostrarHomeDashboard();
    renderizarSidebar();
    fecharMenuMobile();
    return;
  }
  selecionarFerramenta(estado.ferramentaAtiva);
}

// ─── Arquivos da Área ────────────────────────────────────────────────────────
async function abrirArquivosArea(areaId, areaNome) {
  // Cria modal se não existir
  let modal = document.getElementById('modal-arquivos-area');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-arquivos-area';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);z-index:1000;display:flex;align-items:center;justify-content:center;';
    modal.innerHTML = `
      <div style="background:#0F0C24;border:1px solid rgba(124,58,237,.3);border-radius:16px;padding:28px;width:min(600px,94vw);max-height:80vh;display:flex;flex-direction:column;gap:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <h3 id="arquivos-titulo" style="font-family:Syne,sans-serif;font-size:1.1rem;color:#E8E4FF;margin:0;">📂 Arquivos</h3>
          <button onclick="document.getElementById('modal-arquivos-area').remove()" style="background:transparent;border:none;color:rgba(200,190,255,.4);font-size:20px;cursor:pointer;padding:4px;">✕</button>
        </div>
        <div id="arquivos-lista" style="overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:10px;"></div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  }

  document.getElementById('arquivos-titulo').textContent = `📂 ${areaNome}`;
  document.getElementById('arquivos-lista').innerHTML = '<div style="color:rgba(200,190,255,.4);text-align:center;padding:24px;">Carregando...</div>';

  const res = await api.get(`/export/templates?area_id=${areaId}`);
  const lista = document.getElementById('arquivos-lista');

  if (!res?.ok) { lista.innerHTML = '<div style="color:#F87171;text-align:center;padding:24px;">Erro ao carregar arquivos.</div>'; return; }

  const { templates } = await res.json();

  if (!templates.length) {
    lista.innerHTML = `<div style="text-align:center;padding:32px;">
      <div style="font-size:2rem;margin-bottom:10px;">📄</div>
      <p style="color:rgba(200,190,255,.4);font-size:0.88rem;">Nenhum arquivo salvo nesta área ainda.<br>Use o botão <strong style="color:#A78BFA">Salvar</strong> em qualquer resposta da May.</p>
    </div>`;
    return;
  }

  lista.innerHTML = templates.map(t => `
    <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:14px 16px;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:0.88rem;font-weight:600;color:#E8E4FF;margin-bottom:4px;">${escapeHtml(t.titulo)}</div>
          <div style="font-size:0.75rem;color:rgba(200,190,255,.4);">${new Date(t.created_at).toLocaleDateString('pt-BR')} · ${escapeHtml(t.tipo||'')}</div>
          <div style="margin-top:8px;font-size:0.82rem;color:rgba(200,190,255,.6);line-height:1.5;max-height:60px;overflow:hidden;text-overflow:ellipsis;">${escapeHtml((t.conteudo||'').slice(0,180))}${t.conteudo?.length>180?'…':''}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;flex-shrink:0;">
          <button onclick="copiarArquivo('${t.id}',${JSON.stringify(t.conteudo).replace(/'/g,"\\'")})" style="background:rgba(124,58,237,.15);border:1px solid rgba(124,58,237,.3);color:#C4B5FD;border-radius:7px;padding:5px 12px;font-size:0.75rem;cursor:pointer;">Copiar</button>
          <button onclick="excluirArquivo('${t.id}','${areaId}','${escapeHtml(areaNome)}')" style="background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.25);color:#FCA5A5;border-radius:7px;padding:5px 12px;font-size:0.75rem;cursor:pointer;">Excluir</button>
        </div>
      </div>
    </div>
  `).join('');
}

function copiarArquivo(id, conteudo) {
  navigator.clipboard.writeText(conteudo).then(() => mostrarToast('Copiado!', 'sucesso'));
}

async function excluirArquivo(templateId, areaId, areaNome) {
  if (!confirm('Excluir este arquivo?')) return;
  const res = await api.delete(`/export/template/${templateId}`);
  if (res?.ok) { mostrarToast('Arquivo excluído.', 'sucesso'); abrirArquivosArea(areaId, areaNome); }
  else mostrarToast('Erro ao excluir.', 'erro');
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function mostrarToast(msg, tipo = 'info') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${tipo}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// ─── PWA Install Banner ───────────────────────────────────────────────────────
let _pwaPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _pwaPrompt = e;
  // Mostra banner após 20 segundos se o usuário nunca dispensou
  if (!localStorage.getItem('may_pwa_dispensado')) {
    setTimeout(mostrarBannerPWA, 20 * 1000);
  }
});

window.addEventListener('appinstalled', () => {
  localStorage.setItem('may_pwa_instalado', '1');
  fecharBannerPWA();
  mostrarToast('May instalado no seu celular! 🎉', 'sucesso');
});

function mostrarBannerPWA() {
  const banner = document.getElementById('pwa-banner');
  if (!banner || !_pwaPrompt) return;
  banner.style.display = 'flex';
  setTimeout(() => banner.classList.add('visible'), 50);
}

function fecharBannerPWA() {
  const banner = document.getElementById('pwa-banner');
  if (!banner) return;
  banner.classList.remove('visible');
  setTimeout(() => { banner.style.display = 'none'; }, 400);
  localStorage.setItem('may_pwa_dispensado', Date.now());
}

async function instalarPWA() {
  if (!_pwaPrompt) {
    mostrarToast('Abra o menu do Chrome e toque em "Adicionar à tela inicial".', 'aviso');
    return;
  }
  fecharBannerPWA();
  _pwaPrompt.prompt();
  const { outcome } = await _pwaPrompt.userChoice;
  if (outcome === 'accepted') {
    mostrarToast('Instalando May…', 'sucesso');
    localStorage.setItem('may_pwa_instalado', '1');
  }
  _pwaPrompt = null;
}

// ─── Push Notifications ──────────────────────────────────────────────────────
async function inicializarPushNotificacoes() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  try {
    // Registra o Service Worker
    const reg = await navigator.serviceWorker.register('/sw.js');

    // Só pede permissão depois de 30s (não interrompe o onboarding)
    const jaAtivo = localStorage.getItem('may_push_ativo');
    if (jaAtivo) {
      // Já tem permissão — garante que a subscription está atualizada
      await garantirSubscription(reg);
      return;
    }

    // Aguarda 30 segundos e pergunta
    setTimeout(() => solicitarPermissaoPush(reg), 30 * 1000);
  } catch (err) {
    console.warn('SW não registrado:', err.message);
  }
}

async function solicitarPermissaoPush(reg) {
  const permissao = await Notification.requestPermission();
  if (permissao !== 'granted') return;
  await garantirSubscription(reg);
}

async function garantirSubscription(reg) {
  try {
    const res = await fetch('/api/notificacoes/vapid-public');
    const { publicKey } = await res.json();

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    await api.post('/notificacoes/subscribe', { subscription: sub.toJSON() });
    localStorage.setItem('may_push_ativo', '1');
  } catch (err) {
    console.warn('Erro ao registrar push:', err.message);
  }
}

async function testarNotificacao() {
  const res = await api.post('/notificacoes/testar', {});
  const data = await res?.json();
  if (data?.ok > 0) mostrarToast('Notificação enviada! Verifique seu dispositivo.', 'sucesso');
  else mostrarToast('Ative as notificações primeiro (clique no cadeado da URL).', 'aviso');
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

// ─── Home / Tela de início ───────────────────────────────────────────────────
// Blocos de primeiro contato da home. Cada bloco pode:
//   · tipo 'pergunta'   → manda a pergunta para o chat livre
//   · tipo 'ferramenta' → abre uma ferramenta da sidebar
//   · tipo 'link'       → navega para outra página
const HOME_BLOCOS = [
  {
    tag: 'Estratégia', icon: '⚡', tipo: 'pergunta',
    titulo: 'Como a May vai ajudar minha advocacia?',
    texto: 'Me explica, de forma prática, como a May pode ajudar a minha advocacia no dia a dia — o que ela faz, em que momentos eu devo usar e que resultado eu posso esperar.',
  },
  {
    tag: 'Primeiros passos', icon: '🚀', tipo: 'pergunta',
    titulo: 'Por onde eu começo?',
    texto: 'Sou novo aqui. Me diz por onde eu começo na plataforma: o que fazer primeiro, segundo e terceiro para tirar proveito da May já esta semana.',
  },
  {
    tag: 'Módulos', icon: '🧩', tipo: 'pergunta',
    titulo: 'O que são os módulos adicionais?',
    texto: 'O que são os módulos adicionais da plataforma, para que serve cada um e como eu decido qual ativar primeiro?',
  },
  {
    tag: 'Plataforma', icon: '💡', tipo: 'pergunta',
    titulo: 'Dúvidas sobre a plataforma',
    texto: 'Tenho dúvidas sobre a plataforma. Me explica o que cada ferramenta do menu faz e como eu uso cada uma no dia a dia.',
  },
  {
    tag: 'Treino', icon: '🎭', tipo: 'ferramenta', ferramenta: 'simular_reuniao',
    titulo: 'Simular uma reunião com cliente',
    texto: 'Treine antes de ir para o cliente de verdade — a May faz o papel do cliente.',
  },
];

function homeAbrirBloco(i) {
  const b = HOME_BLOCOS[i];
  if (!b) return;
  if (b.tipo === 'ferramenta')      selecionarFerramenta(b.ferramenta);
  else if (b.tipo === 'link')       window.location.href = b.href;
  else                              homePerguntar(b.texto);
}

// Manda uma pergunta da home direto para o chat livre
function homePerguntar(texto) {
  estado.ferramentaAtiva = 'chat';
  estado.conversaAtiva   = null;
  document.getElementById('chat-title').textContent = 'Chat livre';
  document.getElementById('chat-tool-label').textContent = 'May — Assistente de vendas';
  mostrarInputChat();
  document.getElementById('messages-container').innerHTML = '';
  renderizarSidebar();
  enviarMensagemRapida(texto);
}

function mostrarHomeDashboard() {
  const container = document.getElementById('messages-container');
  mostrarInputChat(); // na home o campo de mensagem fica visível

  const user     = estado.user;
  const hora     = new Date().getHours();
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
  const nome     = (user?.name || '').split(' ')[0];
  const ehGestor = ['gestor', 'admin'].includes(user?.role);
  const streak   = estado.streak?.dias_seguidos || 0;

  const gestorStrip = !ehGestor ? '' : `
    <div class="home-gestor">
      <div class="home-gestor-label">Painel do gestor</div>
      <div class="home-gestor-links">
        <button class="home-gestor-link primary" onclick="mostrarDashboardComercial()">📊 Dashboard comercial</button>
        <a class="home-gestor-link" href="/leads">📋 Leads</a>
        <a class="home-gestor-link" href="/agenda"         id="_atalho-agenda"  style="display:none">📅 Agenda</a>
        <a class="home-gestor-link" href="/ranking-vendas" id="_atalho-ranking" style="display:none">🏆 Ranking</a>
        <a class="home-gestor-link ghost" href="/gestor">⚙️ Painel completo</a>
      </div>
    </div>`;

  container.innerHTML = `
    <div class="home-hero">
      ${gestorStrip}

      <div class="home-avatar"><img src="/assets/may-gpt.png" alt="May" onerror="this.replaceWith(Object.assign(document.createElement('span'),{textContent:'M',className:'home-avatar-fallback'}))" /></div>

      <div class="home-greeting">
        <span class="home-greeting-dot"></span>
        ${saudacao}${nome ? `, ${escapeHtml(nome)}` : ''} · pronto pra começar
        ${streak > 1 ? `<span class="home-streak">🔥 ${streak} dias seguidos</span>` : ''}
      </div>

      <h1 class="home-title">May <span>IA</span></h1>
      <p class="home-sub">Sua advocacia, multiplicada por IA.</p>

      <div class="home-blocos">
        ${HOME_BLOCOS.map((b, i) => `
          <button class="home-bloco" onclick="homeAbrirBloco(${i})">
            <div class="home-bloco-tag"><span class="home-bloco-icon">${b.icon}</span>${escapeHtml(b.tag)}</div>
            <div class="home-bloco-titulo">${escapeHtml(b.titulo)}</div>
          </button>
        `).join('')}
      </div>

      <div class="home-chips">
        <button class="home-chip" onclick="abrirModalTrilha()">📚 Minha trilha</button>
        <button class="home-chip" onclick="selecionarFerramenta('simulador_objecoes')">🎯 Treinar objeções</button>
        <button class="home-chip" onclick="selecionarFerramenta('gerador_proposta')">📄 Criar proposta</button>
        <button class="home-chip" onclick="selecionarFerramenta('chat')">💬 Chat livre</button>
      </div>

      <div class="home-hint"><kbd>Enter</kbd> enviar · <kbd>Shift</kbd>+<kbd>Enter</kbd> nova linha</div>
    </div>
  `;

  if (ehGestor) _revelarAtalhosGestor();
}

// Agenda e Ranking só aparecem se o módulo estiver ativo
async function _revelarAtalhosGestor() {
  try {
    const rm = await api.get('/modulos');
    if (!rm?.ok) return;
    const { modulos } = await rm.json();
    const ativos = (modulos || []).filter(m => m.ativo).map(m => m.id);
    const el1 = document.getElementById('_atalho-agenda');
    const el2 = document.getElementById('_atalho-ranking');
    if (el1 && ativos.includes('calendario_cadencia')) el1.style.display = 'inline-flex';
    if (el2 && ativos.includes('ranking_vendas'))      el2.style.display = 'inline-flex';
  } catch (_) { /* silencioso */ }
}

// ─── Dashboard Comercial (para gestor/admin) ──────────────────────────────────
let _dashPeriodo = 'mes';
async function mostrarDashboardComercial() {
  const container = document.getElementById('messages-container');
  const hora = new Date().getHours();
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
  const nome = (estado.user?.name || '').split(' ')[0];

  container.innerHTML = `
    <div style="padding:24px 20px 60px;max-width:1000px;margin:0 auto">

      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:20px">
        <div>
          <h2 style="font-family:'Syne',sans-serif;font-size:22px;font-weight:800;color:#fff;margin:0">${saudacao}, ${escapeHtml(nome)}! 👋</h2>
          <p style="font-size:12px;color:rgba(200,190,255,.5);margin:3px 0 0">Dashboard comercial da equipe</p>
        </div>
        <div style="display:flex;gap:6px">
          <button onclick="setDashPeriodo('hoje',this)" class="_dp-tab" style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:6px 14px;font-size:12px;font-weight:600;color:rgba(200,190,255,.6);cursor:pointer">Hoje</button>
          <button onclick="setDashPeriodo('semana',this)" class="_dp-tab" style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:6px 14px;font-size:12px;font-weight:600;color:rgba(200,190,255,.6);cursor:pointer">Semana</button>
          <button onclick="setDashPeriodo('mes',this)" class="_dp-tab" style="background:rgba(124,58,237,.2);border:1px solid rgba(124,58,237,.4);border-radius:8px;padding:6px 14px;font-size:12px;font-weight:700;color:#C4B5FD;cursor:pointer">Mês</button>
        </div>
      </div>

      <!-- KPIs -->
      <div id="dash-kpis" style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">
        ${['CONTRATOS','FATURAMENTO','TICKET MÉDIO','REUNIÕES'].map(l=>`
          <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:18px 16px;text-align:center">
            <div style="font-family:'Syne',sans-serif;font-size:24px;font-weight:800;background:linear-gradient(135deg,#A78BFA,#60A5FA);-webkit-background-clip:text;-webkit-text-fill-color:transparent">—</div>
            <div style="font-size:10px;color:rgba(200,190,255,.4);text-transform:uppercase;letter-spacing:.08em;margin-top:4px">${l}</div>
          </div>`).join('')}
      </div>

      <!-- Vendedores + Leads fechados -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px">
        <div>
          <div style="font-size:11px;font-weight:700;color:rgba(200,190,255,.4);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">Vendedores</div>
          <div id="dash-vendedores" style="display:flex;flex-direction:column;gap:8px">
            <div style="color:rgba(200,190,255,.4);font-size:13px">Carregando...</div>
          </div>
        </div>
        <div>
          <div style="font-size:11px;font-weight:700;color:rgba(200,190,255,.4);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">Clientes fechados</div>
          <div id="dash-fechados" style="display:flex;flex-direction:column;gap:8px">
            <div style="color:rgba(200,190,255,.4);font-size:13px">Carregando...</div>
          </div>
        </div>
      </div>

      <!-- Atalhos rápidos -->
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">
        <a href="/leads" style="display:inline-flex;align-items:center;gap:6px;background:rgba(124,58,237,.12);border:1px solid rgba(124,58,237,.25);color:#C4B5FD;font-size:12px;font-weight:700;padding:8px 16px;border-radius:20px;text-decoration:none">📋 Leads</a>
        <a href="/agenda" id="_atalho-agenda" style="display:none;align-items:center;gap:6px;background:rgba(124,58,237,.12);border:1px solid rgba(124,58,237,.25);color:#C4B5FD;font-size:12px;font-weight:700;padding:8px 16px;border-radius:20px;text-decoration:none">📅 Agenda</a>
        <a href="/ranking-vendas" id="_atalho-ranking" style="display:none;align-items:center;gap:6px;background:rgba(124,58,237,.12);border:1px solid rgba(124,58,237,.25);color:#C4B5FD;font-size:12px;font-weight:700;padding:8px 16px;border-radius:20px;text-decoration:none">🏆 Ranking</a>
        <a href="/gestor" style="display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);color:rgba(200,190,255,.5);font-size:12px;font-weight:600;padding:8px 16px;border-radius:20px;text-decoration:none">⚙️ Painel completo</a>
      </div>

    </div>`;

  carregarDashComercial();
}

function setDashPeriodo(p, btn) {
  _dashPeriodo = p;
  document.querySelectorAll('._dp-tab').forEach(b => {
    b.style.background = 'rgba(255,255,255,.05)';
    b.style.borderColor = 'rgba(255,255,255,.1)';
    b.style.color = 'rgba(200,190,255,.6)';
    b.style.fontWeight = '600';
  });
  btn.style.background = 'rgba(124,58,237,.2)';
  btn.style.borderColor = 'rgba(124,58,237,.4)';
  btn.style.color = '#C4B5FD';
  btn.style.fontWeight = '700';
  carregarDashComercial();
}

async function carregarDashComercial() {
  try {
    const hoje = new Date();
    let inicio, fim = hoje.toISOString().slice(0,10);
    if (_dashPeriodo === 'hoje') {
      inicio = fim;
    } else if (_dashPeriodo === 'semana') {
      const d = new Date(hoje); d.setDate(d.getDate() - d.getDay()); inicio = d.toISOString().slice(0,10);
    } else {
      inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0,10);
    }

    const r = await api.get(`/gestor/dashboard?inicio=${inicio}&fim=${fim}`);
    if (!r.ok) return;
    const d = await r.json();

    const kpis = d.kpis || {};
    const vendedores = d.vendedores || [];
    const fechados = d.vendas_fechadas || [];

    // Verifica módulos para atalhos
    try {
      const rm = await api.get('/modulos');
      if (rm.ok) {
        const { modulos } = await rm.json();
        const ativos = modulos.filter(m => m.ativo).map(m => m.id);
        const el1 = document.getElementById('_atalho-agenda');
        const el2 = document.getElementById('_atalho-ranking');
        if (el1 && ativos.includes('calendario_cadencia')) el1.style.display = 'inline-flex';
        if (el2 && ativos.includes('ranking_vendas')) el2.style.display = 'inline-flex';
      }
    } catch(_) {}

    // KPIs
    const kpiEl = document.getElementById('dash-kpis');
    if (kpiEl) {
      const fmtBRL = v => 'R$ ' + Number(v||0).toLocaleString('pt-BR', {minimumFractionDigits:2,maximumFractionDigits:2});
      const kpiData = [
        { label: 'CONTRATOS',   valor: kpis.total_contratos ?? '—', cor: '#A78BFA' },
        { label: 'FATURAMENTO', valor: kpis.total_faturamento != null ? fmtBRL(kpis.total_faturamento) : '—', cor: '#34D399' },
        { label: 'TICKET MÉDIO',valor: kpis.ticket_medio != null ? fmtBRL(kpis.ticket_medio) : '—', cor: '#60A5FA' },
        { label: 'REUNIÕES',    valor: kpis.total_reunioes ?? '—', cor: '#F59E0B' },
      ];
      kpiEl.innerHTML = kpiData.map(k => `
        <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:18px 16px;text-align:center;transition:border-color .2s" onmouseover="this.style.borderColor='rgba(167,139,250,.25)'" onmouseout="this.style.borderColor='rgba(255,255,255,.08)'">
          <div style="font-family:'Syne',sans-serif;font-size:24px;font-weight:800;color:${k.cor}">${k.valor}</div>
          <div style="font-size:10px;color:rgba(200,190,255,.4);text-transform:uppercase;letter-spacing:.08em;margin-top:4px">${k.label}</div>
        </div>`).join('');
    }

    // Vendedores
    const vEl = document.getElementById('dash-vendedores');
    if (vEl) {
      if (!vendedores.length) {
        vEl.innerHTML = '<div style="color:rgba(200,190,255,.35);font-size:13px">Nenhum vendedor encontrado.</div>';
      } else {
        const STATUS_ICON = { ok:'🟢', destaque:'⭐', atencao:'🟡', queda:'🔴' };
        vEl.innerHTML = vendedores.map((v,i) => `
          <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:10px 14px;display:flex;align-items:center;gap:10px">
            <span style="font-family:'Syne',sans-serif;font-size:16px;font-weight:800;color:rgba(200,190,255,.3);min-width:22px">#${i+1}</span>
            <span style="font-size:13px;font-weight:600;color:#fff;flex:1">${escapeHtml(v.name)}</span>
            <span style="font-size:12px;font-weight:700;color:#34D399">R$${Number(v.faturamento||0).toLocaleString('pt-BR',{minimumFractionDigits:0})}</span>
            <span>${STATUS_ICON[v.status]||''}</span>
          </div>`).join('');
      }
    }

    // Fechados
    const fEl = document.getElementById('dash-fechados');
    if (fEl) {
      if (!fechados.length) {
        fEl.innerHTML = '<div style="color:rgba(200,190,255,.35);font-size:13px">Nenhum cliente registrado neste período.</div>';
      } else {
        const fmtBRL2 = v => 'R$ ' + Number(v||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
        fEl.innerHTML = fechados.slice(0,5).map(l => `
          <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:10px;padding:9px 14px;display:flex;align-items:center;gap:10px">
            <div style="flex:1">
              <div style="font-size:13px;font-weight:600;color:#fff">${escapeHtml(l.nome_lead||l.empresa_lead||'—')}</div>
              <div style="font-size:11px;color:rgba(200,190,255,.4)">${escapeHtml(l.closer?.name||'')}</div>
            </div>
            <div style="font-size:12px;font-weight:700;color:#34D399">${fmtBRL2(l.valor_honorarios)}</div>
          </div>`).join('');
      }
    }
  } catch(e) { console.error('dashComercial:', e); }
}

function mostrarInputChat() {
  const wrapper = document.getElementById('chat-input-wrapper');
  if (wrapper) wrapper.style.display = '';
}

function calcularNivel(diag) {
  const expMap  = { nunca:0, menos6:1, '6a12':2, '1a3':3, mais3:4 };
  const contrMap = { '0_10':0, '11_20':1, '21_35':2, '36_55':3, '60_mais':4 };
  const exp   = expMap[diag.experiencia] ?? 0;
  const contr = contrMap[diag.contr]     ?? 0;
  const score = Math.round((exp + contr) / 2);
  const nomes = ['Iniciante','Construtor','Praticante','Avançado','Expert'];
  const n   = Math.min(5, score + 1);
  const pct = Math.round(((exp + contr) / 8) * 100);
  return { n, nome: nomes[score] || 'Expert', pct: Math.min(95, pct) };
}

function metaDaSemana(diag) {
  const map = {
    abordagem:   'Melhorar a abordagem inicial com novos leads',
    proposta:    'Montar propostas que convencem pelo valor',
    objecoes:    'Responder objeções sem perder o cliente',
    negociacao:  'Negociar sem ceder desconto',
    follow_up:   'Fazer follow-up de forma natural',
    fechamento:  'Identificar o momento certo de fechar',
    qualificacao:'Qualificar bem antes de investir tempo',
    mentalidade: 'Criar consistência e motivação para vender',
  };
  const difs = diag.dificuldades || [];
  return map[difs[0]] || 'Dominar a venda consultiva jurídica';
}

function getTrilhaProgress() {
  // Usa cache local para leitura síncrona; sincroniza com banco em background
  try { return JSON.parse(localStorage.getItem('may_trilha') || '{}'); } catch { return {}; }
}
function setTrilhaProgress(p) {
  localStorage.setItem('may_trilha', JSON.stringify(p));
  // Persiste no banco de forma assíncrona (silenciosa)
  api.post('/trilha', { progresso: p }).catch(() => {});
}
async function carregarTrilhaDoServidor() {
  try {
    const res = await api.get('/trilha');
    if (!res || !res.ok) return;
    const data = await res.json();
    if (data.progresso && Object.keys(data.progresso).length > 0) {
      localStorage.setItem('may_trilha', JSON.stringify(data.progresso));
    }
  } catch { /* silencioso — usa localStorage como fallback */ }
}

function proximosExercicios() {
  const prog = getTrilhaProgress();
  const lista = [];
  for (const fase of FASES_TRILHA) {
    for (const ex of fase.exercicios) {
      const feito = !!(prog[fase.id]?.[ex.id]);
      const onclick = ex.tipo === 'simular_reuniao'
        ? `iniciarSimulacao('${ex.cenario}')`
        : `iniciarExercicioTrilha('${fase.id}','${ex.id}','${ex.tipo}',\`${ex.prompt?.replace(/`/g,"'")}\`)`;
      lista.push({ label: `${fase.nome}: ${ex.label}`, feito, onclick });
      if (lista.length >= 3) return lista;
    }
  }
  return lista;
}

function iniciarExercicioTrilha(faseId, exId, tipo, prompt) {
  const prog = getTrilhaProgress();
  if (!prog[faseId]) prog[faseId] = {};
  prog[faseId][exId] = true;
  setTrilhaProgress(prog);
  selecionarFerramenta(tipo);
  setTimeout(() => enviarMensagemRapida(prompt), 200);
}

// ─── Trilha Modal ────────────────────────────────────────────────────────────
function abrirModalTrilha() {
  const prog = getTrilhaProgress();
  let totalEx = 0, totalFeito = 0;
  FASES_TRILHA.forEach(f => f.exercicios.forEach(e => {
    totalEx++;
    if (prog[f.id]?.[e.id]) totalFeito++;
  }));
  document.getElementById('trilha-progresso-label').textContent =
    `${totalFeito} de ${totalEx} exercícios concluídos`;

  const html = FASES_TRILHA.map(fase => {
    const faseFeito = fase.exercicios.filter(e => prog[fase.id]?.[e.id]).length;
    const fasePct   = Math.round((faseFeito / fase.exercicios.length) * 100);
    const exHtml    = fase.exercicios.map(ex => {
      const feito = !!(prog[fase.id]?.[ex.id]);
      const onclick = ex.tipo === 'simular_reuniao'
        ? `document.getElementById('modal-trilha').classList.remove('active'); iniciarSimulacao('${ex.cenario}')`
        : `document.getElementById('modal-trilha').classList.remove('active'); iniciarExercicioTrilha('${fase.id}','${ex.id}','${ex.tipo}',\`${ex.prompt?.replace(/`/g,"'")}\`)`;
      return `
        <div class="trilha-ex">
          <div class="trilha-ex-check ${feito ? 'done' : ''}" onclick="marcarExercicio('${fase.id}','${ex.id}',this)">${feito ? '✓' : ''}</div>
          <span class="trilha-ex-label ${feito ? 'done' : ''}">${escapeHtml(ex.label)}</span>
          <button class="trilha-ex-btn" onclick="${onclick}">Iniciar →</button>
        </div>`;
    }).join('');
    return `
      <div class="trilha-fase">
        <div class="trilha-fase-header">
          <span class="trilha-fase-icon">${fase.icon}</span>
          <div class="trilha-fase-info">
            <div class="trilha-fase-nome">${fase.nome}</div>
            <div class="trilha-fase-desc">${fase.desc}</div>
          </div>
          <span class="trilha-fase-pct">${faseFeito}/${fase.exercicios.length}</span>
        </div>
        <div class="trilha-fase-body">${exHtml}</div>
      </div>`;
  }).join('');

  document.getElementById('trilha-conteudo').innerHTML = html;
  document.getElementById('modal-trilha').classList.add('active');
}

function marcarExercicio(faseId, exId, el) {
  const prog = getTrilhaProgress();
  if (!prog[faseId]) prog[faseId] = {};
  prog[faseId][exId] = !prog[faseId][exId];
  setTrilhaProgress(prog);
  el.classList.toggle('done', prog[faseId][exId]);
  el.textContent = prog[faseId][exId] ? '✓' : '';
  const label = el.nextElementSibling;
  if (label) label.classList.toggle('done', prog[faseId][exId]);
  // Atualiza o label de progresso
  const prog2 = getTrilhaProgress();
  let totalEx = 0, totalFeito = 0;
  FASES_TRILHA.forEach(f => f.exercicios.forEach(e => {
    totalEx++; if (prog2[f.id]?.[e.id]) totalFeito++;
  }));
  document.getElementById('trilha-progresso-label').textContent =
    `${totalFeito} de ${totalEx} exercícios concluídos`;
}

// ─── Cenários de Simulação ───────────────────────────────────────────────────
function mostrarCenariosSimulacao() {
  const container = document.getElementById('messages-container');
  const cenariosHtml = Object.entries(CENARIOS_SIMULACAO).map(([id, c]) => `
    <div class="cenario-card" onclick="iniciarSimulacao('${id}')">
      <span class="cenario-icon">${c.icon}</span>
      <div class="cenario-nome">${c.nome}</div>
      <div class="cenario-desc">${c.desc}</div>
    </div>
  `).join('');
  container.innerHTML = `
    <div class="chat-empty">
      <div class="chat-empty-icon">🎭</div>
      <h2>Simular Reunião</h2>
      <p class="text-secondary" style="max-width:480px;margin:0 auto 20px">
        A May joga o papel do cliente. Você conduz a conversa como faria na vida real.
      </p>
      <div class="cenarios-grid">${cenariosHtml}</div>
    </div>
  `;
}

function iniciarSimulacao(cenarioId) {
  const cenario = CENARIOS_SIMULACAO[cenarioId];
  if (!cenario) return;
  selecionarFerramenta('simular_reuniao');
  mostrarInputChat();
  // Injeta o cenário como primeiro prompt do sistema via mensagem especial
  setTimeout(() => {
    const prompt = `[MODO SIMULAÇÃO — ${cenario.nome}]\n\nInstruções para a May: ${cenario.promptSistema}\n\nAgora o advogado vai começar a conversa. Você responde como o cliente. Comece aguardando — quando o advogado falar, você reage naturalmente como esse cliente.`;
    enviarMensagemRapida(prompt);
  }, 100);
}

// ─── Utilitários ─────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Cancelamento de assinatura com feedback ──────────────────────────────────
function abrirModalCancelamento() {
  const modal = document.getElementById('modal-cancelamento');
  if (modal) { modal.style.display = 'flex'; }
}

function fecharModalCancelamento() {
  const modal = document.getElementById('modal-cancelamento');
  if (modal) { modal.style.display = 'none'; }
}

async function confirmarCancelamento() {
  const motivo = document.querySelector('input[name="cancel-motivo"]:checked')?.value;
  if (!motivo) {
    mostrarToast('Selecione o motivo do cancelamento antes de confirmar.', 'erro');
    return;
  }

  const detalhes = document.getElementById('cancel-detalhes')?.value?.trim() || '';
  const btn = document.getElementById('btn-confirmar-cancel');
  if (btn) { btn.textContent = 'Cancelando...'; btn.disabled = true; }

  try {
    const res = await api.post('/stripe/cancel', { motivo, detalhes });
    fecharModalCancelamento();
    mostrarToast('Assinatura cancelada. Você mantém o acesso até o fim do período atual.', 'sucesso');
  } catch (err) {
    mostrarToast('Erro ao cancelar. Tente novamente ou entre em contato pelo suporte.', 'erro');
    if (btn) { btn.textContent = 'Confirmar cancelamento'; btn.disabled = false; }
  }
}

// Expõe funções necessárias para o HTML
Object.assign(window, {
  enviarMensagem, novaConversa, carregarConversa, excluirConversa,
  selecionarFerramenta, uploadArquivo, toggleGravacao, removerAnexo,
  abrirModalDiagnostico, salvarDiagnostico,
  abrirModalPerfil, salvarPerfil, uploadFotoPerfil, uploadLogoEscritorio, baixarPropostaPDF,
  iniciarCheckout, abrirPortalStripe, logout,
  toggleMenuMobile, mostrarToast, toggleUserDropdown, fecharUserDropdown,
  copiarMensagem, exportarDocx, exportarPdf, exportarImagem, salvarTemplate,
  abrirArquivosArea, copiarArquivo, excluirArquivo,
  toggle2FA, confirmar2FAAtivacao, confirmar2FADesativacao,
  abrirModalTrilha, marcarExercicio, iniciarSimulacao, iniciarExercicioTrilha,
  testarNotificacao,
  instalarPWA, fecharBannerPWA,
  toggleTema,
  abrirModalCancelamento, fecharModalCancelamento, confirmarCancelamento,
});

// ─── Módulos ativos no header ──────────────────────────────────────────────
async function carregarModulosHeader() {
  const el = document.getElementById('header-modulos');
  if (!el) return;
  try {
    const r = await api.get('/modulos');
    if (!r.ok) return;
    const { modulos } = await r.json();
    const ativos = modulos.filter(m => m.ativo);
    if (!ativos.length) { el.style.display = 'none'; return; }

    el.style.display = 'flex';
    el.innerHTML = ativos.map(m => `
      <a href="${m.rota}" style="
        display:inline-flex;align-items:center;gap:5px;
        background:rgba(124,58,237,.12);border:1px solid rgba(124,58,237,.25);
        color:#C4B5FD;font-size:11px;font-weight:700;
        padding:4px 11px;border-radius:20px;text-decoration:none;
        white-space:nowrap;transition:background .2s"
        onmouseover="this.style.background='rgba(124,58,237,.25)'"
        onmouseout="this.style.background='rgba(124,58,237,.12)'">
        ${m.emoji} ${m.nome}
      </a>`).join('');
  } catch(_) { el.style.display = 'none'; }
}
