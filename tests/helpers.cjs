const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const express = require('express');

function loadRoute(relative, mocks) {
  const filename = path.resolve(__dirname, '..', relative);
  const realRequire = createRequire(filename);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, console, process, Buffer, Date,
    require: name => Object.hasOwn(mocks, name) ? mocks[name] : realRequire(name),
  }, { filename });
  return module.exports;
}

// Banco de teste implementa filtros e efeitos, em vez de apenas retornar
// sucesso. Isso permite verificar isolamento e ausência de alterações.
function database(tables) {
  const events = [];
  const api = {
    tables, events,
    rpc: async () => ({ data: null, error: null }),
    from(table) {
      const q = {
        op: 'read', conditions: [], columns: null, count: null,
        select(columns) { this.columns = columns; return this; },
        eq(key, value) { this.conditions.push(r => r[key] === value); return this; },
        gt(key, value) { this.conditions.push(r => r[key] > value); return this; },
        gte(key, value) { this.conditions.push(r => r[key] >= value); return this; },
        is(key, value) { return this.eq(key, value); },
        in(key, values) { this.conditions.push(r => values.includes(r[key])); return this; },
        or(expr) {
          if (expr === 'totp_enabled.is.null,totp_enabled.eq.false') {
            this.conditions.push(r => r.totp_enabled == null || r.totp_enabled === false);
          } else throw Error('Filtro de teste não implementado: ' + expr);
          return this;
        },
        order(key, options) { this.ordering = { key, options }; return this; },
        limit(n) { this.count = n; return this; },
        update(value) { this.op = 'update'; this.value = value; return this; },
        insert(value) { this.op = 'insert'; this.value = value; return this; },
        single() { this.one = true; this.required = true; return this; },
        maybeSingle() { this.one = true; return this; },
        catch(reject) { return this.then(x => x, reject); },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            events.push({ table, op: this.op, value: this.value, columns: this.columns });
            if (api.error) return { data: null, error: api.error };
            const source = tables[table] ||= [];
            let rows = source.filter(r => this.conditions.every(fn => fn(r)));
            if (this.op === 'insert') {
              const row = { id: 'created-' + source.length, ...this.value };
              source.push(row); rows = [row];
            } else if (this.op === 'update') rows.forEach(r => Object.assign(r, this.value));
            if (this.ordering) {
              const { key, options } = this.ordering;
              rows = rows.slice().sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * (options.ascending ? 1 : -1));
            }
            if (this.count !== null) rows = rows.slice(0, this.count);
            const project = row => {
              if (!this.columns || this.columns === '*') return { ...row };
              return Object.fromEntries(this.columns.split(',').map(k => [k.trim(), row[k.trim()]]));
            };
            if (this.one && !rows.length && this.required) return { data: null, error: { code: 'PGRST116' } };
            return { data: this.one ? rows[0] ? project(rows[0]) : null : rows.map(project), error: null };
          }).then(resolve, reject);
        },
      };
      return q;
    },
  };
  return api;
}

async function withApp(router, run, before) {
  const app = express(); app.use(express.json());
  if (before) app.use(before);
  app.use(router);
  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    await run(async (url, body, headers = {}) => {
      const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch { data = text; }
      return { status: res.status, data, type: res.headers.get('content-type') };
    });
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

module.exports = { loadRoute, database, withApp };
