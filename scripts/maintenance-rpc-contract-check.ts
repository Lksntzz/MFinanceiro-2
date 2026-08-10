import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migrationPath = 'supabase/migrations/20260810183600_fix_maintenance_scope_key_conflict.sql';
const sql = readFileSync(migrationPath, 'utf8');

assert.match(
  sql,
  /create or replace function public\.mf_set_maintenance_scope\s*\(/i,
  'Hotfix migration must redefine mf_set_maintenance_scope',
);

const safeConflictClauses = sql.match(/on conflict on constraint mf_global_settings_pkey/gi) || [];
assert.equal(
  safeConflictClauses.length,
  2,
  'Mobile and desktop upserts must both target mf_global_settings_pkey explicitly',
);

assert.ok(
  !/on conflict\s*\(\s*key\s*\)/i.test(sql),
  'Scoped maintenance RPC must not use ambiguous ON CONFLICT (key)',
);

for (const scope of ["'mobile'", "'desktop'", "'both'"]) {
  assert.ok(sql.includes(scope), `Scoped maintenance RPC must preserve ${scope}`);
}

assert.match(
  sql,
  /revoke all on function public\.mf_set_maintenance_scope\(text, boolean, text\) from public, anon;/i,
  'RPC must remain unavailable to public/anon',
);
assert.match(
  sql,
  /grant execute on function public\.mf_set_maintenance_scope\(text, boolean, text\) to authenticated, service_role;/i,
  'RPC execution must remain restricted to authenticated/service_role',
);

console.log('Maintenance RPC contract: scoped upserts use the primary-key constraint explicitly.');
