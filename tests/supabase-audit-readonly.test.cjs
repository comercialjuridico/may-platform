const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const sql = fs.readFileSync('supabase/audit_staging_readonly.sql', 'utf8');

// The file is designed to be pasted in the isolated Supabase SQL Editor.
// Guard against future edits adding data mutation or privileged SQL.
test('Supabase staging audit is exclusively read-only SELECT statements', () => {
  const withoutComments = sql.replace(/^\s*--[^\n]*/gm, '').trim();
  const statements = withoutComments.split(';').map(s => s.trim()).filter(Boolean);
  assert(statements.length >= 6, 'Expected RLS, grants, policies, functions and foreign-key checks');
  for (const statement of statements) {
    assert.match(statement, /^SELECT\b/i, 'Audit must contain only SELECT statements');
    assert.doesNotMatch(statement,
      /\b(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|EXECUTE|COPY|CALL|DO)\s+(?:TABLE|POLICY|FUNCTION|INTO|FROM|\w+)/i,
      'Audit must not contain executable mutations');
  }
});

test('Supabase staging audit verifies RLS, both roles, tenant columns and policies', () => {
  for (const name of ['pg_policies', 'relrowsecurity', 'anon', 'authenticated',
    'pg_constraint', 'empresa_id', 'user_id', 'usuario_id', 'prosecdef']) {
    assert(sql.includes(name), 'Missing security check: ' + name);
  }
});
