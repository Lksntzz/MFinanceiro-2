import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(path, 'utf8');

test('Open Finance sync writes canonical account table, never the balance view', () => {
  const sync = read('supabase/functions/open-finance-sync/index.ts');
  assert.doesNotMatch(sync, /from\(["']mf_account_balances["']\)/);
  assert.match(sync, /mf_upsert_open_finance_account_service/);
  assert.match(sync, /mf_upsert_open_finance_entry_service/);
  assert.match(sync, /mf_reconcile_open_finance_account_balance_service/);
  assert.match(sync, /OPEN_FINANCE_PROVIDER_BALANCE_MISSING/);
});

test('Open Finance migration owns provider metadata on canonical accounts', () => {
  const migration = read('supabase/migrations/20260814053000_open_finance_stabilization.sql');
  assert.match(migration, /alter table public\.mf_financial_accounts/);
  assert.match(migration, /bank_connection_id/);
  assert.match(migration, /create or replace view public\.mf_account_balances/);
  assert.doesNotMatch(migration, /alter table public\.mf_account_balances/);
  assert.match(migration, /to service_role/);
});

test('Pluggy pagination fails closed instead of returning truncated history', () => {
  const pluggy = read('supabase/functions/_shared/pluggy.ts');
  assert.match(pluggy, /MAX_TRANSACTION_PAGES/);
  assert.match(pluggy, /excedeu o limite seguro de páginas/);
  assert.doesNotMatch(pluggy, /text\.slice\(0, 300\)/);
});

test('browser bind verifies Pluggy clientUserId ownership', () => {
  const session = read('supabase/functions/open-finance-session/index.ts');
  assert.match(session, /fetchItem\(apiKey, itemId\)/);
  assert.match(session, /providerOwner !== userData\.user\.id/);
  assert.match(session, /OPEN_FINANCE_BIND_OWNERSHIP_MISMATCH/);
});

test('webhook does not persist or echo raw provider failure payloads', () => {
  const webhook = read('supabase/functions/open-finance-webhook/index.ts');
  assert.doesNotMatch(webhook, /JSON\.stringify\(payload\.error/);
  assert.doesNotMatch(webhook, /syncError:\s*syncPayload/);
  assert.match(webhook, /deletedTransactionIds/);
});

test('service telemetry is best effort even without EdgeRuntime waitUntil', () => {
  const telemetry = read('supabase/functions/_shared/mf-admin-telemetry.ts');
  assert.match(telemetry, /function keepAlive/);
  assert.match(telemetry, /void task/);
  assert.match(telemetry, /diagnostics are strictly best-effort/);
});

test('fixed bill payment is a single atomic RPC from the client', () => {
  const hook = read('src/hooks/useDashboardWorkspace.ts');
  assert.match(hook, /mf_pay_fixed_bill_current/);
  const start = hook.indexOf('const payFixedBill');
  const end = hook.indexOf('const importTransactions', start);
  const payBlock = hook.slice(start, end);
  assert.doesNotMatch(payBlock, /mf_create_finance_entry_v3/);
  assert.doesNotMatch(payBlock, /from\('mf_fixed_bills'\)\.update/);
});

test('statement import reuses one correlation id through persistence', () => {
  const types = read('src/types.ts');
  const component = read('src/components/ImportarExtratosCore.tsx');
  const hook = read('src/hooks/useDashboardWorkspace.ts');
  assert.match(types, /correlationId\?: string/);
  assert.match(component, /parserName: importDiagnostics\?\.parserLabel,\s*correlationId,/);
  assert.match(hook, /options\.correlationId \|\| createOperationalCorrelationId\(\)/);
});

test('statement OCR returns document-level statement balance directly', () => {
  const ocr = read('supabase/functions/statement-ocr/index.ts');
  assert.match(ocr, /statementBalance: metadata\.statement_balance/);
});
