export type UndoAction = {
  id: string;
  label: string;
  expiresAt: number;
  run: () => void | Promise<void>;
};

export function offerUndo(
  label: string,
  run: UndoAction['run'],
  timeoutMs = 8_000,
) {
  if (typeof window === 'undefined') return;
  const action: UndoAction = {
    id: crypto.randomUUID(),
    label,
    expiresAt: Date.now() + timeoutMs,
    run,
  };
  window.dispatchEvent(
    new CustomEvent<UndoAction>('mf:offer-undo', { detail: action }),
  );
}
