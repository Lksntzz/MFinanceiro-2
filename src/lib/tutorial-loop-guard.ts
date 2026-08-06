import { supabase } from './supabase';

const SAFE_TUTORIAL_ROOT_ID = 'mf-safe-tutorial-root';
const LEGACY_TUTORIAL_TITLE = 'Primeiros passos no MF Financeiro';
const STORAGE_PREFIX = 'mf:tutorial-dismissed:';
const PENDING_KEY = `${STORAGE_PREFIX}pending`;

let activeUserId: string | null = null;
let installed = false;
let closingLegacy = false;

const normalize = (value: string | null | undefined) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

function storageKey(userId = activeUserId) {
  return userId ? `${STORAGE_PREFIX}${userId}` : PENDING_KEY;
}

function saveDismissedMarker() {
  try {
    localStorage.setItem(storageKey(), '1');
    sessionStorage.setItem(storageKey(), '1');
  } catch {
    // Storage can be unavailable in restrictive browser modes.
  }
}

function transferPendingMarker(userId: string) {
  try {
    const pending = localStorage.getItem(PENDING_KEY) === '1' || sessionStorage.getItem(PENDING_KEY) === '1';
    if (!pending) return;
    localStorage.setItem(storageKey(userId), '1');
    sessionStorage.setItem(storageKey(userId), '1');
    localStorage.removeItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // The database flag remains the durable source of truth.
  }
}

function isDismissed() {
  try {
    return localStorage.getItem(storageKey()) === '1' || sessionStorage.getItem(storageKey()) === '1';
  } catch {
    return false;
  }
}

async function persistDismissed() {
  if (!activeUserId) return;
  try {
    await supabase
      .from('mf_user_settings')
      .update({ onboarding_seen: true })
      .eq('user_id', activeUserId);
  } catch {
    // Closing the tutorial must never depend on network availability.
  }
}

function markDismissed() {
  saveDismissedMarker();
  void persistDismissed();
}

function isLegacyTutorial(backdrop: HTMLElement) {
  return normalize(backdrop.textContent).includes(normalize(LEGACY_TUTORIAL_TITLE));
}

function closeLegacyTutorial(backdrop: HTMLElement) {
  if (closingLegacy) return;
  closingLegacy = true;

  backdrop.dataset.mfTutorialSuppressed = 'true';
  backdrop.style.display = 'none';
  backdrop.style.pointerEvents = 'none';

  const closeButton = backdrop.querySelector<HTMLButtonElement>('.mf-dialog-header button');
  try {
    closeButton?.click();
  } catch {
    // Removing the stale portal below is still enough to unblock the page.
  }

  backdrop.remove();
  window.setTimeout(() => {
    closingLegacy = false;
  }, 0);
}

function sweepLegacyTutorial() {
  if (!isDismissed()) return;
  document.querySelectorAll<HTMLElement>('.mf-dialog-backdrop').forEach((backdrop) => {
    if (isLegacyTutorial(backdrop)) closeLegacyTutorial(backdrop);
  });
}

function installUserTracking() {
  supabase.auth.getUser().then(({ data }) => {
    activeUserId = data.user?.id || null;
    if (activeUserId) transferPendingMarker(activeUserId);
    sweepLegacyTutorial();
  }).catch(() => undefined);

  supabase.auth.onAuthStateChange((_event, session) => {
    activeUserId = session?.user?.id || null;
    if (activeUserId) transferPendingMarker(activeUserId);
    sweepLegacyTutorial();
  });
}

function openCurrentTutorialFromProfile(event: MouseEvent, target: HTMLElement | null) {
  const button = target?.closest<HTMLButtonElement>('button');
  if (!button || normalize(button.textContent) !== 'ver tutorial') return false;

  const profileBackdrop = button.closest<HTMLElement>('.mf-dialog-backdrop');
  if (!profileBackdrop || isLegacyTutorial(profileBackdrop)) return false;

  event.preventDefault();
  event.stopImmediatePropagation();

  const closeProfileButton = profileBackdrop.querySelector<HTMLButtonElement>('.mf-dialog-header button');
  closeProfileButton?.click();

  window.setTimeout(() => {
    window.dispatchEvent(new Event('mf:open-tutorial'));
  }, 0);

  return true;
}

function installTutorialLoopGuard() {
  if (installed) return;
  installed = true;

  installUserTracking();

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;

    if (openCurrentTutorialFromProfile(event, target)) return;

    const safeRoot = target?.closest<HTMLElement>(`#${SAFE_TUTORIAL_ROOT_ID}`);
    if (!safeRoot) return;

    const actionButton = target?.closest<HTMLElement>('[data-action]');
    const action = actionButton?.dataset.action || '';
    const label = normalize(actionButton?.textContent);
    const closingAction =
      action === 'close' ||
      action === 'skip' ||
      (action === 'next' && (label === 'ir para o inicio' || label === 'concluir')) ||
      target === safeRoot;

    if (closingAction) markDismissed();
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.getElementById(SAFE_TUTORIAL_ROOT_ID)) {
      markDismissed();
    }
  }, true);

  const observer = new MutationObserver(sweepLegacyTutorial);
  observer.observe(document.body, { subtree: true, childList: true });
  sweepLegacyTutorial();

  window.addEventListener('beforeunload', () => observer.disconnect(), { once: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installTutorialLoopGuard, { once: true });
} else {
  installTutorialLoopGuard();
}

export {};
