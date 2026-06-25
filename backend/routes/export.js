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

// ─── POST /api/export/pdf ───────────────────────────────────────────────────
router.post('/pdf', authMiddleware, async (req, res) => {
  try {
    const { conteudo, titulo } = req.body;
    if (!conteudo) return res.status(400).json({ erro: 'Conteúdo obrigatório.' });

    const tituloFinal = titulo || 'Proposta — May';
    const nomeArquivo = tituloFinal.replace(/[^a-zA-Z0-9À-ÿ\s]/g, '').replace(/\s+/g, '_').slice(0, 60);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}.pdf"`);

    const doc = new PDFDocument({ margin: 60, size: 'A4' });
    doc.pipe(res);

    // ── Cabeçalho roxo ──────────────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 90).fill('#1a0a3c');
    doc.fillColor('#ffffff')
       .font('Helvetica-Bold').fontSize(22)
       .text(tituloFinal, 60, 28, { width: doc.page.width - 120 });
    doc.fillColor('rgba(200,180,255,0.7)')
       .font('Helvetica').fontSize(10)
       .text(`Gerado pela May · ${new Date().toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' })}`, 60, 58);

    doc.moveDown(3);

    // ── Conteúdo — parsing linha a linha ───────────────────────────────────
    const linhas = conteudo.split('\n');
    for (const linha of linhas) {
      if (linha.startsWith('# ')) {
        doc.moveDown(0.5)
           .fillColor('#1a0a3c').font('Helvetica-Bold').fontSize(16)
           .text(linha.replace(/^# /, ''), { paragraphGap: 4 });
        doc.moveDown(0.2);
      } else if (linha.startsWith('## ')) {
        doc.moveDown(0.3)
           .fillColor('#3b1fa8').font('Helvetica-Bold').fontSize(13)
           .text(linha.replace(/^## /, ''), { paragraphGap: 3 });
      } else if (linha.startsWith('---')) {
        doc.moveDown(0.4)
           .moveTo(60, doc.y).lineTo(doc.page.width - 60, doc.y)
           .strokeColor('#e0d8ff').lineWidth(0.8).stroke();
        doc.moveDown(0.4);
      } else if (linha.startsWith('- ') || linha.startsWith('• ')) {
        doc.fillColor('#2d2d2d').font('Helvetica').fontSize(11)
           .text('• ' + linha.replace(/^[-•] /, ''), { indent: 16, paragraphGap: 2 });
      } else if (linha.trim() === '') {
        doc.moveDown(0.35);
      } else {
        // Remove markdown inline bold (**texto**)
        const semBold = linha.replace(/\*\*(.*?)\*\*/g, '$1');
        doc.fillColor('#1a1a1a').font('Helvetica').fontSize(11)
           .text(semBold, { lineGap: 3, paragraphGap: 2 });
      }
    }

    // ── Rodapé ──────────────────────────────────────────────────────────────
    const rodapeY = doc.page.height - 40;
    doc.rect(0, rodapeY - 10, doc.page.width, 50).fill('#f5f2ff');
    doc.fillColor('#888').font('Helvetica').fontSize(9)
       .text('Documento gerado pela plataforma May · may.com.br', 60, rodapeY, { align: 'center', width: doc.page.width - 120 });

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
