
export type TransactionType = 'expense' | 'income' | 'transfer';

export interface Transaction {
  id: string;
  user_id: string;
  amount: number;
  category: string;
  description: string;
  date: string;
  type: TransactionType;
}

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
}

export interface RhythmData {
  labels: string[];
  data: number[];
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
  card_id: string;
  description: string;
  total_amount: number;
  monthly_amount: number;
  current_installment: number;
  total_installments: number;
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
