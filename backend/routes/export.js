// ─── Rotas de exportação (Word, PDF) ──────────────────────────────────────────
const express = require('express');
const router = express.Router();
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, BorderStyle
} = require('docx');
const PDFDocument = require('pdfkit');
const { supabase } = require('../services/supabase');
const { authMiddleware } = require('../middleware/auth');

// ─── POST /api/export/docx ──────────────────────────────────────────────────
// Exporta o conteúdo de uma conversa ou template para Word
router.post('/docx', authMiddleware, async (req, res) => {
  try {
    const { conversa_id, template_id, titulo, conteudo } = req.body;

    let textoFinal = '';
    let tituloFinal = titulo || 'Exportado pela May';

    if (conversa_id) {
      // Exporta conversa completa
      const { data: msgs } = await supabase
        .from('messages')
        .select('role, content, created_at')
        .eq('conversation_id', conversa_id)
        .eq('user_id', req.user.id)
        .order('created_at', { ascending: true });

      if (!msgs) return res.status(404).json({ erro: 'Conversa não encontrada.' });

      textoFinal = msgs.map(m =>
        `${m.role === 'user' ? 'Você' : 'May'}:\n${m.content}`
      ).join('\n\n---\n\n');

    } else if (template_id) {
      // Exporta template salvo
      const { data: tpl } = await supabase
        .from('templates')
        .select('titulo, conteudo')
        .eq('id', template_id)
        .eq('user_id', req.user.id)
        .single();

      if (!tpl) return res.status(404).json({ erro: 'Template não encontrado.' });
      tituloFinal = tpl.titulo;
      textoFinal = tpl.conteudo;

    } else if (conteudo) {
      // Exporta conteúdo direto passado no body
      textoFinal = conteudo;
    } else {
      return res.status(400).json({ erro: 'Forneça conversa_id, template_id ou conteudo.' });
    }

    // Converte markdown básico para parágrafos
    const linhas = textoFinal.split('\n');
    const children = [];

    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: tituloFinal, bold: true, font: 'Arial', size: 32 })]
      })
    );

    children.push(
      new Paragraph({
        spacing: { after: 200 },
        children: [new TextRun({
          text: `Gerado pela May em ${new Date().toLocaleDateString('pt-BR')}`,
          font: 'Arial', size: 18, color: '888888', italics: true
        })]
      })
    );

    for (const linha of linhas) {
      if (linha.startsWith('## ')) {
        children.push(new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: linha.replace('## ', ''), font: 'Arial', bold: true, size: 26 })]
        }));
      } else if (linha.startsWith('# ')) {
        children.push(new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: linha.replace('# ', ''), font: 'Arial', bold: true, size: 32 })]
        }));
      } else if (linha.startsWith('---')) {
        children.push(new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'CCCCCC', space: 4 } },
          children: [new TextRun('')]
        }));
      } else {
        // Processa negrito (**texto**)
        const partes = linha.split(/\*\*(.*?)\*\*/g);
        const runs = partes.map((parte, i) =>
          new TextRun({ text: parte, font: 'Arial', size: 22, bold: i % 2 === 1 })
        );
        children.push(new Paragraph({
          spacing: { before: 60, after: 60 },
          children: runs.length ? runs : [new TextRun({ text: linha, font: 'Arial', size: 22 })]
        }));
      }
    }

    const doc = new Document({
      styles: {
        default: { document: { run: { font: 'Arial', size: 22 } } }
      },
      sections: [{
        properties: {
          page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } }
        },
        children
      }]
    });

    const buffer = await Packer.toBuffer(doc);

    const nomeArquivo = tituloFinal
      .replace(/[^a-zA-Z0-9À-ÿ\s]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 60);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}.docx"`);
    res.send(buffer);

  } catch (err) {
    console.error('Erro na exportação:', err.message);
    res.status(500).json({ erro: 'Erro ao exportar documento.' });
  }
});

// ─── Utilitário: escurece cor hex (para gradiente no header) ─────────────────
function escurecerCor(hex, fator = 0.4) {
  const h = hex.replace('#', '');
  const r = Math.round(parseInt(h.slice(0,2),16) * fator);
  const g = Math.round(parseInt(h.slice(2,4),16) * fator);
  const b = Math.round(parseInt(h.slice(4,6),16) * fator);
  return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
}

// ─── Utilitário: remove markdown inline, mantendo leitura fluida ─────────────
function limparMarkdown(txt) {
  return txt
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g,   '$1')
    .replace(/`(.*?)`/g,     '$1');
}

// ─── POST /api/export/pdf ───────────────────────────────────────────────────
router.post('/pdf', authMiddleware, async (req, res) => {
  try {
    const { conteudo, titulo } = req.body;
    if (!conteudo) return res.status(400).json({ erro: 'Conteúdo obrigatório.' });

    // Branding do escritório (do perfil do usuário, com fallbacks)
    const corPrincipal = (req.user.cor_escritorio || '#7C3AED').trim();
    const corEscura    = escurecerCor(corPrincipal, 0.35);
    const logoUrl      = req.user.logo_escritorio || null;

    const tituloFinal = titulo || 'Proposta Comercial';
    const nomeArquivo = tituloFinal.replace(/[^a-zA-Z0-9\s]/g, '').replace(/\s+/g, '_').slice(0, 60);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}.pdf"`);

    const doc = new PDFDocument({ margin: 60, size: 'A4', autoFirstPage: true });
    doc.pipe(res);

    const W = doc.page.width;
    const MARGIN = 60;
    const CONTENT_W = W - MARGIN * 2;

    // ── Cabeçalho com cor do escritório ─────────────────────────────────────
    const HEADER_H = logoUrl ? 100 : 80;
    doc.rect(0, 0, W, HEADER_H).fill(corEscura);
    doc.rect(0, 0, W, HEADER_H * 0.6).fill(corPrincipal);

    // Logo do escritório (se disponível)
    let logoBuffer = null;
    if (logoUrl) {
      try {
        const resp = await fetch(logoUrl);
        if (resp.ok) {
          const ab = await resp.arrayBuffer();
          logoBuffer = Buffer.from(ab);
        }
      } catch (_) { /* logo indisponível — continua sem ele */ }
    }

    if (logoBuffer) {
      // Logo à direita do header
      try {
        doc.image(logoBuffer, W - MARGIN - 60, 12, { height: 56, fit: [120, 56] });
      } catch (_) { /* formato de imagem não suportado */ }
    }

    // Título da proposta no header
    doc.fillColor('#ffffff')
       .font('Helvetica-Bold').fontSize(logoBuffer ? 18 : 20)
       .text(tituloFinal, MARGIN, logoBuffer ? 22 : 20, { width: logoBuffer ? CONTENT_W - 130 : CONTENT_W });

    // Data no header
    doc.fillColor('rgba(255,255,255,0.65)')
       .font('Helvetica').fontSize(9.5)
       .text(
         new Date().toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' }),
         MARGIN, HEADER_H - 22, { width: CONTENT_W }
       );

    doc.y = HEADER_H + 24;

    // ── Conteúdo — parsing linha a linha ─────────────────────────────────────
    const linhas = conteudo.split('\n');
    for (const linha of linhas) {
      if (doc.y > doc.page.height - 80) {
        doc.addPage();
        doc.y = 50;
      }

      if (linha.startsWith('# ')) {
        doc.moveDown(0.6)
           .fillColor(corEscura || '#1a1a40').font('Helvetica-Bold').fontSize(15)
           .text(limparMarkdown(linha.replace(/^# /, '')), MARGIN, doc.y, { width: CONTENT_W, paragraphGap: 4 });
        // Linha decorativa sob o H1
        doc.moveDown(0.15)
           .moveTo(MARGIN, doc.y).lineTo(MARGIN + 40, doc.y)
           .strokeColor(corPrincipal).lineWidth(2.5).stroke();
        doc.moveDown(0.4);

      } else if (linha.startsWith('## ')) {
        doc.moveDown(0.4)
           .fillColor(corPrincipal).font('Helvetica-Bold').fontSize(12.5)
           .text(limparMarkdown(linha.replace(/^## /, '')), MARGIN, doc.y, { width: CONTENT_W, paragraphGap: 3 });
        doc.moveDown(0.2);

      } else if (linha.startsWith('### ')) {
        doc.moveDown(0.3)
           .fillColor('#333333').font('Helvetica-Bold').fontSize(11)
           .text(limparMarkdown(linha.replace(/^### /, '')), MARGIN, doc.y, { width: CONTENT_W });

      } else if (linha.startsWith('---')) {
        doc.moveDown(0.4)
           .moveTo(MARGIN, doc.y).lineTo(W - MARGIN, doc.y)
           .strokeColor('#dddddd').lineWidth(0.7).stroke();
        doc.moveDown(0.4);

      } else if (linha.match(/^[-*•] /)) {
        const texto = limparMarkdown(linha.replace(/^[-*•] /, ''));
        // Bullet colorido
        doc.fillColor(corPrincipal).font('Helvetica-Bold').fontSize(11)
           .text('•', MARGIN, doc.y, { continued: false, width: 14 });
        const bulletY = doc.y - doc.currentLineHeight();
        doc.fillColor('#1a1a1a').font('Helvetica').fontSize(11)
           .text(texto, MARGIN + 16, bulletY, { width: CONTENT_W - 16, lineGap: 2 });

      } else if (linha.trim() === '') {
        doc.moveDown(0.3);

      } else {
        // Texto normal — detecta negrito inline (**texto**)
        const partes = linha.split(/\*\*(.*?)\*\*/g);
        if (partes.length > 1) {
          // Tem negrito: renderiza em segmentos
          doc.x = MARGIN;
          let primeiroSegmento = true;
          for (let i = 0; i < partes.length; i++) {
            const texto = partes[i];
            if (!texto) continue;
            const negrito = i % 2 === 1;
            doc.fillColor('#1a1a1a')
               .font(negrito ? 'Helvetica-Bold' : 'Helvetica')
               .fontSize(11)
               .text(texto, primeiroSegmento ? MARGIN : doc.x, doc.y, {
                 continued: i < partes.length - 1 && partes[i+1] !== undefined,
                 lineGap: 2,
               });
            primeiroSegmento = false;
          }
          if (doc.x !== MARGIN) doc.moveDown(0.2);
        } else {
          doc.fillColor('#1a1a1a').font('Helvetica').fontSize(11)
             .text(limparMarkdown(linha), MARGIN, doc.y, { width: CONTENT_W, lineGap: 2, paragraphGap: 1 });
        }
      }
    }

    // ── Rodapé ──────────────────────────────────────────────────────────────
    const totalPages = doc.bufferedPageRange ? doc.bufferedPageRange().count : 1;
    const range = doc.bufferedPageRange ? doc.bufferedPageRange() : { start: 0, count: 1 };
    const rodapeY = doc.page.height - 36;
    doc.rect(0, rodapeY - 8, W, 44).fill('#f8f7ff');
    doc.fillColor('#999999').font('Helvetica').fontSize(8.5)
       .text(
         `Proposta gerada pela plataforma May  ·  may.com.br  ·  ${new Date().toLocaleDateString('pt-BR')}`,
         MARGIN, rodapeY, { align: 'center', width: CONTENT_W }
       );

    doc.end();
  } catch (err) {
    console.error('Erro ao exportar PDF:', err.message);
    if (!res.headersSent) res.status(500).json({ erro: 'Erro ao gerar PDF.' });
  }
});

// ─── POST /api/export/template ──────────────────────────────────────────────
router.post('/template', authMiddleware, async (req, res) => {
  try {
    const { tipo, titulo, conteudo, nicho, area_id } = req.body;
    if (!tipo || !titulo || !conteudo) {
      return res.status(400).json({ erro: 'Tipo, título e conteúdo são obrigatórios.' });
    }

    const { data, error } = await supabase
      .from('templates')
      .insert({
        user_id: req.user.id,
        tipo,
        titulo,
        conteudo,
        nicho: nicho || req.user.nicho,
        area_id: area_id || null,
      })
      .select('id, titulo')
      .single();

    if (error) throw error;
    res.status(201).json({ mensagem: 'Template salvo.', template: data });
  } catch (err) {
    console.error('Erro ao salvar template:', err.message);
    res.status(500).json({ erro: 'Erro ao salvar template.' });
  }
});

// ─── GET /api/export/templates ──────────────────────────────────────────────
router.get('/templates', authMiddleware, async (req, res) => {
  try {
    const { area_id } = req.query;
    let query = supabase
      .from('templates')
      .select('id, tipo, titulo, conteudo, area_id, created_at')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false });

    if (area_id) query = query.eq('area_id', area_id);

    const { data, error } = await query;
    if (error) throw error;
    res.json({ templates: data });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar templates.' });
  }
});

// ─── DELETE /api/export/template/:id ─────────────────────────────────────────
router.delete('/template/:id', authMiddleware, async (req, res) => {
  try {
    const { error } = await supabase
      .from('templates')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao excluir template.' });
  }
});

module.exports = router;
