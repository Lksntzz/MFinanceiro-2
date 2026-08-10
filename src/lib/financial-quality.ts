import type { CreditCard, FinancialAccount, FixedBill, Transaction, TransactionCategory } from '../types';

export type DataQualitySeverity = 'high' | 'medium' | 'low';

export type DataQualityIssue = {
  id: string;
  severity: DataQualitySeverity;
  title: string;
  description: string;
  actionLabel: string;
  actionPath: string;
};

function normalized(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function transactionFingerprint(transaction: Transaction) {
  const date = String(transaction.date || '').slice(0, 10);
  const description = normalized(transaction.description).replace(/\s+/g, ' ');
  const amount = Math.abs(Number(transaction.amount || 0)).toFixed(2);
  return `${date}|${description}|${amount}|${transaction.type}`;
}

export function assessDataQuality({
  accounts,
  categories,
  cards,
  fixedBills,
  transactions,
}: {
  accounts: FinancialAccount[];
  categories: TransactionCategory[];
  cards: CreditCard[];
  fixedBills: FixedBill[];
  transactions: Transaction[];
}): DataQualityIssue[] {
  const issues: DataQualityIssue[] = [];
  const activeAccounts = accounts.filter((account) => account.is_active !== false);

  if (!activeAccounts.length) {
    issues.push({
      id: 'no-account', severity: 'high', title: 'Nenhuma conta financeira ativa',
      description: 'Sem uma conta ativa, saldo e disponibilidade perdem confiabilidade.',
      actionLabel: 'Configurar conta', actionPath: '/app/planejamento/contas',
    });
  } else if (!activeAccounts.some((account) => account.is_default)) {
    issues.push({
      id: 'no-default-account', severity: 'medium', title: 'Conta principal não definida',
      description: 'Defina qual conta representa o ponto de entrada padrão dos lançamentos.',
      actionLabel: 'Definir principal', actionPath: '/app/planejamento/contas',
    });
  }

  const activeCategories = categories.filter((category) => category.is_active !== false);
  if (!activeCategories.length) {
    issues.push({
      id: 'no-categories', severity: 'medium', title: 'Categorias não configuradas',
      description: 'Categorias melhoram orçamento, busca e interpretação dos gastos.',
      actionLabel: 'Configurar categorias', actionPath: '/app/planejamento/categorias',
    });
  }

  const recent = [...transactions]
    .sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
    .slice(0, 60);
  if (recent.length >= 8) {
    const genericCount = recent.filter((transaction) => {
      const category = normalized(transaction.category);
      return !category || category === 'geral' || category === 'outros' || category === 'sem categoria';
    }).length;
    if (genericCount / recent.length >= 0.25) {
      issues.push({
        id: 'generic-categories', severity: 'medium', title: 'Muitos lançamentos genéricos',
        description: `${genericCount} dos ${recent.length} lançamentos recentes estão em categorias genéricas.`,
        actionLabel: 'Revisar movimentações', actionPath: '/app/movimentacoes',
      });
    }
  }

  const fingerprints = new Map<string, number>();
  recent.forEach((transaction) => {
    const key = transactionFingerprint(transaction);
    fingerprints.set(key, (fingerprints.get(key) || 0) + 1);
  });
  const duplicateGroups = [...fingerprints.values()].filter((count) => count > 1).length;
  if (duplicateGroups > 0) {
    issues.push({
      id: 'possible-duplicates', severity: 'medium', title: 'Possíveis lançamentos duplicados',
      description: `${duplicateGroups} grupo${duplicateGroups === 1 ? '' : 's'} recente${duplicateGroups === 1 ? '' : 's'} merece${duplicateGroups === 1 ? '' : 'm'} conferência.`,
      actionLabel: 'Conferir histórico', actionPath: '/app/movimentacoes',
    });
  }

  const incompleteCards = cards.filter((card) => Number(card.limit || 0) <= 0 || Number((card as any).due_day || 0) <= 0 || Number((card as any).closing_day || 0) <= 0);
  if (incompleteCards.length) {
    issues.push({
      id: 'card-dates', severity: 'low', title: 'Cartão com configuração incompleta',
      description: 'Limite, fechamento e vencimento completos melhoram Agenda e projeções.',
      actionLabel: 'Revisar cartões', actionPath: '/app/planejamento/cartoes',
    });
  }

  const invalidBills = fixedBills.filter((bill) => Number(bill.amount || 0) <= 0 || Number((bill as any).due_day || 0) < 1 || Number((bill as any).due_day || 0) > 31);
  if (invalidBills.length) {
    issues.push({
      id: 'invalid-recurrence', severity: 'low', title: 'Recorrência precisa de revisão',
      description: 'Há compromisso sem valor ou dia de vencimento válido.',
      actionLabel: 'Revisar recorrências', actionPath: '/app/agenda/recorrencias',
    });
  }

  const rank: Record<DataQualitySeverity, number> = { high: 0, medium: 1, low: 2 };
  return issues.sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 6);
}
