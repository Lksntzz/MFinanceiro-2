import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function read(path: string) {
  return readFileSync(path, 'utf8');
}

function expectContains(content: string, value: string, label: string) {
  assert.ok(content.includes(value), `${label}: expected to contain ${value}`);
}

function occurrenceCount(content: string, value: string) {
  return content.split(value).length - 1;
}

const androidManifest = read('android/app/src/main/AndroidManifest.xml');
const androidActivity = read(
  'android/app/src/main/java/br/com/mfinanceiro/app/MainActivity.java',
);
const androidShareStore = read(
  'android/app/src/main/java/br/com/mfinanceiro/app/NativeShareStore.java',
);
const androidSharePlugin = read(
  'android/app/src/main/java/br/com/mfinanceiro/app/NativeShareReceiverPlugin.java',
);
const androidQuickTile = read(
  'android/app/src/main/java/br/com/mfinanceiro/app/MFQuickTileService.java',
);
const androidShortcuts = read('android/app/src/main/res/xml/shortcuts.xml');
const iosInfo = read('ios/App/App/Info.plist');
const iosDelegate = read('ios/App/App/AppDelegate.swift');
const nativeShareBridge = read('src/mobile/native/native-share.ts');
const mainEntry = read('src/main.tsx');

// Android: custom links, native shortcuts and Share Sheet target stay wired to the same app.
expectContains(
  androidManifest,
  'android:scheme="mfinanceiro"',
  'Android deep link',
);
expectContains(
  androidManifest,
  'android.intent.action.SEND',
  'Android share target',
);
expectContains(
  androidManifest,
  'android:mimeType="application/pdf"',
  'Android PDF share target',
);
expectContains(
  androidManifest,
  'android:mimeType="image/*"',
  'Android image share target',
);
expectContains(
  androidManifest,
  'android:mimeType="text/plain"',
  'Android text share target',
);
for (const destination of [
  'mfinanceiro://quick',
  'mfinanceiro://scan',
  'mfinanceiro://pulse',
]) {
  expectContains(
    androidShortcuts,
    destination,
    `Android shortcut ${destination}`,
  );
}

// Android Quick Settings: the tile must be protected by the system permission, require unlock when needed,
// and open the same MF Quick route rather than introducing a parallel native entry flow.
expectContains(
  androidManifest,
  'android:name=".MFQuickTileService"',
  'Android MF Quick tile service',
);
expectContains(
  androidManifest,
  'android.permission.BIND_QUICK_SETTINGS_TILE',
  'Android tile bind permission',
);
expectContains(
  androidManifest,
  'android.service.quicksettings.action.QS_TILE',
  'Android tile intent filter',
);
expectContains(
  androidQuickTile,
  'mfinanceiro://quick',
  'Android tile Quick destination',
);
expectContains(
  androidQuickTile,
  'isSecure() && isLocked()',
  'Android tile lock-screen protection',
);
expectContains(
  androidQuickTile,
  'unlockAndRun(this::openQuickEntry)',
  'Android tile unlock handoff',
);
expectContains(
  androidQuickTile,
  'TileServiceCompat.startActivityAndCollapse',
  'Android tile activity launch compatibility',
);

// BridgeActivity already forwards the initial intent through onNewIntent. Capture it exactly once.
assert.equal(
  occurrenceCount(androidActivity, 'NativeShareStore.capture(this, intent);'),
  1,
  'Android share intent must be captured exactly once in onNewIntent',
);
assert.equal(
  occurrenceCount(
    androidActivity,
    'NativeShareStore.capture(this, getIntent())',
  ),
  0,
  'Android onCreate must not duplicate the initial share capture',
);
expectContains(
  androidActivity,
  'registerPlugin(NativeShareReceiverPlugin.class);',
  'Android custom plugin registration',
);

// Native file receiver: private cache, supported document types and the same 20 MB safety cap as MF Share.
expectContains(
  androidShareStore,
  '20L * 1024L * 1024L',
  'Android native share size cap',
);
expectContains(
  androidShareStore,
  'application/pdf',
  'Android native PDF support',
);
expectContains(androidShareStore, 'image/jpeg', 'Android native JPEG support');
expectContains(androidShareStore, 'image/png', 'Android native PNG support');
expectContains(androidShareStore, 'image/webp', 'Android native WebP support');
expectContains(
  androidSharePlugin,
  '@CapacitorPlugin(name = "NativeShareReceiver")',
  'Android Capacitor share plugin',
);
expectContains(
  androidSharePlugin,
  'getPendingShare',
  'Android share read method',
);
expectContains(
  androidSharePlugin,
  'clearPendingShare',
  'Android share cleanup method',
);

// Web bridge must hydrate the existing MF Share review queue instead of bypassing human review.
expectContains(
  nativeShareBridge,
  'saveMobileSharedPayload',
  'Native share queue reuse',
);
expectContains(nativeShareBridge, '/share?id=', 'Native share review route');
expectContains(
  nativeShareBridge,
  'clearPendingShare',
  'Native share native cleanup',
);
expectContains(
  mainEntry,
  'installNativeShareBridge',
  'Native share bridge bootstrap',
);

// iOS: static Home Screen actions are available immediately after installation and route through the MF scheme.
for (const shortcutType of [
  'br.com.mfinanceiro.app.quick',
  'br.com.mfinanceiro.app.scan',
  'br.com.mfinanceiro.app.pulse',
]) {
  expectContains(iosInfo, shortcutType, `iOS static shortcut ${shortcutType}`);
}
expectContains(
  iosInfo,
  '<string>mfinanceiro</string>',
  'iOS custom URL scheme',
);
expectContains(
  iosDelegate,
  'launchOptions?[.shortcutItem]',
  'iOS quick action cold launch',
);
expectContains(
  iosDelegate,
  'pendingShortcutURL',
  'iOS pending quick action handoff',
);
expectContains(
  iosDelegate,
  'performActionFor shortcutItem',
  'iOS quick action warm launch',
);
for (const destination of [
  'mfinanceiro://quick',
  'mfinanceiro://scan',
  'mfinanceiro://pulse',
]) {
  expectContains(iosDelegate, destination, `iOS shortcut ${destination}`);
}

console.log(
  'Native shell checks passed: Android share target, native shortcuts/Quick Settings tile, iOS quick actions and review-queue bridge.',
);
