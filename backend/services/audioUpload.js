const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { toFile } = require('openai/uploads');
const executar = promisify(execFile);
const TIPOS = { mp3:'audio/mpeg', m4a:'audio/mp4', mp4:'audio/mp4', wav:'audio/wav', webm:'audio/webm', ogg:'audio/ogg', opus:'audio/ogg', oga:'audio/ogg' };
function tipoAudio(nome) { return TIPOS[path.extname(nome).slice(1).toLowerCase()] || null; }
async function transcreverAudio(openai, buffer, nome) {
  const tipo = tipoAudio(nome);
  if (!tipo || !buffer.length || buffer.length > 20 * 1024 * 1024) throw new Error('Envie um áudio válido de até 20 MB: MP3, M4A, MP4, WAV, WebM, OGG ou OPUS.');
  let dir;
  try {
    let arquivo = buffer, filename = 'audio.' + path.extname(nome).slice(1).toLowerCase();
    if (tipo === 'audio/ogg') {
      if (buffer.toString('ascii',0,4) !== 'OggS') throw new Error('OGG/OPUS inválido.');
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'may-audio-'));
      const entrada = path.join(dir, 'entrada.ogg'), saida = path.join(dir, 'saida.mp3');
      await fs.writeFile(entrada, buffer, { mode: 0o600 });
      await executar(require('@ffmpeg-installer/ffmpeg').path, ['-nostdin', '-protocol_whitelist', 'file,pipe', '-f', 'ogg', '-i', entrada, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', saida], { timeout: 45000, maxBuffer: 1024 * 1024 });
      const stat = await fs.stat(saida);
      if (stat.size > 20 * 1024 * 1024) throw new Error('Áudio convertido excede 20 MB.');
      arquivo = await fs.readFile(saida); filename = 'audio.mp3';
    }
    const file = await toFile(arquivo, filename);
    return await openai.audio.transcriptions.create({ file, model:'whisper-1', language:'pt', response_format:'text' }, { timeout:60000, maxRetries:0 });
  } finally { if (dir) await fs.rm(dir, { recursive:true, force:true }); }
}
module.exports = { tipoAudio, transcreverAudio };
