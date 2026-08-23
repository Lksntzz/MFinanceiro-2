import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/lib/operational-observability.ts', 'utf8');
const env = readFileSync('.env.example', 'utf8');

for (const required of [
  'normalizePrivacyKey',
  'SAFE_STRING_CONTEXT_KEYS',
  'SAFE_NUMBER_CONTEXT_KEYS',
  'FORBIDDEN_KEY_FRAGMENTS',
  'createOperationalCorrelationId()',
  'VITE_MF_DIAG_ENVIRONMENT',
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
assert.ok(
  env.includes('VITE_MF_ADMIN_INGEST_URL') &&
    env.includes('VITE_MF_DIAG_ENVIRONMENT'),
  'public diagnostic environment variables must be documented',
);

console.log('Telemetry privacy contract passed.');
