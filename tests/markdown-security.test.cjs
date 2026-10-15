const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const createDOMPurify = require('dompurify');

function renderer() {
  const window = new JSDOM('').window;
  window.DOMPurify = createDOMPurify(window);
  const context = { window };
  vm.runInNewContext(fs.readFileSync('frontend/js/markdown.js', 'utf8'), context);
  return { window, render: window.renderMarkdown };
}

test('Markdown blocks scripts, event attributes, unsafe URLs and SVG payloads in the parsed DOM', () => {
  const { window, render } = renderer();
  const payloads = [
    '[click](https://example.invalid/" onmouseover="void 0)',
    '[click](javascript:alert%281%29)',
    '[click](data:text/html,hello)',
    '<img src=x onerror="void 0"><svg onload="void 0"></svg>',
    '[click](https://example.invalid/" style="background:red" autofocus onfocus="void 0)',
    '[click](jav&#x61;script:alert%281%29)',
    '[click](https://example.invalid/"/><iframe srcdoc="bad"></iframe>)',
  ];
  for (const payload of payloads) {
    const div = window.document.createElement('div'); div.innerHTML = render(payload);
    assert.equal(div.querySelector('script,img,svg,iframe,object,style'), null);
    for (const node of div.querySelectorAll('*')) for (const attr of node.attributes) {
      assert(!/^on/i.test(attr.name)); assert.notEqual(attr.name, 'style');
      if (attr.name === 'href') assert(!/^(javascript|data|vbscript):/i.test(attr.value));
    }
  }
});

test('normal formatting and safe links remain usable', () => {
  const { window, render } = renderer();
  const div = window.document.createElement('div'); div.innerHTML = render('## Heading\n\n**value** [site](https://example.com)');
  assert.equal(div.querySelector('h2').textContent, 'Heading');
  assert.equal(div.querySelector('strong').textContent, 'value');
  assert.equal(div.querySelector('a').href, 'https://example.com/');
});

test('missing sanitizer fails closed as literal text', () => {
  const window = {}; vm.runInNewContext(fs.readFileSync('frontend/js/markdown.js', 'utf8'), { window });
  const result = window.renderMarkdown('<img src=x onerror="x">');
  assert(!result.includes('<')); assert.match(result, /&lt;img/);
});

test('inline action arguments survive apostrophes and cannot execute appended code', () => {
  const source = fs.readFileSync('frontend/js/app.js', 'utf8');
  const functions = source.slice(source.indexOf('function escapeHtml('), source.indexOf('// ─── Cancelamento de assinatura com feedback'));
  const context = {}; vm.runInNewContext(functions, context);
  const payload = "name');globalThis.executed=true;//\"<";
  const dom = new JSDOM(`<button onclick="action(${context.jsString(payload)})">x</button>`);
  const handler = dom.window.document.querySelector('button').getAttribute('onclick');
  const sandbox = { action(value) { sandbox.value = value; } };
  vm.runInNewContext(handler, sandbox);
  assert.equal(sandbox.value, payload); assert.equal(sandbox.executed, undefined);
});
