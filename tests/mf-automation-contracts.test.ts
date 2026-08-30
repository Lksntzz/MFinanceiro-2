import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTOMATION_CONTRACT_VERSION,
  buildIdempotencyKey,
  sanitizeNotificationText,
  validateAutomationEnvelope,
  validateTargetEnvelope,
} from '../supabase/functions/_shared/mf-automation-contract.ts';

const correlationId = '6cb2ba18-5f8c-4a9b-8a28-32164d614a57';
const contextRef = '913d1072-237c-47e1-8ae1-e52acc1d6b37';

test('accepts a minimal sanitized automation envelope', () => {
  const envelope = validateAutomationEnvelope({
    version: AUTOMATION_CONTRACT_VERSION,
    action: 'budget.context',
    correlation_id: correlationId,
    idempotency_key: buildIdempotencyKey('budget.context', correlationId),
    user_context: {
      context_ref: contextRef,
      mode: 'automation_initiated',
      scope: 'budget',
    },
    payload: {},
  });

  assert.equal(envelope.action, 'budget.context');
  assert.equal(envelope.user_context.scope, 'budget');
});

test('rejects financial values and descriptions in n8n payloads', () => {
  for (const payload of [
    { amount: 100 },
    { balance: 200 },
    { nested: { description: 'mercado' } },
    { raw_statement: 'private' },
  ]) {
    assert.throws(() => validateAutomationEnvelope({
      version: AUTOMATION_CONTRACT_VERSION,
      action: 'pulse.context',
      correlation_id: correlationId,
      idempotency_key: buildIdempotencyKey('pulse.context', correlationId),
      user_context: {
        context_ref: contextRef,
        mode: 'automation_initiated',
        scope: 'pulse',
      },
      payload,
    }), /AUTOMATION_PAYLOAD_FORBIDDEN_FIELD/);
  }
});

test('requires action plus correlation id for idempotency', () => {
  assert.throws(() => validateAutomationEnvelope({
    version: AUTOMATION_CONTRACT_VERSION,
    action: 'card.context',
    correlation_id: correlationId,
    idempotency_key: correlationId,
    user_context: {
      context_ref: contextRef,
      mode: 'automation_initiated',
      scope: 'cards',
    },
    payload: {},
  }), /AUTOMATION_IDEMPOTENCY_KEY_INVALID/);
});

test('validates internal target discovery without exposing a user id', () => {
  const envelope = validateTargetEnvelope({
    version: AUTOMATION_CONTRACT_VERSION,
    action: 'targets.list',
    correlation_id: correlationId,
    idempotency_key: buildIdempotencyKey('targets.list', correlationId),
    payload: { module: 'pulse', limit: 50 },
  });

  assert.deepEqual(envelope.payload, { module: 'pulse', limit: 50 });
});

test('notification text refuses currency and obvious PII', () => {
  assert.equal(sanitizeNotificationText('Você possui 3 compromissos próximos.', 120), 'Você possui 3 compromissos próximos.');
  assert.throws(() => sanitizeNotificationText('Você gastou R$ 100 hoje.', 120), /AUTOMATION_NOTIFICATION_FINANCIAL_VALUE_FORBIDDEN/);
  assert.throws(() => sanitizeNotificationText('Contato teste@example.com', 120), /AUTOMATION_NOTIFICATION_PII_FORBIDDEN/);
});
