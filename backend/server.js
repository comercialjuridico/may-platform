// ═══════════════════════════════════════════════════════════════════════════════
// server.js — Servidor principal da plataforma May
// ═══════════════════════════════════════════════════════════════════════════════
require('dotenv').config();

const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');
const compression  = require('compression');
const path         = require('path');

const app = express();

// ─── Compressão gzip ───────────────────────────────────────────────────────
app.use(compression());

// ─── Segurança ──────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // Configurar CSP separadamente em produção
}));

app.use(cors({
  origin: process.env.APP_URL || '*',
  credentials: true,
}));

// Rate limiting geral
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 200,
  message: { erro: 'Muitas requisições. Tente novamente em 15 minutos.' },
});
app.use('/api/', limiter);

// Rate limiting estrito para auth
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { erro: 'Muitas tentativas de login. Aguarde 15 minutos.' },
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// ─── Body Parser ───────────────────────────────────────────────────────────
// ATENÇÃO: o webhook do Stripe precisa do raw body — montamos antes do json()
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Rotas do frontend (ANTES do static para não ser interceptado) ─────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/landing.html'));
});
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ─── Arquivos estáticos (frontend) ─────────────────────────────────────────
// Cache longo para assets imutáveis (js/css/imgs com hash no nome)
app.use('/assets', express.static(path.join(__dirname, '../frontend/assets'), {
  maxAge: '30d',
  immutable: true,
}));
app.use('/css', express.static(path.join(__dirname, '../frontend/css'), {
  maxAge: '1d',
}));
app.use('/js', express.static(path.join(__dirname, '../frontend/js'), {
  maxAge: '1d',
}));
app.use(express.static(path.join(__dirname, '../frontend'), {
  maxAge: '1h',
}));

// ─── Rotas da API ──────────────────────────────────────────────────────────
app.use('/api/auth',   require('./routes/auth'));
app.use('/api/chat',   require('./routes/chat'));
app.use('/api/user',   require('./routes/user'));
app.use('/api/stripe', require('./routes/stripe'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/export', require('./routes/export'));
app.use('/api/gestor', require('./routes/gestor'));
app.use('/api/vendas',   require('./routes/vendas'));
app.use('/api/areas',   require('./routes/areas'));
app.use('/api/ranking', require('./routes/ranking'));
app.use('/api/metas',  require('./routes/metas'));
app.use('/api/2fa',          require('./routes/twofa'));
app.use('/api/notificacoes', require('./routes/notificacoes'));

// ─── Health check ──────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Fallback SPA ──────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ erro: 'Rota não encontrada.' });
  }
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ─── Tratamento global de erros ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Erro não tratado:', err.message);
  res.status(500).json({ erro: 'Erro interno do servidor.' });
});

// ─── Inicialização ──────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✓ May rodando na porta ${PORT}`);
  console.log(`✓ Ambiente: ${process.env.NODE_ENV || 'development'}`);
  iniciarCronPush();
});

// ─── Cron de notificações push ───────────────────────────────────────────────
function iniciarCronPush() {
  if (!process.env.CRON_SECRET || !process.env.VAPID_PUBLIC_KEY) return;

  // Verifica a cada 1 hora se é hora de disparar
  setInterval(async () => {
    const agora    = new Date();
    const hora     = agora.getUTCHours(); // UTC — ajuste para BRT (UTC-3): hora 12 UTC = 9h BRT
    const diaSem   = agora.getUTCDay();   // 0=dom, 1=seg

    // Push diário: 12h UTC (9h BRT), todos os dias
    if (hora === 12) {
      try {
        const res = await fetch(`http://localhost:${PORT}/api/notificacoes/enviar-cron`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-cron-secret': process.env.CRON_SECRET },
          body: JSON.stringify({ tipo: diaSem === 1 ? 'semanal' : 'diario' }),
        });
        const data = await res.json();
        console.log(`✓ Push ${diaSem === 1 ? 'semanal' : 'diário'}: ${data.enviados} enviados`);
      } catch (err) {
        console.error('Erro no cron push:', err.message);
      }
    }
  }, 60 * 60 * 1000); // a cada 1 hora
}

module.exports = app;
