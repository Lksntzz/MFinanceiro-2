import { supabase } from './supabase';

let installed = false;

function isAuthLockInterruption(error: unknown): boolean {
  const value = error as { name?: string; message?: string } | null;
  const text = `${value?.name || ''} ${value?.message || ''}`.toLowerCase();
  return (
    text.includes('lock broken by another request') ||
    text.includes('navigatorlock') ||
    (text.includes('aborterror') && text.includes('steal'))
  );
}

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

export function installAuthRefreshGuard() {
  if (installed) return;
  installed = true;

  const auth = supabase.auth as any;

  const wrapSingleFlight = (methodName: 'getSession' | 'getUser') => {
    const original = auth[methodName].bind(auth);
    let inFlight: Promise<any> | null = null;

    auth[methodName] = (...args: any[]) => {
      if (args.length === 0 && inFlight) return inFlight;

      const execute = async () => {
        try {
          return await original(...args);
        } catch (error) {
          if (!isAuthLockInterruption(error)) throw error;
          await wait(120);
          return original(...args);
        }
      };

      const request = execute();
      if (args.length > 0) return request;

      inFlight = request.finally(() => {
        inFlight = null;
      });
      return inFlight;
    };
  };

  wrapSingleFlight('getSession');
  wrapSingleFlight('getUser');

  const originalRefreshSession = auth.refreshSession.bind(auth);
  let inFlight: Promise<any> | null = null;
  let lastResult: any = null;
  let lastCompletedAt = 0;
  const minimumIntervalMs = 60_000;

  auth.refreshSession = (...args: any[]) => {
    if (inFlight) return inFlight;

    if (lastResult && Date.now() - lastCompletedAt < minimumIntervalMs) {
      return Promise.resolve(lastResult);
    }

    const execute = async () => {
      try {
        return await originalRefreshSession(...args);
      } catch (error) {
        if (!isAuthLockInterruption(error)) throw error;
        await wait(150);
        return originalRefreshSession(...args);
      }
    };

    inFlight = execute()
      .then((result: any) => {
        lastResult = result;
        lastCompletedAt = Date.now();
        return result;
      })
      .finally(() => {
        inFlight = null;
      });

    return inFlight;
  };

  window.addEventListener('unhandledrejection', (event) => {
    if (!isAuthLockInterruption(event.reason)) return;
    event.preventDefault();
    window.setTimeout(() => {
      void supabase.auth.getSession().catch(() => undefined);
    }, 180);
  });
}

installAuthRefreshGuard();
