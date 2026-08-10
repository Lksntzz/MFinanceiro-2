import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shell = readFileSync('src/mobile/MobileAppShell.tsx', 'utf8');
const app = readFileSync('src/mobile/MobileApp.tsx', 'utf8');
const appGate = readFileSync('src/App.tsx', 'utf8');
const maintenance = readFileSync('src/lib/maintenance.ts', 'utf8');
const mobileProfile = readFileSync('src/mobile/pages/MobileProfile.tsx', 'utf8');
const desktopMaintenance = readFileSync('src/components/AdminMaintenanceControl.tsx', 'utf8');

const cardsBlock = app.slice(app.indexOf('function CardsPage'), app.indexOf('function MorePage'));
const moreBlock = app.slice(app.indexOf('function MorePage'), app.indexOf('export default function MobileApp'));

assert.ok(cardsBlock.length > 0, 'CardsPage block must exist');
assert.ok(moreBlock.length > 0, 'MorePage block must exist');

for (const label of ['Início', 'Movimentos', 'Cartões', 'Mais']) {
  assert.ok(shell.includes(`label: '${label}'`), `Primary mobile nav must keep ${label}`);
}
assert.match(shell, /className="mf-mobile-nav__quick"/, 'Primary mobile nav must keep the central + action');

assert.ok(!cardsBlock.includes('purchaseImpact'), 'Purchase impact must not alter the approved Cards primary surface');
assert.ok(!moreBlock.includes('MOBILE_ROUTES.pulse'), 'MF Pulse must stay outside the approved More primary surface');
assert.ok(!moreBlock.includes('MOBILE_ROUTES.documentInbox'), 'Document Inbox must stay outside the approved More primary surface');
assert.ok(moreBlock.includes('<strong>Perfil</strong>'), 'Approved More surface must keep the authorized mobile profile entry');
assert.ok(moreBlock.includes('<strong>MF Inbox</strong>'), 'Approved More surface must keep MF Inbox');
assert.ok(moreBlock.includes('<strong>MF Scan</strong>'), 'Approved More surface must keep MF Scan');
assert.ok(moreBlock.includes('<strong>MF Quick</strong>'), 'Approved More surface must keep MF Quick');
assert.ok(moreBlock.includes('<strong>Abrir versão completa</strong>'), 'Approved More surface must keep desktop handoff');

for (const route of ['profile', 'documentInbox', 'purchaseImpact', 'pulse']) {
  assert.ok(app.includes(`MOBILE_ROUTES.${route}`), `Advanced route ${route} must remain implemented behind the approved layout`);
}

assert.ok(maintenance.includes(".in('key', ['global', 'mobile', 'desktop'])"), 'Maintenance config must read independent mobile and desktop scopes with legacy fallback');
assert.ok(maintenance.includes('isCurrentMobileExperience()'), 'Maintenance config must project state to the current client surface');
assert.ok(appGate.includes("table: 'mf_global_settings'"), 'Application must continue listening to maintenance changes');
assert.ok(!appGate.includes("filter: 'key=eq.global'"), 'Maintenance listener must not ignore scoped mobile/desktop rows');
assert.ok(appGate.includes(".on('broadcast', { event: MAINTENANCE_BROADCAST_EVENT }, () =>"), 'Maintenance broadcasts must trigger a fresh scoped read');
assert.ok(mobileProfile.includes("setScope('mobile')"), 'Mobile admin profile must expose mobile-only maintenance');
assert.ok(mobileProfile.includes("setScope('desktop')"), 'Mobile admin profile must expose desktop-only maintenance');
assert.ok(mobileProfile.includes("setScope('both')"), 'Mobile admin profile must expose combined maintenance');
assert.ok(mobileProfile.includes("supabase.rpc('mf_set_maintenance_scope'"), 'Mobile maintenance must use the scoped privileged RPC');
assert.ok(mobileProfile.includes('user.app_metadata?.role'), 'Mobile administrator visibility must rely on trusted app metadata');
assert.ok(mobileProfile.includes('mfa.getAuthenticatorAssuranceLevel'), 'Mobile privileged maintenance must retain MFA session checks');
assert.ok(desktopMaintenance.includes("supabase.rpc('mf_set_maintenance_mode'"), 'Desktop maintenance UI must remain on its existing RPC contract');
assert.ok(!desktopMaintenance.includes("mf_set_maintenance_scope"), 'Mobile implementation must not redesign desktop maintenance controls');

console.log('Mobile layout contract: approved primary structure and scoped maintenance preserved.');
