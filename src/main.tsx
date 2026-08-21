import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App.tsx';
import AccessibilityLayer from './components/AccessibilityLayer';
import AppErrorBoundary from './components/AppErrorBoundary';
import { AppProvider } from './context/AppContext';
import {
  createOperationalCorrelationId,
  installGlobalOperationalObservers,
  reportOperationalEvent,
} from './lib/operational-observability';
import { installNativeDeepLinkBridge } from './mobile/native/native-deep-links';
import { installNativeShareBridge } from './mobile/native/native-share';
import './index.css';
import './layout-tuning.css';
import './navigation.css';
import './stage6.css';
import './product-maturity.css';
import './product-maturity-additions.css';

const VERSION_CHECK_INTERVAL_MS = 60_000;
const DIAG_ENVIRONMENT = String(import.meta.env.VITE_MF_DIAG_ENVIRONMENT || '').trim().toLowerCase();
const SHOULD_USE_SERVICE_WORKER = import.meta.env.PROD && DIAG_ENVIRONMENT !== 'preview';
let versionReloadStarted = false;

async function checkForAppUpdate() {
  if (!SHOULD_USE_SERVICE_WORKER || versionReloadStarted) return;

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
  if (!SHOULD_USE_SERVICE_WORKER) return;

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
    if (SHOULD_USE_SERVICE_WORKER) {
      navigator.serviceWorker.register('/sw.js').then((registration) => {
        registration.update().catch(() => {});
      }).catch(() => {
        void import('./lib/operational-observability').then(({ reportOperationalEvent }) =>
          reportOperationalEvent('runtime.service_worker_registration_failed', 'service-worker', 'warning'),
        );
      });
    } else {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => registration.unregister());
      });
    }
  }

  startAppVersionWatcher();
});

installGlobalOperationalObservers();

if (DIAG_ENVIRONMENT === 'preview') {
  const previewWindow = window as typeof window & { __mfDiagSmokeTest?: () => string };
  previewWindow.__mfDiagSmokeTest = () => {
    const correlationId = createOperationalCorrelationId();
    reportOperationalEvent(
      'diagnostic.preview_smoke_test',
      'observability-transport',
      'info',
      { synthetic: true, phase: '1.6' },
      {
        category: 'infrastructure',
        module: 'observability.transport',
        operation: 'preview_smoke_test',
        errorCode: 'PHASE16_PREVIEW_SMOKE_TEST',
        impact: 'none',
        correlationId,
        severity: 'low',
      },
    );
    return correlationId;
  };
}

void installNativeDeepLinkBridge();
void installNativeShareBridge();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <BrowserRouter>
        <AccessibilityLayer />
        <AppProvider>
          <App />
        </AppProvider>
      </BrowserRouter>
    </AppErrorBoundary>
  </StrictMode>,
);
