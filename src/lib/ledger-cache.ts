import type { LedgerCursor, Transaction } from '../types';

export const LEDGER_PAGE_SIZE = 100;

interface LedgerCacheSnapshot {
  version: 1;
  userId: string;
  savedAt: number;
  rows: Transaction[];
  totalCount: number;
  hasMore: boolean;
  nextCursor: LedgerCursor | null;
}

const CACHE_PREFIX = 'mfinanceiro:ledger-page:v1:';
const MAX_CACHE_AGE_MS = 15 * 60_000;
const MAX_CACHED_ROWS = 500;

function cacheKey(userId: string): string {
  return `${CACHE_PREFIX}${userId}`;
}

function transactionTime(row: Transaction): number {
  const date = new Date(row.date || row.created_at || 0).getTime();
  const created = new Date(row.created_at || 0).getTime();
  return Math.max(
    Number.isFinite(date) ? date : 0,
    Number.isFinite(created) ? created : 0,
  );
}

export function sortLedgerRows(rows: Transaction[]): Transaction[] {
  return [...rows].sort((a, b) => {
    const byDate = String(b.date || '').localeCompare(String(a.date || ''));
    if (byDate !== 0) return byDate;
    const byCreated = String(b.created_at || '').localeCompare(
      String(a.created_at || ''),
    );
    if (byCreated !== 0) return byCreated;
    return String(b.id).localeCompare(String(a.id));
  });
}

export function mergeLedgerRows(
  current: Transaction[],
  incoming: Transaction[],
): Transaction[] {
  const rows = new Map(current.map((row) => [row.id, row]));
  incoming.forEach((row) => rows.set(row.id, { ...rows.get(row.id), ...row }));
  return sortLedgerRows([...rows.values()]);
}

export function readLedgerCache(userId: string): LedgerCacheSnapshot | null {
  if (typeof window === 'undefined') return null;

  try {
    const parsed = JSON.parse(
      window.sessionStorage.getItem(cacheKey(userId)) || 'null',
    ) as LedgerCacheSnapshot | null;
    if (
      parsed?.version !== 1 ||
      parsed.userId !== userId ||
      !Array.isArray(parsed.rows)
    )
      return null;
    if (Date.now() - Number(parsed.savedAt || 0) > MAX_CACHE_AGE_MS) {
      window.sessionStorage.removeItem(cacheKey(userId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeLedgerCache(
  userId: string,
  rows: Transaction[],
  totalCount: number,
  hasMore: boolean,
  nextCursor: LedgerCursor | null,
): void {
  if (typeof window === 'undefined') return;

  const snapshot: LedgerCacheSnapshot = {
    version: 1,
    userId,
    savedAt: Date.now(),
    rows: sortLedgerRows(rows).slice(0, MAX_CACHED_ROWS),
    totalCount,
    hasMore,
    nextCursor,
  };

  try {
    window.sessionStorage.setItem(cacheKey(userId), JSON.stringify(snapshot));
  } catch {
    // The in-memory state remains authoritative when browser storage is unavailable.
  }
}

export function isNewerLedgerRow(
  candidate: Transaction,
  reference: Transaction,
): boolean {
  return transactionTime(candidate) >= transactionTime(reference);
}
