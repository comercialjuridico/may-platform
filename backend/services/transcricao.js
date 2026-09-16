// ─── Transcrição de reuniões ─────────────────────────────────────────────────
// Baixa a gravação (link temporário do Daily) e transcreve com o Whisper da
// OpenAI — mesma OPENAI_API_KEY que já roda o resto da May.
const OpenAI = require('openai');
const fs     = require('fs');
const os     = require('os');
const path   = require('path');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function baixarParaArquivoTemp(url) {
  const resposta = await fetch(url);
  if (!resposta.ok) {
    throw new Error(`Falha ao baixar a gravação (HTTP ${resposta.status})`);
  }
  const buffer  = Buffer.from(await resposta.arrayBuffer());
  const caminho = path.join(os.tmpdir(), `may-reuniao-${Date.now()}.mp4`);
  fs.writeFileSync(caminho, buffer);
  return caminho;
}

// Recebe o `download_link` temporário que vem de daily.linkAcessoGravacao().
async function transcrever(urlGravacao) {
  const caminho = await baixarParaArquivoTemp(urlGravacao);
  try {
    const resposta = await openai.audio.transcriptions.create({
      file:     fs.createReadStream(caminho),
      model:    'whisper-1',
      language: 'pt',
    });
    return resposta.text;
  } finally {
    fs.unlink(caminho, () => {}); // limpa o temporário sem travar o retorno
  }
}

module.exports = { transcrever };
