// Bootstrap contains only active consolidated runtime integrations.
import './lib/admin-maintenance-mount';
import './lib/bank-excel-parser-guard';
import './lib/bank-csv-parser-guard';
import './lib/historical-import-review-guard';
import './lib/installment-manager-mount';
import './lib/income-payroll-center-mount';
import './lib/payroll-advance-correction-guard';
import './lib/simple-navigation-mount';
import './lib/profile-onboarding-mount';
import './lib/guided-tutorial-mount';
import './lib/monthly-fixed-bills-mount';
import './lib/standalone-insights-mount';
import './lib/unified-transaction-launcher-mount';
import './lib/release-update-notification-mount';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { AppProvider } from './context/AppContext';
import './index.css';
import './layout-tuning.css';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
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
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
);
