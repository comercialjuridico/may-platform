// ─── Transcrição de reuniões ─────────────────────────────────────────────────
// Baixa a gravação (link temporário do Daily) e transcreve com o Whisper da
// OpenAI — mesma OPENAI_API_KEY que já roda o resto da May.
//
// Achado em 2026-09-16: a gravação que vem do Daily é o vídeo composto da
// call inteira, e mesmo uma call de 2 minutos passa fácil de 80MB — o
// Whisper da OpenAI recusa qualquer arquivo acima de 25MB. Por isso, antes
// de mandar pro Whisper, extrai só o áudio (mono, comprimido) com o ffmpeg:
// isso derruba até uma reunião de 1h pra bem menos que o limite, sem perder
// qualidade nenhuma pra transcrição (a voz continua nítida) e sem mexer no
// vídeo original guardado no Daily (o botão "Assistir gravação" continua
// mostrando o vídeo completo, essa conversão é só pra transcrição).
const OpenAI     = require('openai');
const fs         = require('fs');
const os         = require('os');
const path       = require('path');
const { execFile } = require('child_process');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

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

// Extrai só o áudio do vídeo, mono/16kHz/32kbps — leve o suficiente pra
// caber no limite do Whisper mesmo numa reunião longa, sem perder
// inteligibilidade de voz.
function extrairAudio(caminhoVideo) {
  const caminhoAudio = caminhoVideo.replace(/\.mp4$/, '.mp3');
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath, [
      '-y',
      '-i', caminhoVideo,
      '-vn',
      '-ac', '1',
      '-ar', '16000',
      '-b:a', '32k',
      caminhoAudio,
    ], (err) => {
      if (err) return reject(new Error(`Falha ao extrair áudio da gravação: ${err.message}`));
      resolve(caminhoAudio);
    });
  });
}

// Recebe o `download_link` temporário que vem de daily.linkAcessoGravacao().
async function transcrever(urlGravacao) {
  const caminhoVideo = await baixarParaArquivoTemp(urlGravacao);
  let caminhoAudio;
  try {
    caminhoAudio = await extrairAudio(caminhoVideo);
    const resposta = await openai.audio.transcriptions.create({
      file:     fs.createReadStream(caminhoAudio),
      model:    'whisper-1',
      language: 'pt',
    });
    return resposta.text;
  } finally {
    fs.unlink(caminhoVideo, () => {});
    if (caminhoAudio) fs.unlink(caminhoAudio, () => {});
  }
}

module.exports = { transcrever };
