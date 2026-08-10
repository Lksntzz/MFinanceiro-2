export type RecurrenceHistoryItem = {
  id: string;
  description: string;
  amount: number;
  category?: string | null;
  date: string;
  type: string;
  status?: string | null;
  affects_balance?: boolean | null;
};

export type ExistingRecurrence = {
  name: string;
  category?: string | null;
};

export type RecurrenceSuggestion = {
  key: string;
  name: string;
  category: string;
  estimatedAmount: number;
  dueDay: number;
  occurrences: number;
  distinctMonths: number;
  firstDate: string;
  lastDate: string;
  amountVariation: number;
  amountBehavior: 'stable' | 'variable';
  confidence: 'high' | 'medium';
  confidenceScore: number;
  reason: string;
};

function normalizeText(value: string) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/\b(?:pix|ted|doc|debito|deb|credito|cred|compra|pagamento|pgto|pgt|transacao)\b/g, ' ')
    .replace(/\b\d{2,}\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function recurrenceKey(description: string) {
  return normalizeText(description)
    .split(' ')
    .filter((token) => token.length >= 3)
    .slice(0, 5)
    .join(' ')
    .slice(0, 120);
}

function monthIndex(date: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;
  return Number(match[1]) * 12 + Number(match[2]) - 1;
}

function dayOfMonth(date: string) {
  const match = /^\d{4}-\d{2}-(\d{2})$/.exec(date);
  return match ? Number(match[1]) : null;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function modeText(values: Array<string | null | undefined>) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const clean = String(value || '').trim();
    if (!clean) continue;
    counts.set(clean, (counts.get(clean) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'Contas Fixas';
}

function tokenSet(value: string) {
  return new Set(normalizeText(value).split(' ').filter((token) => token.length >= 3));
}

function similarity(left: string, right: string) {
  const a = tokenSet(left);
  const b = tokenSet(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  const union = new Set([...a, ...b]).size;
  return union ? intersection / union : 0;
}

function representativeName(rows: RecurrenceHistoryItem[]) {
  const names = rows
    .map((row) => String(row.description || '').trim())
    .filter(Boolean)
    .sort((a, b) => a.length - b.length);
  return (names[0] || 'Recorrência detectada').slice(0, 120);
}

function isAlreadyTracked(name: string, existing: ExistingRecurrence[]) {
  const normalized = normalizeText(name);
  return existing.some((item) => {
    const candidate = normalizeText(item.name);
    if (!candidate) return false;
    if (normalized.includes(candidate) || candidate.includes(normalized)) return true;
    return similarity(name, item.name) >= 0.6;
  });
}

function monthlyBuckets(rows: RecurrenceHistoryItem[]) {
  const byMonth = new Map<number, RecurrenceHistoryItem[]>();
  for (const row of rows) {
    const month = monthIndex(row.date);
    if (month == null) continue;
    const bucket = byMonth.get(month) || [];
    bucket.push(row);
    byMonth.set(month, bucket);
  }
  return byMonth;
}

function groupRepresentativeRows(rows: RecurrenceHistoryItem[]) {
  const byMonth = monthlyBuckets(rows);
  const representatives: RecurrenceHistoryItem[] = [];
  for (const bucket of byMonth.values()) {
    const sorted = [...bucket].sort((a, b) => a.date.localeCompare(b.date));
    representatives.push(sorted[Math.floor(sorted.length / 2)]);
  }
  return representatives.sort((a, b) => a.date.localeCompare(b.date));
}

export function detectRecurringExpenses(
  history: RecurrenceHistoryItem[],
  existing: ExistingRecurrence[],
): RecurrenceSuggestion[] {
  const groups = new Map<string, RecurrenceHistoryItem[]>();

  for (const row of history) {
    if (row.type !== 'expense') continue;
    if (row.affects_balance === false) continue;
    const amount = Math.abs(Number(row.amount || 0));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue;

    const key = recurrenceKey(row.description);
    if (!key || key.length < 3) continue;
    const bucket = groups.get(key) || [];
    bucket.push({ ...row, amount });
    groups.set(key, bucket);
  }

  const suggestions: RecurrenceSuggestion[] = [];

  for (const [key, rows] of groups.entries()) {
    const byMonth = monthlyBuckets(rows);
    const representatives = groupRepresentativeRows(rows);
    if (representatives.length < 3) continue;

    // A monthly bill should happen approximately once per cycle. This blocks
    // merchants such as supermarkets, fuel stations and mobility apps that can
    // appear every month but are used many times within the same month.
    const monthCounts = [...byMonth.values()].map((bucket) => bucket.length);
    const averagePerActiveMonth = rows.length / Math.max(1, representatives.length);
    const repeatedMonthRatio = monthCounts.filter((count) => count > 1).length / Math.max(1, monthCounts.length);
    if (averagePerActiveMonth > 1.6 || repeatedMonthRatio > 0.5) continue;

    const months = representatives.map((row) => monthIndex(row.date)).filter((value): value is number => value != null);
    const firstMonth = Math.min(...months);
    const lastMonth = Math.max(...months);
    const monthSpan = lastMonth - firstMonth + 1;
    const coverage = monthSpan > 0 ? representatives.length / monthSpan : 0;
    if (coverage < 0.6) continue;

    const monthGaps = months.slice(1).map((month, index) => month - months[index]);
    const normalMonthlyGaps = monthGaps.filter((gap) => gap >= 1 && gap <= 2).length;
    if (monthGaps.length && normalMonthlyGaps / monthGaps.length < 0.7) continue;

    const days = representatives.map((row) => dayOfMonth(row.date)).filter((value): value is number => value != null);
    const dueDay = Math.max(1, Math.min(31, Math.round(median(days))));
    const dayDeviation = days.length ? median(days.map((day) => Math.abs(day - dueDay))) : 31;
    if (dayDeviation > 7) continue;

    const amounts = representatives.map((row) => Math.abs(Number(row.amount || 0))).filter((value) => value > 0);
    const estimatedAmount = Number(median(amounts).toFixed(2));
    if (!estimatedAmount) continue;
    const medianDeviation = median(amounts.map((amount) => Math.abs(amount - estimatedAmount)));
    const relativeMedianDeviation = medianDeviation / estimatedAmount;
    const rangeVariation = (Math.max(...amounts) - Math.min(...amounts)) / estimatedAmount;
    // Median deviation is robust against one odd month, while range catches
    // genuinely variable utility bills whose values move materially across cycles.
    const amountVariation = Math.max(relativeMedianDeviation, rangeVariation);
    const amountBehavior = amountVariation <= 0.12 ? 'stable' : 'variable';

    const name = representativeName(representatives);
    if (isAlreadyTracked(name, existing)) continue;

    let score = 0.52;
    score += Math.min(0.18, (representatives.length - 3) * 0.045);
    score += Math.min(0.1, coverage * 0.1);
    score += Math.max(0, 0.1 - (dayDeviation / 7) * 0.1);
    if (amountBehavior === 'stable') score += 0.05;
    score = Math.min(0.97, score);
    if (score < 0.65) continue;

    const category = modeText(representatives.map((row) => row.category));
    const variabilityText = amountBehavior === 'stable'
      ? 'valor costuma variar pouco'
      : 'valor varia, mas o padrão mensal é consistente';
    suggestions.push({
      key,
      name,
      category,
      estimatedAmount,
      dueDay,
      occurrences: rows.length,
      distinctMonths: representatives.length,
      firstDate: representatives[0].date,
      lastDate: representatives[representatives.length - 1].date,
      amountVariation,
      amountBehavior,
      confidence: score >= 0.82 ? 'high' : 'medium',
      confidenceScore: score,
      reason: `Apareceu em ${representatives.length} meses, perto do dia ${dueDay}; ${variabilityText}.`,
    });
  }

  return suggestions
    .sort((a, b) => b.confidenceScore - a.confidenceScore || b.distinctMonths - a.distinctMonths)
    .slice(0, 12);
}
