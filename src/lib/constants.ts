import { UserSettings } from '../types';

export const DEFAULT_USER_SETTINGS = (userId: string): Omit<UserSettings, 'id'> => ({
  user_id: userId,
  current_balance: 0,
  gross_salary: 0,
  net_salary_estimated: 0,
  benefits: 0,
  deductions: 0,
  payday_cycle: 'monthly' as const,
  payday_1: 5,
  // Ensure any newer fields have safe defaults here
});

export const APP_VERSION = '2.1.0';
export const STORAGE_PREFIX = 'mfinanceiro:';

export const CATEGORIES = [
  'Geral',
  'Alimentação',
  'Transporte',
  'Lazer',
  'Saúde',
  'Educação',
  'Contas Fixas',
  'Moradia',
  'Rendimentos',
  'Salário',
  'Benefícios',
  'Transferência',
  'Outros'
];
