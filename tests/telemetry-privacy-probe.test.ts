import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/lib/telemetry-privacy-probe.ts', 'utf8');

test('privacy probe is restricted to the dedicated Preview host and explicit trigger', () => {
  assert.ok(source.includes("VITE_MF_DIAG_ENVIRONMENT) !== 'preview'"));
  assert.ok(
    source.includes(
      "m-financeiro-2-git-hardening-7386ad-lucasmanga95-4135s-projects.vercel.app",
    ),
  );
  assert.ok(source.includes("PREVIEW_PROBE_VALUE = 'server-v1'"));
  assert.ok(source.includes('trustedMfAdminIngestUrl('));
  assert.ok(source.indexOf('trustedMfAdminIngestUrl(') < source.indexOf('getSession()'));
});

test('privacy probe sends only fixed synthetic sensitive values', () => {
  for (const marker of [
    "module: 'observability.privacy_probe'",
    "operation: 'server_sanitization'",
    "environment: 'preview'",
    "amount: 999",
    "balance: 5000",
    "email: 'privacy-probe@example.invalid'",
    "token: 'synthetic-token-never-valid'",
    "description: 'synthetic-sensitive-description'",
    "raw_payload: 'synthetic-raw-payload'",
    "accepted_count: 3",
    "parser: 'synthetic'",
  ]) {
    assert.ok(source.includes(marker), `missing synthetic probe marker: ${marker}`);
  }
  assert.equal(source.includes('console.log'), false);
  assert.equal(source.includes('localStorage'), false);
});
