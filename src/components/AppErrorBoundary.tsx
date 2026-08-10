import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { reportOperationalEvent } from '../lib/operational-observability';

type State = { failed: boolean };

export default class AppErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch() {
    void reportOperationalEvent('runtime.react_render_error', 'react-boundary', 'error');
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="flex min-h-screen items-center justify-center bg-[#050505] p-6 text-white">
        <section className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-6 text-center shadow-2xl">
          <AlertTriangle className="mx-auto mb-4 text-amber-300" size={34} />
          <h1 className="text-lg font-black">Não foi possível concluir esta tela</h1>
          <p className="mt-2 text-sm leading-relaxed text-white/50">
            O MF interrompeu esta tela para evitar continuar em um estado inconsistente. Recarregue e confira a última operação antes de tentar novamente.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mx-auto mt-5 flex items-center gap-2 rounded-xl bg-brand-primary px-4 py-2.5 text-sm font-black text-black"
          >
            <RefreshCw size={16} /> Recarregar
          </button>
        </section>
      </main>
    );
  }
}
