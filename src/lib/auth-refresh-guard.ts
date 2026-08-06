import { supabase } from './supabase';

let installed = false;

export function installAuthRefreshGuard() {
  if (installed) return;
  installed = true;

  const auth = supabase.auth as any;
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

    inFlight = originalRefreshSession(...args)
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
}

installAuthRefreshGuard();
