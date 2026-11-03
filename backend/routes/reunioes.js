// ─── Reuniões com IA — sala própria da May, gravação, transcrição e nota ──────
// Módulo opcional (ver routes/modulos.js, id "reunioes_ia"): gera a sala no
// Daily.co, guarda o link e o registro, e manda o convite pro cliente. A
// transcrição e a nota por IA acontecem depois que a chamada termina (job
// separado lê a gravação pronta e roda Whisper + GPT em cima dela).
const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { Resend }         = require('resend');
const { supabase }       = require('../services/supabase');
const { authMiddleware } = require('../middleware/auth');
const daily = require('../services/daily');
const { transcrever }     = require('../services/transcricao');
const { analisarReuniao } = require('../services/analiseReuniao');
const { exigirAcessoAtivo } = require('../services/recursos');
const { limiteReuniao, limiteConviteEmail } = require('../services/limiteIA');

// O room_url salvo traz o token de anfitrião (?t=...), que inicia a gravação
// e dá poderes de dono da sala. Esse link é só de quem criou a reunião; o
// cliente recebe a sala sem token.
function linkConvidado(roomUrl) {
  try { const u = new URL(roomUrl); u.search = ''; u.hash = ''; return u.toString(); }
  catch { return null; }
}
function comLinkConvidado(reuniao) {
  return reuniao ? { ...reuniao, room_url_convidado: linkConvidado(reuniao.room_url) } : reuniao;
}
function escaparHtml(v) {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const EMAIL_VALIDO = /^[^\s@<>"',;]{1,64}@[^\s@<>"',;]{1,190}\.[a-z]{2,24}$/i;

const resend = new Resend(process.env.RESEND_API_KEY);

function semEmpresa(req, res) {
  if (req.user.empresa_id) return false;
  res.status(400).json({
    erro: 'Sua conta ainda não está vinculada a um escritório. Saia e entre de novo, ou fale com o suporte.',
    code: 'SEM_EMPRESA',
  });
  return true;
}

// ─── GET /api/reunioes ─────────────────────────────────────────────────────────
// Histórico de reuniões do escritório, mais recentes primeiro.
router.get('/', authMiddleware, async (req, res) => {
  try {
    if (semEmpresa(req, res)) return;

    const { data, error } = await supabase
      .from('reunioes_ia')
      .select('*')
      .eq('empresa_id', req.user.empresa_id)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;
    res.json({ reunioes: (data || []).map(comLinkConvidado) });
  } catch (err) {
    console.error('Erro GET /reunioes:', err.message);
    res.status(500).json({ erro: 'Erro ao buscar reuniões.' });
  }
});

// ─── GET /api/reunioes/:id ─────────────────────────────────────────────────────
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    if (semEmpresa(req, res)) return;

    const { data, error } = await supabase
      .from('reunioes_ia')
      .select('*')
      .eq('id', req.params.id)
      .eq('empresa_id', req.user.empresa_id)
      .single();

    if (error || !data) return res.status(404).json({ erro: 'Reunião não encontrada.' });
    res.json({ reuniao: comLinkConvidado(data) });
  } catch (err) {
    console.error('Erro GET /reunioes/:id:', err.message);
    res.status(500).json({ erro: 'Erro ao buscar reunião.' });
  }
});

// ─── POST /api/reunioes ─────────────────────────────────────────────────────────
// Cria a sala no Daily.co e salva o registro. Devolve o link pronto pra mandar
// pro cliente (ver POST /:id/convite abaixo).
router.post('/', authMiddleware, exigirAcessoAtivo, limiteReuniao, async (req, res) => {
  try {
    if (semEmpresa(req, res)) return;
    if (!process.env.DAILY_API_KEY) {
      return res.status(500).json({ erro: 'Módulo de reuniões ainda não configurado (falta DAILY_API_KEY no servidor).' });
    }

    const { titulo, cliente_nome, cliente_telefone, produto_servico } = req.body;
    if (!titulo) return res.status(400).json({ erro: 'Título da reunião é obrigatório.' });

    const nomeSala = `may-${uuidv4().slice(0, 8)}`;
    const sala = await daily.criarSala({ nomeSala });

    const { data, error } = await supabase
      .from('reunioes_ia')
      .insert({
        empresa_id:       req.user.empresa_id,
        criado_por:       req.user.id,
        titulo,
        cliente_nome:     cliente_nome || null,
        cliente_telefone: cliente_telefone || null,
        produto_servico:  produto_servico || null,
        provider:         'daily',
        room_name:        sala.name,
        room_url:         sala.url,
        status:           'agendada',
      })
      .select()
      .single();

    if (error) throw error;
    res.json({ reuniao: comLinkConvidado(data) });
  } catch (err) {
    console.error('Erro POST /reunioes:', err.message);
    res.status(500).json({ erro: 'Erro ao criar a sala da reunião.' });
  }
});

// ─── POST /api/reunioes/:id/convite ─────────────────────────────────────────────
// Manda o link da sala por e-mail pro cliente (reusa o Resend já configurado
// para o resto da May). O envio por WhatsApp não passa por aqui: o link de
// wa.me é montado direto no frontend, sem precisar de API.
router.post('/:id/convite', authMiddleware, exigirAcessoAtivo, limiteConviteEmail, async (req, res) => {
  try {
    if (semEmpresa(req, res)) return;

    const email = typeof req.body.email === 'string' ? req.body.email.trim() : '';
    if (!email) return res.status(400).json({ erro: 'E-mail do cliente é obrigatório.' });
    if (!EMAIL_VALIDO.test(email)) return res.status(400).json({ erro: 'Confira o e-mail do cliente.' });

    const { data: reuniao } = await supabase
      .from('reunioes_ia')
      .select('titulo, room_url, cliente_nome')
      .eq('id', req.params.id)
      .eq('empresa_id', req.user.empresa_id)
      .single();

    if (!reuniao) return res.status(404).json({ erro: 'Reunião não encontrada.' });

    const link = linkConvidado(reuniao.room_url);
    if (!link) return res.status(409).json({ erro: 'Esta reunião não tem um link válido.' });

    const r = await resend.emails.send({
      from:    `${process.env.EMAIL_FROM_NAME} <${process.env.EMAIL_FROM}>`,
      to:      email,
      subject: `Link da reunião: ${String(reuniao.titulo || '').replace(/[\r\n]+/g, ' ').slice(0, 120)}`,
      html: `<p>Olá${reuniao.cliente_nome ? ', ' + escaparHtml(reuniao.cliente_nome) : ''}!</p>
             <p>Segue o link da nossa reunião:</p>
             <p><a href="${escaparHtml(link)}">${escaparHtml(link)}</a></p>
             <p>Só clicar no horário combinado, não precisa instalar nada.</p>
             <p>A reunião pode ser gravada para registro do atendimento.</p>`,
    });

    if (r?.error) {
      console.error('[email convite reunião] falhou:', JSON.stringify(r.error));
      return res.status(502).json({ erro: 'Não consegui enviar o e-mail.' });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Erro POST /reunioes/:id/convite:', err.message);
    res.status(500).json({ erro: 'Erro ao enviar convite.' });
  }
});

// ─── POST /api/reunioes/:id/processar ───────────────────────────────────────────
// Busca a gravação pronta no Daily, transcreve com Whisper e gera nota/resumo/
// riscos/próximos passos com IA. O Daily leva um tempo processando a gravação
// depois que a call termina — se ainda não estiver pronta, devolve 409 pra
// pessoa tentar de novo em instantes (não fica tentando sozinho em loop).
router.post('/:id/processar', authMiddleware, exigirAcessoAtivo, limiteReuniao, async (req, res) => {
  try {
    if (semEmpresa(req, res)) return;

    const { data: reuniao } = await supabase
      .from('reunioes_ia')
      .select('*')
      .eq('id', req.params.id)
      .eq('empresa_id', req.user.empresa_id)
      .single();

    if (!reuniao) return res.status(404).json({ erro: 'Reunião não encontrada.' });

    const gravacoes = await daily.listarGravacoes(reuniao.room_name);
    const pronta = gravacoes.find(g => g.status === 'finished');

    if (!pronta) {
      return res.status(409).json({
        erro: 'A gravação ainda não está pronta. O Daily leva alguns minutos para processar depois que a call termina — tente de novo em instantes.',
      });
    }

    const { download_link } = await daily.linkAcessoGravacao(pronta.id);
    const transcricao = await transcrever(download_link);
    const analise      = await analisarReuniao(transcricao);

    const { data: atualizada, error } = await supabase
      .from('reunioes_ia')
      .update({
        daily_recording_id: pronta.id,
        transcricao,
        resumo_ia:          analise.resumo,
        nota_ia:             analise.nota,
        sentimento:          analise.sentimento,
        riscos:              analise.riscos,
        proximos_passos:     analise.proximos_passos,
        duracao_min:         pronta.duration ? Math.round(pronta.duration / 60) : null,
        status:              'finalizada',
        finalizada_em:       new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json({ reuniao: comLinkConvidado(atualizada) });
  } catch (err) {
    console.error('Erro POST /reunioes/:id/processar:', err.message);
    res.status(500).json({ erro: 'Erro ao processar a gravação da reunião.' });
  }
});

// ─── GET /api/reunioes/:id/gravacao ─────────────────────────────────────────────
// Gera um link novo pra assistir/baixar a gravação (o do Daily expira em
// minutos, por isso não fica salvo — é pedido na hora que a pessoa quer ver).
router.get('/:id/gravacao', authMiddleware, async (req, res) => {
  try {
    if (semEmpresa(req, res)) return;

    const { data: reuniao } = await supabase
      .from('reunioes_ia')
      .select('daily_recording_id')
      .eq('id', req.params.id)
      .eq('empresa_id', req.user.empresa_id)
      .single();

    if (!reuniao?.daily_recording_id) {
      return res.status(404).json({ erro: 'Essa reunião ainda não tem gravação processada.' });
    }

    const { download_link } = await daily.linkAcessoGravacao(reuniao.daily_recording_id);
    res.json({ url: download_link });
  } catch (err) {
    console.error('Erro GET /reunioes/:id/gravacao:', err.message);
    res.status(500).json({ erro: 'Erro ao buscar o link da gravação.' });
  }
});

// ─── DELETE /api/reunioes/:id ───────────────────────────────────────────────────
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    if (semEmpresa(req, res)) return;

    const { data: reuniao } = await supabase
      .from('reunioes_ia')
      .select('room_name')
      .eq('id', req.params.id)
      .eq('empresa_id', req.user.empresa_id)
      .single();

    if (!reuniao) return res.status(404).json({ erro: 'Reunião não encontrada.' });

    await daily.apagarSala(reuniao.room_name).catch(() => {});
    await supabase.from('reunioes_ia').delete().eq('id', req.params.id);

    res.json({ ok: true });
  } catch (err) {
    console.error('Erro DELETE /reunioes/:id:', err.message);
    res.status(500).json({ erro: 'Erro ao cancelar reunião.' });
  }
});

module.exports = router;
