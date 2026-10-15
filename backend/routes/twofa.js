// ─── Rotas de 2FA (TOTP via Google Authenticator / Authy) ──────────────────
const express   = require('express');
const router    = express.Router();
const speakeasy = require('speakeasy');
const QRCode    = require('qrcode');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { supabase } = require('../services/supabase');
const { authMiddleware } = require('../middleware/auth');
const { registrarAuditoria } = require('../middleware/auditLog');

const limitarPorConta = rateLimit({
  windowMs: 5 * 60 * 1000, max: 10,
  keyGenerator: req => req.user?.id || req.totpUserId,
  message: { erro: 'Muitas tentativas de 2FA. Aguarde 5 minutos.' },
});
router.use(rateLimit({
  windowMs: 5 * 60 * 1000, max: 30,
  message: { erro: 'Muitas tentativas de 2FA. Aguarde 5 minutos.' },
}));

function codigoValido(codigo) {
  return typeof codigo === 'string' && /^\d{6}$/.test(codigo);
}

function autenticarSegundaEtapa(req, res, next) {
  try {
    if (typeof req.body?.temp_token !== 'string') throw new Error('token inválido');
    const payload = jwt.verify(req.body.temp_token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (payload.tipo !== '2fa_pendente' || typeof payload.id !== 'string') throw new Error('tipo inválido');
    req.totpUserId = payload.id;
    next();
  } catch {
    res.status(401).json({ erro: 'Token inválido ou expirado. Faça login novamente.' });
  }
}

// ─── POST /api/2fa/setup ────────────────────────────────────────────────────
// Gera o secret e retorna QR code para o usuário escanear no app
router.post('/setup', authMiddleware, limitarPorConta, async (req, res) => {
  try {
    const user = req.user;

    if (user.totp_enabled) {
      return res.status(400).json({ erro: '2FA já está ativado para esta conta.' });
    }

    const secretObj = speakeasy.generateSecret({ length: 20, name: `May:${user.email}` });
    const otpauth = speakeasy.otpauthURL({
      secret: secretObj.base32,
      label: `May:${user.email}`,
      issuer: 'May App',
      encoding: 'base32',
    });

    const qrDataUrl = await QRCode.toDataURL(otpauth, {
      width: 200,
      margin: 1,
      color: { dark: '#E8E4FF', light: '#080B1A' },
    });

    // Salva o secret temporariamente (não ativado ainda — ativação exige verificação)
    const { data: salvo, error } = await supabase
      .from('users')
      .update({ totp_secret: secretObj.base32 })
      .eq('id', user.id)
      .or('totp_enabled.is.null,totp_enabled.eq.false')
      .select('id').maybeSingle();
    if (error) throw error;
    if (!salvo) return res.status(409).json({ erro: '2FA já está ativo. Atualize sua sessão.' });

    res.json({ secret: secretObj.base32, qrDataUrl });
  } catch (err) {
    console.error('Erro no setup 2FA:', err.message);
    res.status(500).json({ erro: 'Erro ao configurar 2FA.' });
  }
});

// ─── POST /api/2fa/ativar ───────────────────────────────────────────────────
// Verifica o código do app e ativa o 2FA
router.post('/ativar', authMiddleware, limitarPorConta, async (req, res) => {
  try {
    const { codigo } = req.body;
    const user = req.user;

    if (!codigoValido(codigo)) return res.status(400).json({ erro: 'Informe o código de 6 dígitos.' });
    if (user.totp_enabled) return res.status(400).json({ erro: '2FA já está ativo.' });

    // Busca o secret salvo no setup
    const { data: u } = await supabase
      .from('users')
      .select('totp_secret')
      .eq('id', user.id)
      .single();

    if (!u?.totp_secret) {
      return res.status(400).json({ erro: 'Inicie o setup primeiro.' });
    }

    const valido = speakeasy.totp.verify({ secret: u.totp_secret, encoding: 'base32', token: codigo, window: 1 });
    if (!valido) {
      return res.status(401).json({ erro: 'Código inválido. Tente novamente.' });
    }

    const { data: ativado, error } = await supabase
      .from('users')
      .update({ totp_enabled: true, refresh_token: null })
      .eq('id', user.id).eq('totp_secret', u.totp_secret)
      .or('totp_enabled.is.null,totp_enabled.eq.false')
      .select('id').maybeSingle();
    if (error) throw error;
    if (!ativado) return res.status(409).json({ erro: 'Configuração alterada. Reinicie a ativação.' });

    await registrarAuditoria({ userId: user.id, acao: '2fa_ativado', req });

    res.json({ mensagem: '2FA ativado com sucesso.' });
  } catch (err) {
    console.error('Erro ao ativar 2FA:', err.message);
    res.status(500).json({ erro: 'Erro ao ativar 2FA.' });
  }
});

// ─── POST /api/2fa/desativar ────────────────────────────────────────────────
// Desativa o 2FA (exige código atual para confirmar)
router.post('/desativar', authMiddleware, limitarPorConta, async (req, res) => {
  try {
    const { codigo } = req.body;
    const user = req.user;

    if (!user.totp_enabled) return res.status(400).json({ erro: '2FA não está ativo.' });
    if (!codigoValido(codigo)) return res.status(400).json({ erro: 'Informe o código de 6 dígitos.' });

    const { data: u } = await supabase
      .from('users')
      .select('totp_secret')
      .eq('id', user.id)
      .single();

    if (!u?.totp_secret) return res.status(409).json({ erro: 'Configuração de 2FA indisponível.' });
    const valido = speakeasy.totp.verify({ secret: u.totp_secret, encoding: 'base32', token: codigo, window: 1 });
    if (!valido) return res.status(401).json({ erro: 'Código inválido.' });

    const { data: desativado, error } = await supabase
      .from('users')
      .update({ totp_enabled: false, totp_secret: null, refresh_token: null })
      .eq('id', user.id).eq('totp_secret', u.totp_secret).eq('totp_enabled', true)
      .select('id').maybeSingle();
    if (error) throw error;
    if (!desativado) return res.status(409).json({ erro: 'Configuração alterada. Atualize sua sessão.' });

    await registrarAuditoria({ userId: user.id, acao: '2fa_desativado', req });

    res.json({ mensagem: '2FA desativado.' });
  } catch (err) {
    console.error('Erro ao desativar 2FA:', err.message);
    res.status(500).json({ erro: 'Erro ao desativar 2FA.' });
  }
});

// ─── POST /api/2fa/validar ──────────────────────────────────────────────────
// Valida o código TOTP durante o login (segunda etapa)
// Espera { temp_token, codigo } — temp_token é gerado no login quando 2FA está ativo
router.post('/validar', autenticarSegundaEtapa, limitarPorConta, async (req, res) => {
  try {
    const { temp_token, codigo } = req.body;
    if (!temp_token || !codigoValido(codigo)) {
      return res.status(400).json({ erro: 'Token temporário e código são obrigatórios.' });
    }

    const { data: user } = await supabase
      .from('users')
      .select('id, email, name, plano, totp_secret, totp_enabled')
      .eq('id', req.totpUserId)
      .single();

    if (!user || !user.totp_enabled || !user.totp_secret) {
      return res.status(401).json({ erro: 'Usuário inválido.' });
    }

    const valido = speakeasy.totp.verify({ secret: user.totp_secret, encoding: 'base32', token: codigo, window: 1 });
    if (!valido) return res.status(401).json({ erro: 'Código incorreto.' });

    // Emite os tokens definitivos
    const accessToken = jwt.sign(
      { id: user.id, email: user.email, plano: user.plano },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
    );
    const refreshToken = jwt.sign(
      { id: user.id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' }
    );

    const { error } = await supabase.from('users').update({ refresh_token: refreshToken }).eq('id', user.id);
    if (error) throw error;
    await registrarAuditoria({ userId: user.id, acao: '2fa_login_ok', req });

    const { totp_secret, ...userPublic } = user;
    res.json({ accessToken, refreshToken, user: userPublic });
  } catch (err) {
    console.error('Erro ao validar 2FA:', err.message);
    res.status(500).json({ erro: 'Erro ao validar código.' });
  }
});

module.exports = router;
