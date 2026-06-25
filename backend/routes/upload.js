// ─── Rotas de upload de documentos e transcrição de voz ───────────────────────
const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const pdfParse = require('pdf-parse');
const mammoth  = require('mammoth');
const { supabase } = require('../services/supabase');
const { authMiddleware } = require('../middleware/auth');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Configuração do multer — documentos e áudio
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (req, file, cb) => {
    const tiposPermitidos = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'text/plain',
      'audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/x-m4a',
    ];
    tiposPermitidos.includes(file.mimetype) ? cb(null, true) : cb(new Error('Tipo de arquivo não permitido.'));
  },
});

// Multer para imagens do chat (até 10 MB)
const uploadImagemChat = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const permitidos = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    permitidos.includes(file.mimetype) ? cb(null, true) : cb(new Error('Envie JPG, PNG ou WebP.'));
  },
});

const uploadImagem = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    const permitidos = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    permitidos.includes(file.mimetype) ? cb(null, true) : cb(new Error('Envie uma imagem JPG, PNG ou WebP.'));
  },
});

// ─── POST /api/upload/avatar ────────────────────────────────────────────────
// Faz upload de foto de perfil para o Supabase Storage e atualiza avatar_url
router.post('/avatar', authMiddleware, uploadImagem.single('foto'), async (req, res) => {
  if (!req.file) return res.status(400).json({ erro: 'Nenhuma imagem enviada.' });

  try {
    const ext      = req.file.mimetype.split('/')[1].replace('jpeg', 'jpg');
    const filename = `avatars/${req.user.id}.${ext}`;

    // Faz upload ao bucket "avatars" no Supabase Storage
    const { error: uploadErr } = await supabase.storage
      .from('avatars')
      .upload(filename, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: true,       // substitui se já existir
      });

    if (uploadErr) throw uploadErr;

    // Gera URL pública
    const { data: urlData } = supabase.storage
      .from('avatars')
      .getPublicUrl(filename);

    const avatar_url = urlData.publicUrl;

    // Salva no perfil do usuário
    const { error: updateErr } = await supabase
      .from('users')
      .update({ avatar_url })
      .eq('id', req.user.id);

    if (updateErr) throw updateErr;

    res.json({ avatar_url });
  } catch (err) {
    console.error('Erro ao fazer upload do avatar:', err.message);
    res.status(500).json({ erro: 'Erro ao salvar foto de perfil.' });
  }
});

// ─── POST /api/upload/documento ─────────────────────────────────────────────
// Recebe PDF ou DOCX, extrai texto e salva no banco
router.post('/documento', authMiddleware, upload.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado.' });

    let textoExtraido = '';

    if (req.file.mimetype === 'application/pdf') {
      const result = await pdfParse(req.file.buffer);
      textoExtraido = result.text.slice(0, 50000);
    } else if (req.file.mimetype.includes('wordprocessingml') || req.file.mimetype === 'application/msword') {
      const result = await mammoth.extractRawText({ buffer: req.file.buffer });
      textoExtraido = result.value.slice(0, 50000);
    } else {
      textoExtraido = req.file.buffer.toString('utf-8').slice(0, 50000);
    }

    const { data, error } = await supabase
      .from('uploads')
      .insert({
        user_id: req.user.id,
        filename: req.file.originalname,
        mimetype: req.file.mimetype,
        tamanho: req.file.size,
        texto_extraido: textoExtraido,
      })
      .select('id, filename')
      .single();

    if (error) throw error;

    res.json({
      mensagem: 'Documento processado com sucesso.',
      upload_id: data.id,
      filename: data.filename,
      texto_preview: textoExtraido.slice(0, 8000) + (textoExtraido.length > 8000 ? '\n\n[... documento truncado ...]' : ''),
      tamanho_texto: textoExtraido.length,
    });
  } catch (err) {
    console.error('Erro no upload de documento:', err.message);
    res.status(500).json({ erro: err.message || 'Erro ao processar documento.' });
  }
});

// ─── POST /api/upload/audio ─────────────────────────────────────────────────
// Recebe áudio e transcreve via Whisper (OpenAI)
router.post('/audio', authMiddleware, upload.single('audio'), async (req, res) => {
  // Apenas planos pagos têm acesso à transcrição
  if (req.user.plano === 'free') {
    return res.status(403).json({
      erro: 'A transcrição de áudio está disponível apenas nos planos pagos.',
      code: 'PLANO_INSUFICIENTE',
    });
  }

  if (!req.file) return res.status(400).json({ erro: 'Nenhum áudio enviado.' });

  try {
    // Salva temporariamente para enviar ao Whisper
    const tmpPath = path.join('/tmp', `audio_${Date.now()}.${req.file.mimetype.split('/')[1]}`);
    fs.writeFileSync(tmpPath, req.file.buffer);

    const transcricao = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model: 'whisper-1',
      language: 'pt',
      response_format: 'text',
    });

    fs.unlinkSync(tmpPath); // Remove arquivo temporário

    res.json({
      transcricao: transcricao,
      duracao_estimada: Math.round(req.file.size / 16000), // Estimativa em segundos
    });
  } catch (err) {
    console.error('Erro na transcrição de áudio:', err.message);
    res.status(500).json({ erro: 'Erro ao transcrever áudio.' });
  }
});

// ─── POST /api/upload/imagem-chat ───────────────────────────────────────────
// Recebe imagem e analisa via GPT-4o Vision
router.post('/imagem-chat', authMiddleware, uploadImagemChat.single('imagem'), async (req, res) => {
  if (!req.file) return res.status(400).json({ erro: 'Nenhuma imagem enviada.' });

  try {
    const base64 = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype;
    const dataUrl = `data:${mimeType};base64,${base64}`;

    // Salva URL temporária no banco para exibir no chat
    const { data: upload } = await supabase
      .from('uploads')
      .insert({
        user_id: req.user.id,
        filename: req.file.originalname,
        mimetype: mimeType,
        tamanho: req.file.size,
        texto_extraido: '[imagem]',
      })
      .select('id')
      .single();

    // Analisa com GPT-4o Vision
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: req.body.instrucao ||
              'Descreva detalhadamente o conteúdo desta imagem. Se for um documento, contrato, proposta ou texto, transcreva o conteúdo principal.'
          },
          { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } }
        ]
      }]
    });

    const analise = completion.choices[0]?.message?.content || 'Não foi possível analisar a imagem.';

    res.json({
      upload_id: upload?.id,
      filename: req.file.originalname,
      dataUrl,          // para exibir miniatura no chat
      analise,
    });
  } catch (err) {
    console.error('Erro ao analisar imagem:', err.message);
    res.status(500).json({ erro: 'Erro ao analisar imagem.' });
  }
});

// ─── GET /api/upload/uploads ─────────────────────────────────────────────────
// Lista uploads do usuário
router.get('/uploads', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('uploads')
      .select('id, filename, mimetype, tamanho, created_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;
    res.json({ uploads: data });
  } catch (err) {
    console.error('Erro ao listar uploads:', err.message);
    res.status(500).json({ erro: 'Erro ao buscar uploads.' });
  }
});

// ─── GET /api/upload/:id/texto ──────────────────────────────────────────────
// Retorna o texto extraído de um upload
router.get('/:id/texto', authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('uploads')
      .select('texto_extraido, filename')
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .single();

    if (error || !data) return res.status(404).json({ erro: 'Upload não encontrado.' });

    res.json({ filename: data.filename, texto: data.texto_extraido });
  } catch (err) {
    console.error('Erro ao buscar texto do upload:', err.message);
    res.status(500).json({ erro: 'Erro ao buscar texto.' });
  }
});

module.exports = router;
