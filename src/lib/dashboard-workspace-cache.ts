import type {
  CardInstallment,
  CreditCard,
  FinancialAccount,
  FixedBill,
  TransactionCategory,
  UserSettings,
} from '../types';

export interface DashboardWorkspaceCacheSnapshot {
  version: 1;
  userId: string;
  savedAt: number;
  settings: UserSettings;
  accounts: FinancialAccount[];
  categories: TransactionCategory[];
  fixedBills: FixedBill[];
  cards: CreditCard[];
  installments: CardInstallment[];
}

const CACHE_PREFIX = 'mfinanceiro:dashboard-workspace:v1:';
const MAX_CACHE_AGE_MS = 15 * 60_000;

function cacheKey(userId: string): string {
  return `${CACHE_PREFIX}${userId}`;
}

export function readDashboardWorkspaceCache(userId: string): DashboardWorkspaceCacheSnapshot | null {
  if (typeof window === 'undefined') return null;

  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(cacheKey(userId)) || 'null') as DashboardWorkspaceCacheSnapshot | null;
    if (!parsed || parsed.version !== 1 || parsed.userId !== userId || !parsed.settings) return null;
    if (!Array.isArray(parsed.accounts) || !Array.isArray(parsed.categories) || !Array.isArray(parsed.fixedBills) || !Array.isArray(parsed.cards) || !Array.isArray(parsed.installments)) return null;
    if (Date.now() - Number(parsed.savedAt || 0) > MAX_CACHE_AGE_MS) {
      window.sessionStorage.removeItem(cacheKey(userId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeDashboardWorkspaceCache(
  userId: string,
  data: Omit<DashboardWorkspaceCacheSnapshot, 'version' | 'userId' | 'savedAt'>,
): void {
  if (typeof window === 'undefined') return;

  const snapshot: DashboardWorkspaceCacheSnapshot = {
    version: 1,
    userId,
    savedAt: Date.now(),
    ...data,
  };

  try {
    window.sessionStorage.setItem(cacheKey(userId), JSON.stringify(snapshot));
  } catch {
    // The live dashboard state remains authoritative when browser storage is unavailable.
  }
}
