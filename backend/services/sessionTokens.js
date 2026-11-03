// Refresh tokens: keep only a SHA-256 verifier in the database.
// Compatible with legacy plaintext JWTs during the first rotation.
const { createHash, timingSafeEqual } = require('node:crypto');

function hashRefreshToken(token) {
  if (typeof token !== 'string' || token.length === 0 || token.length > 4096) {
    throw new TypeError('Refresh token inválido.');
  }
  return 'sha256:' + createHash('sha256').update(token, 'utf8').digest('hex');
}

function refreshTokenConfere(stored, presented) {
  if (typeof stored !== 'string' || !stored ||
      typeof presented !== 'string' || !presented || presented.length > 4096) return false;
  const expected = stored.startsWith('sha256:') ? hashRefreshToken(presented) : presented;
  const a = Buffer.from(stored, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

module.exports = { hashRefreshToken, refreshTokenConfere };
