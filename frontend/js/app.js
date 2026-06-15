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
  { id: 'simulador_objecoes', nome: 'Simulador de objeções',       icon: '🎯' },
  { id: 'gerador_proposta',   nome: 'Gerador de proposta',         icon: '📄' },
  { id: 'follow_up',          nome: 'Script de follow-up',         icon: '🔁' },
  { id: 'negociacao',         nome: 'Argumentos de negociação',    icon: '⚖️' },
  { id: 'diagnostico',        nome: 'Diagnóstico de atendimento',  icon: '🔍' },
  { id: 'spin',               nome: 'Treino SPIN Selling',         icon: '🧠' },
  { id: 'simulador_vendas',   nome: 'Simulador de vendas',         icon: '🏋️' },
  { id: 'criador_prompt',     nome: 'Criador de prompt de IA',     icon: '🤖' },
];

// ─── Inicialização ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
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
  document.getElementById('user-avatar-text').textContent =
    (user?.name || 'U').charAt(0).toUpperCase();
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
    linkGestor.style.display = user?.role === 'gestor' ? 'block' : 'none';
  }
  const btnVenda = document.getElementById('btn-registrar-venda');
  if (btnVenda) {
    btnVenda.style.display = user?.empresa_id ? 'block' : 'none';
  }
  const linkRanking = document.getElementById('link-ranking');
  if (linkRanking) {
    linkRanking.style.display = user?.empresa_id ? 'block' : 'none';
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
        <div onclick="selecionarArea('${a.id}')"
             style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:7px;cursor:pointer;margin-bottom:3px;font-size:13px;transition:background .15s;
                    background:${ativa?.id === a.id ? 'rgba(249,115,22,0.15)' : 'transparent'};
                    border:1px solid ${ativa?.id === a.id ? 'rgba(249,115,22,0.35)' : 'transparent'};
                    color:${ativa?.id === a.id ? 'var(--accent)' : 'var(--text-secondary)'}">
          <span>${a.icone || '⚖️'}</span>
          <span style="font-weight:${ativa?.id === a.id ? '600' : '400'}">${escapeHtml(a.nome)}</span>
          ${ativa?.id === a.id ? '<span style="margin-left:auto;font-size:10px;opacity:.7">●</span>' : ''}
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
      <button class="conv-delete" onclick="event.stopPropagation(); excluirConversa('${c.id}')"
              title="Excluir">✕</button>
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

  mostrarTelaVazia(id);
  renderizarSidebar();
  fecharMenuMobile();
}

// ─── Tela vazia com sugestões ────────────────────────────────────────────────
function mostrarTelaVazia(ferramenta) {
  const container = document.getElementById('messages-container');

  const sugestoes = {
    chat: [
      'Como responder objeções de preço?',
      'Como qualificar um lead no primeiro contato?',
      'Me dá um script de abordagem para WhatsApp',
      'Como pedir indicação sem parecer chato?',
    ],
    simulador_objecoes: [
      'Iniciar simulação — nível fácil',
      'Iniciar simulação — nível médio',
      'Quero treinar a objeção "não tenho dinheiro"',
    ],
    gerador_proposta: [
      'Quero gerar uma proposta comercial',
    ],
    follow_up: [
      'Lead sumiu após a proposta — gera um follow-up',
      'Preciso de mensagem de reativação de lead frio',
    ],
    negociacao: [
      'Preciso de argumentos para sustentar meu preço',
      'Lead comparou com concorrente mais barato',
    ],
    diagnostico: [
      'Vou colar uma conversa real para análise',
    ],
    spin: [
      'Iniciar treino de reunião com SPIN Selling',
    ],
    simulador_vendas: [
      'Iniciar simulação completa de vendas',
    ],
  };

  const ferr = FERRAMENTAS.find(f => f.id === ferramenta);
  const qs = sugestoes[ferramenta] || [];

  container.innerHTML = `
    <div class="chat-empty">
      <div class="chat-empty-icon">${ferr?.icon || '💬'}</div>
      <h2>${ferr?.nome || 'Chat'}</h2>
      <p class="text-secondary">
        ${ferramenta === 'chat'
          ? 'Pergunte qualquer coisa sobre vendas. A May responde com base no seu perfil.'
          : 'Use esta ferramenta para ' + (ferr?.nome || '').toLowerCase() + '.'}
      </p>
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
async function excluirConversa(id) {
  if (!confirm('Excluir esta conversa?')) return;
  const res = await api.delete(`/chat/conversa/${id}`);
  if (res?.ok) {
    estado.conversas = estado.conversas.filter(c => c.id !== id);
    if (estado.conversaAtiva === id) {
      estado.conversaAtiva = null;
      selecionarFerramenta(estado.ferramentaAtiva);
    }
    renderizarSidebar();
  }
}

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
        // Adiciona botões de ação pós-mensagem
        const msgEl = document.getElementById(msgId);
        if (msgEl) {
          msgEl.insertAdjacentHTML('beforeend', `
            <div class="msg-actions">
              <button class="msg-action-btn" onclick="copiarMensagem('${msgId}')">Copiar</button>
              <button class="msg-action-btn" onclick="salvarTemplate('${msgId}')">Salvar</button>
              <button class="msg-action-btn" onclick="exportarDocx('${msgId}')">↓ Word</button>
            </div>
          `);
        }
        // Atualiza uso
        estado.uso.mensagens_usadas++;
        estado.uso.restantes = Math.max(0, estado.uso.restantes - 1);
        atualizarContadorUso();
        // Recarrega lista de conversas
        recarregarConversas();
      }
    },
    // onError
    (msg) => {
      bolha.innerHTML = `<span style="color:var(--error)">${escapeHtml(msg)}</span>`;
      mostrarToast(msg, 'erro');
    }
  );

  estado.enviando = false;
  document.getElementById('btn-send').disabled = false;
  input.focus();
}

// ─── Adicionar mensagem ao DOM ────────────────────────────────────────────────
function adicionarMensagem(role, conteudo, scroll = true) {
  const container = document.getElementById('messages-container');
  const isUser = role === 'user';
  const inicial = (estado.user?.name || 'V').charAt(0).toUpperCase();

  const html = `
    <div class="message ${isUser ? 'user' : ''}">
      <div class="msg-avatar ${isUser ? 'user-av' : 'may'}">${isUser ? inicial : 'M'}</div>
      <div class="msg-content">
        <div class="msg-name">${isUser ? 'Você' : 'May'}</div>
        <div class="msg-bubble">${isUser ? escapeHtml(conteudo) : renderMarkdown(conteudo)}</div>
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
  const titulo = prompt('Nome para salvar este conteúdo:');
  if (!titulo) return;

  const res = await api.post('/export/template', {
    tipo: estado.ferramentaAtiva,
    titulo,
    conteudo,
  });

  if (res?.ok) mostrarToast('Salvo nos seus templates!', 'sucesso');
  else mostrarToast('Erro ao salvar', 'erro');
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
  document.getElementById('modal-perfil').classList.add('active');
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

// ─── Planos / Checkout ───────────────────────────────────────────────────────
async function iniciarCheckout(plano) {
  mostrarToast('Redirecionando...', 'aviso');
  const res = await api.post('/stripe/checkout', { plano });
  if (!res?.ok) { mostrarToast('Erro ao iniciar pagamento', 'erro'); return; }
  const data = await res.json();
  window.location.href = data.url;
}

async function abrirPortalStripe() {
  const res = await api.post('/stripe/portal', {});
  if (!res?.ok) { mostrarToast('Erro ao abrir portal', 'erro'); return; }
  const data = await res.json();
  window.open(data.url, '_blank');
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
function logout() {
  if (!confirm('Sair da plataforma?')) return;
  limparTokens();
  window.location.href = '/auth.html';
}

// ─── Mobile sidebar ──────────────────────────────────────────────────────────
function toggleMenuMobile() {
  document.getElementById('sidebar').classList.toggle('open');
}
function fecharMenuMobile() {
  document.getElementById('sidebar').classList.remove('open');
}

// ─── Nova conversa ───────────────────────────────────────────────────────────
function novaConversa() {
  estado.conversaAtiva = null;
  selecionarFerramenta(estado.ferramentaAtiva);
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

// ─── Utilitários ─────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Expõe funções necessárias para o HTML
Object.assign(window, {
  enviarMensagem, novaConversa, carregarConversa, excluirConversa,
  selecionarFerramenta, uploadArquivo, toggleGravacao,
  abrirModalDiagnostico, salvarDiagnostico,
  abrirModalPerfil, salvarPerfil,
  iniciarCheckout, abrirPortalStripe, logout,
  toggleMenuMobile, mostrarToast,
  copiarMensagem, exportarDocx, salvarTemplate,
  abrirModalVenda, fecharModalVenda, registrarVenda,
});
