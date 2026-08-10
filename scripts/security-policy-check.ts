import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const workflowsDir = join(root, '.github', 'workflows');
for (const name of readdirSync(workflowsDir).filter((file) => /\.ya?ml$/i.test(file))) {
  const content = readFileSync(join(workflowsDir, name), 'utf8');
  assert.equal(/contents:\s*write/i.test(content), false, `${name}: validation workflows must not have contents: write`);
}

const hardeningMigration = read('supabase/migrations/20260810004500_security_architecture_hardening.sql');
for (const required of [
  'mf_delete_all_finance_entries',
  'mf_operational_events',
  'mf_admin_audit_events',
  'revoke execute',
  'enable row level security',
]) {
  assert.ok(hardeningMigration.toLowerCase().includes(required.toLowerCase()), `hardening migration missing ${required}`);
}

const financialHealth = read('src/components/FinancialHealth.tsx');
assert.ok(financialHealth.includes('to="/app/analises/insights"'), 'legacy financial-health route must converge on Insights');
assert.equal(/calculate|progress|badge|level|healthScore|financialScore/i.test(financialHealth), false, 'legacy financial-health implementation returned');

const automationCenter = read('src/components/AutomationCenter.tsx');
assert.ok(automationCenter.includes('/app/integracoes'), 'standalone automation center must converge on Conexões');

const details = read('src/components/Details.tsx');
assert.ok(details.includes('to="/app"'), 'legacy statistics surface must converge on Início');

const dashboard = read('src/components/Dashboard.tsx');
assert.equal(dashboard.includes('mf_delete_all_finance_entries'), false, 'bulk ledger deletion must not exist in Dashboard');

const accessControl = read('src/lib/access-control.ts');
assert.equal(accessControl.includes('supabase.rpc("check_access_request_status"'), false, 'browser must not call privileged access status RPC directly');

console.log('Security policy checks passed: workflow permissions, DB hardening, destructive paths and retired legacy surfaces.');
