const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync('frontend/js/app.js', 'utf8');
function context() {
  const dom = new JSDOM(fs.readFileSync('frontend/index.html', 'utf8'));
  const notices = [], requests = [], redirects = [];
  const ctx = {
    document: dom.window.document, estado: { user: { plano: 'free' } }, URL, URLSearchParams,
    window: { location: { search: '?pagamento=sucesso&session_id=cs_test_1', assign: url => redirects.push(url) }, history: { replaceState() {} } },
    mostrarToast: (message, type) => notices.push({ message, type }),
    api: { post: async (url, data) => { requests.push({ url, data }); return { ok: true, json: async () => ({ url: 'https://checkout.stripe.com/c/pay/test' }) }; } },
    carregarDadosIniciais: async () => {}, renderizarSidebar() {}, preencherMinhaAssinatura() {},
    fecharModalCancelamento() {}, fecharPaymentWall() {}, clearTimeout() {}, _bloqueioExpiradoTimer: null,
  };
  const checkout = source.slice(source.indexOf('let _checkoutEmAndamento'), source.indexOf('// ─── Logout'));
  const confirm = source.slice(source.indexOf('async function verificarQueryParams()'), source.indexOf('// ─── Diagnóstico inicial'));
  const cancel = source.slice(source.indexOf('async function confirmarCancelamento()'), source.indexOf('// Expõe funções necessárias'));
  vm.runInNewContext(checkout+'\n'+confirm+'\n'+cancel, ctx);
  return { ctx, notices, requests, redirects };
}
test('payment UI has no card inputs and sends only plan before redirecting to Stripe', async () => {
  const f = context(); assert.equal(f.ctx.document.querySelector('#pw-cvv,#cartao-cvv,#pw-numero,#cartao-numero'), null);
  await f.ctx.iniciarCheckout('start_anual');
  assert.equal(f.requests[0].url, '/stripe/checkout'); assert.equal(JSON.stringify(f.requests[0].data), '{"plano":"start_anual"}');
  assert.equal(f.redirects.length, 1);
  f.ctx.api.post = async () => ({ ok: true, json: async () => ({ url: 'https://evil.example/card' }) });
  await f.ctx.iniciarCheckout('mensal'); assert.equal(f.redirects.length, 1); assert.equal(f.notices.at(-1).type, 'erro');
});
test('success parameter cannot display activation when server reports pending or error', async () => {
  for (const ok of [true, false]) {
    const f = context(); f.ctx.api.post = async () => ({ ok, json: async () => ({ confirmado: false, erro: 'Pendente' }) });
    await f.ctx.verificarQueryParams(); assert.equal(f.notices.some(n => n.type === 'sucesso'), false);
  }
});
test('cancel UI chooses existing provider and never reports success for HTTP failure', async () => {
  const f = context(); f.ctx.document.querySelector('input[name="cancel-motivo"]').checked = true;
  f.ctx.estado.user.cielo_recurrent_payment_id = 'rp_existing';
  f.ctx.api.post = async url => { f.requests.push({ url }); return { ok: false, json: async () => ({ erro: 'Recusado pelo provedor' }) }; };
  await f.ctx.confirmarCancelamento(); assert.equal(f.requests[0].url, '/cielo/cancelar');
  assert.equal(f.notices.at(-1).type, 'erro'); assert.equal(f.ctx.document.getElementById('btn-confirmar-cancel').disabled, false);
});
