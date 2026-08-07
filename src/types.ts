export type TransactionType = 'expense' | 'income' | 'transfer';

export interface Transaction {
  id: string;
  user_id: string;
  account_id?: string;
  category_id?: string;
  import_batch_id?: string;
  import_row_id?: string;
  amount: number;
  category: string;
  description: string;
  date: string;
  type: TransactionType;
  status?: 'pending' | 'completed' | 'ready' | 'duplicate' | 'error' | 'paid';
  source?: string;
  created_at?: string;
  updated_at?: string;
  affects_balance?: boolean;
}

export type NormalizedTransaction = Transaction & {
  bank_source?: string;
  running_balance?: number;
  duplicateKey?: string;
  transactionDate?: string;
  normalizedDescription?: string;
  bankName?: string;
  sourceFormat?: string;
  [key: string]: any;
};

export interface UserSettings {
  id: string;
  user_id: string;
  current_balance: number;
  gross_salary: number;
  net_salary_estimated: number;
  benefits: number;
  deductions: number;
  payday_cycle: 'monthly' | 'biweekly';
  payday_1: number;
  payday_2?: number;
  payday_1_percentage?: number;
  payday_2_percentage?: number;
  balance_confirmed?: boolean;
  display_name?: string | null;
  workspace_name?: string | null;
  avatar_url?: string | null;
  onboarding_seen?: boolean | null;
  onboarding_completed?: boolean | null;
}

export interface RhythmData {
  labels: string[];
  data: number[];
  incomeData?: number[];
}

export interface PriorityItem {
  id: string;
  title: string;
  message: string;
  type: 'urgent' | 'warning' | 'info';
  action?: string;
}

export interface FixedBill {
  id: string;
  user_id: string;
  name: string;
  amount: number;
  due_day: number;
  status: 'paid' | 'pending';
  category: string;
  last_paid_month?: string;
  keywords?: string[];
  merchant_id?: string;
  dda_reference?: string;
}

export interface CreditCard {
  id: string;
  user_id: string;
  name: string;
  brand: string;
  limit: number;
  used: number;
  closing_day: number;
  due_day: number;
}

export interface CardInstallment {
  id: string;
  user_id: string;
  card_id?: string;
  description: string;
  total_amount: number;
  monthly_amount: number;
  current_installment: number;
  total_installments: number;
  due_day: number;
  last_paid_month?: string;
}

export interface ImportedTransaction {
  id: string;
  extraction_item_id?: string;
  date: string;
  description: string;
  amount: number;
  source_id?: string;
  type: 'income' | 'expense';
  category: string;
  source?: string;
  categorySuggestion?: string;
  status: 'pending' | 'duplicate' | 'ready' | 'error';
  confidence: number;
  original_description: string;
  bank_source?: string;
  running_balance?: number;
  review_status?: 'pending' | 'accepted' | 'edited' | 'rejected';
}

export type FinancialAccountType = 'checking' | 'savings' | 'cash' | 'investment' | 'credit' | 'other';

export interface FinancialAccount {
  id: string;
  user_id: string;
  name: string;
  account_type: FinancialAccountType;
  currency: string;
  institution_name?: string | null;
  opening_balance: number;
  current_balance: number;
  transaction_count: number;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface TransactionCategory {
  id: string;
  user_id: string;
  name: string;
  name_key: string;
  category_type: 'income' | 'expense' | 'both';
  color?: string | null;
  icon?: string | null;
  is_system: boolean;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface LedgerCursor {
  date: string;
  created_at: string;
  id: string;
}

export interface LedgerPage {
  items: Transaction[];
  has_more: boolean;
  total_count: number;
  next_cursor: LedgerCursor | null;
}

export interface StatementImportOptions {
  accountId: string;
  balanceMode?: 'keep' | 'apply_new' | 'statement';
  fileName?: string;
  fileType?: string;
  fileSize?: number;
  fileHash?: string;
  parserName?: string;
  diagnostics?: Record<string, unknown>;
}

export interface StatementImportBatch {
  id: string;
  user_id: string;
  account_id: string;
  status: 'uploaded' | 'parsed' | 'reviewing' | 'committing' | 'completed' | 'failed' | 'reverted';
  source_format: string;
  file_name?: string | null;
  parser_name?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  balance_mode: 'keep' | 'apply_new' | 'statement';
  balance_before?: number | null;
  balance_after?: number | null;
  net_amount: number;
  requested_count: number;
  inserted_count: number;
  duplicate_count: number;
  rejected_count: number;
  ignored_count: number;
  error_message?: string | null;
  created_at: string;
  completed_at?: string | null;
  reverted_at?: string | null;
  revert_reason?: string | null;
}

export interface StatementImportRow {
  id: string;
  batch_id: string;
  line_number: number;
  transaction_date?: string | null;
  description?: string | null;
  category_name?: string | null;
  signed_amount?: number | null;
  status: 'parsed' | 'imported' | 'duplicate' | 'rejected' | 'ignored' | 'reconciled' | 'reverted';
  error_message?: string | null;
  ledger_entry_id?: string | null;
}

export interface CategorizationRule {
  id: string;
  user_id: string;
  name: string;
  priority: number;
  match_field: 'description' | 'source' | 'description_or_source';
  match_operator: 'contains' | 'starts_with' | 'exact';
  match_value: string;
  transaction_type?: 'income' | 'expense' | null;
  minimum_amount?: number | null;
  maximum_amount?: number | null;
  account_id?: string | null;
  category_id: string;
  is_active: boolean;
  hit_count: number;
  last_matched_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentExtraction {
  id: string;
  user_id: string;
  account_id?: string | null;
  source_file_path: string;
  source_file_name: string;
  source_mime_type: string;
  source_file_size: number;
  source_file_hash?: string | null;
  document_type: 'statement' | 'payroll' | 'other';
  status: 'uploaded' | 'processing' | 'reviewing' | 'completed' | 'failed' | 'cancelled';
  provider?: string | null;
  model?: string | null;
  document_confidence?: number | null;
  result_metadata: Record<string, unknown>;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentExtractionItem {
  id: string;
  extraction_id: string;
  user_id: string;
  line_number: number;
  transaction_date?: string | null;
  description?: string | null;
  signed_amount?: number | null;
  transaction_type?: 'income' | 'expense' | null;
  source_name?: string | null;
  external_id?: string | null;
  running_balance?: number | null;
  category_id?: string | null;
  category_name?: string | null;
  overall_confidence: number;
  field_confidence: Record<string, number>;
  review_status: 'pending' | 'accepted' | 'edited' | 'rejected';
  reviewer_notes?: string | null;
}

export interface BankConnection {
  id: string;
  user_id: string;
  provider: string;
  institution_id?: string | null;
  institution_name: string;
  display_name?: string | null;
  status: 'pending' | 'authorizing' | 'active' | 'expiring' | 'expired' | 'revocation_pending' | 'revoked' | 'error';
  sync_status: 'idle' | 'queued' | 'syncing' | 'completed' | 'partial' | 'error';
  scopes: string[];
  consent_expires_at?: string | null;
  last_synced_at?: string | null;
  next_sync_at?: string | null;
  last_error?: string | null;
  created_at: string;
  updated_at: string;
}

export interface BankSyncRun {
  id: string;
  connection_id: string;
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';
  trigger_source: 'initial' | 'manual' | 'scheduled' | 'webhook' | 'retry';
  received_count: number;
  imported_count: number;
  duplicate_count: number;
  error_message?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  created_at: string;
}

export interface FinanceSummary {
  currentBalance: number;
  projectedBalance: number;
  dailyLimit: number;
  daysRemaining: number;
  nextPaydayDate: string;
  nextPaydayLabel: string;
  cyclePeriodLabel?: string;
  cycleInterval?: { start: Date; end: Date };
  todaySpent: number;
  totalSpentInCycle: number;
  averageDailySpent: number;
  dominantCategory: string;
  spendingTrend: 'up' | 'down' | 'stable';
  dailyInsight: string;
  insights: string[];
  smartAlert: {
    message: string;
    type: 'danger' | 'warning' | 'success';
  } | null;
  rhythm: {
    day: RhythmData;
    week: RhythmData;
    month: RhythmData;
  };
  topCategories: { name: string; amount: number; percentage: number }[];
  priorities: PriorityItem[];
  processedFixedBills?: (FixedBill & { reconciledStatus: 'paid_identified' | 'pending' | 'overdue' | 'off-cycle' })[];
}

export interface Investment {
  id: string;
  user_id: string;
  name: string;
  type: 'fixed_income' | 'variable_income' | 'crypto' | 'other';
  institution: string;
  amount: number;
  initial_amount?: number;
  quantity?: number;
  average_price?: number;
  current_price?: number;
  dividends_received?: number;
  target_percentage?: number;
  yield_percentage?: number;
  purchase_date?: string;
  category: string;
  pl?: number;
  roe?: number;
  ebitda?: number;
  liquid_debt?: number;
  dividend_yield?: number;
  score?: number;
  note?: string;
}

export interface Budget {
  id: string;
  user_id: string;
  category: string;
  limit_amount: number;
}

export interface Subscription {
  id: string;
  user_id: string;
  name: string;
  amount: number;
  due_day: number;
  category: string;
  billing_cycle: 'monthly' | 'yearly';
  status: 'active' | 'cancelled';
}

export interface FinancialHealth {
  score: number;
  level: 'Iniciante' | 'Aprendiz' | 'Gestor' | 'Estrategista' | 'Wealth Master';
  nextLevelProgress: number;
  unlockedBadges: string[];
}
