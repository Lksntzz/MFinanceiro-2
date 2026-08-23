export const BASE_REVIEW_THRESHOLD = 0.85;

export type AdaptiveCategoryPattern = {
  merchant_key: string;
  transaction_type: 'income' | 'expense';
  category_id: string;
  category_name: string;
  confidence_score: number;
  confirmation_count: number;
};

export function clampConfidence(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0;
}

export function normalizeLearningKey(value: unknown) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('pt-BR')
    .replace(/\s+/g, ' ')
    .slice(0, 160);
}

export function merchantKey(value: unknown) {
  return String(value || '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\b\d{3,}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

export function calibrateConfidence(
  rawConfidence: unknown,
  reviewThreshold: unknown,
) {
  const raw = clampConfidence(rawConfidence);
  const threshold = Math.min(
    0.98,
    Math.max(0.75, Number(reviewThreshold) || BASE_REVIEW_THRESHOLD),
  );
  // The current review UI uses 0.85 as its selection boundary. Shifting the
  // calibrated score preserves that UI while making the effective threshold adaptive.
  return clampConfidence(raw + (BASE_REVIEW_THRESHOLD - threshold));
}

export function buildAdaptivePatternMap(rows: Array<Record<string, unknown>>) {
  const map = new Map<string, AdaptiveCategoryPattern>();
  for (const row of rows) {
    const type =
      row.transaction_type === 'income' || row.transaction_type === 'expense'
        ? row.transaction_type
        : null;
    const key = merchantKey(row.merchant_key);
    const categoryId = String(row.category_id || '');
    const categoryName = String(row.category_name || '').trim();
    if (!type || !key || !categoryId || !categoryName) continue;
    map.set(`${type}:${key}`, {
      merchant_key: key,
      transaction_type: type,
      category_id: categoryId,
      category_name: categoryName,
      confidence_score: clampConfidence(row.confidence_score),
      confirmation_count: Math.max(
        0,
        Math.trunc(Number(row.confirmation_count) || 0),
      ),
    });
  }
  return map;
}
