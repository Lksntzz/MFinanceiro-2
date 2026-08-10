import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const shell = readFileSync('src/mobile/MobileAppShell.tsx', 'utf8');
const app = readFileSync('src/mobile/MobileApp.tsx', 'utf8');

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
assert.ok(moreBlock.includes('<strong>MF Inbox</strong>'), 'Approved More surface must keep MF Inbox');
assert.ok(moreBlock.includes('<strong>MF Scan</strong>'), 'Approved More surface must keep MF Scan');
assert.ok(moreBlock.includes('<strong>MF Quick</strong>'), 'Approved More surface must keep MF Quick');
assert.ok(moreBlock.includes('<strong>Abrir versão completa</strong>'), 'Approved More surface must keep desktop handoff');

for (const route of ['documentInbox', 'purchaseImpact', 'pulse']) {
  assert.ok(app.includes(`MOBILE_ROUTES.${route}`), `Advanced route ${route} must remain implemented behind the approved layout`);
}

console.log('Mobile layout contract: approved primary structure preserved.');
