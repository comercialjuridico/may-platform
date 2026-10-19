const yauzl = require('yauzl');
const path = require('node:path');
const { tipoAudio } = require('./audioUpload');
const MB = 1024 * 1024;
function erro(message) { return Object.assign(new Error(message), { status:400 }); }
function lerZip(buffer) {
  return new Promise((resolve, reject) => {
    if (!buffer.length || buffer.length > 20 * MB) return reject(erro('Envie um ZIP de até 20 MB.'));
    yauzl.fromBuffer(buffer, { lazyEntries:true, validateEntrySizes:true, strictFileNames:true }, (e, zip) => {
      if (e) return reject(erro('ZIP inválido ou protegido por senha.'));
      let total = 0, count = 0, finalizado = false;
      const arquivos = [], nomes = new Set();
      function falhar(e) { if (finalizado) return; finalizado = true; zip.close(); reject(erro(e.message || 'ZIP inválido.')); }
      zip.on('error', () => falhar(erro('Não foi possível ler o ZIP com segurança.')));
      zip.on('entry', entry => {
        const nome = entry.fileName;
        if (++count > 200) return falhar(erro('O ZIP excede 200 arquivos. Divida a conversa.'));
        if (nome.includes('\\') || nome.startsWith('/') || /^[a-z]:/i.test(nome) || nome.split('/').includes('..') || /[\x00-\x1f]/.test(nome) || ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000 || (entry.generalPurposeBitFlag & 1)) return falhar(erro('O ZIP contém caminhos, links ou arquivos protegidos não permitidos.'));
        if (nome.endsWith('/') || nome.startsWith('__MACOSX/')) { zip.readEntry(); return; }
        total += entry.uncompressedSize;
        if (total > 60 * MB || entry.uncompressedSize > 20 * MB || entry.uncompressedSize / Math.max(1, entry.compressedSize) > 1000) return falhar(erro('ZIP excede o limite de expansão: 60 MB no total e 20 MB por arquivo.'));
        const base = path.posix.basename(nome).normalize('NFC');
        if (nomes.has(base)) return falhar(erro('Há arquivos com nomes repetidos no ZIP. Exporte apenas uma conversa.'));
        nomes.add(base);
        if (!/\.(txt|jpe?g|png|webp)$/i.test(base) && !tipoAudio(base)) { arquivos.push({ nome:base, buffer:null }); zip.readEntry(); return; }
        zip.openReadStream(entry, (e, stream) => {
          if (e) return falhar(erro('Falha ao abrir um arquivo do ZIP.'));
          const chunks = []; let size = 0;
          stream.on('data', chunk => { size += chunk.length; if (size > 20 * MB || size > entry.uncompressedSize) { stream.destroy(); falhar(erro('Tamanho inválido no ZIP.')); } else chunks.push(chunk); });
          stream.on('error', () => falhar(erro('Arquivo corrompido no ZIP.')));
          stream.on('end', () => { if (finalizado) return; arquivos.push({ nome:base, buffer:Buffer.concat(chunks) }); zip.readEntry(); });
        });
      });
      zip.on('end', () => { if (!finalizado) { finalizado = true; resolve(arquivos); } });
      zip.readEntry();
    });
  });
}
function tipoImagem(nome, buf) {
  if (/\.jpe?g$/i.test(nome) && buf?.[0] === 255 && buf?.[1] === 216) return 'image/jpeg';
  if (/\.png$/i.test(nome) && buf?.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (/\.webp$/i.test(nome) && buf?.toString('ascii',0,4) === 'RIFF' && buf?.toString('ascii',8,12) === 'WEBP') return 'image/webp';
  return null;
}
async function importarConversa(buffer, { transcrever, analisarImagem }) {
  const arquivos = await lerZip(buffer);
  const textos = arquivos.filter(a => /\.txt$/i.test(a.nome));
  if (textos.length !== 1 || !textos[0].buffer) throw erro('O ZIP deve conter exatamente uma conversa TXT exportada do WhatsApp.');
  if (textos[0].buffer.length > 2 * MB) throw erro('A conversa TXT excede 2 MB. Exporte um período menor.');
  let texto = textos[0].buffer.toString('utf8').normalize('NFC');
  if (!texto.trim() || texto.includes('\u0000')) throw erro('Conversa TXT inválida.');
  const manifesto = [], avisos = []; let processadas = 0;
  const prazo = Date.now() + 180000;
  for (const a of arquivos.filter(a => a !== textos[0])) {
    let conteudo;
    const audio = tipoAudio(a.nome), imagem = tipoImagem(a.nome, a.buffer);
    const item = { nome:a.nome, status:'ignorado', motivo:'Formato não suportado.' };
    if ((audio || imagem) && a.buffer) {
      if (Date.now() >= prazo) item.motivo = 'Tempo máximo de processamento atingido. Envie esta mídia separadamente.';
      else if (processadas >= 12) item.motivo = 'Limite de 12 mídias por importação. Envie as restantes separadamente.';
      else if (imagem && a.buffer.length > 5 * MB) item.motivo = 'Imagem acima de 5 MB.';
      else {
        processadas++;
        try {
          const bruto = String(audio ? await transcrever(a.buffer, a.nome) : await analisarImagem(a.buffer, imagem));
          conteudo = bruto.length > 8000 ? bruto.slice(0,7800) + '\n[Mídia truncada em 8 mil caracteres.]' : bruto;
          if (bruto.length > 8000) avisos.push('Conteúdo truncado: ' + a.nome);
          if (/\.mp4$/i.test(a.nome)) avisos.push('MP4 processado apenas como áudio: ' + a.nome);
          if (!conteudo.trim()) throw Error('empty');
          item.status = 'processado'; delete item.motivo;
        } catch { item.status = 'falhou'; item.motivo = 'Não foi possível processar esta mídia. Envie o arquivo separadamente para tentar novamente.'; }
      }
    }
    const referencia = texto.includes(a.nome);
    const bloco = `\n[Mídia ${JSON.stringify(a.nome)} — ${audio ? 'áudio' : imagem ? 'imagem' : 'arquivo'}: ${conteudo || item.motivo}]\n`;
    if (referencia) texto = texto.split(a.nome).join(bloco);
    else { avisos.push('Mídia sem referência no TXT: ' + a.nome); texto += '\n[Sem posição identificada na conversa]' + bloco; }
    manifesto.push(item);
  }
  if (/mídia oculta|media omitted|arquivo omitido|áudio oculto/i.test(texto)) avisos.push('O TXT contém mídias omitidas na exportação; elas não foram recuperadas.');
  const truncado = texto.length > 50000;
  if (truncado) { texto = texto.slice(0,49800) + '\n[CONVERSA TRUNCADA: limite de 50 mil caracteres. Importe um período menor para análise completa.]'; avisos.push('Conversa truncada para 50 mil caracteres.'); }
  return { texto, manifesto, avisos, truncado };
}
module.exports = { lerZip, importarConversa, tipoImagem };
