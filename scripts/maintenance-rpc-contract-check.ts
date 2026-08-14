import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260814170000_centralize_maintenance_control.sql',
  'utf8',
);
const iosMigration = readFileSync(
  'supabase/migrations/20260814221000_add_ios_maintenance_target.sql',
  'utf8',
);
const edgeFunction = readFileSync(
  'supabase/functions/admin-maintenance-control/index.ts',
  'utf8',
);
const dashboard = readFileSync('src/components/Dashboard.tsx', 'utf8');
const mobileProfile = readFileSync('src/mobile/pages/MobileProfile.tsx', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');

assert.match(
  migration,
  /revoke all on function public\.mf_set_maintenance_mode\(boolean, text\)[\s\S]*authenticated/i,
  'Legacy maintenance mode RPC must not remain executable by authenticated browser users',
);
assert.match(
  migration,
  /revoke all on function public\.mf_set_maintenance_scope\(text, boolean, text\)[\s\S]*authenticated/i,
  'Scoped maintenance RPC must not remain executable by authenticated browser users',
);

assert.match(iosMigration, /where key = 'mobile'/);
assert.match(iosMigration, /'ios'/);

assert.match(edgeFunction, /MF_ADMIN_SUPABASE_URL/);
assert.match(edgeFunction, /MF_ADMIN_PUBLISHABLE_KEY/);
assert.match(edgeFunction, /\/auth\/v1\/user/);
assert.match(edgeFunction, /identity\.role !== "admin"/);
assert.match(edgeFunction, /identity\.aal !== "aal2"/);
assert.match(edgeFunction, /SUPABASE_SERVICE_ROLE_KEY/);
assert.match(edgeFunction, /MF_MAINTENANCE_CONTROL_SECRET/);
assert.match(edgeFunction, /MF_ADMIN_SERVICE_INGEST_SECRET/);
assert.match(edgeFunction, /x-mf-maintenance-control-secret/);
assert.match(edgeFunction, /safeEqual\(suppliedControlSecret, expectedControlSecret\)/);
assert.match(edgeFunction, /"mobile", "desktop", "ios"/);
assert.match(edgeFunction, /body\.targets/);
assert.ok(
  !edgeFunction.includes('mf_set_maintenance_scope') && !edgeFunction.includes('mf_set_maintenance_mode'),
  'Server control endpoint must not depend on legacy browser-admin RPCs',
);

assert.ok(!dashboard.includes('AdminMaintenanceControl'), 'Financeiro desktop must not render maintenance administration');
assert.ok(!mobileProfile.includes('mf_set_maintenance_scope'), 'Financeiro mobile must not mutate maintenance state');
assert.ok(!mobileProfile.includes('Manutenção'), 'Financeiro mobile profile must not expose a maintenance administration card');
assert.ok(!app.includes('isMaintenanceBypass='), 'Financeiro must not pass maintenance bypass into the product shell');
assert.match(
  app,
  /if \(maintenanceEnabled\) \{[\s\S]*<MaintenanceScreen/,
  'Maintenance enforcement must apply before Financeiro renders the authenticated product',
);

console.log('Maintenance control boundary: one Admin control plane targets desktop, mobile/Android and iOS.');
