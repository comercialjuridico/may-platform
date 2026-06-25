// ─── Rotas de autenticação ─────────────────────────────────────────────────────
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../services/supabase');
const { Resend } = require('resend');
const { registrarAuditoria } = require('../middleware/auditLog');

const resend = new Resend(process.env.RESEND_API_KEY);

// Gera access token (curta duração)
function gerarAccessToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, plano: user.plano },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );
}

// Gera refresh token (longa duração)
function gerarRefreshToken(user) {
  return jwt.sign(
    { id: user.id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' }
  );
}

// ─── POST /api/auth/register ────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, convite_token } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ erro: 'Nome, e-mail e senha são obrigatórios.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ erro: 'A senha deve ter no mínimo 8 caracteres.' });
    }

    // Verifica se e-mail já existe
    const { data: existente } = await supabase
      .from('users')
      .select('id')
      .eq('email', email.toLowerCase())
      .single();

    if (existente) {
      return res.status(409).json({ erro: 'Este e-mail já está cadastrado.' });
    }

    // Valida convite (se fornecido)
    let conviteData = null;
    if (convite_token) {
      const { data: convite } = await supabase
        .from('convites')
        .select('id, empresa_id, email, aceito')
        .eq('token', convite_token)
        .single();

      if (convite && !convite.aceito) {
        conviteData = convite;
      }
    }

    const password_hash = await bcrypt.hash(password, 12);
    const verify_token = uuidv4();

    const novoUsuario = {
      name,
      email: email.toLowerCase(),
      password_hash,
      verify_token,
      plano: 'free',
    };

    // Vincula à empresa do convite
    if (conviteData) {
      novoUsuario.empresa_id = conviteData.empresa_id;
      novoUsuario.role = 'membro';
    }

    const { data: user, error } = await supabase
      .from('users')
      .insert(novoUsuario)
      .select('id, email, name, plano, role, empresa_id')
      .single();

    if (error) throw error;

    // Marca convite como aceito
    if (conviteData) {
      await supabase.from('convites')
        .update({ aceito: true })
        .eq('id', conviteData.id);
    }

    // Cria registro de streak inicial
    await supabase.from('streak').insert({ user_id: user.id });

    // Envia e-mail de verificação
    await resend.emails.send({
      from: `${process.env.EMAIL_FROM_NAME} <${process.env.EMAIL_FROM}>`,
      to: user.email,
      subject: 'Confirme seu e-mail — May',
      html: `
        <h2>Bem-vindo(a) à May!</h2>
        <p>Clique no link abaixo para confirmar seu e-mail:</p>
        <a href="${process.env.APP_URL}/api/auth/verify/${verify_token}">Confirmar e-mail</a>
        <p>O link expira em 24 horas.</p>
      `,
    });

    const accessToken  = gerarAccessToken(user);
    const refreshToken = gerarRefreshToken(user);

    await supabase.from('users').update({ refresh_token: refreshToken }).eq('id', user.id);

    res.status(201).json({
      mensagem: 'Conta criada. Verifique seu e-mail.',
      accessToken,
      refreshToken,
      user: { id: user.id, name: user.name, email: user.email, plano: user.plano, diagnostico_completo: false },
    });
  } catch (err) {
    console.error('Erro no registro:', err.message);
    res.status(500).json({ erro: 'Erro ao criar conta.' });
  }
});

// ─── POST /api/auth/login ───────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ erro: 'E-mail e senha são obrigatórios.' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, name, password_hash, plano, plano_status, plano_fim, diagnostico_completo, nicho, produto, publico_alvo, nivel, maior_dificuldade, totp_enabled')
      .eq('email', email.toLowerCase())
      .single();

    if (error || !user) {
      return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
    }

    const senhaCorreta = await bcrypt.compare(password, user.password_hash);
    if (!senhaCorreta) {
      return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
    }

    // Se 2FA está ativo, retorna token temporário (5 min) para segunda etapa
    if (user.totp_enabled) {
      const tempToken = jwt.sign(
        { id: user.id, tipo: '2fa_pendente' },
        process.env.JWT_SECRET,
        { expiresIn: '5m' }
      );
      return res.json({ requires_2fa: true, temp_token: tempToken });
    }

    const accessToken  = gerarAccessToken(user);
    const refreshToken = gerarRefreshToken(user);

    await supabase.from('users').update({ refresh_token: refreshToken }).eq('id', user.id);

    const { password_hash, totp_enabled, ...userPublic } = user;

    await registrarAuditoria({ userId: user.id, acao: 'login', req });

    res.json({ accessToken, refreshToken, user: userPublic });
  } catch (err) {
    console.error('Erro no login:', err.message);
    res.status(500).json({ erro: 'Erro ao fazer login.' });
  }
});

// ─── POST /api/auth/refresh ─────────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ erro: 'Refresh token não fornecido.' });

    let payload;
    try {
      payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch {
      return res.status(401).json({ erro: 'Refresh token inválido ou expirado.' });
    }

    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, name, plano, refresh_token')
      .eq('id', payload.id)
      .single();

    if (error || !user || user.refresh_token !== refreshToken) {
      return res.status(401).json({ erro: 'Refresh token inválido.' });
    }

    const novoAccessToken  = gerarAccessToken(user);
    const novoRefreshToken = gerarRefreshToken(user);

    await supabase.from('users').update({ refresh_token: novoRefreshToken }).eq('id', user.id);

    res.json({ accessToken: novoAccessToken, refreshToken: novoRefreshToken });
  } catch (err) {
    console.error('Erro no refresh:', err.message);
    res.status(500).json({ erro: 'Erro ao renovar token.' });
  }
});

// ─── POST /api/auth/forgot-password ────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ erro: 'E-mail obrigatório.' });

    const { data: user } = await supabase
      .from('users')
      .select('id, name')
      .eq('email', email.toLowerCase())
      .single();

    // Sempre retorna sucesso para não revelar se o e-mail existe
    if (!user) return res.json({ mensagem: 'Se o e-mail existir, você receberá as instruções.' });

    const resetToken = uuidv4();
    const resetExp   = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

    await supabase.from('users').update({
      reset_token: resetToken,
      reset_token_exp: resetExp.toISOString(),
    }).eq('id', user.id);

    await resend.emails.send({
      from: `${process.env.EMAIL_FROM_NAME} <${process.env.EMAIL_FROM}>`,
      to: email,
      subject: 'Redefinição de senha — May',
      html: `
        <h2>Redefinição de senha</h2>
        <p>Clique no link abaixo para redefinir sua senha:</p>
        <a href="${process.env.APP_URL}/reset-password?token=${resetToken}">Redefinir senha</a>
        <p>O link expira em 1 hora. Se não solicitou, ignore este e-mail.</p>
      `,
    });

    res.json({ mensagem: 'Se o e-mail existir, você receberá as instruções.' });
  } catch (err) {
    console.error('Erro no forgot-password:', err.message);
    res.status(500).json({ erro: 'Erro ao processar solicitação.' });
  }
});

// ─── POST /api/auth/reset-password ─────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ erro: 'Token e senha são obrigatórios.' });
    if (password.length < 8) return res.status(400).json({ erro: 'Senha deve ter no mínimo 8 caracteres.' });

    const { data: user } = await supabase
      .from('users')
      .select('id, reset_token_exp')
      .eq('reset_token', token)
      .single();

    if (!user) return res.status(400).json({ erro: 'Token inválido.' });
    if (new Date(user.reset_token_exp) < new Date()) {
      return res.status(400).json({ erro: 'Token expirado. Solicite um novo.' });
    }

    const password_hash = await bcrypt.hash(password, 12);
    await supabase.from('users').update({
      password_hash,
      reset_token: null,
      reset_token_exp: null,
    }).eq('id', user.id);

    res.json({ mensagem: 'Senha redefinida com sucesso.' });
  } catch (err) {
    console.error('Erro no reset-password:', err.message);
    res.status(500).json({ erro: 'Erro ao redefinir senha.' });
  }
});

// ─── GET /api/auth/convite/:token ───────────────────────────────────────────
// Valida token de convite e retorna info da empresa (público, sem auth)
router.get('/convite/:token', async (req, res) => {
  try {
    const { data: convite, error } = await supabase
      .from('convites')
      .select('email, aceito, empresa_id, empresas(nome)')
      .eq('token', req.params.token)
      .single();

    if (error || !convite) {
      return res.status(404).json({ erro: 'Convite não encontrado ou expirado.' });
    }
    if (convite.aceito) {
      return res.status(410).json({ erro: 'Este convite já foi utilizado.' });
    }

    res.json({
      valido: true,
      email: convite.email,
      empresa_nome: convite.empresas?.nome || 'May',
    });
  } catch (err) {
    console.error('Erro ao validar convite:', err.message);
    res.status(500).json({ erro: 'Erro ao validar convite.' });
  }
});

// ─── GET /api/auth/verify/:token ────────────────────────────────────────────
router.get('/verify/:token', async (req, res) => {
  try {
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('verify_token', req.params.token)
      .single();

    if (!user) return res.redirect(`${process.env.APP_URL}/auth.html?erro=token_invalido`);

    await supabase.from('users').update({
      email_verificado: true,
      verify_token: null,
    }).eq('id', user.id);

    res.redirect(`${process.env.APP_URL}/auth.html?verificado=1`);
  } catch (err) {
    res.redirect(`${process.env.APP_URL}/auth.html?erro=erro_verificacao`);
  }
});

// ─── POST /api/auth/logout ──────────────────────────────────────────────────
router.post('/logout', async (req, res) => {
  try {
    const header = req.headers.authorization;
    if (header && header.startsWith('Bearer ')) {
      const token = header.split(' ')[1];
      try {
        const payload = require('jsonwebtoken').verify(token, process.env.JWT_SECRET);
        // Invalida o refresh token no banco (revogação)
        await supabase.from('users').update({ refresh_token: null }).eq('id', payload.id);
        await registrarAuditoria({ userId: payload.id, acao: 'logout', req });
      } catch {
        // Token já inválido — tudo bem, continua logout
      }
    }
    res.json({ mensagem: 'Logout realizado.' });
  } catch (err) {
    console.error('Erro no logout:', err.message);
    res.status(500).json({ erro: 'Erro ao fazer logout.' });
  }
});

module.exports = router;
