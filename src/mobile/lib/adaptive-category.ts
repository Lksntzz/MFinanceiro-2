import type {
  Transaction,
  TransactionCategory,
  TransactionType,
} from '../../types';

export type AdaptiveCategorySuggestion = {
  categoryId: string;
  categoryName: string;
  confidence: 'high' | 'medium';
  confidenceScore: number;
  matchCount: number;
  consistency: number;
};

const STOP_WORDS = new Set([
  'a',
  'ao',
  'aos',
  'as',
  'com',
  'compra',
  'comprado',
  'comprei',
  'da',
  'das',
  'de',
  'debito',
  'do',
  'dos',
  'em',
  'gastei',
  'gasto',
  'no',
  'nos',
  'na',
  'nas',
  'pagamento',
  'paguei',
  'por',
  'pra',
  'para',
  'real',
  'reais',
  'r$',
  'cartao',
  'credito',
  'pix',
  'ltda',
  'me',
  'meu',
  'minha',
  'foi',
  'uma',
  'um',
]);
const BROAD_FIRST_TOKENS = new Set([
  'mercado',
  'loja',
  'posto',
  'shopping',
  'pag',
  'pay',
]);
const EXCLUDED_STATUSES = new Set(['pending', 'duplicate', 'error']);

function normalizeText(value: string) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\b\d+[a-z]?\b/g, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function adaptiveMerchantTokens(value: string) {
  return normalizeText(value)
    .split(' ')
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
    .slice(0, 7);
}

export function adaptiveMerchantKey(value: string) {
  return adaptiveMerchantTokens(value).slice(0, 4).join(' ');
}

function similarity(left: string, right: string) {
  const leftTokens = adaptiveMerchantTokens(left);
  const rightTokens = adaptiveMerchantTokens(right);
  if (!leftTokens.length || !rightTokens.length) return 0;
  if (leftTokens[0] !== rightTokens[0]) return 0;
  if (BROAD_FIRST_TOKENS.has(leftTokens[0])) {
    if (
      leftTokens.length < 2 ||
      rightTokens.length < 2 ||
      leftTokens[1] !== rightTokens[1]
    )
      return 0;
  }

  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  const overlap = [...leftSet].filter((token) => rightSet.has(token)).length;
  const containment =
    overlap / Math.max(1, Math.min(leftSet.size, rightSet.size));
  const union = new Set([...leftSet, ...rightSet]).size;
  const jaccard = overlap / Math.max(1, union);
  return Math.min(1, containment * 0.72 + jaccard * 0.18 + 0.1);
}

function compatibleCategory(
  category: TransactionCategory,
  type: TransactionType,
) {
  if (!category.is_active) return false;
  if (type === 'transfer') return false;
  return category.category_type === 'both' || category.category_type === type;
}

function resolveHistoryCategory(
  item: Transaction,
  categories: TransactionCategory[],
) {
  if (item.category_id) {
    const byId = categories.find(
      (category) => category.id === item.category_id,
    );
    if (byId) return byId;
  }
  const key = normalizeText(item.category || '');
  return (
    categories.find((category) => normalizeText(category.name) === key) || null
  );
}

export function inferAdaptiveCategory(options: {
  merchantText: string;
  type: Exclude<TransactionType, 'transfer'>;
  history: Transaction[];
  categories: TransactionCategory[];
}): AdaptiveCategorySuggestion | null {
  const { merchantText, type, history, categories } = options;
  if (adaptiveMerchantTokens(merchantText).length === 0) return null;

  const candidates = history
    .filter(
      (item) =>
        item.type === type &&
        !EXCLUDED_STATUSES.has(String(item.status || 'paid')),
    )
    .map((item) => {
      const category = resolveHistoryCategory(item, categories);
      const score = similarity(
        merchantText,
        item.description || item.source || '',
      );
      return { item, category, score };
    })
    .filter(
      (candidate) =>
        candidate.category &&
        compatibleCategory(candidate.category, type) &&
        candidate.score >= 0.7,
    ) as Array<{
    item: Transaction;
    category: TransactionCategory;
    score: number;
  }>;

  if (candidates.length < 2) return null;

  const grouped = new Map<
    string,
    { category: TransactionCategory; count: number; similarityTotal: number }
  >();
  for (const candidate of candidates) {
    const current = grouped.get(candidate.category.id) || {
      category: candidate.category,
      count: 0,
      similarityTotal: 0,
    };
    current.count += 1;
    current.similarityTotal += candidate.score;
    grouped.set(candidate.category.id, current);
  }

  const ranked = [...grouped.values()].sort(
    (a, b) => b.count - a.count || b.similarityTotal - a.similarityTotal,
  );
  const winner = ranked[0];
  if (!winner) return null;

  const consistency = winner.count / candidates.length;
  const averageSimilarity = winner.similarityTotal / winner.count;
  const high =
    winner.count >= 3 && consistency >= 0.8 && averageSimilarity >= 0.72;
  const medium =
    winner.count >= 2 && consistency >= 0.67 && averageSimilarity >= 0.7;
  if (!high && !medium) return null;

  const confidenceScore = Math.min(
    0.98,
    0.42 +
      Math.min(0.24, winner.count * 0.06) +
      consistency * 0.2 +
      averageSimilarity * 0.12,
  );
  return {
    categoryId: winner.category.id,
    categoryName: winner.category.name,
    confidence: high ? 'high' : 'medium',
    confidenceScore,
    matchCount: winner.count,
    consistency,
  };
}
