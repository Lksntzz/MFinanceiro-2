import { supabase } from './supabase';

export type ActivityEvent = {
  id: string;
  user_id: string;
  action: string;
  entity_type: string;
  entity_id?: string | null;
  summary: string;
  metadata?: Record<string, string | number | boolean | null>;
  created_at: string;
};

const LOCAL_LIMIT = 80;

function localKey(userId: string) {
  return `mf-activity:v1:${userId}`;
}

function sanitizeMetadata(metadata: ActivityEvent['metadata']) {
  const safe: Record<string, string | number | boolean | null> = {};
  Object.entries(metadata || {}).forEach(([key, value]) => {
    if (/amount|balance|value|email|token|document|description|card|account/i.test(key)) return;
    if (['string', 'number', 'boolean'].includes(typeof value) || value === null) safe[key] = value as string | number | boolean | null;
  });
  return safe;
}

export function readLocalActivity(userId: string): ActivityEvent[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(localKey(userId)) || '[]');
    return Array.isArray(parsed) ? parsed.slice(0, LOCAL_LIMIT) : [];
  } catch {
    return [];
  }
}

function persistLocalActivity(event: ActivityEvent) {
  if (typeof window === 'undefined') return;
  try {
    const next = [event, ...readLocalActivity(event.user_id).filter((item) => item.id !== event.id)].slice(0, LOCAL_LIMIT);
    window.localStorage.setItem(localKey(event.user_id), JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('mf:activity-recorded', { detail: event }));
  } catch {
    // Audit fallback must not block a financial operation.
  }
}

export async function recordUserActivity(input: Omit<ActivityEvent, 'id' | 'created_at'>) {
  const event: ActivityEvent = {
    ...input,
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    metadata: sanitizeMetadata(input.metadata),
  };
  persistLocalActivity(event);

  try {
    const { error } = await supabase.from('mf_user_activity_events').insert({
      id: event.id,
      user_id: event.user_id,
      action: event.action,
      entity_type: event.entity_type,
      entity_id: event.entity_id || null,
      summary: event.summary,
      metadata: event.metadata || {},
      created_at: event.created_at,
    });
    if (error && !['42P01', '42501', 'PGRST205'].includes(String(error.code || ''))) {
      console.warn('Activity audit persistence failed:', error.message);
    }
  } catch {
    // The migration can be rolled out after the frontend; local history remains available.
  }
  return event;
}

export async function loadUserActivity(userId: string): Promise<ActivityEvent[]> {
  try {
    const { data, error } = await supabase
      .from('mf_user_activity_events')
      .select('id,user_id,action,entity_type,entity_id,summary,metadata,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(80);
    if (!error && data?.length) return data as ActivityEvent[];
  } catch {
    // Fallback below.
  }
  return readLocalActivity(userId);
}
