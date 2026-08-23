import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20260814190000_centralize_user_approvals.sql',
  'utf8',
);
const edgeFunction = readFileSync(
  'supabase/functions/admin-access-control/index.ts',
  'utf8',
);
const dashboard = readFileSync('src/components/Dashboard.tsx', 'utf8');
const accessControl = readFileSync('src/lib/access-control.ts', 'utf8');

assert.ok(
  !dashboard.includes('AdminAccessRequests'),
  'MF Financeiro must not render the user approval administration panel',
);
assert.match(
  migration,
  /revoke all on table public\.mf_access_requests from anon, authenticated/i,
  'Browser roles must not directly read or mutate access requests',
);
assert.match(
  migration,
  /revoke all on function public\.check_access_request_status\(text\) from public, anon, authenticated/i,
  'Privileged request-status lookup must not remain a browser RPC',
);
assert.match(
  migration,
  /grant execute on function public\.submit_access_request\(text, text\) to anon, authenticated, service_role/i,
  'Public request submission must remain available',
);

assert.match(edgeFunction, /MF_ACCESS_APPROVAL_CONTROL_SECRET/);
assert.match(edgeFunction, /x-mf-access-approval-control-secret/);
assert.match(edgeFunction, /identity\.role !== ['"]admin['"]/);
assert.match(edgeFunction, /identity\.aal !== ['"]aal2['"]/);
assert.match(edgeFunction, /SUPABASE_SERVICE_ROLE_KEY/);
assert.match(edgeFunction, /decision_source:\s*['"]mf_administracao['"]/);
assert.match(edgeFunction, /status=in\.\(pending,pendente\)/);

assert.match(accessControl, /supabase\.rpc\(['"]submit_access_request['"]/);
assert.match(
  accessControl,
  /supabase\.functions\.invoke\(\s*['"]resolve-auth-state['"]/,
);

console.log(
  'User approval boundary: MF Financeiro accepts requests and enforces decisions; MF Administração owns approval control.',
);
