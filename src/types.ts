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
}

export interface StatementImportRow {
  id: string;
  batch_id: string;
  line_number: number;
  transaction_date?: string | null;
  description?: string | null;
  category_name?: string | null;
  signed_amount?: number | null;
  status: 'parsed' | 'imported' | 'duplicate' | 'rejected' | 'ignored' | 'reconciled';
  error_message?: string | null;
  ledger_entry_id?: string | null;
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
