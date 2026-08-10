// Bank format adapters are pure parsing compatibility layers.
import './lib/unified-transaction-launcher-mount';
import './lib/mega-update-announcement-mount';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App.tsx';
import AccessibilityLayer from './components/AccessibilityLayer';
import { AppProvider } from './context/AppContext';
import { installNativeDeepLinkBridge } from './mobile/native/native-deep-links';
import { installNativeShareBridge } from './mobile/native/native-share';
import './index.css';
import './layout-tuning.css';
import './navigation.css';
import './stage6.css';

const VERSION_CHECK_INTERVAL_MS = 60_000;
let versionReloadStarted = false;

async function checkForAppUpdate() {
  if (!import.meta.env.PROD || versionReloadStarted) return;

  try {
    const response = await fetch(`/version.json?check=${Date.now()}`, {
      cache: 'no-store',
      headers: { 'cache-control': 'no-cache' },
    });
    if (!response.ok) return;

    const remoteVersion = await response.json() as { buildId?: string };
    if (!remoteVersion.buildId || remoteVersion.buildId === __MF_BUILD_ID__) return;

    versionReloadStarted = true;

    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        await registration?.update();
      } catch {
        // A failed SW refresh must not prevent loading the new application build.
      }
    }

    window.location.reload();
  } catch {
    // Offline/temporary network failures are retried on the next check.
  }
}

function startAppVersionWatcher() {
  if (!import.meta.env.PROD) return;

  void checkForAppUpdate();
  window.setInterval(() => void checkForAppUpdate(), VERSION_CHECK_INTERVAL_MS);
  window.addEventListener('focus', () => void checkForAppUpdate());
  window.addEventListener('online', () => void checkForAppUpdate());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForAppUpdate();
  });
}

window.addEventListener('load', () => {
  if ('serviceWorker' in navigator) {
    if (import.meta.env.PROD) {
      navigator.serviceWorker.register('/sw.js').then((registration) => {
        registration.update().catch(() => {});
      }).catch((registrationError) => {
        console.log('SW registration failed: ', registrationError);
      });
    } else {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => registration.unregister());
      });
    }
  }

  startAppVersionWatcher();
});

void installNativeDeepLinkBridge();
void installNativeShareBridge();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AccessibilityLayer />
      <AppProvider>
        <App />
      </AppProvider>
    </BrowserRouter>
  </StrictMode>,
);
