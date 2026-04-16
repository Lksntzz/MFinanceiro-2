import { Component, StrictMode, type ReactNode } from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Remova qualquer Service Worker fantasma que possa estar em cache
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) {
      registration.unregister()
        .then(success => {
          if (success) console.log('ServiceWorker defasado desregistrado com sucesso');
        })
        .catch(err => console.error('Falha ao desregistrar ServiceWorker', err));
    }
  });
}

class RootErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; message: string }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error.message };
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[#050505] p-6 text-white">
          <div className="max-w-lg rounded-2xl border border-red-500/30 bg-red-500/10 p-6">
            <h1 className="mb-2 text-xl font-bold text-red-400">Erro ao carregar o app</h1>
            <p className="text-sm text-white/70">
              {this.state.message || 'Ocorreu uma falha na inicialização do React.'}
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>,
);
