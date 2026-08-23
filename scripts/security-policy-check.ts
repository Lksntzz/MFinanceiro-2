import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

function sourceFiles(directory: string): string[] {
  const output: string[] = [];
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) output.push(...sourceFiles(fullPath));
    else if (/\.(?:ts|tsx)$/i.test(entry)) output.push(fullPath);
  }
  return output;
}

const workflowsDir = join(root, '.github', 'workflows');
for (const name of readdirSync(workflowsDir).filter((file) =>
  /\.ya?ml$/i.test(file),
)) {
  if (!/(ci|validate|check)/i.test(name)) continue;
  const content = readFileSync(join(workflowsDir, name), 'utf8');
  assert.equal(
    /contents:\s*write/i.test(content),
    false,
    `${name}: validation workflows must not have contents: write`,
  );
}

const hardeningMigration = read(
  'supabase/migrations/20260810004500_security_architecture_hardening.sql',
);
for (const required of [
  'mf_delete_all_finance_entries',
  'mf_operational_events',
  'mf_admin_audit_events',
  'revoke execute',
  'enable row level security',
]) {
  assert.ok(
    hardeningMigration.toLowerCase().includes(required.toLowerCase()),
    `hardening migration missing ${required}`,
  );
}

const financialHealth = read('src/components/FinancialHealth.tsx');
assert.ok(
  financialHealth.includes('to="/app/analises/insights"'),
  'legacy financial-health route must converge on Insights',
);
assert.equal(
  /calculate|progress|badge|level|healthScore|financialScore/i.test(
    financialHealth,
  ),
  false,
  'legacy financial-health implementation returned',
);

const bootstrap = read('src/components/DashboardBootstrap.tsx');
assert.ok(
  /legacyAutomationRoute\) return <Navigate to="\/app\/integracoes"/i.test(
    bootstrap,
  ),
  'legacy automation route must converge on Conexões',
);

const details = read('src/components/Details.tsx');
assert.ok(
  details.includes('to="/app"'),
  'legacy statistics surface must converge on Início',
);

const dashboard = read('src/components/Dashboard.tsx');
assert.equal(
  dashboard.includes('mf_delete_all_finance_entries'),
  false,
  'bulk ledger deletion must not exist in Dashboard',
);

const accessControl = read('src/lib/access-control.ts');
assert.equal(
  accessControl.includes('supabase.rpc("check_access_request_status"'),
  false,
  'browser must not call privileged access status RPC directly',
);

const forbiddenBrowserRpcs = [
  'check_access_request_status',
  'mf_create_finance_entry_v2',
  'mf_delete_all_finance_entries',
  'mf_fixed_bill_cycle_bounds',
  'mf_resolve_access_entry',
  'mf_sync_fixed_bill_snapshots',
];

for (const file of sourceFiles(join(root, 'src'))) {
  const content = readFileSync(file, 'utf8');
  for (const rpc of forbiddenBrowserRpcs) {
    assert.equal(
      content.includes(`rpc('${rpc}'`) || content.includes(`rpc("${rpc}"`),
      false,
      `${relative(root, file)}: browser code must not call internal RPC ${rpc}`,
    );
  }
}

const legacyOrchestratorPath = join(
  root,
  'src/lib/web-product-orchestrator-mount.tsx',
);
if (existsSync(legacyOrchestratorPath)) {
  const orchestrator = readFileSync(legacyOrchestratorPath, 'utf8');
  assert.equal(
    /createRoot\s*\(/.test(orchestrator),
    false,
    'product guidance must not create a second React root',
  );
  assert.equal(
    /document\.body\.appendChild|document\.createElement\(['"]div['"]\)/.test(
      orchestrator,
    ),
    false,
    'product guidance must not inject its own application host into the DOM',
  );
  assert.equal(
    /setInterval\s*\([^)]*window\.location|setInterval\s*\(sync\s*,/s.test(
      orchestrator,
    ),
    false,
    'product guidance must use router state instead of navigation polling',
  );
}

console.log(
  'Security policy checks passed: permissions, DB hardening, browser RPC boundaries, destructive paths, legacy surfaces and architecture boundaries.',
);
