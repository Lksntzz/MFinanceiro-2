import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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
for (const name of readdirSync(workflowsDir).filter((file) => /\.ya?ml$/i.test(file))) {
  if (!/(ci|validate|check)/i.test(name)) continue;
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
  'grant all on table public.mf_operational_events to service_role',
  'drop policy if exists "operational events insert own"',
]) {
  assert.ok(hardeningMigration.toLowerCase().includes(required.toLowerCase()), `hardening migration missing ${required}`);
}
assert.equal(/grant\s+insert\s+on\s+table\s+public\.mf_operational_events\s+to\s+authenticated/i.test(hardeningMigration), false, 'operational telemetry must not accept direct browser inserts');
assert.equal(/create\s+policy\s+["']?operational events insert own/i.test(hardeningMigration), false, 'operational telemetry must remain service-write only');

const rateLimitMigration = read('supabase/migrations/20260810235500_edge_rate_limit_controls.sql');
for (const required of [
  'mf_rate_limit_windows',
  'mf_consume_rate_limit',
  'enable row level security',
  'revoke all on table public.mf_rate_limit_windows from public, anon, authenticated',
  'grant all on table public.mf_rate_limit_windows to service_role',
  'grant execute on function public.mf_consume_rate_limit',
]) {
  assert.ok(rateLimitMigration.toLowerCase().includes(required.toLowerCase()), `rate limit migration missing ${required}`);
}
assert.ok(rateLimitMigration.includes("key_hash text not null check (key_hash ~ '^[a-f0-9]{64}$')"), 'rate limiter must persist only hashed subjects');

const vercelConfig = JSON.parse(read('vercel.json')) as {
  headers?: Array<{ source?: string; headers?: Array<{ key?: string; value?: string }> }>;
  rewrites?: Array<{ source?: string; destination?: string }>;
};
const globalHeaders = vercelConfig.headers?.find((entry) => entry.source === '/(.*)')?.headers || [];
const headerMap = new Map(globalHeaders.map((header) => [String(header.key || '').toLowerCase(), String(header.value || '')]));
const csp = headerMap.get('content-security-policy') || '';
for (const required of [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  'https://cdn.pluggy.ai',
  'https://ckpqoqwvnltmbvyqmmme.supabase.co',
  'upgrade-insecure-requests',
]) {
  assert.ok(csp.includes(required), `CSP missing ${required}`);
}
assert.equal(csp.includes("'unsafe-eval'"), false, 'CSP must not allow generic unsafe-eval');
for (const requiredHeader of [
  'strict-transport-security',
  'x-content-type-options',
  'x-frame-options',
  'referrer-policy',
  'permissions-policy',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
]) {
  assert.ok(headerMap.has(requiredHeader), `web security header missing: ${requiredHeader}`);
}
assert.ok(vercelConfig.rewrites?.some((rewrite) => rewrite.source === '/activate' && rewrite.destination === '/index.html'), 'invite activation must have a direct-navigation rewrite');

const edgeSecurity = read('supabase/functions/_shared/edge-security.ts');
for (const required of [
  'SAFE_CONTEXT_KEYS',
  'sanitizeOperationalContext',
  'crypto.subtle.importKey',
  'HMAC',
  'SHA-256',
  'mf_consume_rate_limit',
  'Cache-Control',
  'no-store',
  'VERCEL_TEAM_SUFFIX',
  'mf_operational_events',
]) {
  assert.ok(edgeSecurity.includes(required), `shared Edge security helper missing ${required}`);
}
assert.equal(edgeSecurity.includes('hostname.endsWith(".vercel.app")'), false, 'Edge CORS must not trust every Vercel application');
assert.equal(edgeSecurity.includes('"Access-Control-Allow-Origin": "*"'), false, 'shared Edge security must not use wildcard CORS');

const operationalEventFunction = read('supabase/functions/operational-event/index.ts');
for (const required of [
  'MAX_BODY_BYTES',
  'auth.getUser',
  'consumeRateLimit',
  'sanitizeOperationalContext',
  'recordOperationalEvent',
  'accepted(request)',
]) {
  assert.ok(operationalEventFunction.includes(required), `operational-event ingestion missing ${required}`);
}
assert.equal(operationalEventFunction.includes('console.error'), false, 'operational ingestion must not dump raw error objects to logs');

const browserObservability = read('src/lib/operational-observability.ts');
assert.ok(browserObservability.includes("supabase.functions.invoke('operational-event'"), 'browser telemetry must use centralized Edge ingestion');
assert.ok(browserObservability.includes('SAFE_CONTEXT_KEYS'), 'browser telemetry must use an allowlist');
assert.equal(browserObservability.includes("from('mf_operational_events')"), false, 'browser telemetry must not write directly to operational event storage');

const criticalRateLimitedFunctions = [
  'supabase/functions/access-request/index.ts',
  'supabase/functions/document-ocr/index.ts',
  'supabase/functions/statement-ocr/index.ts',
  'supabase/functions/open-finance-session/index.ts',
];
for (const path of criticalRateLimitedFunctions) {
  const content = read(path);
  assert.ok(content.includes('consumeRateLimit'), `${path}: sensitive Edge Function must consume a persistent rate limit`);
  assert.ok(content.includes('Retry-After') || path.endsWith('access-request/index.ts'), `${path}: authenticated rate limit responses must expose retry timing`);
  assert.equal(content.includes('"Access-Control-Allow-Origin": "*"'), false, `${path}: sensitive Edge Function must not use wildcard CORS`);
}

const accessRequestFunction = read('supabase/functions/access-request/index.ts');
for (const required of [
  'mf_prepare_access_request',
  'inviteUserByEmail',
  'mf_access_request_id',
  'mf_invite_token',
  'EdgeRuntime.waitUntil',
  'authorizeAdmin',
  'processAdminDecision',
  'access-request-ip',
  'access-request-email',
]) {
  assert.ok(accessRequestFunction.includes(required), `access-request function missing: ${required}`);
}
assert.equal(accessRequestFunction.includes('listUsers'), false, 'access-request function must not enumerate Auth users');
assert.ok(accessRequestFunction.includes('Public responses stay intentionally indistinguishable'), 'public access rate limiting must not become an enumeration oracle');

for (const path of ['supabase/functions/document-ocr/index.ts', 'supabase/functions/statement-ocr/index.ts']) {
  const content = read(path);
  assert.ok(content.includes('provider.request_failed'), `${path}: provider failures must feed redacted observability`);
  assert.equal(content.includes('providerMessage'), false, `${path}: raw AI provider response bodies must not be returned or logged`);
}

const openFinanceSession = read('supabase/functions/open-finance-session/index.ts');
assert.ok(openFinanceSession.includes('open-finance-connect'), 'Open Finance connect token creation must be rate limited independently');
assert.ok(openFinanceSession.includes('open-finance-management'), 'Open Finance management actions must be rate limited independently');
assert.ok(openFinanceSession.includes('open_finance.session_failed'), 'Open Finance failures must feed redacted observability');

const financialHealth = read('src/components/FinancialHealth.tsx');
assert.ok(financialHealth.includes('to="/app/analises/insights"'), 'legacy financial-health route must converge on Insights');
assert.equal(/calculate|progress|badge|level|healthScore|financialScore/i.test(financialHealth), false, 'legacy financial-health implementation returned');

const bootstrap = read('src/components/DashboardBootstrap.tsx');
assert.ok(/legacyAutomationRoute\) return <Navigate to="\/app\/integracoes"/i.test(bootstrap), 'legacy automation route must converge on Conexões');

const details = read('src/components/Details.tsx');
assert.ok(details.includes('to="/app"'), 'legacy statistics surface must converge on Início');

const dashboard = read('src/components/Dashboard.tsx');
assert.equal(dashboard.includes('mf_delete_all_finance_entries'), false, 'bulk ledger deletion must not exist in Dashboard');

const accessControl = read('src/lib/access-control.ts');
assert.ok(accessControl.includes("supabase.functions.invoke('access-request'"), 'public access requests must go through the non-enumerating Edge Function');
assert.equal(/resolveAuthState|fetchAccessStatus|check_access_request_status|mf_resolve_access_entry/.test(accessControl), false, 'browser access control must not expose account/request state discovery');

const authUi = read('src/components/Auth.tsx');
assert.equal(/signUp\s*\(|resolveAuthState|Verificando se este e-mail já possui conta|Conta encontrada/.test(authUi), false, 'public auth UI must not enumerate accounts or create users directly');
assert.ok(authUi.includes('signInWithPassword'), 'existing users must retain password login');

const adminAccessUi = read('src/components/AdminAccessRequests.tsx');
assert.ok(adminAccessUi.includes("supabase.functions.invoke('access-request'"), 'admin approval must use the trusted access-request Edge Function');
assert.equal(/\.from\(['"]mf_access_requests['"]\)[\s\S]{0,500}\.update\(/.test(adminAccessUi), false, 'browser admin UI must not directly update access-request approval state');

const app = read('src/App.tsx');
assert.ok(app.includes("const ACTIVATION_PATH = '/activate'"), 'invite activation route must remain explicit');
assert.ok(app.includes('<InviteActivation session={session} />'), 'invite activation route must use the authenticated invite session');

const accessMigration = read('supabase/migrations/20260810234500_secure_access_invites.sql');
for (const required of [
  'activation_token_hash',
  'mf_prepare_access_request',
  'mf_before_user_created',
  'supabase_auth_admin',
  'service_role',
  'extensions.digest',
  'revoke execute on function public.mf_resolve_access_entry',
  'revoke execute on function public.check_access_request_status',
  'revoke execute on function public.submit_access_request',
]) {
  assert.ok(accessMigration.includes(required), `secure access migration missing: ${required}`);
}

const retiredResolver = read('supabase/functions/resolve-auth-state/index.ts');
assert.ok(retiredResolver.includes('endpoint_retired'), 'legacy auth-state resolver must stay retired');
assert.equal(/listUsers|check_access_request_status|SUPABASE_SERVICE_ROLE_KEY/.test(retiredResolver), false, 'retired auth-state resolver must not retain privileged discovery logic');

const serviceWorker = read('public/sw.js');
for (const required of [
  "const CACHE_PREFIX = 'mfinanceiro-assets-'",
  'MAX_CACHED_ASSETS',
  "url.pathname.startsWith('/assets/')",
  '!url.search',
  "request.headers.has('authorization')",
  "request.headers.has('apikey')",
  "cacheControl.includes('private')",
  "cacheControl.includes('no-store')",
  'trimAssetCache(cache)',
]) {
  assert.ok(serviceWorker.includes(required), `service worker cache policy missing: ${required}`);
}
assert.equal(serviceWorker.includes("key.startsWith('mfinanceiro-')"), false, 'service worker must not delete unrelated MF caches');
assert.equal(/if \(request\.method === ['"]GET['"]\)[\s\S]{0,500}cache\.put/.test(serviceWorker), false, 'service worker must not cache arbitrary GET responses');

const packageJson = JSON.parse(read('package.json')) as { devDependencies?: Record<string, string> };
assert.ok(/^\^4\.23\./.test(packageJson.devDependencies?.tsx || ''), 'tsx must stay on the patched 4.23 line or newer');
const packageLock = read('package-lock.json');
assert.ok(packageLock.includes('"tsx": "^4.23.12"'), 'package lock must pin the patched tsx range');
assert.ok(packageLock.includes('"version": "0.28.2"'), 'package lock must contain the patched esbuild 0.28.2 resolution');

const forbiddenBrowserRpcs = [
  'check_access_request_status',
  'mf_create_finance_entry_v2',
  'mf_delete_all_finance_entries',
  'mf_fixed_bill_cycle_bounds',
  'mf_resolve_access_entry',
  'mf_sync_fixed_bill_snapshots',
  'submit_access_request',
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
  assert.equal(
    /\.from\(['"]mf_operational_events['"]\)/.test(content),
    false,
    `${relative(root, file)}: operational telemetry storage is service-only`,
  );
}

const legacyOrchestratorPath = join(root, 'src/lib/web-product-orchestrator-mount.tsx');
if (existsSync(legacyOrchestratorPath)) {
  const orchestrator = readFileSync(legacyOrchestratorPath, 'utf8');
  assert.equal(/createRoot\s*\(/.test(orchestrator), false, 'product guidance must not create a second React root');
  assert.equal(/document\.body\.appendChild|document\.createElement\(['"]div['"]\)/.test(orchestrator), false, 'product guidance must not inject its own application host into the DOM');
  assert.equal(/setInterval\s*\([^)]*window\.location|setInterval\s*\(sync\s*,/s.test(orchestrator), false, 'product guidance must use router state instead of navigation polling');
}

console.log('Security policy checks passed: CSP and web headers, persistent rate limits, redacted service-only observability, invite-only auth, trusted admin approval, patched dependencies, browser RPC boundaries, destructive paths, service-worker cache isolation and architecture boundaries.');
