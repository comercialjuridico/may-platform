// ═══════════════════════════════════════════════════════════════════════════════
// retencao.js — Memória do escritório (camada 1) e retornos de clientes (camada 2)
// Carregado depois do app.js: usa api, escapeHtml, mostrarToast, brf, brfEstilo,
// brfAbrirNaTela e brfFeedbackAbrir, que já existem quando estas funções rodam.
// ═══════════════════════════════════════════════════════════════════════════════

const ret = { retornos: [], carregou: false, disponivel: true };
const mem = { dados: null, sugestoes: [], completude: 0, ritual: true, salvando: false };

const MEM_CAMPOS = [
  { id: 'servicos',         rotulo: 'Serviços que o escritório oferece', dica: 'Ex: aposentadoria por idade, revisão da vida toda, BPC/LOAS, auxílio-doença', linhas: 3 },
  { id: 'honorarios',       rotulo: 'Honorários e como cobra',           dica: 'Ex: 30% do retroativo, sem entrada; consulta R$ 250 abatida do contrato', linhas: 3 },
  { id: 'formas_pagamento', rotulo: 'Formas de pagamento',               dica: 'Ex: Pix, cartão em até 10x, boleto', linhas: 2 },
  { id: 'perfil_cliente',   rotulo: 'Quem é o cliente típico',           dica: 'Ex: pessoas acima de 55 anos, interior de SP, chegam pelo Instagram e pelo WhatsApp', linhas: 3 },
  { id: 'diferenciais',     rotulo: 'Por que escolher o seu escritório', dica: 'Ex: 12 anos só com previdenciário, atendimento por vídeo, acompanhamento semanal', linhas: 3 },
  { id: 'tom',              rotulo: 'Jeito de falar com o cliente',      dica: 'Ex: próximo e simples, sem juridiquês, chama o cliente pelo primeiro nome', linhas: 2 },
];
const MEM_ROTULO_SUGESTAO = {
  servicos: 'Serviço', honorarios: 'Honorários', formas_pagamento: 'Pagamento',
  perfil_cliente: 'Cliente típico', diferenciais: 'Diferencial', objecao: 'Objeção',
};

// ─── Datas ───────────────────────────────────────────────────────────────────
function retParaInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function retFimDeHoje() { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); }
function retQuando(iso) {
  const t = Date.parse(iso);
  const d = new Date(t);
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const dia = new Date(d); dia.setHours(0, 0, 0, 0);
  const diff = Math.round((dia - hoje) / 86400000);
  if (diff === 0) return `hoje às ${hora}`;
  if (diff === 1) return `amanhã às ${hora}`;
  if (diff === -1) return `ontem às ${hora}`;
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${hora}`;
}

// ─── Retornos (camada 2) ─────────────────────────────────────────────────────
async function retCarregar() {
  try {
    const res = await api.get('/briefing/retornos?dias=30');
    if (!res?.ok) return;
    const data = await res.json();
    ret.retornos = data.retornos || [];
    ret.disponivel = data.retorno_disponivel !== false;
    ret.carregou = true;
  } catch (_) { /* silencioso: tela mostra vazio */ }
}

function retPendentesHoje() {
  const fim = retFimDeHoje();
  return ret.retornos.filter(r => Date.parse(r.data_retorno) <= fim).length;
}

async function retAtualizar() {
  await retCarregar();
  if (typeof brf !== 'undefined' && brf.aba === 'retornos' && document.getElementById('brf-conteudo')) brfRenderRetornos();
}

function retWhats(numero, nome) {
  const dig = String(numero || '').replace(/\D/g, '');
  if (dig.length < 10) return '';
  const n = dig.length <= 11 ? `55${dig}` : dig;
  const texto = encodeURIComponent(`Olá${nome ? ', ' + String(nome).split(' ')[0] : ''}! Tudo bem?`);
  return `https://wa.me/${n}?text=${texto}`;
}

function retItem(r) {
  const atrasado = Date.parse(r.data_retorno) < Date.now();
  const wa = retWhats(r.whatsapp, r.nome_lead);
  return `
    <div class="brf-card" style="margin-bottom:9px;padding:14px 15px">
      <div style="display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap">
        <div style="flex:1;min-width:200px">
          <div class="brf-item-nome">${escapeHtml(r.nome_lead || 'Cliente')}${r.produto ? ` <span class="brf-item-emp">· ${escapeHtml(r.produto)}</span>` : ''}</div>
          <div class="brf-item-meta" style="${atrasado ? 'color:var(--b-red)' : ''}">${atrasado ? 'Atrasado · ' : ''}${retQuando(r.data_retorno)}</div>
          ${r.proximo_passo ? `<div style="font-size:13.5px;margin-top:6px">${escapeHtml(r.proximo_passo)}</div>` : ''}
        </div>
      </div>
      <div class="brf-acoes" style="margin-top:12px">
        <button class="brf-btn mini" onclick="retConcluir('${r.id}')">Retorno feito</button>
        <button class="brf-btn ghost mini" onclick="retRemarcar('${r.id}')">Remarcar</button>
        ${wa ? `<a class="brf-btn ghost mini" style="text-decoration:none" target="_blank" rel="noopener" href="${escapeHtml(wa)}">WhatsApp</a>` : ''}
        <button class="brf-btn ghost mini" onclick="retAbrirBriefing('${r.id}')">Ver briefing</button>
      </div>
    </div>`;
}

async function brfRenderRetornos() {
  const alvo = document.getElementById('brf-conteudo');
  if (!alvo) return;
  if (!ret.carregou) {
    alvo.innerHTML = '<div class="brf-vazio">Carregando seus retornos...</div>';
    await retCarregar();
    if (brf.aba !== 'retornos') return;
    const aba = [...document.querySelectorAll('.brf-tab')].find(b => b.textContent.trim().startsWith('Retornos'));
    const n = retPendentesHoje();
    if (aba && n) aba.innerHTML = `Retornos<span class="brf-badge">${n}</span>`;
  }
  if (!ret.disponivel) {
    alvo.innerHTML = '<div class="brf-vazio">Os retornos ficam disponíveis assim que o banco for atualizado.</div>';
    return;
  }
  if (!ret.retornos.length) {
    alvo.innerHTML = `
      <div class="brf-vazio">
        Nenhum retorno marcado para os próximos 30 dias.<br>
        Depois de cada reunião, abra o briefing, clique em "Como foi a reunião" e marque o próximo passo com data.
        A May te avisa no dia.
      </div>`;
    return;
  }
  const fim = retFimDeHoje();
  const atrasados = ret.retornos.filter(r => Date.parse(r.data_retorno) < Date.now());
  const hoje      = ret.retornos.filter(r => Date.parse(r.data_retorno) >= Date.now() && Date.parse(r.data_retorno) <= fim);
  const depois    = ret.retornos.filter(r => Date.parse(r.data_retorno) > fim);
  const bloco = (titulo, lista) => lista.length
    ? `<div style="font-size:12px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--b-sub);margin:16px 0 8px">${titulo} (${lista.length})</div>${lista.map(retItem).join('')}`
    : '';
  alvo.innerHTML = bloco('Atrasados', atrasados) + bloco('Hoje', hoje) + bloco('Próximos dias', depois);
}

async function retPatch(id, corpo) {
  const res = await api.patch(`/briefing/${id}`, corpo);
  const data = await res.json().catch(() => ({}));
  if (!res?.ok) { mostrarToast(data.erro || 'Não consegui salvar', 'erro'); return null; }
  const l = brf.lista.find(x => String(x.id) === String(id));
  if (l) Object.assign(l, data.lead || corpo);
  if (brf.aberto && String(brf.aberto.id) === String(id)) Object.assign(brf.aberto, data.lead || corpo);
  return data.lead || corpo;
}

async function retConcluir(id) {
  if (!(await retPatch(id, { retorno_concluido: true }))) return;
  ret.retornos = ret.retornos.filter(r => String(r.id) !== String(id));
  mostrarToast('Retorno marcado como feito', 'sucesso');
  if (brf.aberto && String(brf.aberto.id) === String(id) && !document.getElementById('brf-conteudo')) brfAbrirNaTela(brf.aberto);
  else brfRenderRetornos();
}

function retRemarcar(id) {
  brfEstilo();
  const atual = ret.retornos.find(r => String(r.id) === String(id)) || brf.aberto || {};
  document.getElementById('ret-overlay')?.remove();
  const o = document.createElement('div');
  o.className = 'brf-overlay brf'; o.id = 'ret-overlay';
  o.onclick = e => { if (e.target === o) o.remove(); };
  o.innerHTML = `
    <div class="brf-modal">
      <h2 style="font-size:18px;margin:0 0 12px">Remarcar retorno</h2>
      <div class="brf-campo" style="margin-bottom:12px">
        <label>Próximo passo</label>
        <input id="ret-passo" maxlength="500" value="${escapeHtml(atual.proximo_passo || '')}" />
      </div>
      <div class="brf-campo" style="margin-bottom:14px">
        <label>Nova data</label>
        <input id="ret-data" type="datetime-local" value="${retParaInput(atual.data_retorno)}" />
      </div>
      <div class="brf-acoes" style="margin-top:0">
        <button class="brf-btn" onclick="retSalvarRemarcar('${id}')">Salvar</button>
        <button class="brf-btn ghost" onclick="document.getElementById('ret-overlay').remove()">Cancelar</button>
      </div>
    </div>`;
  document.body.appendChild(o);
}

async function retSalvarRemarcar(id) {
  const v = document.getElementById('ret-data')?.value;
  if (!v) { mostrarToast('Escolha a nova data', 'erro'); return; }
  const corpo = { data_retorno: new Date(v).toISOString(), proximo_passo: document.getElementById('ret-passo')?.value || '' };
  if (!(await retPatch(id, corpo))) return;
  document.getElementById('ret-overlay')?.remove();
  mostrarToast('Retorno remarcado. A May te lembra no dia.', 'sucesso');
  await retCarregar();
  if (brf.aberto && String(brf.aberto.id) === String(id) && !document.getElementById('brf-conteudo')) brfAbrirNaTela(brf.aberto);
  else brfRenderRetornos();
}

async function retAbrirBriefing(id) {
  let lead = brf.lista.find(l => String(l.id) === String(id));
  if (!lead) {
    const res = await api.get(`/briefing/${id}`);
    if (!res?.ok) { mostrarToast('Não encontrei esse briefing', 'erro'); return; }
    lead = await res.json();
  }
  brfAbrirNaTela(lead);
}

// Bloco no topo do briefing aberto: o que ficou combinado e quando retornar.
function retBlocoProximoPasso(lead) {
  if (!lead) return '';
  if (!lead.proximo_passo && !lead.data_retorno) {
    return `
      <div class="brf-card" style="margin-bottom:14px;padding:13px 15px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <div style="flex:1;min-width:200px;font-size:13.5px;color:var(--b-sub)">Depois da reunião, registre o próximo passo e a data do retorno. A May te avisa no dia.</div>
        <button class="brf-btn mini" onclick="brfFeedbackAbrir('${lead.id}')">Registrar próximo passo</button>
      </div>`;
  }
  const feito = lead.retorno_concluido;
  return `
    <div class="brf-card" style="margin-bottom:14px;padding:13px 15px">
      <div style="font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--b-sub)">Próximo passo</div>
      <div style="font-size:14.5px;margin:4px 0">${escapeHtml(lead.proximo_passo || 'Sem descrição')}</div>
      ${lead.data_retorno ? `<div class="brf-item-meta">${feito ? 'Retorno feito' : 'Retorno ' + retQuando(lead.data_retorno)}</div>` : ''}
      ${feito ? '' : `
        <div class="brf-acoes" style="margin-top:10px">
          ${lead.data_retorno ? `<button class="brf-btn mini" onclick="retConcluir('${lead.id}')">Retorno feito</button>` : ''}
          <button class="brf-btn ghost mini" onclick="retRemarcar('${lead.id}')">${lead.data_retorno ? 'Remarcar' : 'Marcar data'}</button>
        </div>`}
    </div>`;
}

// ─── Home: retornos de hoje e convite para preencher a memória ───────────────
async function retHome() {
  const alvo = document.getElementById('home-retencao');
  if (!alvo) return;
  await Promise.all([retCarregar(), memCarregar(true)]);
  if (!document.getElementById('home-retencao')) return;
  const hoje = retPendentesHoje();
  const faixas = [];
  if (hoje) {
    faixas.push(`<button class="home-chip" style="width:100%;justify-content:center;margin-bottom:8px" onclick="selecionarFerramenta('briefing');brfIrPara('retornos')">📞 ${hoje} retorno${hoje > 1 ? 's' : ''} para fazer hoje · ver lista</button>`);
  }
  if (mem.dados && mem.completude < 60) {
    faixas.push(`<button class="home-chip" style="width:100%;justify-content:center;margin-bottom:8px" onclick="selecionarFerramenta('memoria')">🗂️ Ensine a May sobre o seu escritório (${mem.completude}% preenchido) · as respostas ficam do seu jeito</button>`);
  }
  if (mem.sugestoes.length) {
    faixas.push(`<button class="home-chip" style="width:100%;justify-content:center;margin-bottom:8px" onclick="selecionarFerramenta('memoria')">💡 A May aprendeu ${mem.sugestoes.length} coisa${mem.sugestoes.length > 1 ? 's' : ''} sobre o seu escritório · revisar</button>`);
  }
  alvo.innerHTML = faixas.length ? `<div style="max-width:640px;margin:0 auto 14px">${faixas.join('')}</div>` : '';
}

// ─── Memória do escritório (camada 1) ────────────────────────────────────────
function memAplicar(data) {
  mem.dados = data.memoria;
  mem.sugestoes = data.sugestoes || [];
  mem.completude = data.completude || 0;
  mem.ritual = data.ritual_semanal !== false;
}

async function memCarregar(silencioso) {
  try {
    const res = await api.get('/memoria');
    const data = await res.json().catch(() => ({}));
    if (!res?.ok) { if (!silencioso) mostrarToast(data.erro || 'Não consegui carregar a memória', 'erro'); return false; }
    memAplicar(data);
    return true;
  } catch (_) { return false; }
}

async function mostrarMemoria() {
  brfEstilo();
  const container = document.getElementById('messages-container');
  container.innerHTML = '<div class="brf"><div class="brf-vazio">Carregando a memória do escritório...</div></div>';
  if (!(await memCarregar())) {
    container.innerHTML = '<div class="brf"><div class="brf-vazio">Não consegui carregar a memória agora. Tente de novo em instantes.</div></div>';
    return;
  }
  memRender();
}

function memLinhaObjecao(o, i) {
  return `
    <div class="brf-card" style="padding:12px;margin-bottom:8px" data-obj="${i}">
      <div class="brf-campo" style="margin-bottom:8px">
        <label>O que o cliente diz</label>
        <input class="mem-obj-texto" maxlength="300" value="${escapeHtml(o.texto || '')}" placeholder='Ex: "Vou pensar e te retorno"' />
      </div>
      <div class="brf-campo">
        <label>Como o escritório responde (opcional)</label>
        <textarea class="mem-obj-resp" maxlength="1000" style="min-height:56px">${escapeHtml(o.resposta || '')}</textarea>
      </div>
      <button class="brf-btn ghost mini" style="margin-top:8px" onclick="memRemover('obj', ${i})">Remover</button>
    </div>`;
}

function memLinhaScript(sc, i) {
  return `
    <div class="brf-card" style="padding:12px;margin-bottom:8px" data-scr="${i}">
      <div class="brf-campo" style="margin-bottom:8px">
        <label>Nome do script</label>
        <input class="mem-scr-titulo" maxlength="120" value="${escapeHtml(sc.titulo || '')}" placeholder="Ex: Primeira mensagem para lead do Instagram" />
      </div>
      <div class="brf-campo">
        <label>Texto</label>
        <textarea class="mem-scr-texto" maxlength="2000" style="min-height:90px">${escapeHtml(sc.texto || '')}</textarea>
      </div>
      <button class="brf-btn ghost mini" style="margin-top:8px" onclick="memRemover('scr', ${i})">Remover</button>
    </div>`;
}

function memRender() {
  const d = mem.dados || {};
  const container = document.getElementById('messages-container');
  const sug = mem.sugestoes.map((s, i) => `
    <div class="brf-card" style="padding:12px 14px;margin-bottom:8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <div style="flex:1;min-width:200px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--b-sub)">${escapeHtml(MEM_ROTULO_SUGESTAO[s.campo] || s.campo)}</div>
        <div style="font-size:14px;margin-top:3px">${escapeHtml(s.texto)}</div>
        ${s.resposta ? `<div class="brf-item-meta">Resposta: ${escapeHtml(s.resposta)}</div>` : ''}
      </div>
      <button class="brf-btn mini" onclick="memSugestao(${i}, true)">Guardar</button>
      <button class="brf-btn ghost mini" onclick="memSugestao(${i}, false)">Descartar</button>
    </div>`).join('');

  container.innerHTML = `
    <div class="brf">
      <h2>🗂️ Memória do escritório</h2>
      <p class="brf-lead">
        Tudo o que você escreve aqui entra em cada resposta, simulação e briefing da May.
        Quanto mais ela sabe sobre o seu escritório, mais as respostas soam como você e menos você precisa explicar.
      </p>

      <div class="brf-card" style="margin-bottom:16px;padding:14px 16px">
        <div style="display:flex;justify-content:space-between;font-size:13px;font-weight:700">
          <span>Memória preenchida</span><span>${mem.completude}%</span>
        </div>
        <div style="height:8px;background:var(--b-border);border-radius:8px;margin-top:8px;overflow:hidden">
          <div style="height:100%;width:${mem.completude}%;background:var(--b-brand);border-radius:8px"></div>
        </div>
      </div>

      ${sug ? `
        <h3 style="font-size:15px;margin:18px 0 4px">💡 O que a May aprendeu nas suas conversas</h3>
        <p class="brf-dica" style="margin:0 0 10px">Nada entra na memória sem você aprovar.</p>
        ${sug}` : ''}

      <div class="brf-card" style="margin-top:16px">
        <div class="brf-grid">
          ${MEM_CAMPOS.map(c => `
            <div class="brf-campo ${c.linhas > 2 ? 'brf-full' : ''}">
              <label>${c.rotulo}</label>
              <textarea id="mem-${c.id}" style="min-height:${c.linhas * 26}px" placeholder="${escapeHtml(c.dica)}">${escapeHtml(d[c.id] || '')}</textarea>
            </div>`).join('')}
        </div>
      </div>

      <h3 style="font-size:15px;margin:22px 0 4px">Objeções que seus clientes costumam levantar</h3>
      <p class="brf-dica" style="margin:0 0 10px">Com 3 ou mais, as simulações e os briefings passam a usar as objeções reais do seu escritório.</p>
      <div id="mem-objecoes">${(d.objecoes || []).map(memLinhaObjecao).join('')}</div>
      <button class="brf-btn ghost mini" onclick="memAdicionar('obj')">+ Adicionar objeção</button>

      <h3 style="font-size:15px;margin:22px 0 4px">Scripts que funcionam no seu escritório</h3>
      <p class="brf-dica" style="margin:0 0 10px">A May usa como referência de tom e de estrutura quando escreve para você.</p>
      <div id="mem-scripts">${(d.scripts || []).map(memLinhaScript).join('')}</div>
      <button class="brf-btn ghost mini" onclick="memAdicionar('scr')">+ Adicionar script</button>

      <div class="brf-card" style="margin-top:22px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <label style="display:flex;gap:10px;align-items:center;cursor:pointer;flex:1;min-width:220px;font-size:14px">
          <input type="checkbox" id="mem-ritual" ${mem.ritual ? 'checked' : ''} onchange="memRitual(this.checked)" style="width:18px;height:18px" />
          Receber o resumo de segunda-feira: retornos da semana, resultado das reuniões e um treino de 10 minutos
        </label>
      </div>

      <div class="brf-acoes">
        <button class="brf-btn" id="mem-salvar" onclick="memSalvar()">Salvar memória</button>
      </div>
    </div>`;
  container.scrollTop = 0;
}

function memColetar() {
  const out = {};
  MEM_CAMPOS.forEach(c => { out[c.id] = document.getElementById(`mem-${c.id}`)?.value || ''; });
  out.objecoes = [...document.querySelectorAll('#mem-objecoes [data-obj]')].map(el => ({
    texto: el.querySelector('.mem-obj-texto')?.value || '',
    resposta: el.querySelector('.mem-obj-resp')?.value || '',
  })).filter(o => o.texto.trim());
  out.scripts = [...document.querySelectorAll('#mem-scripts [data-scr]')].map(el => ({
    titulo: el.querySelector('.mem-scr-titulo')?.value || '',
    texto: el.querySelector('.mem-scr-texto')?.value || '',
  })).filter(s => s.titulo.trim() && s.texto.trim());
  return out;
}

// Mantém o que já foi digitado ao adicionar ou remover linhas.
function memAdicionar(tipo) {
  const atual = memColetar();
  mem.dados = { ...mem.dados, ...atual };
  if (tipo === 'obj') mem.dados.objecoes = [...(atual.objecoes || []), { texto: '', resposta: '' }];
  else mem.dados.scripts = [...(atual.scripts || []), { titulo: '', texto: '' }];
  memRenderMantendoRolagem();
}

function memRemover(tipo, i) {
  const atual = memColetar();
  // memColetar descarta linhas vazias; remove pela posição na tela
  const linhas = [...document.querySelectorAll(tipo === 'obj' ? '#mem-objecoes [data-obj]' : '#mem-scripts [data-scr]')];
  const lista = linhas.map(el => tipo === 'obj'
    ? { texto: el.querySelector('.mem-obj-texto')?.value || '', resposta: el.querySelector('.mem-obj-resp')?.value || '' }
    : { titulo: el.querySelector('.mem-scr-titulo')?.value || '', texto: el.querySelector('.mem-scr-texto')?.value || '' });
  lista.splice(i, 1);
  mem.dados = { ...mem.dados, ...atual, [tipo === 'obj' ? 'objecoes' : 'scripts']: lista };
  memRenderMantendoRolagem();
}

function memRenderMantendoRolagem() {
  const c = document.getElementById('messages-container');
  const y = c?.scrollTop || 0;
  memRender();
  if (c) c.scrollTop = y;
}

async function memSalvar() {
  if (mem.salvando) return;
  mem.salvando = true;
  const btn = document.getElementById('mem-salvar');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando...'; }
  try {
    const res = await api.put('/memoria', memColetar());
    const data = await res.json().catch(() => ({}));
    if (!res?.ok) { mostrarToast(data.erro || 'Não consegui salvar', 'erro'); return; }
    memAplicar(data);
    memRenderMantendoRolagem();
    mostrarToast('Memória salva. A May já usa isso nas próximas respostas.', 'sucesso');
  } catch (_) {
    mostrarToast('Erro de conexão', 'erro');
  } finally {
    mem.salvando = false;
    const b = document.getElementById('mem-salvar');
    if (b) { b.disabled = false; b.textContent = 'Salvar memória'; }
  }
}

async function memSugestao(i, aceitar) {
  const res = aceitar ? await api.post(`/memoria/sugestoes/${i}`, {}) : await api.delete(`/memoria/sugestoes/${i}`);
  const data = await res.json().catch(() => ({}));
  if (!res?.ok) { mostrarToast(data.erro || 'Não consegui salvar', 'erro'); return; }
  // Preserva o que estava digitado e não salvo
  const digitado = memColetar();
  memAplicar(data);
  if (aceitar) mostrarToast('Guardado na memória', 'sucesso');
  mem.dados = { ...mem.dados, ...Object.fromEntries(Object.entries(digitado).filter(([k, v]) => typeof v === 'string' && v && !mem.dados[k])) };
  memRenderMantendoRolagem();
}

async function memRitual(ativo) {
  const res = await api.put('/memoria/ritual', { ativo });
  const data = await res.json().catch(() => ({}));
  if (!res?.ok) { mostrarToast(data.erro || 'Não consegui salvar', 'erro'); const cb = document.getElementById('mem-ritual'); if (cb) cb.checked = !ativo; return; }
  mem.ritual = ativo;
  mostrarToast(ativo ? 'Você vai receber o resumo toda segunda-feira' : 'Resumo de segunda desligado', 'sucesso');
}

Object.assign(window, {
  ret, mem, retParaInput, retPendentesHoje, retAtualizar, brfRenderRetornos, retConcluir, retRemarcar,
  retSalvarRemarcar, retAbrirBriefing, retBlocoProximoPasso, retHome,
  mostrarMemoria, memAdicionar, memRemover, memSalvar, memSugestao, memRitual,
});
