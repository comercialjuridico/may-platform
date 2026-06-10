// ─── Rotas de upload de documentos e transcrição de voz ───────────────────────
const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const pdfParse = require('pdf-parse');
const { supabase } = require('../services/supabase');
const { authMiddleware } = require('../middleware/auth');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Configuração do multer — armazenamento temporário em memória
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const tiposPermitidos = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'audio/webm',
      'audio/mp4',
      'audio/mpeg',
      'audio/wav',
      'audio/ogg',
    ];
    if (tiposPermitidos.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de arquivo não permitido.'));
    }
  },
});

// ─── POST /api/upload/documento ─────────────────────────────────────────────
// Recebe PDF ou DOCX, extrai texto e salva no banco
router.post('/documento', authMiddleware, upload.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado.' });

    let textoExtraido = '';

    if (req.file.mimetype === 'application/pdf') {
      const result = await pdfParse(req.file.buffer);
      textoExtraido = result.text.slice(0, 50000); // Limita a 50k caracteres
    } else if (req.file.mimetype.includes('wordprocessingml')) {
      // Para DOCX, extrai texto básico da estrutura XML
      // (para extração completa em produção, use mammoth.js)
      textoExtraido = req.file.buffer.toString('utf-8').replace(/<[^>]*>/g, ' ').slice(0, 50000);
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
      texto_preview: textoExtraido.slice(0, 300) + (textoExtraido.length > 300 ? '...' : ''),
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
