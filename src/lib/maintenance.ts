import { Capacitor } from '@capacitor/core';
import type { Session, SupabaseClient } from '@supabase/supabase-js';

import { isCurrentMobileExperience } from '../mobile/useMobileExperience';

export type MaintenanceSurface = 'mobile' | 'desktop' | 'ios';
export type MaintenanceScope = MaintenanceSurface | 'both' | 'all';

export interface MaintenanceConfig {
  maintenance_mode: boolean;
  maintenance_message: string;
  mobile_mode?: boolean;
  mobile_message?: string;
  desktop_mode?: boolean;
  desktop_message?: string;
  ios_mode?: boolean;
  ios_message?: string;
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

function currentMaintenanceSurface(): MaintenanceSurface {
  const platform = Capacitor.getPlatform();
  if (platform === 'ios') return 'ios';
  if (platform === 'android') return 'mobile';
  return isCurrentMobileExperience() ? 'mobile' : 'desktop';
}

function scopedConfig(
  legacy: MaintenanceRow | undefined,
  mobile: MaintenanceRow | undefined,
  desktop: MaintenanceRow | undefined,
  ios: MaintenanceRow | undefined,
): MaintenanceConfig {
  const mobileRow = mobile || legacy;
  const desktopRow = desktop || legacy;
  // Compatibilidade: antes de existir a chave ios, o app iOS era tratado como mobile.
  const iosRow = ios || mobile || legacy;

  const mobileMode = parseBoolean(mobileRow?.maintenance_mode);
  const desktopMode = parseBoolean(desktopRow?.maintenance_mode);
  const iosMode = parseBoolean(iosRow?.maintenance_mode);
  const mobileMessage = parseMessage(mobileRow?.maintenance_message);
  const desktopMessage = parseMessage(desktopRow?.maintenance_message);
  const iosMessage = parseMessage(iosRow?.maintenance_message);
  const currentSurface = currentMaintenanceSurface();

  const current = currentSurface === 'ios'
    ? { mode: iosMode, message: iosMessage }
    : currentSurface === 'mobile'
      ? { mode: mobileMode, message: mobileMessage }
      : { mode: desktopMode, message: desktopMessage };

  return {
    maintenance_mode: current.mode,
    maintenance_message: current.message,
    mobile_mode: mobileMode,
    mobile_message: mobileMessage,
    desktop_mode: desktopMode,
    desktop_message: desktopMessage,
    ios_mode: iosMode,
    ios_message: iosMessage,
  };
}

async function readFromGlobalSettingsTable(
  db: SupabaseClient,
): Promise<MaintenanceConfig | null> {
  const { data, error } = await db
    .from('mf_global_settings')
    .select('key, maintenance_mode, maintenance_message, updated_at')
    .in('key', ['global', 'mobile', 'desktop', 'ios']);

  if (error) {
    if (isMissingSchemaError(error)) return null;
    throw error;
  }

  const rows = (data || []) as MaintenanceRow[];
  if (!rows.length) return null;

  const legacy = rows.find((row) => row.key === 'global');
  const mobile = rows.find((row) => row.key === 'mobile');
  const desktop = rows.find((row) => row.key === 'desktop');
  const ios = rows.find((row) => row.key === 'ios');
  return scopedConfig(legacy, mobile, desktop, ios);
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
  return scopedConfig(data as MaintenanceRow, undefined, undefined, undefined);
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

  return scopedConfig(undefined, undefined, undefined, undefined);
}

export function getMaintenanceForSurface(
  config: MaintenanceConfig | null | undefined,
  surface: MaintenanceSurface,
): { maintenance_mode: boolean; maintenance_message: string } {
  if (!config) {
    return { maintenance_mode: false, maintenance_message: DEFAULT_MESSAGE };
  }

  if (surface === 'ios') {
    return {
      maintenance_mode: Boolean(config.ios_mode ?? config.mobile_mode ?? config.maintenance_mode),
      maintenance_message: config.ios_message || config.mobile_message || config.maintenance_message,
    };
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
