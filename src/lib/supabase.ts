import { createClient } from '@supabase/supabase-js';

const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').trim();
const supabaseAnonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

export const isSupabaseConfigured = () =>
  Boolean(
    supabaseUrl
      && supabaseAnonKey
      && supabaseUrl.startsWith('https://')
      && !supabaseUrl.includes('your-project')
      && supabaseAnonKey !== 'your-anon-key',
  );

if (!isSupabaseConfigured()) {
  console.error(
    'Supabase não configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.',
  );
}

type AuthLock = <R>(
  name: string,
  acquireTimeout: number,
  fn: () => Promise<R>,
) => Promise<R>;

const authLockTails = new Map<string, Promise<void>>();

const processAuthLock: AuthLock = async <R>(
  name: string,
  _acquireTimeout: number,
  fn: () => Promise<R>,
): Promise<R> => {
  const previous = authLockTails.get(name) || Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const currentTail = previous.catch(() => undefined).then(() => gate);

  authLockTails.set(name, currentTail);
  await previous.catch(() => undefined);

  try {
    return await fn();
  } finally {
    release();
    if (authLockTails.get(name) === currentTail) {
      authLockTails.delete(name);
    }
  }
};

export const supabase = createClient(
  supabaseUrl || 'https://placeholder-project.supabase.co',
  supabaseAnonKey || 'placeholder-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      lock: processAuthLock,
    },
  },
);
