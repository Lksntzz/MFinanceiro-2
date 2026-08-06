import './lib/settings-conflict-recovery';
import './lib/auth-refresh-guard';
import './lib/dashboard-data-sync';
import './lib/rhythm-chart-filter';
import './lib/admin-maintenance-mount';
import './lib/bank-excel-parser-guard';
import './lib/bank-csv-parser-guard';
import './lib/installment-manager-mount';
import './lib/income-payroll-center-mount';
import './lib/income-payroll-layer-guard';
import './lib/payroll-cycle-display-guard';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { AppProvider } from './context/AppContext';
import './index.css';
import './layout-tuning.css';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Keep SW only in production and force-check updates on each load.
    if (import.meta.env.PROD) {
      navigator.serviceWorker.register('/sw.js').then((registration) => {
        registration.update().catch(() => {});
      }).catch((registrationError) => {
        console.log('SW registration failed: ', registrationError);
      });
    } else {
      // In development, remove stale SW to avoid asset/cache interference.
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => registration.unregister());
      });
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
);
