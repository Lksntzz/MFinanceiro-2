export type InvestmentAssetClass = 'stock' | 'fii' | 'etf' | 'bdr' | 'crypto' | 'fixed_income' | 'international' | 'other';
export type InvestmentOperationType = 'buy' | 'sell';

export type InvestmentBetaOperation = {
  id: string;
  userId: string;
  type: InvestmentOperationType;
  assetClass: InvestmentAssetClass;
  symbol: string;
  assetName?: string;
  institution?: string;
  accountId?: string;
  accountName?: string;
  date: string;
  quantity: number;
  unitPrice: number;
  fees: number;
  currency: string;
  createdAt: string;
};

export type InvestmentBetaQuote = {
  symbol: string;
  name?: string;
  currency: string;
  price: number;
  change: number;
  changePercent: number;
  updatedAt?: string;
  source: 'brapi-sandbox';
};

export type InvestmentBetaPosition = {
  assetClass: InvestmentAssetClass;
  symbol: string;
  assetName?: string;
  currency: string;
  quantity: number;
  averagePrice: number;
  investedCost: number;
  currentPrice: number;
  currentValue: number;
  unrealizedResult: number;
  unrealizedResultPercent: number;
};

export const ASSET_CLASS_LABELS: Record<InvestmentAssetClass, string> = {
  stock: 'Ações',
  fii: 'FIIs',
  etf: 'ETFs',
  bdr: 'BDRs',
  crypto: 'Criptoativos',
  fixed_income: 'Renda fixa',
  international: 'Exterior',
  other: 'Outros',
};

export function betaOperationsStorageKey(userId: string) {
  return `mf-beta:investments-v2:operations:${userId}`;
}

export function betaTargetsStorageKey(userId: string) {
  return `mf-beta:investments-v2:targets:${userId}`;
}

export function betaAccessStorageKey() {
  return 'mf-beta:investments-v2:enabled';
}

export function sanitizeNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function normalizeSymbol(value: string): string {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

export function operationGrossAmount(operation: Pick<InvestmentBetaOperation, 'quantity' | 'unitPrice' | 'fees' | 'type'>): number {
  const trade = Math.max(0, sanitizeNumber(operation.quantity)) * Math.max(0, sanitizeNumber(operation.unitPrice));
  const fees = Math.max(0, sanitizeNumber(operation.fees));
  return Number((operation.type === 'buy' ? trade + fees : Math.max(0, trade - fees)).toFixed(2));
}

export function deriveInvestmentPositions(
  operations: InvestmentBetaOperation[],
  quotes: Record<string, InvestmentBetaQuote | undefined> = {},
): InvestmentBetaPosition[] {
  const sorted = [...operations].sort((a, b) => {
    const dateOrder = a.date.localeCompare(b.date);
    return dateOrder !== 0 ? dateOrder : a.createdAt.localeCompare(b.createdAt);
  });
  const positions = new Map<string, { assetClass: InvestmentAssetClass; symbol: string; assetName?: string; currency: string; quantity: number; cost: number; lastPrice: number }>();

  for (const operation of sorted) {
    const symbol = normalizeSymbol(operation.symbol);
    if (!symbol) continue;
    const key = `${operation.assetClass}:${symbol}:${operation.currency || 'BRL'}`;
    const current = positions.get(key) || {
      assetClass: operation.assetClass,
      symbol,
      assetName: operation.assetName,
      currency: operation.currency || 'BRL',
      quantity: 0,
      cost: 0,
      lastPrice: Math.max(0, sanitizeNumber(operation.unitPrice)),
    };

    const quantity = Math.max(0, sanitizeNumber(operation.quantity));
    const unitPrice = Math.max(0, sanitizeNumber(operation.unitPrice));
    const fees = Math.max(0, sanitizeNumber(operation.fees));
    current.assetName = operation.assetName || current.assetName;
    current.lastPrice = unitPrice || current.lastPrice;

    if (operation.type === 'buy') {
      current.quantity += quantity;
      current.cost += quantity * unitPrice + fees;
    } else if (quantity > 0 && current.quantity > 0) {
      const quantityBefore = current.quantity;
      const averagePriceBefore = current.cost / quantityBefore;
      const removed = Math.min(quantity, quantityBefore);
      current.quantity = Math.max(0, quantityBefore - removed);
      current.cost = Math.max(0, current.cost - averagePriceBefore * removed);
      if (current.quantity <= 0.00000001) {
        current.quantity = 0;
        current.cost = 0;
      }
    }

    positions.set(key, current);
  }

  return [...positions.values()]
    .filter((position) => position.quantity > 0)
    .map((position) => {
      const quote = quotes[position.symbol];
      const averagePrice = position.quantity > 0 ? position.cost / position.quantity : 0;
      const currentPrice = quote?.price && quote.price > 0 ? quote.price : position.lastPrice;
      const currentValue = position.quantity * currentPrice;
      const unrealizedResult = currentValue - position.cost;
      const unrealizedResultPercent = position.cost > 0 ? (unrealizedResult / position.cost) * 100 : 0;
      return {
        assetClass: position.assetClass,
        symbol: position.symbol,
        assetName: position.assetName,
        currency: position.currency,
        quantity: Number(position.quantity.toFixed(8)),
        averagePrice: Number(averagePrice.toFixed(6)),
        investedCost: Number(position.cost.toFixed(2)),
        currentPrice: Number(currentPrice.toFixed(6)),
        currentValue: Number(currentValue.toFixed(2)),
        unrealizedResult: Number(unrealizedResult.toFixed(2)),
        unrealizedResultPercent: Number(unrealizedResultPercent.toFixed(2)),
      };
    })
    .sort((a, b) => b.currentValue - a.currentValue);
}

export function deriveAllocationByClass(positions: InvestmentBetaPosition[]) {
  const total = positions.reduce((sum, position) => sum + Math.max(0, position.currentValue), 0);
  const rows = new Map<InvestmentAssetClass, number>();
  positions.forEach((position) => rows.set(position.assetClass, (rows.get(position.assetClass) || 0) + Math.max(0, position.currentValue)));
  return [...rows.entries()]
    .map(([assetClass, value]) => ({ assetClass, label: ASSET_CLASS_LABELS[assetClass], value: Number(value.toFixed(2)), percentage: total > 0 ? Number(((value / total) * 100).toFixed(2)) : 0 }))
    .sort((a, b) => b.value - a.value);
}

export function calculateRebalancingPlan(
  positions: InvestmentBetaPosition[],
  targets: Partial<Record<InvestmentAssetClass, number>>,
  contribution: number,
) {
  const available = Math.max(0, sanitizeNumber(contribution));
  if (available <= 0) return [];
  const current = new Map<InvestmentAssetClass, number>();
  positions.forEach((position) => current.set(position.assetClass, (current.get(position.assetClass) || 0) + Math.max(0, position.currentValue)));
  const currentTotal = [...current.values()].reduce((sum, value) => sum + value, 0);
  const finalTotal = currentTotal + available;
  const desired = (Object.keys(ASSET_CLASS_LABELS) as InvestmentAssetClass[])
    .map((assetClass) => ({
      assetClass,
      label: ASSET_CLASS_LABELS[assetClass],
      target: Math.max(0, sanitizeNumber(targets[assetClass])),
      currentValue: current.get(assetClass) || 0,
    }))
    .filter((row) => row.target > 0);
  const targetSum = desired.reduce((sum, row) => sum + row.target, 0);
  if (targetSum <= 0) return [];
  const deficits = desired.map((row) => {
    const normalizedTarget = row.target / targetSum;
    const desiredValue = finalTotal * normalizedTarget;
    return { ...row, normalizedTarget, deficit: Math.max(0, desiredValue - row.currentValue) };
  });
  const deficitTotal = deficits.reduce((sum, row) => sum + row.deficit, 0);
  if (deficitTotal <= 0) return [];
  return deficits
    .filter((row) => row.deficit > 0)
    .map((row) => ({
      assetClass: row.assetClass,
      label: row.label,
      targetPercentage: Number((row.normalizedTarget * 100).toFixed(2)),
      currentValue: Number(row.currentValue.toFixed(2)),
      suggestedAmount: Number(Math.min(row.deficit, available * (row.deficit / deficitTotal)).toFixed(2)),
    }))
    .filter((row) => row.suggestedAmount > 0)
    .sort((a, b) => b.suggestedAmount - a.suggestedAmount);
}
