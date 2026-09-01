// ═══════════════════════════════════════════════════════════════════════════════
// server.js — Servidor principal da plataforma May
// ═══════════════════════════════════════════════════════════════════════════════
require('dotenv').config();

// ─── Variáveis obrigatórias ────────────────────────────────────────────────
// Sem isso, o processo morria dentro do SDK do Supabase com "supabaseUrl is
// required" e o Railway ficava reiniciando em loop — sem dizer qual variável
// faltava. Aqui a falta aparece nomeada, na primeira linha do log.
const OBRIGATORIAS = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY'];
const faltando = OBRIGATORIAS.filter(k => !process.env[k]);
if (faltando.length) {
  console.error('═'.repeat(70));
  console.error('A May não pode iniciar: falta configurar variável de ambiente.');
  console.error('Faltando: ' + faltando.join(', '));
  console.error('Configure em Railway → serviço → aba Variables e faça o redeploy.');
  console.error('SUPABASE_URL e SUPABASE_SERVICE_KEY ficam em Supabase → Settings → API.');
  console.error('═'.repeat(70));
  process.exit(1);
}

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
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Rotas do frontend (ANTES do static para não ser interceptado) ─────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/landing.html'));
});
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});
// Cadastro e login: sem essas rotas, /register caía no fallback SPA, que servia
// o app, que redirecionava para /auth.html — e a query (?plano=anual) se perdia no caminho.
app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/auth.html'));
});
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/auth.html'));
});
// Link do e-mail de redefinição de senha. Sem esta rota o link caía no fallback
// SPA, que servia o app e mandava o usuário para /auth.html — perdendo o token.
app.get('/reset-password', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/auth.html'));
});
app.get('/manual', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/manual.html'));
});
app.get('/modulos', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/modulos.html'));
});
app.get('/ranking', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/ranking.html'));
});
app.get('/agenda', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/agenda.html'));
});
app.get('/leads', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/leads.html'));
});
app.get('/gestor', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/gestor.html'));
});
app.get('/ranking-vendas', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/ranking-vendas.html'));
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
app.use('/api/cielo',  require('./routes/cielo'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/export', require('./routes/export'));
app.use('/api/areas',   require('./routes/areas'));
app.use('/api/2fa',          require('./routes/twofa'));
app.use('/api/notificacoes', require('./routes/notificacoes'));
app.use('/api/trilha',      require('./routes/trilha'));
app.use('/api/leads',       require('./routes/leads'));
app.use('/api/followups',   require('./routes/followups'));
app.use('/api/public',      require('./routes/public'));
app.use('/api/stripe',      require('./routes/stripe'));
app.use('/api/modulos',        require('./routes/modulos'));
app.use('/api/ranking-vendas', require('./routes/ranking-vendas'));

// ─── Health check ──────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  // `cielo` não expõe segredo nenhum — só diz se a credencial existe e em que
  // ambiente ela aponta. Cartão real recusado em 'sandbox' é o esperado.
  const { cieloStatus } = require('./services/cielo');
  res.json({
    status:    'ok',
    timestamp: new Date().toISOString(),
    cielo:     cieloStatus(),
  });
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

    // Lembretes de reunião: toda hora, verifica reuniões na próxima 1h
    try {
      const { supabase } = require('./services/supabase');
      const agora   = new Date();
      const em1h    = new Date(agora.getTime() + 60 * 60 * 1000);
      const { data: reunioes } = await supabase
        .from('leads')
        .select('id, nome_lead, closer_id, data_reuniao, local_reuniao')
        .eq('status', 'reuniao_agendada')
        .eq('lembrete_enviado', false)
        .gte('data_reuniao', agora.toISOString())
        .lte('data_reuniao', em1h.toISOString());

      for (const r of (reunioes || [])) {
        if (!r.closer_id) continue;
        const { data: sub } = await supabase
          .from('push_subscriptions')
          .select('subscription')
          .eq('user_id', r.closer_id)
          .limit(1)
          .single();

        if (sub?.subscription) {
          const horario = new Date(r.data_reuniao).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
          await fetch(`http://localhost:${PORT}/api/notificacoes/enviar-direto`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-cron-secret': process.env.CRON_SECRET },
            body: JSON.stringify({
              user_id: r.closer_id,
              titulo:  `🎯 Reunião em breve — ${r.nome_lead}`,
              corpo:   `Sua reunião está marcada para ${horario}${r.local_reuniao ? ` · ${r.local_reuniao}` : ''}. Abra o briefing agora.`,
            }),
          }).catch(() => {});
        }

        // Marca como lembrete enviado para não duplicar
        await supabase.from('leads').update({ lembrete_enviado: true }).eq('id', r.id);
      }
    } catch (e) {
      console.error('Cron lembretes reunião:', e.message);
    }

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
