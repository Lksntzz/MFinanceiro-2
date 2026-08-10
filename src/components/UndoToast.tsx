import React, { useEffect, useRef, useState } from 'react';
import { RotateCcw, X } from 'lucide-react';

import type { UndoAction } from '../lib/undo-actions';

export default function UndoToast() {
  const [action, setAction] = useState<UndoAction | null>(null);
  const [running, setRunning] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const clear = () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
    const onOffer = (event: Event) => {
      const next = (event as CustomEvent<UndoAction>).detail;
      if (!next?.run) return;
      clear();
      setAction(next);
      const delay = Math.max(500, next.expiresAt - Date.now());
      timerRef.current = window.setTimeout(() => setAction(null), delay);
    };
    window.addEventListener('mf:offer-undo', onOffer);
    return () => {
      clear();
      window.removeEventListener('mf:offer-undo', onOffer);
    };
  }, []);

  if (!action) return null;

  async function undo() {
    if (!action || running) return;
    setRunning(true);
    try {
      await action.run();
      setAction(null);
    } finally {
      setRunning(false);
    }
  }

  return (
    <aside className="mf-undo-toast" role="status" aria-live="polite">
      <span>{action.label}</span>
      <button type="button" onClick={() => void undo()} disabled={running} className="mf-undo-action">
        <RotateCcw size={14} />{running ? 'Restaurando...' : 'Desfazer'}
      </button>
      <button type="button" onClick={() => setAction(null)} aria-label="Fechar"><X size={14} /></button>
    </aside>
  );
}
