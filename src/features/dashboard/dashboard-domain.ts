import type {
  CardInstallment,
  FinancialAccount,
  ImportedTransaction,
  LedgerCursor,
  LedgerPage,
  StatementImportOptions,
  Transaction,
} from '../../types';

export type StatementBalanceMode = 'keep' | 'apply_new' | 'statement';

export type StatementImportRpcResult = {
  batch_id: string;
  inserted_count: number;
  duplicate_count: number;
  rejected_count: number;
  ignored_count: number;
  net_new: number;
  balance_before: number;
  balance_after: number;
  balance_mode: StatementBalanceMode;
};

export type StatementImportEntry = {
  selected: boolean;
  status: ImportedTransaction['status'];
  date: string;
  description: string;
  category: string;
  amount: number;
  type: ImportedTransaction['type'];
  source: string;
  external_id: string | null;
  original_description: string;
  confidence: number;
  running_balance: number | undefined;
};

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

export function normalizeDashboardTransaction(row: unknown): Transaction | null {
  const item = recordOf(row);
  const rawDate = item.date || item.data || item.created_at;
  if (!rawDate) return null;

  const amount = Number(item.amount ?? item.valor ?? 0);
  const rawType = String(item.type || item.tipo || '').toLowerCase();
  const type: 'income' | 'expense' =
    rawType === 'income' || rawType === 'entrada' || rawType === 'receita' || amount > 0
      ? 'income'
      : 'expense';

  return {
    ...item,
    amount,
    type,
    date: String(rawDate),
    description: String(item.description || item.descricao || 'Lançamento importado'),
    category: String(item.category || item.categoria || 'Geral'),
    status: (item.status || 'paid') as Transaction['status'],
  } as unknown as Transaction;
}

export function normalizeDashboardLedgerPage(raw: unknown): LedgerPage {
  const page = recordOf(raw);
  const items = Array.isArray(page.items)
    ? page.items.map(normalizeDashboardTransaction).filter((item): item is Transaction => Boolean(item))
    : [];

  return {
    items,
    has_more: page.has_more === true,
    total_count: Number(page.total_count || items.length),
    next_cursor: page.next_cursor && typeof page.next_cursor === 'object'
      ? page.next_cursor as LedgerCursor
      : null,
  };
}

export function normalizeDashboardAccounts(rows: unknown[]): FinancialAccount[] {
  return rows.map((row) => {
    const item = recordOf(row);
    return {
      ...item,
      opening_balance: Number(item.opening_balance || 0),
      current_balance: Number(item.current_balance || 0),
      transaction_count: Number(item.transaction_count || 0),
    } as unknown as FinancialAccount;
  });
}

export function normalizeDashboardInstallments(rows: unknown[]): CardInstallment[] {
  return rows.map((row) => {
    const item = recordOf(row);
    return {
      ...item,
      description: String(item.description || item.descricao || 'Parcelamento'),
      total_amount: Number(item.total_amount ?? item.valor_total ?? 0),
      monthly_amount: Number(item.monthly_amount ?? item.valor_mensal ?? 0),
      current_installment: Number(item.current_installment ?? item.parcela_atual ?? 1),
      total_installments: Number(item.total_installments ?? item.total_parcelas ?? 1),
      due_day: Number(item.due_day ?? 1),
    } as unknown as CardInstallment;
  });
}

export function calculateDashboardBalance(accounts: FinancialAccount[], fallbackBalance = 0): number {
  if (!accounts.length) return Number(fallbackBalance || 0);
  return accounts.reduce((sum, account) => sum + Number(account.current_balance || 0), 0);
}

export function buildStatementImportEntries(imported: ImportedTransaction[]): StatementImportEntry[] {
  return imported.map((item) => {
    const numericAmount = Number(item.amount);
    return {
      selected: item.status === 'ready'
        && Number.isFinite(numericAmount)
        && numericAmount > 0
        && item.description !== 'Sem descricao',
      status: item.status,
      date: item.date || '',
      description: item.description || '',
      category: item.category || 'Geral',
      amount: Number.isFinite(numericAmount) ? Math.abs(numericAmount) : 0,
      type: item.type,
      source: item.bank_source || item.source || 'Importado',
      external_id: item.source_id
        ? `statement:${item.bank_source || item.source || 'unknown'}:${item.source_id}`
        : null,
      original_description: item.original_description,
      confidence: item.confidence,
      running_balance: item.running_balance,
    };
  });
}

export function buildStatementImportCommand(
  imported: ImportedTransaction[],
  newBalance: number | undefined,
  options: StatementImportOptions,
) {
  const entries = buildStatementImportEntries(imported);
  if (!entries.some((entry) => entry.selected)) {
    throw new Error('Nenhum lançamento válido foi selecionado para importação.');
  }

  const balanceMode: StatementBalanceMode = options.balanceMode
    || (typeof newBalance === 'number' && Number.isFinite(newBalance) ? 'statement' : 'keep');

  return {
    balanceMode,
    params: {
      p_entries: entries,
      p_account_id: options.accountId,
      p_balance_mode: balanceMode,
      p_statement_balance: balanceMode === 'statement' ? newBalance : null,
      p_file_name: options.fileName || null,
      p_file_type: options.fileType || null,
      p_file_size: options.fileSize ?? null,
      p_file_hash: options.fileHash || null,
      p_parser_name: options.parserName || null,
      p_raw_metadata: options.diagnostics || {},
    },
  };
}

export function normalizeStatementImportResult(raw: unknown): StatementImportRpcResult {
  if (!raw || typeof raw !== 'object') {
    throw new Error('O banco não retornou o resumo da importação.');
  }

  const result = raw as StatementImportRpcResult;
  return {
    ...result,
    inserted_count: Number(result.inserted_count || 0),
    duplicate_count: Number(result.duplicate_count || 0),
    rejected_count: Number(result.rejected_count || 0),
    ignored_count: Number(result.ignored_count || 0),
    net_new: Number(result.net_new || 0),
    balance_before: Number(result.balance_before || 0),
    balance_after: Number(result.balance_after || 0),
  };
}
