import type { Session, SupabaseClient } from '@supabase/supabase-js';

import { isCurrentMobileExperience } from '../mobile/useMobileExperience';

export type MaintenanceSurface = 'mobile' | 'desktop';
export type MaintenanceScope = MaintenanceSurface | 'both';

export interface MaintenanceConfig {
  maintenance_mode: boolean;
  maintenance_message: string;
  mobile_mode?: boolean;
  mobile_message?: string;
  desktop_mode?: boolean;
  desktop_message?: string;
}

export const MAINTENANCE_CHANNEL = 'mf-global-maintenance';
export const MAINTENANCE_BROADCAST_EVENT = 'maintenance-changed';

const DEFAULT_MESSAGE =
  'Estamos em manutenção para melhorias. Tente novamente em alguns minutos.';

const MISSING_TABLE_CODES = new Set(['PGRST205', '42P01']);
const MISSING_COLUMN_CODE = 'PGRST204';

type MaintenanceRow = {
  key?: string | null;
  maintenance_mode?: unknown;
  maintenance_message?: unknown;
  updated_at?: string | null;
};

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

function scopedConfig(
  legacy: MaintenanceRow | undefined,
  mobile: MaintenanceRow | undefined,
  desktop: MaintenanceRow | undefined,
): MaintenanceConfig {
  const mobileMode = parseBoolean((mobile || legacy)?.maintenance_mode);
  const desktopMode = parseBoolean((desktop || legacy)?.maintenance_mode);
  const mobileMessage = parseMessage((mobile || legacy)?.maintenance_message);
  const desktopMessage = parseMessage((desktop || legacy)?.maintenance_message);
  const mobileExperience = isCurrentMobileExperience();

  return {
    maintenance_mode: mobileExperience ? mobileMode : desktopMode,
    maintenance_message: mobileExperience ? mobileMessage : desktopMessage,
    mobile_mode: mobileMode,
    mobile_message: mobileMessage,
    desktop_mode: desktopMode,
    desktop_message: desktopMessage,
  };
}

async function readFromGlobalSettingsTable(
  db: SupabaseClient,
): Promise<MaintenanceConfig | null> {
  const { data, error } = await db
    .from('mf_global_settings')
    .select('key, maintenance_mode, maintenance_message, updated_at')
    .in('key', ['global', 'mobile', 'desktop']);

  if (error) {
    if (isMissingSchemaError(error)) return null;
    throw error;
  }

  const rows = (data || []) as MaintenanceRow[];
  if (!rows.length) return null;

  const legacy = rows.find((row) => row.key === 'global');
  const mobile = rows.find((row) => row.key === 'mobile');
  const desktop = rows.find((row) => row.key === 'desktop');
  return scopedConfig(legacy, mobile, desktop);
}

async function readFromAppConfigTable(
  db: SupabaseClient,
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
  return scopedConfig(data as MaintenanceRow, undefined, undefined);
}

export async function fetchMaintenanceConfig(
  db: SupabaseClient,
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

  return scopedConfig(undefined, undefined, undefined);
}

export function getMaintenanceForSurface(
  config: MaintenanceConfig | null | undefined,
  surface: MaintenanceSurface,
): { maintenance_mode: boolean; maintenance_message: string } {
  if (!config) {
    return { maintenance_mode: false, maintenance_message: DEFAULT_MESSAGE };
  }

  return surface === 'mobile'
    ? {
        maintenance_mode: Boolean(config.mobile_mode ?? config.maintenance_mode),
        maintenance_message: config.mobile_message || config.maintenance_message,
      }
    : {
        maintenance_mode: Boolean(config.desktop_mode ?? config.maintenance_mode),
        maintenance_message: config.desktop_message || config.maintenance_message,
      };
}

export async function broadcastMaintenanceConfig(
  db: SupabaseClient,
  config: MaintenanceConfig,
): Promise<void> {
  const channel = db.channel(MAINTENANCE_CHANNEL);

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      void db.removeChannel(channel);
      if (error) reject(error);
      else resolve();
    };

    const timeoutId = window.setTimeout(() => {
      finish(new Error('Tempo limite ao publicar a mudança de manutenção.'));
    }, 5000);

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        try {
          const sendStatus = await channel.send({
            type: 'broadcast',
            event: MAINTENANCE_BROADCAST_EVENT,
            payload: config,
          });

          if (sendStatus === 'ok') finish();
          else finish(new Error(`Falha ao publicar manutenção: ${sendStatus}`));
        } catch (error) {
          finish(error instanceof Error ? error : new Error('Falha ao publicar manutenção.'));
        }
        return;
      }

      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        finish(new Error(`Canal de manutenção indisponível: ${status}`));
      }
    });
  });
}

export function isMaintenanceAdmin(session: Session | null): boolean {
  const isDev = (import.meta as any).env.DEV === true ||
                (import.meta as any).env.MODE === 'development' ||
                window.location.hostname === 'localhost' ||
                window.location.hostname === '127.0.0.1';

  if (isDev) return true;
  if (!session?.user) return false;

  const role = String(session.user.app_metadata?.role || '').toLowerCase();
  return role === 'admin' || role === 'owner';
}
