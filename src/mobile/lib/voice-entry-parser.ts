import type { FinancialAccount, TransactionCategory } from '../../types';

export type VoiceEntryType = 'expense' | 'income';

export type ParsedVoiceEntry = {
  type: VoiceEntryType;
  amount: number | null;
  description: string;
  categoryId: string;
  accountId: string;
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
};

const INCOME_WORDS = [
  'recebi',
  'receita',
  'entrou',
  'ganhei',
  'salario',
  'salário',
  'pagamento recebido',
  'renda',
];
const EXPENSE_WORDS = [
  'gastei',
  'paguei',
  'comprei',
  'despesa',
  'saiu',
  'gasto',
  'custou',
];

const CATEGORY_FAMILIES: Array<{
  categoryTokens: string[];
  speechTokens: string[];
}> = [
  {
    categoryTokens: ['transporte', 'combustivel', 'combustível'],
    speechTokens: [
      'gasolina',
      'etanol',
      'diesel',
      'combustivel',
      'combustível',
      'posto',
      'uber',
      '99',
      'taxi',
      'táxi',
      'onibus',
      'ônibus',
      'metro',
      'metrô',
    ],
  },
  {
    categoryTokens: ['alimentacao', 'alimentação', 'comida'],
    speechTokens: [
      'almoco',
      'almoço',
      'jantar',
      'lanche',
      'restaurante',
      'padaria',
      'ifood',
      'comida',
    ],
  },
  {
    categoryTokens: ['mercado', 'supermercado'],
    speechTokens: ['mercado', 'supermercado', 'compras'],
  },
  {
    categoryTokens: ['moradia', 'casa'],
    speechTokens: [
      'aluguel',
      'condominio',
      'condomínio',
      'energia',
      'luz',
      'agua',
      'água',
      'internet',
    ],
  },
  {
    categoryTokens: ['saude', 'saúde'],
    speechTokens: [
      'farmacia',
      'farmácia',
      'remedio',
      'remédio',
      'consulta',
      'medico',
      'médico',
    ],
  },
  {
    categoryTokens: ['lazer'],
    speechTokens: ['cinema', 'show', 'jogo', 'viagem', 'passeio'],
  },
  {
    categoryTokens: ['salario', 'salário', 'renda'],
    speechTokens: ['salario', 'salário', 'holerite', 'pagamento'],
  },
];

function normalize(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9\s,.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseAmount(transcript: string) {
  const normalized = normalize(transcript);
  const moneyMatch = normalized.match(
    /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})|\d+(?:[.,]\d{1,2})?)\s*(?:reais|real)?\b/,
  );
  if (moneyMatch?.[1]) {
    const token = moneyMatch[1];
    const value = token.includes(',')
      ? Number(token.replace(/\./g, '').replace(',', '.'))
      : Number(token);
    if (Number.isFinite(value) && value > 0) return value;
  }

  const wholeMatch = normalized.match(/\b(\d+)\s*(?:reais|real)\b/);
  if (wholeMatch?.[1]) {
    const value = Number(wholeMatch[1]);
    if (Number.isFinite(value) && value > 0) return value;
  }

  return null;
}

function detectType(transcript: string): VoiceEntryType {
  const normalized = normalize(transcript);
  if (INCOME_WORDS.some((word) => normalized.includes(normalize(word))))
    return 'income';
  if (EXPENSE_WORDS.some((word) => normalized.includes(normalize(word))))
    return 'expense';
  return 'expense';
}

function compatibleCategories(
  categories: TransactionCategory[],
  type: VoiceEntryType,
) {
  return categories.filter(
    (category) =>
      category.is_active &&
      (category.category_type === 'both' || category.category_type === type),
  );
}

function categoryScore(category: TransactionCategory, transcript: string) {
  const normalizedTranscript = normalize(transcript);
  const categoryName = normalize(category.name);
  if (categoryName && normalizedTranscript.includes(categoryName)) return 100;

  const words = categoryName.split(' ').filter((word) => word.length >= 4);
  let score = words.reduce(
    (total, word) => total + (normalizedTranscript.includes(word) ? 10 : 0),
    0,
  );

  for (const family of CATEGORY_FAMILIES) {
    const categoryMatchesFamily = family.categoryTokens.some((token) =>
      categoryName.includes(normalize(token)),
    );
    if (!categoryMatchesFamily) continue;
    const speechHits = family.speechTokens.filter((token) =>
      normalizedTranscript.includes(normalize(token)),
    ).length;
    score += speechHits * 12;
  }
  return score;
}

function findCategory(
  categories: TransactionCategory[],
  type: VoiceEntryType,
  transcript: string,
) {
  const compatible = compatibleCategories(categories, type);
  const ranked = compatible
    .map((category) => ({
      category,
      score: categoryScore(category, transcript),
    }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.score > 0 ? ranked[0].category : null;
}

function accountScore(account: FinancialAccount, transcript: string) {
  const normalizedTranscript = normalize(transcript);
  const candidates = [account.name, account.institution_name || '']
    .map(normalize)
    .filter(Boolean);
  return candidates.reduce(
    (score, candidate) =>
      score + (normalizedTranscript.includes(candidate) ? 20 : 0),
    0,
  );
}

function findAccount(accounts: FinancialAccount[], transcript: string) {
  const ranked = accounts
    .filter((account) => account.is_active)
    .map((account) => ({ account, score: accountScore(account, transcript) }))
    .sort((a, b) => b.score - a.score);
  if (ranked[0]?.score > 0) return ranked[0].account;
  return accounts.find((account) => account.is_default) || accounts[0] || null;
}

export function parseVoiceEntry(
  transcript: string,
  categories: TransactionCategory[],
  accounts: FinancialAccount[],
): ParsedVoiceEntry {
  const type = detectType(transcript);
  const amount = parseAmount(transcript);
  const category = findCategory(categories, type, transcript);
  const account = findAccount(accounts, transcript);
  const warnings: string[] = [];

  if (!amount) warnings.push('Não consegui identificar o valor com segurança.');
  if (!category) warnings.push('Confirme a categoria antes de salvar.');
  if (!account) warnings.push('Selecione a conta financeira.');

  const confidence =
    amount && category ? 'high' : amount || category ? 'medium' : 'low';
  return {
    type,
    amount,
    description: transcript.trim().slice(0, 180),
    categoryId: category?.id || '',
    accountId: account?.id || '',
    confidence,
    warnings,
  };
}
