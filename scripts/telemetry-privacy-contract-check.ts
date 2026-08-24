import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TRUSTED_MF_ADMIN_INGEST_URL,
  trustedMfAdminIngestUrl,
} from '../src/lib/telemetry-endpoint';

const source = readFileSync('src/lib/operational-observability.ts', 'utf8');
const endpoint = readFileSync('src/lib/telemetry-endpoint.ts', 'utf8');
const env = readFileSync('.env.example', 'utf8');

for (const required of [
  'normalizePrivacyKey',
  'SAFE_STRING_CONTEXT_KEYS',
  'SAFE_NUMBER_CONTEXT_KEYS',
  'FORBIDDEN_KEY_FRAGMENTS',
  'createOperationalCorrelationId()',
  'VITE_MF_DIAG_ENVIRONMENT',
  'trustedMfAdminIngestUrl',
]) {
  assert.ok(
    source.includes(required),
    `missing telemetry privacy guard: ${required}`,
  );
}

for (const forbidden of [
  'raw_payload',
  'base_text_preview',
  'VITE_MF_DIAGNOSTIC_ENV',
]) {
  assert.equal(
    source.includes(forbidden),
    false,
    `obsolete or unsafe telemetry value: ${forbidden}`,
  );
}

assert.equal(
  source.includes('message:'),
  false,
  'telemetry must not include free-text messages in event payloads',
);
assert.ok(
  source.includes('correlation_id: isUuid(options.correlationId)') &&
    source.includes(': createOperationalCorrelationId()'),
  'telemetry must fall back to an operation correlation id',
);

assert.equal(
  trustedMfAdminIngestUrl(TRUSTED_MF_ADMIN_INGEST_URL),
  TRUSTED_MF_ADMIN_INGEST_URL,
  'trusted Admin ingest URL must be accepted',
);
for (const unsafeUrl of [
  'http://lyhsttditfrxmfnnligk.supabase.co/functions/v1/ingest-event',
  'https://attacker.example/functions/v1/ingest-event',
  `${TRUSTED_MF_ADMIN_INGEST_URL}?redirect=https://attacker.example`,
  'https://lyhsttditfrxmfnnligk.supabase.co/functions/v1/other',
]) {
  assert.equal(
    trustedMfAdminIngestUrl(unsafeUrl),
    null,
    `untrusted diagnostic target must fail closed: ${unsafeUrl}`,
  );
}
assert.ok(
  endpoint.includes("candidate.protocol !== 'https:'") &&
    source.indexOf('trustedMfAdminIngestUrl(') < source.indexOf('supabase.auth.getSession()'),
  'diagnostic destination must be validated before reading the user session token',
);
assert.ok(
  env.includes(`VITE_MF_ADMIN_INGEST_URL="${TRUSTED_MF_ADMIN_INGEST_URL}"`) &&
    env.includes('VITE_MF_DIAG_ENVIRONMENT'),
  'public diagnostic variables must document the pinned endpoint',
);

console.log('Telemetry privacy contract passed.');
