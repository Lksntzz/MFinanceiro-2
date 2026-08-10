import { supabase } from './supabase';

const EXPORT_TABLES = [
  'mf_user_settings',
  'mf_financial_accounts',
  'mf_transaction_categories',
  'mf_credit_cards',
  'mf_card_installments',
  'mf_fixed_bills',
  'mf_subscriptions',
  'mf_financial_goals',
  'mf_category_budgets',
  'mf_expected_income',
  'mf_document_extractions',
  'mf_statement_import_batches',
] as const;

async function readTable(table: string, userId: string) {
  try {
    const { data, error } = await supabase.from(table as any).select('*').eq('user_id', userId);
    if (error) {
      if (['42P01', 'PGRST205', '42501'].includes(String(error.code || ''))) return [];
      throw error;
    }
    return data || [];
  } catch {
    return [];
  }
}

async function readLedger() {
  const rows: unknown[] = [];
  let cursor: { date: string; created_at: string; id: string } | null = null;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await supabase.rpc('mf_get_ledger_page', {
      p_page_size: 250,
      p_cursor_date: cursor?.date || null,
      p_cursor_created_at: cursor?.created_at || null,
      p_cursor_id: cursor?.id || null,
    });
    if (error) throw error;
    const page = (data || {}) as any;
    if (Array.isArray(page.items)) rows.push(...page.items);
    hasMore = page.has_more === true;
    cursor = page.next_cursor || null;
    if (hasMore && !cursor) break;
  }
  return rows;
}

export async function exportFinancialData(userId: string) {
  const entries = await Promise.all(EXPORT_TABLES.map(async (table) => [table, await readTable(table, userId)] as const));
  const ledger = await readLedger();
  const payload = {
    schema: 'mf-financeiro-user-export-v1',
    exported_at: new Date().toISOString(),
    user_id: userId,
    note: 'O pacote contém dados estruturados do MF Financeiro. Arquivos privados armazenados no Storage não são incluídos automaticamente.',
    data: Object.fromEntries([...entries, ['mf_finance_ledger_entries', ledger]]),
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `MF_Financeiro_Dados_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
}
