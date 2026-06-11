// ═══════════════════════════════════════════════════════════════════════════════
// app.js — Lógica principal do chat e da interface
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Estado global ──────────────────────────────────────────────────────────
const estado = {
  user: null,
  streak: null,
  conversaAtiva: null,
  ferramentaAtiva: 'chat',
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
    const [resMe, resConversas, resUso] = await Promise.all([
      api.get('/user/me'),
      api.get('/chat/conversas'),
      api.get('/user/uso'),
    ]);

    if (resMe?.ok) {
      const data = await resMe.json();
      estado.user   = data.user;
      estado.streak = data.streak;
      salvarUser(data.user);

      // Mostra link do painel se for gestor
      if (data.user?.role === 'gestor') {
        const linkGestor = document.getElementById('link-gestor');
        if (linkGestor) linkGestor.style.display = 'block';
      }
      // Mostra botão de registrar venda se pertencer a uma equipe
      if (data.user?.empresa_id) {
        const btnVenda = document.getElementById('btn-registrar-venda');
        if (btnVenda) btnVenda.style.display = 'block';
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

  // Conversas
  renderizarListaConversas();

  // Contador de uso
  atualizarContadorUso();
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

// ─── Modal de diagnóstico ────────────────────────────────────────────────────
function abrirModalDiagnostico() {
  document.getElementById('modal-diagnostico').classList.add('active');
}

async function salvarDiagnostico() {
  const dados = {
    nicho:             document.getElementById('diag-nicho').value,
    produto:           document.getElementById('diag-produto').value.trim(),
    publico_alvo:      document.getElementById('diag-publico').value.trim(),
    nivel:             document.getElementById('diag-nivel').value,
    maior_dificuldade: document.getElementById('diag-dificuldade').value,
  };

  if (!dados.nicho || !dados.produto || !dados.publico_alvo || !dados.nivel || !dados.maior_dificuldade) {
    mostrarToast('Preencha todos os campos.', 'erro');
    return;
  }

  const res = await api.put('/user/diagnostico', dados);
  if (!res?.ok) { mostrarToast('Erro ao salvar diagnóstico', 'erro'); return; }

  const data = await res.json();
  estado.user = { ...estado.user, ...data.user };
  salvarUser(estado.user);

  document.getElementById('modal-diagnostico').classList.remove('active');
  mostrarToast('Diagnóstico salvo! A May está personalizada para você.', 'sucesso');
  renderizarSidebar();
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
  document.getElementById('modal-venda').classList.add('active');
  document.getElementById('venda-valor').value = '';
  document.getElementById('venda-descricao').value = '';
  document.getElementById('venda-cliente').value = '';
  document.getElementById('venda-resultado').style.display = 'none';
  document.getElementById('btn-confirmar-venda').style.display = 'block';
  document.getElementById('btn-confirmar-venda').disabled = false;
}

function fecharModalVenda() {
  document.getElementById('modal-venda').classList.remove('active');
}

async function registrarVenda() {
  const valor     = parseFloat(document.getElementById('venda-valor').value);
  const descricao = document.getElementById('venda-descricao').value.trim();
  const cliente   = document.getElementById('venda-cliente').value.trim();

  if (!valor || valor <= 0) {
    mostrarToast('Informe o valor da venda.', 'erro');
    return;
  }

  const btn = document.getElementById('btn-confirmar-venda');
  btn.disabled = true;
  btn.textContent = 'Registrando...';

  try {
    const res = await api.post('/vendas', { valor, descricao, cliente });
    const data = await res.json();

    if (!res.ok) {
      mostrarToast(data.erro || 'Erro ao registrar venda.', 'erro');
      btn.disabled = false;
      btn.textContent = 'Registrar venda';
      return;
    }

    // Mostra resultado com XP e posição
    const fmt = v => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    const textoResultado = [
      `Venda de ${fmt(valor)} registrada.`,
      `+${data.xp_ganho} XP`,
      data.posicao_ranking
        ? `Você está em ${data.posicao_ranking}° no ranking da equipe.`
        : '',
    ].filter(Boolean).join(' · ');

    document.getElementById('venda-resultado-texto').textContent = textoResultado;
    document.getElementById('venda-resultado').style.display = 'block';
    btn.style.display = 'none';

    mostrarToast(`💰 +${data.xp_ganho} XP · ${data.posicao_ranking}° no ranking!`, 'sucesso');
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
