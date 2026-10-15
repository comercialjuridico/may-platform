const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');

test('production entry point serves sanitizer and versioned app assets without contacting providers', async () => {
  const scout = net.createServer();
  await new Promise(resolve => scout.listen(0, '127.0.0.1', resolve));
  const port = scout.address().port;
  await new Promise(resolve => scout.close(resolve));
  const child = spawn(process.execPath, ['backend/server.js'], {
    env: {
      ...process.env, PORT: String(port), NODE_ENV: 'test',
      SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_KEY: 'fixture-key',
      OPENAI_API_KEY: 'fixture-key', STRIPE_SECRET_KEY: 'sk_test_fixture', RESEND_API_KEY: 're_fixture',
      JWT_SECRET: 'fixture-access-secret', JWT_REFRESH_SECRET: 'fixture-refresh-secret',
      CRON_SECRET: '', VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '',
    }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('startup timeout')), 10000);
      child.stdout.on('data', b => { if (b.toString().includes('May rodando')) { clearTimeout(timeout); resolve(); } });
      child.on('exit', code => { clearTimeout(timeout); reject(Error('startup exit ' + code)); });
    });
    for (const p of ['/api/health', '/app', '/js/vendor/purify.min.js?v=security-1', '/js/markdown.js?v=security-1']) {
      const r = await fetch(`http://127.0.0.1:${port}${p}`);
      assert.equal(r.status, 200, p);
      const text = await r.text();
      if (p.includes('purify')) assert.match(text, /DOMPurify/);
      if (p === '/app') assert.match(text, /purify\.min\.js\?v=security-1/);
    }
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve));
  }
});
