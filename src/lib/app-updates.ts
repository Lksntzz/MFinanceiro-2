import type { SupabaseClient } from '@supabase/supabase-js';

export interface AppUpdateInfo {
  id: string;
  version: string;
  title: string;
  summary: string;
  hasNewFeatures: boolean;
  newFeatures: string[];
  fixes: string[];
  publishedAt: string | null;
}

const MISSING_TABLE_CODES = new Set(['PGRST205', '42P01']);
const MISSING_COLUMN_CODE = 'PGRST204';

function isMissingSchemaError(error: any): boolean {
  if (!error) return false;
  const code = String(error.code || '');
  if (MISSING_TABLE_CODES.has(code)) return true;
  if (code === MISSING_COLUMN_CODE) return true;
  const message = String(error.message || '').toLowerCase();
  return message.includes('does not exist') || message.includes('schema cache');
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

export async function fetchLatestAppUpdate(
  db: SupabaseClient
): Promise<AppUpdateInfo | null> {
  const { data, error } = await db
    .from('mf_app_updates')
    .select(
      'id, version, title, summary, has_new_features, new_features, fixes, published_at'
    )
    .eq('is_active', true)
    .order('published_at', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMissingSchemaError(error)) return null;
    throw error;
  }

  if (!data) return null;

  return {
    id: String((data as any).id ?? ''),
    version: String((data as any).version ?? ''),
    title: String((data as any).title ?? 'Atualizacao do aplicativo'),
    summary: String((data as any).summary ?? ''),
    hasNewFeatures: Boolean((data as any).has_new_features),
    newFeatures: toStringArray((data as any).new_features),
    fixes: toStringArray((data as any).fixes),
    publishedAt:
      typeof (data as any).published_at === 'string'
        ? (data as any).published_at
        : null,
  };
}
