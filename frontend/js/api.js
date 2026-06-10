// ─── api.js — Cliente HTTP com refresh automático de token ────────────────────

const API_BASE = '/api';

// ─── Gerenciamento de tokens ────────────────────────────────────────────────

function salvarTokens(accessToken, refreshToken) {
  localStorage.setItem('may_access', accessToken);
  if (refreshToken) localStorage.setItem('may_refresh', refreshToken);
}

function getAccessToken() { return localStorage.getItem('may_access'); }
function getRefreshToken() { return localStorage.getItem('may_refresh'); }

function limparTokens() {
  localStorage.removeItem('may_access');
  localStorage.removeItem('may_refresh');
  localStorage.removeItem('may_user');
}

function salvarUser(user) {
  localStorage.setItem('may_user', JSON.stringify(user));
}
function getUser() {
  try { return JSON.parse(localStorage.getItem('may_user')); } catch { return null; }
}

// ─── Refresh de token ───────────────────────────────────────────────────────

let refreshando = false;
let filaRefresh = [];

async function refreshToken() {
  if (refreshando) {
    return new Promise((resolve, reject) => filaRefresh.push({ resolve, reject }));
  }

  refreshando = true;
  const rt = getRefreshToken();

  if (!rt) {
    refreshando = false;
    throw new Error('Sem refresh token');
  }

  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt }),
    });

    if (!res.ok) throw new Error('Refresh falhou');

    const data = await res.json();
    salvarTokens(data.accessToken, data.refreshToken);
    filaRefresh.forEach(p => p.resolve(data.accessToken));
    filaRefresh = [];
    return data.accessToken;
  } catch (err) {
    filaRefresh.forEach(p => p.reject(err));
    filaRefresh = [];
    limparTokens();
    window.location.href = '/auth.html';
    throw err;
  } finally {
    refreshando = false;
  }
}

// ─── Fetch com autenticação automática ─────────────────────────────────────

async function apiFetch(url, options = {}) {
  const token = getAccessToken();

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  let res = await fetch(`${API_BASE}${url}`, { ...options, headers });

  // Se expirado, tenta refresh
  if (res.status === 401) {
    const body = await res.json().catch(() => ({}));
    if (body.code === 'TOKEN_EXPIRADO') {
      try {
        const novoToken = await refreshToken();
        headers.Authorization = `Bearer ${novoToken}`;
        res = await fetch(`${API_BASE}${url}`, { ...options, headers });
      } catch {
        return null;
      }
    }
  }

  return res;
}

// ─── Métodos utilitários ────────────────────────────────────────────────────

const api = {
  get:    (url)         => apiFetch(url, { method: 'GET' }),
  delete: (url)         => apiFetch(url, { method: 'DELETE' }),
  post:   (url, body)   => apiFetch(url, { method: 'POST',  body: JSON.stringify(body) }),
  put:    (url, body)   => apiFetch(url, { method: 'PUT',   body: JSON.stringify(body) }),
  patch:  (url, body)   => apiFetch(url, { method: 'PATCH', body: JSON.stringify(body) }),

  // Upload de arquivo (multipart)
  upload: (url, formData) => {
    const token = getAccessToken();
    return fetch(`${API_BASE}${url}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
  },

  // Streaming SSE para o chat
  stream: async (url, body, onChunk, onDone, onError) => {
    const token = getAccessToken();
    try {
      const res = await fetch(`${API_BASE}${url}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ erro: 'Erro desconhecido' }));
        onError(err.erro || 'Erro ao enviar mensagem');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const linhas = buffer.split('\n');
        buffer = linhas.pop(); // guarda linha incompleta

        for (const linha of linhas) {
          if (!linha.startsWith('data: ')) continue;
          try {
            const evento = JSON.parse(linha.slice(6));
            if (evento.tipo === 'texto')            onChunk(evento.conteudo);
            if (evento.tipo === 'conversa_criada')  onDone(evento, 'conversa_criada');
            if (evento.tipo === 'fim')              onDone(evento, 'fim');
            if (evento.tipo === 'erro')             onError(evento.mensagem);
          } catch { /* ignora linha malformada */ }
        }
      }
    } catch (err) {
      onError('Erro de conexão. Verifique sua internet.');
    }
  }
};

// Exporta para uso global
window.api = api;
window.salvarTokens = salvarTokens;
window.salvarUser = salvarUser;
window.getUser = getUser;
window.limparTokens = limparTokens;
window.getAccessToken = getAccessToken;
