import type { Session, SupabaseClient } from '@supabase/supabase-js';

export interface MaintenanceConfig {
  maintenance_mode: boolean;
  maintenance_message: string;
}

const DEFAULT_MESSAGE =
  'Estamos em manutenção para melhorias. Tente novamente em alguns minutos.';

const MISSING_TABLE_CODES = new Set(['PGRST205', '42P01']);
const MISSING_COLUMN_CODE = 'PGRST204';

function parseBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function parseMessage(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return DEFAULT_MESSAGE;
  return value.trim();
}

function isMissingSchemaError(error: any): boolean {
  if (!error) return false;
  const code = String(error.code || '');
  if (MISSING_TABLE_CODES.has(code)) return true;
  if (code === MISSING_COLUMN_CODE) return true;
  const message = String(error.message || '').toLowerCase();
  return message.includes('does not exist') || message.includes('schema cache');
}

async function readFromGlobalSettingsTable(
  db: SupabaseClient
): Promise<MaintenanceConfig | null> {
  const { data, error } = await db
    .from('mf_global_settings')
    .select('maintenance_mode, maintenance_message')
    .eq('key', 'global')
    .maybeSingle();

  if (error) {
    if (isMissingSchemaError(error)) return null;
    throw error;
  }

  // Compatibilidade: se nao existir a linha key='global',
  // tenta ler a linha mais recente da tabela.
  if (!data) {
    const { data: fallback, error: fallbackError } = await db
      .from('mf_global_settings')
      .select('maintenance_mode, maintenance_message')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fallbackError) {
      if (isMissingSchemaError(fallbackError)) return null;
      throw fallbackError;
    }

    if (!fallback) return null;

    return {
      maintenance_mode: parseBoolean((fallback as any).maintenance_mode),
      maintenance_message: parseMessage((fallback as any).maintenance_message),
    };
  }

  return {
    maintenance_mode: parseBoolean((data as any).maintenance_mode),
    maintenance_message: parseMessage((data as any).maintenance_message),
  };
}

async function readFromAppConfigTable(
  db: SupabaseClient
): Promise<MaintenanceConfig | null> {
  const { data, error } = await db
    .from('mf_app_config')
    .select('maintenance_mode, maintenance_message')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMissingSchemaError(error)) return null;
    throw error;
  }

  if (!data) return null;

  return {
    maintenance_mode: parseBoolean((data as any).maintenance_mode),
    maintenance_message: parseMessage((data as any).maintenance_message),
  };
}

export async function fetchMaintenanceConfig(
  db: SupabaseClient
): Promise<MaintenanceConfig> {
  const strategies: Array<() => Promise<MaintenanceConfig | null>> = [
    () => readFromGlobalSettingsTable(db),
    () => readFromAppConfigTable(db),
  ];

  for (const read of strategies) {
    try {
      const result = await read();
      if (result) return result;
    } catch (e) {
      console.warn('Maintenance check strategy failed:', e);
    }
  }

  return {
    maintenance_mode: false,
    maintenance_message: DEFAULT_MESSAGE,
  };
}

function parseAdminEmails(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isMaintenanceAdmin(session: Session | null): boolean {
  // Bypass para ambiente local ou desenvolvimento
  const isDev = (import.meta as any).env.DEV === true || 
                (import.meta as any).env.MODE === 'development' ||
                window.location.hostname === 'localhost' ||
                window.location.hostname === '127.0.0.1';
  
  if (isDev) return true;

  if (!session?.user) return false;

  const role = String(session.user.app_metadata?.role || '').toLowerCase();
  if (role === 'admin' || role === 'owner') return true;

  if (session.user.user_metadata?.is_admin === true) return true;

  const adminEmails = parseAdminEmails(
    (import.meta as any).env.VITE_MAINTENANCE_ADMIN_EMAILS
  );
  const userEmail = String(session.user.email || '').toLowerCase();
  return userEmail ? adminEmails.has(userEmail) : false;
}
