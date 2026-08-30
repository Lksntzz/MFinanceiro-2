import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const migration = read('supabase/migrations/20260819005000_mf_automation_idempotency_hardening.sql');
const gateway = read('supabase/functions/mf-automation-gateway/index.ts');

test('automation idempotency cache is bound to context_ref', () => {
  assert.match(migration, /mf_automation_idempotency_get\(\s*p_key text,\s*p_context_ref uuid/s);
  assert.match(migration, /item\.context_ref = p_context_ref/);
  assert.match(migration, /context\.revoked_at is null/);
  assert.match(migration, /context\.expires_at > now\(\)/);
  assert.match(migration, /context\.use_count < context\.max_uses/);
});

test('idempotency write rejects key reuse across another context', () => {
  assert.match(migration, /AUTOMATION_IDEMPOTENCY_COLLISION/);
  assert.match(migration, /context_ref is not distinct from excluded\.context_ref/);
  assert.match(migration, /correlation_id = excluded\.correlation_id/);
  assert.match(migration, /action = excluded\.action/);
});

test('gateway passes context_ref on cache lookup', () => {
  assert.match(gateway, /p_context_ref: contextRef/);
  assert.match(gateway, /envelope\.user_context\.context_ref/);
  assert.match(gateway, /idempotencyGet\(admin, envelope\.idempotency_key, null\)/);
});

test('target list cache lifetime stays below context lifetime', () => {
  assert.match(gateway, /ttlSeconds: 600/);
});
