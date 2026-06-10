// ─── Rotas de autenticação ─────────────────────────────────────────────────────
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../services/supabase');
const { Resend } = require('resend');

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
    const { name, email, password } = req.body;

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

    const password_hash = await bcrypt.hash(password, 12);
    const verify_token = uuidv4();

    const { data: user, error } = await supabase
      .from('users')
      .insert({
        name,
        email: email.toLowerCase(),
        password_hash,
        verify_token,
        plano: 'free',
      })
      .select('id, email, name, plano')
      .single();

    if (error) throw error;

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
      .select('id, email, name, password_hash, plano, plano_status, plano_fim, diagnostico_completo, nicho, produto, publico_alvo, nivel, maior_dificuldade')
      .eq('email', email.toLowerCase())
      .single();

    if (error || !user) {
      return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
    }

    const senhaCorreta = await bcrypt.compare(password, user.password_hash);
    if (!senhaCorreta) {
      return res.status(401).json({ erro: 'E-mail ou senha incorretos.' });
    }

    const accessToken  = gerarAccessToken(user);
    const refreshToken = gerarRefreshToken(user);

    await supabase.from('users').update({ refresh_token: refreshToken }).eq('id', user.id);

    const { password_hash, ...userPublic } = user;
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

module.exports = router;
