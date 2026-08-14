import type { ImportedTransaction } from '../../types';
import type { ImportBalanceValidation } from './import-types';

function signedAmount(item: ImportedTransaction): number {
  const amount = Number(item.amount);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return item.type === 'income' ? Math.abs(amount) : -Math.abs(amount);
}

function importedTimestamp(value: string): number {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

export function calculateImportBalanceValidation(
  items: ImportedTransaction[],
  documentStatementBalance?: number,
): ImportBalanceValidation | null {
  const withRunningBalance = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.running_balance !== undefined && Number.isFinite(item.running_balance));

  if (withRunningBalance.length) {
    const ascending = [...withRunningBalance].sort((a, b) => {
      const byDate = importedTimestamp(a.item.date) - importedTimestamp(b.item.date);
      return byDate || a.index - b.index;
    });
    const descending = [...withRunningBalance].sort((a, b) => {
      const byDate = importedTimestamp(b.item.date) - importedTimestamp(a.item.date);
      return byDate || b.index - a.index;
    });
    const first = ascending[0]?.item;
    const last = descending[0]?.item;
    if (!first || !last) return null;

    const openingBalance = Number(first.running_balance ?? 0) - signedAmount(first);
    const selectedNet = items
      .filter((item) => item.status === 'ready')
      .reduce((sum, item) => sum + signedAmount(item), 0);
    const expectedFinal = openingBalance + selectedNet;
    const statementFinal = Number(last.running_balance ?? 0);
    const diff = expectedFinal - statementFinal;

    return { expectedFinal, statementFinal, diff, isClose: Math.abs(diff) < 0.01 };
  }

  if (!items.length || documentStatementBalance === undefined || !Number.isFinite(documentStatementBalance)) {
    return null;
  }

  const statementFinal = Number(documentStatementBalance);
  const fullStatementNet = items.reduce((sum, item) => sum + signedAmount(item), 0);
  const selectedNet = items
    .filter((item) => item.status === 'ready')
    .reduce((sum, item) => sum + signedAmount(item), 0);
  const inferredOpeningBalance = statementFinal - fullStatementNet;
  const expectedFinal = inferredOpeningBalance + selectedNet;
  const diff = expectedFinal - statementFinal;

  return { expectedFinal, statementFinal, diff, isClose: Math.abs(diff) < 0.01 };
}

export function toggleImportedTransaction(items: ImportedTransaction[], id: string): ImportedTransaction[] {
  return items.map((item) => {
    if (item.id !== id) return item;
    if (item.status === 'error' && (item.amount <= 0 || item.description === 'Sem descricao')) return item;
    const selected = item.status !== 'ready';
    return {
      ...item,
      status: selected ? 'ready' : 'pending',
      review_status: item.extraction_item_id ? (selected ? 'accepted' : 'pending') : item.review_status,
    };
  });
}

export function updateImportedTransaction(
  items: ImportedTransaction[],
  id: string,
  patch: Partial<ImportedTransaction>,
): ImportedTransaction[] {
  return items.map((item) => {
    if (item.id !== id) return item;
    const next = { ...item, ...patch };
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(next.date)
      && next.description.trim().length > 0
      && Number(next.amount) > 0;
    return {
      ...next,
      status: valid ? 'ready' : 'error',
      confidence: Math.min(Number(next.confidence || 0), 0.99),
      review_status: 'edited',
    };
  });
}

export function removeImportedTransaction(items: ImportedTransaction[], id: string) {
  const removed = items.find((item) => item.id === id);
  return {
    items: items.filter((item) => item.id !== id),
    rejectedExtractionItemId: removed?.extraction_item_id || null,
  };
}
