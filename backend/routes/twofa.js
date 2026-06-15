// ─── Rotas de 2FA (TOTP via Google Authenticator / Authy) ──────────────────
const express   = require('express');
const router    = express.Router();
const speakeasy = require('speakeasy');
const QRCode    = require('qrcode');
const { supabase } = require('../services/supabase');
const { authMiddleware } = require('../middleware/auth');
const { registrarAuditoria } = require('../middleware/auditLog');

// ─── POST /api/2fa/setup ────────────────────────────────────────────────────
// Gera o secret e retorna QR code para o usuário escanear no app
router.post('/setup', authMiddleware, async (req, res) => {
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
    await supabase
      .from('users')
      .update({ totp_secret: secretObj.base32 })
      .eq('id', user.id);

    res.json({ secret: secretObj.base32, qrDataUrl });
  } catch (err) {
    console.error('Erro no setup 2FA:', err.message);
    res.status(500).json({ erro: 'Erro ao configurar 2FA.' });
  }
});

// ─── POST /api/2fa/ativar ───────────────────────────────────────────────────
// Verifica o código do app e ativa o 2FA
router.post('/ativar', authMiddleware, async (req, res) => {
  try {
    const { codigo } = req.body;
    const user = req.user;

    if (!codigo) return res.status(400).json({ erro: 'Código obrigatório.' });
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

    await supabase
      .from('users')
      .update({ totp_enabled: true })
      .eq('id', user.id);

    await registrarAuditoria({ userId: user.id, acao: '2fa_ativado', req });

    res.json({ mensagem: '2FA ativado com sucesso.' });
  } catch (err) {
    console.error('Erro ao ativar 2FA:', err.message);
    res.status(500).json({ erro: 'Erro ao ativar 2FA.' });
  }
});

// ─── POST /api/2fa/desativar ────────────────────────────────────────────────
// Desativa o 2FA (exige código atual para confirmar)
router.post('/desativar', authMiddleware, async (req, res) => {
  try {
    const { codigo } = req.body;
    const user = req.user;

    if (!user.totp_enabled) return res.status(400).json({ erro: '2FA não está ativo.' });
    if (!codigo) return res.status(400).json({ erro: 'Código obrigatório para desativar.' });

    const { data: u } = await supabase
      .from('users')
      .select('totp_secret')
      .eq('id', user.id)
      .single();

    const valido = speakeasy.totp.verify({ secret: u.totp_secret, encoding: 'base32', token: codigo, window: 1 });
    if (!valido) return res.status(401).json({ erro: 'Código inválido.' });

    await supabase
      .from('users')
      .update({ totp_enabled: false, totp_secret: null })
      .eq('id', user.id);

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
router.post('/validar', async (req, res) => {
  try {
    const { temp_token, codigo } = req.body;
    if (!temp_token || !codigo) {
      return res.status(400).json({ erro: 'Token temporário e código são obrigatórios.' });
    }

    // Verifica o temp_token (JWT de 5 minutos emitido no login)
    let payload;
    try {
      const jwt = require('jsonwebtoken');
      payload = jwt.verify(temp_token, process.env.JWT_SECRET);
      if (payload.tipo !== '2fa_pendente') throw new Error('tipo inválido');
    } catch {
      return res.status(401).json({ erro: 'Token inválido ou expirado. Faça login novamente.' });
    }

    const { data: user } = await supabase
      .from('users')
      .select('id, email, name, plano, totp_secret, totp_enabled, refresh_token')
      .eq('id', payload.id)
      .single();

    if (!user || !user.totp_enabled || !user.totp_secret) {
      return res.status(401).json({ erro: 'Usuário inválido.' });
    }

    const valido = speakeasy.totp.verify({ secret: user.totp_secret, encoding: 'base32', token: codigo, window: 1 });
    if (!valido) return res.status(401).json({ erro: 'Código incorreto.' });

    // Emite os tokens definitivos
    const jwt = require('jsonwebtoken');
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

    await supabase.from('users').update({ refresh_token: refreshToken }).eq('id', user.id);
    await registrarAuditoria({ userId: user.id, acao: '2fa_login_ok', req });

    const { totp_secret, ...userPublic } = user;
    res.json({ accessToken, refreshToken, user: userPublic });
  } catch (err) {
    console.error('Erro ao validar 2FA:', err.message);
    res.status(500).json({ erro: 'Erro ao validar código.' });
  }
});

module.exports = router;
