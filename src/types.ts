export type TransactionType = 'expense' | 'income' | 'transfer';

export interface Transaction {
  id: string;
  user_id: string;
  amount: number;
  category: string;
  description: string;
  date: string;
  type: TransactionType;
  status?: 'pending' | 'completed' | 'ready' | 'duplicate' | 'error' | 'paid';
  source?: string;
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
  benefits: number; // VR, VA, etc
  deductions: number; // Added field for payroll deductions
  payday_cycle: 'monthly' | 'biweekly';
  payday_1: number; // Day of month (1-31)
  payday_2?: number; // Optional second payday
  payday_1_percentage?: number;
  payday_2_percentage?: number;
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
}

export interface DailyBill {
  id: string;
  user_id: string;
  name: string;
  average_amount: number;
  frequency: 'weekly' | 'monthly';
  category: string;
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
  status: 'pending' | 'duplicate' | 'ready' | 'error';
  confidence: number;
  original_description: string;
  bank_source?: string;
  running_balance?: number;
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
}

export interface Investment {
  id: string;
  user_id: string;
  name: string;
  type: 'fixed_income' | 'variable_income' | 'crypto' | 'other';
  institution: string;
  amount: number; // Current value (patrimony)
  initial_amount?: number; // Total invested initially
  quantity?: number;
  average_price?: number;
  current_price?: number;
  dividends_received?: number;
  target_percentage?: number; // % Ideal
  yield_percentage?: number;
  purchase_date?: string;
  category: string;
  // Fundamentalist Indicators
  pl?: number;
  roe?: number;
  ebitda?: number;
  liquid_debt?: number;
  dividend_yield?: number; // Current Yield for variable income
  score?: number; // 0-10 based on analysis
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
  score: number; // 0-1000
  level: 'Iniciante' | 'Aprendiz' | 'Gestor' | 'Estrategista' | 'Wealth Master';
  nextLevelProgress: number;
  unlockedBadges: string[];
}
