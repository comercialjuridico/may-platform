const { test } = require('node:test');
const assert = require('node:assert/strict');
const { imagemPerfilPermitida, buscarLogoSeguro } = require('../backend/services/profileImages');
process.env.SUPABASE_URL = 'https://example.supabase.co';
const good = 'https://example.supabase.co/storage/v1/object/public/avatars/logos/alice.png';

test('profile images restrict origin, object path and owner', () => {
  assert.equal(imagemPerfilPermitida(good, 'alice', 'logo'), true);
  for (const url of ['http://127.0.0.1/private', 'http://169.254.169.254/', 'https://attacker.invalid/logo.png', 'https://example.supabase.co.attacker.invalid/x', good.replace('alice', 'bob'), good.replace('logos/', 'logos/../'), good.replace('https://', 'https://user:pass@'), 'data:image/svg+xml,bad', good.replace('.png', '.svg')]) {
    assert.equal(imagemPerfilPermitida(url, 'alice', 'logo'), false, url);
  }
});

test('PDF logo download does not contact arbitrary or internal URLs', async () => {
  let calls = 0;
  const result = await buscarLogoSeguro('http://localhost/admin', 'alice', async () => { calls++; });
  assert.equal(result, null); assert.equal(calls, 0);
});

test('valid logo download disables redirects and has a timeout and size limit', async () => {
  const result = await buscarLogoSeguro(good, 'alice', async (url, options) => {
    assert.equal(options.redirect, 'error'); assert(options.signal);
    return new Response(Buffer.from('image'), { headers: { 'Content-Type': 'image/png' } });
  });
  assert.equal(result.toString(), 'image');
  await assert.rejects(buscarLogoSeguro(good, 'alice', async () => new Response(Buffer.alloc(5 * 1024 * 1024 + 1), { headers: { 'Content-Type': 'image/png' } })), /tamanho/);
});
