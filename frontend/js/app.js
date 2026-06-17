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
};

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
  await carregarDadosIniciais();
  renderizarSidebar();
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
      // Ativa a primeira área por padrão se nenhuma estiver ativa
      if (!estado.areaAtiva && estado.areas.length > 0) {
        estado.areaAtiva = estado.areas[0];
      }
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
  if (!estado.user?.diagnostico_completo) {
    abrirModalDiagnostico();
  }
}

// ─── Render Sidebar ──────────────────────────────────────────────────────────
function renderizarSidebar() {
  const user = estado.user;

  // Avatar e nome
  const avatarEl = document.getElementById('user-avatar-text');
  if (user?.avatar_url) {
    avatarEl.innerHTML = `<img src="${user.avatar_url}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
  } else {
    avatarEl.textContent = (user?.name || 'U').charAt(0).toUpperCase();
  }
  document.getElementById('user-name-text').textContent = user?.name || '';
  document.getElementById('user-plan-badge').innerHTML =
    `<span class="badge badge-${user?.plano || 'free'}">${user?.plano || 'free'}</span>`;

  // Ferramentas
  const toolList = document.getElementById('tool-list');
  toolList.innerHTML = FERRAMENTAS.map(f => `
    <div class="tool-item ${estado.ferramentaAtiva === f.id ? 'active' : ''}"
         onclick="selecionarFerramenta('${f.id}')">
      <span class="tool-icon">${f.icon}</span>
      <span>${f.nome}</span>
    </div>
  `).join('');

  // Seletor de Área Ativa
  renderizarSeletorArea();

  // Conversas
  renderizarListaConversas();

  // Contador de uso
  atualizarContadorUso();

  // Botões contextuais — sempre re-avaliados com base no estado atual do usuário
  const linkGestor = document.getElementById('link-gestor');
  if (linkGestor) {
    linkGestor.style.display = (user?.role === 'gestor' || user?.role === 'admin') ? 'block' : 'none';
  }
  const btnVenda = document.getElementById('btn-registrar-venda');
  if (btnVenda) {
    btnVenda.style.display = user?.empresa_id ? 'block' : 'none';
  }
  const linkRanking = document.getElementById('link-ranking');
  if (linkRanking) {
    linkRanking.style.display = user?.empresa_id ? 'block' : 'none';
  }
  const btnFunil = document.getElementById('btn-funil');
  if (btnFunil) {
    btnFunil.style.display = user?.empresa_id ? 'block' : 'none';
  }
  const linkAgenda = document.getElementById('link-agenda');
  if (linkAgenda) {
    linkAgenda.style.display = user?.empresa_id ? 'block' : 'none';
  }
  const linkLeads = document.getElementById('link-leads');
  if (linkLeads) {
    linkLeads.style.display = user?.empresa_id ? 'block' : 'none';
  }
}

// ─── Seletor de Área Ativa ───────────────────────────────────────────────────
function renderizarSeletorArea() {
  // Busca ou cria o container na sidebar
  let container = document.getElementById('area-ativa-container');
  if (!container) return; // será criado pelo HTML

  if (!estado.areas.length) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';
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
  // Remove tela vazia se existir
  const vazia = container.querySelector('.chat-empty');
  if (vazia) vazia.remove();

  adicionarMensagem('user', texto);

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
  return `<div class="msg-actions">
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
  </div>`;
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

// ─── Upload de arquivo ───────────────────────────────────────────────────────
async function uploadArquivo() {
  const input = document.createElement('input');
  input.type  = 'file';
  input.accept = '.pdf,.docx,.txt';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;

    mostrarToast('Processando arquivo...', 'aviso');
    const form = new FormData();
    form.append('arquivo', file);

    const res = await api.upload('/upload/documento', form);
    if (!res?.ok) { mostrarToast('Erro ao processar arquivo', 'erro'); return; }

    const data = await res.json();
    mostrarToast(`"${file.name}" processado!`, 'sucesso');

    // Injeta o texto extraído na caixa de mensagem
    const msgInput = document.getElementById('message-input');
    msgInput.value = `Analise este documento:\n\n${data.texto_preview}\n\n[Arquivo: ${file.name}]`;
    msgInput.dispatchEvent(new Event('input'));
  };
  input.click();
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

async function salvarPerfil() {
  const name = document.getElementById('perfil-nome').value.trim();
  if (!name) { mostrarToast('Nome obrigatório.', 'erro'); return; }

  const res = await api.put('/user/perfil', { name });
  if (!res?.ok) { mostrarToast('Erro ao salvar perfil', 'erro'); return; }

  const data = await res.json();
  estado.user = { ...estado.user, ...data.user };
  salvarUser(estado.user);

  document.getElementById('modal-perfil').classList.remove('active');
  mostrarToast('Perfil atualizado!', 'sucesso');
  renderizarSidebar();
}

// ─── Planos / Checkout Cielo ─────────────────────────────────────────────────
let _planoSelecionado = 'mensal';

function iniciarCheckout(plano) {
  _planoSelecionado = plano;
  const label = plano === 'mensal' ? 'Mensal' : 'Anual';
  document.getElementById('cartao-titulo').textContent = `Assinar — Plano ${label}`;
  document.getElementById('cartao-erro').style.display = 'none';
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
      erro.textContent = data.erro || 'Pagamento recusado. Verifique os dados e tente novamente.';
      erro.style.display = 'block';
      return;
    }

    // Sucesso — fecha modal, atualiza estado, exibe confirmação
    document.getElementById('modal-cartao').classList.remove('active');
    estado.user.plano = _planoSelecionado;
    estado.user.plano_status = 'ativo';
    renderizarSidebar();
    mostrarToast(`🎉 Plano ${_planoSelecionado} ativado com sucesso!`, 'sucesso');

  } catch {
    erro.textContent = 'Erro de conexão. Tente novamente.';
    erro.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirmar assinatura';
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

// ─── Modal: Registrar Venda ───────────────────────────────────────────────────
function abrirModalVenda() {
  ['venda-cliente','venda-telefone','venda-produto','venda-valor','venda-data-contato','venda-data-fechamento'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const origem = document.getElementById('venda-origem');
  if (origem) origem.value = '';
  document.getElementById('venda-resultado').style.display = 'none';
  document.getElementById('btn-confirmar-venda').style.display = 'block';
  document.getElementById('btn-confirmar-venda').disabled = false;
  document.getElementById('modal-venda').classList.add('active');

  // Preenche data de fechamento com hoje por padrão
  const hoje = new Date().toISOString().slice(0, 10);
  document.getElementById('venda-data-fechamento').value = hoje;
}

function fecharModalVenda() {
  document.getElementById('modal-venda').classList.remove('active');
}

async function registrarVenda() {
  const cliente       = document.getElementById('venda-cliente').value.trim();
  const origem        = document.getElementById('venda-origem').value;
  const produto       = document.getElementById('venda-produto').value.trim();
  const telefone      = document.getElementById('venda-telefone').value.trim();
  const valorRaw      = document.getElementById('venda-valor').value;
  const valor         = valorRaw ? parseFloat(valorRaw) : null;
  const dataContato   = document.getElementById('venda-data-contato').value || null;
  const dataFechamento= document.getElementById('venda-data-fechamento').value || null;

  if (!cliente) { mostrarToast('Informe o nome do cliente.', 'erro'); return; }
  if (!origem)  { mostrarToast('Selecione a origem do cliente.', 'erro'); return; }
  if (!produto) { mostrarToast('Informe o produto ou serviço.', 'erro'); return; }

  const btn = document.getElementById('btn-confirmar-venda');
  btn.disabled = true;
  btn.textContent = 'Registrando...';

  try {
    const res = await api.post('/vendas', {
      cliente,
      telefone:        telefone  || null,
      origem,
      descricao:       produto,
      valor:           valor && valor > 0 ? valor : null,
      data_contato:    dataContato,
      data_fechamento: dataFechamento,
    });
    const data = await res.json();

    if (!res.ok) {
      mostrarToast(data.erro || 'Erro ao registrar venda.', 'erro');
      btn.disabled = false;
      btn.textContent = 'Registrar venda';
      return;
    }

    const fmt = v => v ? 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : null;
    const textoResultado = [
      `${produto} — ${cliente} registrado.`,
      `+${data.xp_ganho} XP`,
      valor ? fmt(valor) : 'Êxito (sem valor definido)',
      data.posicao_ranking ? `${data.posicao_ranking}° no ranking` : '',
    ].filter(Boolean).join(' · ');

    document.getElementById('venda-resultado-texto').textContent = textoResultado;
    document.getElementById('venda-resultado').style.display = 'block';
    btn.style.display = 'none';

    mostrarToast(`💰 Venda registrada! +${data.xp_ganho} XP`, 'sucesso');
  } catch (err) {
    mostrarToast('Erro de conexão.', 'erro');
    btn.disabled = false;
    btn.textContent = 'Registrar venda';
  }
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

// ─── Home Dashboard ──────────────────────────────────────────────────────────
function mostrarHomeDashboard() {
  const container = document.getElementById('messages-container');
  const wrapper   = document.getElementById('chat-input-wrapper');
  if (wrapper) wrapper.style.display = 'none';

  const user  = estado.user;
  // Os campos do diagnóstico ficam diretamente em user, não em user.diagnostico
  const diag  = {
    experiencia:  user?.tempo_experiencia,
    contr:        user?.contratos_mes,
    dificuldades: user?.maior_dificuldade ? [user.maior_dificuldade] : [],
  };
  const nivel = calcularNivel(diag);
  const meta  = metaDaSemana(diag);
  const streak = estado.streak?.dias_seguidos || 0;
  const prox  = proximosExercicios();
  const hora  = new Date().getHours();
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';
  const nome  = (user?.name || '').split(' ')[0];

  container.innerHTML = `
    <div class="home-dashboard">
      <div class="hd-header">
        <div>
          <h2 class="hd-greeting">${saudacao}, ${escapeHtml(nome)}! 👋</h2>
          <p class="hd-sub">Aqui está seu progresso comercial</p>
        </div>
        ${streak > 1 ? `<div class="hd-streak">🔥 ${streak} dias seguidos</div>` : ''}
      </div>

      <div class="hd-cards-row">
        <div class="hd-card hd-nivel-card">
          <div class="hd-card-label">Seu nível</div>
          <div class="hd-nivel-badge">Nível ${nivel.n}</div>
          <div class="hd-nivel-nome">${nivel.nome}</div>
          <div class="hd-progress-bar"><div class="hd-progress-fill" style="width:${nivel.pct}%"></div></div>
          <div class="hd-progress-label">${nivel.pct}% para o próximo nível</div>
        </div>
        <div class="hd-card">
          <div class="hd-card-label">Meta da semana</div>
          <p class="hd-meta-text">${meta}</p>
        </div>
      </div>

      <div class="hd-cards-row" style="margin-bottom:20px">
        <div class="hd-card" style="grid-column:1/-1">
          <div class="hd-card-label">Trilha de hoje — próximos exercícios</div>
          <div class="hd-trilha-items">
            ${prox.map(ex => `
              <div class="hd-trilha-item" onclick="${ex.onclick}">
                <div class="hd-check ${ex.feito ? 'done' : ''}">${ex.feito ? '✓' : ''}</div>
                <span class="hd-trilha-label">${escapeHtml(ex.label)}</span>
                ${!ex.feito ? '<span style="font-size:.72rem;color:var(--accent-light);margin-left:auto">→ Iniciar</span>' : ''}
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <div class="hd-actions">
        <button class="hd-btn primary" onclick="abrirModalTrilha()">📚 Ver trilha completa</button>
        <button class="hd-btn" onclick="selecionarFerramenta('simular_reuniao')">🎭 Simular reunião</button>
        <button class="hd-btn" onclick="selecionarFerramenta('chat')">💬 Chat livre</button>
        ${user?.empresa_id ? `<button class="hd-btn" onclick="abrirModalVenda()">💰 Registrar venda</button>` : ''}
      </div>
    </div>
  `;
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

// ─── Funil SDR / Closer ──────────────────────────────────────────────────────
const funil = (() => {
  let _leads = [];
  let _leadAtivo = null;

  function aba(nome) {
    ['novo', 'lista'].forEach(n => {
      const el = document.getElementById(`funil-aba-${n}`);
      if (el) el.style.display = n === nome ? 'block' : 'none';
      const tab = document.getElementById(`tab-${n === 'novo' ? 'novo-lead' : 'leads'}`);
      if (tab) tab.classList.toggle('active', n === nome);
    });
    if (nome === 'lista') listar();
  }

  async function listar() {
    const container = document.getElementById('funil-leads-lista');
    if (!container) return;
    container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px">Carregando…</div>';

    const status = document.getElementById('funil-filtro-status')?.value || '';
    const url    = '/leads' + (status ? `?status=${encodeURIComponent(status)}` : '');

    try {
      const res  = await api.get(url);
      if (!res?.ok) throw new Error();
      const data = await res.json();
      _leads = data.leads || [];

      if (!_leads.length) {
        container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:32px">Nenhum lead encontrado.</div>';
        return;
      }

      const statusLabel = {
        novo: 'Novo',
        briefing_gerado: 'Briefing pronto',
        reuniao_agendada: 'Reunião marcada',
        negociando: 'Negociando',
        ganhou: 'Ganhou ✅',
        perdeu: 'Perdeu ❌',
      };

      container.innerHTML = _leads.map(l => `
        <div class="lead-card" onclick="funil.abrirBriefing('${l.id}')">
          <div style="display:flex;align-items:flex-start;gap:10px;justify-content:space-between">
            <div style="flex:1">
              <div style="font-weight:700;font-size:14px;margin-bottom:2px">${esc(l.nome_lead)}</div>
              ${l.empresa_lead ? `<div style="font-size:12px;color:var(--text-muted)">${esc(l.empresa_lead)}</div>` : ''}
            </div>
            <span class="lead-status-pill status-${l.status || 'novo'}">${statusLabel[l.status] || l.status}</span>
          </div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:8px;line-height:1.4">
            ${esc(l.contexto?.slice(0, 100))}${(l.contexto?.length || 0) > 100 ? '…' : ''}
          </div>
          <div style="display:flex;gap:16px;margin-top:8px;font-size:11px;color:var(--text-muted)">
            <span>SDR: ${l.sdr?.name || '—'}</span>
            ${l.closer?.name ? `<span>Closer: ${l.closer.name}</span>` : ''}
            <span>Origem: ${esc(l.origem || '—')}</span>
            ${l.valor_estimado ? `<span style="color:#10B981">R$ ${Number(l.valor_estimado).toLocaleString('pt-BR')}</span>` : ''}
          </div>
        </div>
      `).join('');
    } catch {
      container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:32px">Erro ao carregar leads.</div>';
    }
  }

  async function registrar(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-registrar-lead');
    btn.disabled = true;
    btn.textContent = '⏳ Gerando briefing com May…';

    try {
      const body = {
        nome_lead:       document.getElementById('fl-nome').value.trim(),
        empresa_lead:    document.getElementById('fl-empresa').value.trim() || null,
        contexto:        document.getElementById('fl-contexto').value.trim(),
        objecao_inicial: document.getElementById('fl-objecao').value.trim() || null,
        origem:          document.getElementById('fl-origem').value === 'outro'
                           ? (document.getElementById('fl-origem-outro').value.trim() || 'outro')
                           : document.getElementById('fl-origem').value,
        valor_estimado:  document.getElementById('fl-valor').value || null,
        closer_id:       document.getElementById('fl-closer')?.value || null,
      };

      const res  = await api.post('/leads', body);
      const data = await res?.json();

      if (!res?.ok) throw new Error(data?.erro || 'Erro ao registrar lead.');

      // Limpa form
      ['fl-nome','fl-empresa','fl-contexto','fl-objecao','fl-valor'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });

      mostrarToast('✅ Lead registrado! Briefing gerado pela May.', 'sucesso');

      // Exibe briefing imediatamente
      _leadAtivo = data.lead;
      mostrarBriefing(data.lead);

    } catch (err) {
      mostrarToast(err.message || 'Erro ao registrar lead.', 'erro');
    } finally {
      btn.disabled = false;
      btn.textContent = '🎯 Registrar Lead e Gerar Briefing';
    }
  }

  function abrirBriefing(id) {
    const lead = _leads.find(l => l.id === id);
    if (!lead) return;
    _leadAtivo = lead;
    mostrarBriefing(lead);
  }

  function mostrarBriefing(lead) {
    document.getElementById('briefing-titulo').textContent   = `🎯 ${lead.nome_lead}`;
    document.getElementById('briefing-origem').textContent   = `Origem: ${lead.origem || '—'} · ${lead.empresa_lead || ''}`;
    document.getElementById('briefing-conteudo').textContent = lead.briefing || 'Briefing não disponível.';
    document.getElementById('briefing-lead-id').value        = lead.id;
    document.getElementById('briefing-resultado').value      = lead.resultado || '';
    document.getElementById('briefing-valor-group').style.display = 'none';
    document.getElementById('modal-briefing').classList.add('active');
  }

  async function atualizarStatus(btn) {
    const id     = document.getElementById('briefing-lead-id')?.value;
    const status = btn.dataset.status;
    if (!id) return;

    // Reunião marcada: mostra campos de data/hora
    if (status === 'reuniao_agendada') {
      const ag = document.getElementById('briefing-agenda-group');
      if (ag) { ag.style.display = 'flex'; }
      document.getElementById('briefing-valor-group').style.display = 'none';
      return; // aguarda confirmarAgendamento()
    }

    const ganhando = status === 'ganhou';
    document.getElementById('briefing-valor-group').style.display  = ganhando ? 'block' : 'none';
    document.getElementById('briefing-agenda-group').style.display = 'none';
    if (!ganhando) _confirmarStatus(id, status);
  }

  async function confirmarAgendamento() {
    const id           = document.getElementById('briefing-lead-id')?.value;
    const data_reuniao = document.getElementById('briefing-data-reuniao')?.value;
    const local        = document.getElementById('briefing-local-reuniao')?.value || null;

    if (!data_reuniao) { mostrarToast('Informe a data e hora da reunião.', 'erro'); return; }

    await _confirmarStatus(id, 'reuniao_agendada', { data_reuniao: new Date(data_reuniao).toISOString(), local_reuniao: local });
    mostrarToast('📅 Reunião agendada! Aparecerá na Agenda Comercial.', 'sucesso');
  }

  async function _confirmarStatus(id, status, extra = {}) {
    const resultado     = document.getElementById('briefing-resultado')?.value;
    const valor_fechado = document.getElementById('briefing-valor-fechado')?.value || null;

    try {
      const body = { status, resultado, valor_fechado, ...extra };
      const res  = await api.patch(`/leads/${id}/status`, body);
      if (!res?.ok) throw new Error();
      if (status !== 'reuniao_agendada') mostrarToast('Status atualizado!', 'sucesso');
      document.getElementById('modal-briefing').classList.remove('active');
      document.getElementById('briefing-agenda-group').style.display = 'none';
      listar();
    } catch {
      mostrarToast('Erro ao atualizar status.', 'erro');
    }
  }

  return { aba, listar, registrar, abrirBriefing, atualizarStatus, confirmarAgendamento };
})();

function abrirModalFunil() {
  document.getElementById('modal-funil').classList.add('active');
  funil.aba('novo');
}

function fecharModalFunil() {
  document.getElementById('modal-funil').classList.remove('active');
}

function fecharModalBriefing() {
  document.getElementById('modal-briefing').classList.remove('active');
}

// Expõe funções necessárias para o HTML
Object.assign(window, {
  enviarMensagem, novaConversa, carregarConversa, excluirConversa,
  selecionarFerramenta, uploadArquivo, toggleGravacao,
  abrirModalDiagnostico, salvarDiagnostico,
  abrirModalPerfil, salvarPerfil, uploadFotoPerfil,
  iniciarCheckout, abrirPortalStripe, logout,
  toggleMenuMobile, mostrarToast,
  copiarMensagem, exportarDocx, salvarTemplate,
  abrirArquivosArea, copiarArquivo, excluirArquivo,
  abrirModalVenda, fecharModalVenda, registrarVenda,
  toggle2FA, confirmar2FAAtivacao, confirmar2FADesativacao,
  abrirModalTrilha, marcarExercicio, iniciarSimulacao, iniciarExercicioTrilha,
  testarNotificacao,
  instalarPWA, fecharBannerPWA,
  toggleTema,
  abrirModalFunil, fecharModalFunil, fecharModalBriefing,
  funil,
});
