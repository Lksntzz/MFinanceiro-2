import type { SupabaseClient } from '@supabase/supabase-js';
import type { CardInstallment } from '../types';

type AnyRow = Record<string, any>;

export interface InstallmentUpsertInput {
  userId: string;
  cardId?: string;
  description: string;
  totalAmount: number;
  monthlyAmount: number;
  currentInstallment: number;
  totalInstallments: number;
  startDate?: string;
}

function isMissingColumnError(error: any, column: string): boolean {
  return String(error?.message || '').includes(`'${column}' column`);
}

function canFallback(error: any): boolean {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('schema cache') ||
    message.includes('column') ||
    error?.code === 'PGRST204' ||
    error?.code === 'PGRST205'
  );
}

function toIsoDateOnly(value?: string): string | undefined {
  if (!value) return undefined;
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString().slice(0, 10);
}

function normalizeInstallment(row: AnyRow, userId: string): CardInstallment {
  return {
    id: String(row.id || row.installment_id || row.parcela_id || row.uuid || `inst-${Date.now()}`),
    user_id: String(row.user_id || userId),
    card_id: row.card_id || undefined,
    description: row.description || row.descricao || 'Sem descriÒ§Ò£o',
    total_amount: Number(row.total_amount ?? row.valor_total ?? 0) || 0,
    monthly_amount: Number(row.monthly_amount ?? row.valor_mensal ?? 0) || 0,
    current_installment: Number(row.current_installment ?? row.parcela_atual ?? 1) || 1,
    total_installments: Number(row.total_installments ?? row.total_parcelas ?? 1) || 1,
    start_date: toIsoDateOnly(row.start_date || row.data_inicio),
  };
}

function sanitize(row: AnyRow): AnyRow {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
}

function buildPayloadCandidates(input: InstallmentUpsertInput): AnyRow[] {
  const english = sanitize({
    user_id: input.userId,
    card_id: input.cardId,
    description: input.description,
    total_amount: input.totalAmount,
    monthly_amount: input.monthlyAmount,
    current_installment: input.currentInstallment,
    total_installments: input.totalInstallments,
    start_date: toIsoDateOnly(input.startDate),
  });

  const englishNoUser = sanitize({ ...english, user_id: undefined });

  const portuguese = sanitize({
    user_id: input.userId,
    card_id: input.cardId,
    descricao: input.description,
    valor_total: input.totalAmount,
    valor_mensal: input.monthlyAmount,
    parcela_atual: input.currentInstallment,
    total_parcelas: input.totalInstallments,
    data_inicio: toIsoDateOnly(input.startDate),
  });

  const portugueseNoUser = sanitize({ ...portuguese, user_id: undefined });

  return [english, englishNoUser, portuguese, portugueseNoUser];
}

export async function fetchInstallments(db: SupabaseClient, userId: string): Promise<CardInstallment[]> {
  let rows: AnyRow[] = [];
  const scoped = await db.from('mf_card_installments').select('*').eq('user_id', userId);
  if (scoped.error) {
    if (!isMissingColumnError(scoped.error, 'user_id')) throw scoped.error;
    const unscoped = await db.from('mf_card_installments').select('*');
    if (unscoped.error) throw unscoped.error;
    rows = (unscoped.data as AnyRow[]) || [];
  } else {
    rows = (scoped.data as AnyRow[]) || [];
  }

  return rows.map((row) => normalizeInstallment(row, userId));
}

export async function upsertInstallment(
  db: SupabaseClient,
  input: InstallmentUpsertInput,
  editingId?: string
): Promise<CardInstallment> {
  const candidates = buildPayloadCandidates(input);
  let lastError: any = null;

  for (const candidate of candidates) {
    if (editingId) {
      const result = await db.from('mf_card_installments').update(candidate).eq('id', editingId).select('*').maybeSingle();
      if (!result.error) {
        return normalizeInstallment((result.data as AnyRow) || { ...candidate, id: editingId }, input.userId);
      }
      lastError = result.error;
      if (!canFallback(result.error)) throw result.error;
      continue;
    }

    const result = await db.from('mf_card_installments').insert(candidate).select('*').maybeSingle();
    if (!result.error) {
      return normalizeInstallment((result.data as AnyRow) || candidate, input.userId);
    }
    lastError = result.error;
    if (!canFallback(result.error)) throw result.error;
  }

  throw lastError || new Error('NÒ£o foi possÒ­vel salvar o parcelamento.');
}

export async function deleteInstallment(db: SupabaseClient, installment: CardInstallment): Promise<void> {
  const row = installment as AnyRow;
  const keyCandidates: Array<{ column: string; value: string | number }> = [
    { column: 'id', value: row.id },
    { column: 'installment_id', value: row.installment_id },
    { column: 'parcela_id', value: row.parcela_id },
    { column: 'uuid', value: row.uuid },
  ].filter((candidate) => candidate.value !== undefined && candidate.value !== null);

  for (const candidate of keyCandidates) {
    const result = await db.from('mf_card_installments').delete().eq(candidate.column, candidate.value).select('*');
    if (result.error) {
      if (!canFallback(result.error)) throw result.error;
      continue;
    }
    if ((result.data?.length || 0) > 0) return;
  }

  const fallback = await db
    .from('mf_card_installments')
    .delete()
    .eq('description', installment.description)
    .eq('total_amount', installment.total_amount)
    .eq('monthly_amount', installment.monthly_amount)
    .eq('current_installment', installment.current_installment)
    .eq('total_installments', installment.total_installments)
    .select('*');

  if (fallback.error) throw fallback.error;
  if ((fallback.data?.length || 0) === 0) {
    throw new Error('Nenhum registro foi removido. Verifique permissÒµes RLS e chave primÒ¡ria da tabela.');
  }
}
