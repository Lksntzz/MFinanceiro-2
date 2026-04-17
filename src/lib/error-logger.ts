import type { SupabaseClient } from '@supabase/supabase-js';

interface LogAppErrorInput {
  userId?: string;
  scope: string;
  error: unknown;
  metadata?: Record<string, unknown>;
}

export async function logAppError(db: SupabaseClient, input: LogAppErrorInput): Promise<void> {
  const errorObj = input.error as any;
  const payload = {
    user_id: input.userId,
    scope: input.scope,
    error_code: String(errorObj?.code || ''),
    error_message: String(errorObj?.message || 'Erro desconhecido'),
    error_details: String(errorObj?.details || ''),
    metadata: input.metadata || {},
    created_at: new Date().toISOString(),
  };

  // Best effort: never break UX if logs table is missing.
  await db.from('mf_error_logs').insert(payload);
}
