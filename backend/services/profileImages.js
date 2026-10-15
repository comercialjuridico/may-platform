// URLs de perfil não podem transformar a exportação de PDF em um proxy HTTP.
function imagemPerfilPermitida(value, userId, tipo) {
  if (typeof value !== 'string' || !value || !process.env.SUPABASE_URL) return false;
  try {
    const url = new URL(value);
    const origem = new URL(process.env.SUPABASE_URL);
    if (url.protocol !== 'https:' || url.origin !== origem.origin || url.username || url.password) return false;
    const pasta = tipo === 'logo' ? 'logos' : 'avatars';
    return ['jpg', 'jpeg', 'png', 'webp', 'gif'].some(ext =>
      url.pathname === `/storage/v1/object/public/avatars/${pasta}/${encodeURIComponent(userId)}.${ext}`);
  } catch { return false; }
}

async function buscarLogoSeguro(value, userId, fetchImpl = fetch) {
  if (!imagemPerfilPermitida(value, userId, 'logo')) return null;
  const resp = await fetchImpl(value, { redirect: 'error', signal: AbortSignal.timeout(5000) });
  if (!resp.ok || !/^image\/(png|jpeg|webp|gif)(;|$)/i.test(resp.headers.get('content-type') || '')) return null;
  const max = 5 * 1024 * 1024;
  if (Number(resp.headers.get('content-length')) > max) return null;
  const chunks = [];
  let bytes = 0;
  for await (const chunk of resp.body) {
    bytes += chunk.length;
    if (bytes > max) throw new Error('Logo excede tamanho permitido.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

module.exports = { imagemPerfilPermitida, buscarLogoSeguro };
