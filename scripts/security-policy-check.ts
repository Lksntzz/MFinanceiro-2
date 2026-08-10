import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const workflowsDir = join(root, '.github', 'workflows');
for (const name of readdirSync(workflowsDir).filter((file) => /\.ya?ml$/i.test(file))) {
  const content = readFileSync(join(workflowsDir, name), 'utf8');
  assert.equal(
    /contents:\s*write/i.test(content),
    false,
    `${name}: validation workflows must not have contents: write`,
  );
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
assert.equal(/0\s*[–-]\s*1000|score|conquista/i.test(financialHealth), false, 'legacy financial-health scoring returned');

const automationCenter = read('src/components/AutomationCenter.tsx');
assert.ok(automationCenter.includes('/app/integracoes'), 'standalone automation center must converge on Conexões');

const details = read('src/components/Details.tsx');
assert.ok(details.includes('to="/app"'), 'legacy statistics surface must converge on Início');

console.log('Security policy checks passed: workflow permissions, DB hardening and retired legacy surfaces.');
