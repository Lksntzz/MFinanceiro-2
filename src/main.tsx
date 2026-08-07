// Bank format adapters are pure parsing compatibility layers.
import './lib/unified-transaction-launcher-mount';
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App.tsx';
import AccessibilityLayer from './components/AccessibilityLayer';
import { AppProvider } from './context/AppContext';
import './index.css';
import './layout-tuning.css';
import './navigation.css';
import './stage6.css';

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
    <BrowserRouter>
      <AccessibilityLayer />
      <AppProvider>
        <App />
      </AppProvider>
    </BrowserRouter>
  </StrictMode>,
);
