type TransactionLike = {
  amount?: number | string | null;
  date?: string | null;
  type?: string | null;
  category?: string | null;
  description?: string | null;
};

type FixedBillLike = {
  amount?: number | string | null;
  status?: string | null;
};

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

function money(value: number): string {
  return BRL.format(Number.isFinite(value) ? value : 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function transactionKind(transaction: TransactionLike): 'income' | 'expense' {
  const raw = String(transaction.type || '').toLowerCase();
  if (raw === 'income' || raw === 'entrada' || raw === 'receita')
    return 'income';
  return Number(transaction.amount || 0) >= 0 ? 'income' : 'expense';
}

function validTransactions(
  transactions: TransactionLike[],
): Array<TransactionLike & { parsedDate: Date; numericAmount: number }> {
  return transactions
    .map((transaction) => ({
      ...transaction,
      parsedDate: new Date(String(transaction.date || '')),
      numericAmount: Number(transaction.amount || 0),
    }))
    .filter(
      (transaction) =>
        !Number.isNaN(transaction.parsedDate.getTime()) &&
        Number.isFinite(transaction.numericAmount),
    );
}

export interface MarketInsight {
  summary: string;
  tendency: 'bull' | 'bear' | 'neutral';
  topAssetTypes: string[];
  tips: string[];
}

export interface InvestmentAdvice {
  recommendedAmount: number;
  strategy: string;
  reasoning: string;
}

/**
 * Planejamento local e educacional. Não consulta cotações nem notícias externas,
 * portanto não apresenta informações de mercado como se fossem atuais.
 */
export async function getMarketIntelligence(): Promise<MarketInsight> {
  return {
    summary:
      'Análise local ativada: o aplicativo não consulta o mercado em tempo real. A prioridade é preservar liquidez, diversificar e registrar preços reais manualmente antes de tomar decisões.',
    tendency: 'neutral',
    topAssetTypes: [
      'Reserva com liquidez',
      'Renda fixa',
      'Carteira diversificada',
    ],
    tips: [
      'Mantenha uma reserva de emergência antes de aumentar o risco',
      'Evite concentrar a carteira em um único ativo ou instituição',
      'Atualize quantidade e preço atual para obter cálculos confiáveis',
    ],
  };
}

export async function getPredictiveAnalysis(
  transactions: TransactionLike[],
  currentBalance: number,
  fixedBills: FixedBillLike[],
): Promise<string> {
  const rows = validTransactions(transactions);
  if (rows.length === 0) {
    return 'Cadastre ou importe lançamentos para gerar uma projeção financeira local.';
  }

  const latestDate = rows.reduce(
    (latest, row) => (row.parsedDate > latest ? row.parsedDate : latest),
    rows[0].parsedDate,
  );
  const windowStart = new Date(latestDate);
  windowStart.setDate(windowStart.getDate() - 29);

  const recent = rows.filter(
    (row) => row.parsedDate >= windowStart && row.parsedDate <= latestDate,
  );
  const income = recent
    .filter((row) => transactionKind(row) === 'income')
    .reduce((sum, row) => sum + Math.abs(row.numericAmount), 0);
  const expense = recent
    .filter((row) => transactionKind(row) === 'expense')
    .reduce((sum, row) => sum + Math.abs(row.numericAmount), 0);
  const pendingFixed = fixedBills
    .filter((bill) => String(bill.status || 'pending').toLowerCase() !== 'paid')
    .reduce((sum, bill) => sum + Math.abs(Number(bill.amount || 0)), 0);

  const expenseByCategory = new Map<string, number>();
  recent
    .filter((row) => transactionKind(row) === 'expense')
    .forEach((row) => {
      const category = String(row.category || 'Geral');
      expenseByCategory.set(
        category,
        (expenseByCategory.get(category) || 0) + Math.abs(row.numericAmount),
      );
    });

  const dominant = [...expenseByCategory.entries()].sort(
    (a, b) => b[1] - a[1],
  )[0];
  const averageDailyExpense = expense / 30;
  const averageDailyIncome = income / 30;
  const projectedThirtyDays =
    Number(currentBalance || 0) +
    (averageDailyIncome - averageDailyExpense) * 30 -
    pendingFixed;
  const resultLabel = projectedThirtyDays >= 0 ? 'positivo' : 'negativo';

  const lines = [
    `**Projeção local de 30 dias:** saldo estimado de **${money(projectedThirtyDays)}** (${resultLabel}).`,
    `Entradas analisadas: **${money(income)}**; saídas: **${money(expense)}**; contas fixas pendentes: **${money(pendingFixed)}**.`,
  ];

  if (dominant && expense > 0) {
    const share = (dominant[1] / expense) * 100;
    lines.push(
      `Maior concentração de gastos: **${dominant[0]}**, com ${share.toFixed(0)}% das saídas do período.`,
    );
  }

  if (projectedThirtyDays < 0) {
    lines.push(
      `Para equilibrar a projeção, reduza em média **${money(Math.abs(projectedThirtyDays) / 30)} por dia** ou registre receitas ainda não incluídas.`,
    );
  } else if (expense > income && income > 0) {
    lines.push(
      'O saldo projetado ainda é positivo, mas as saídas do período superaram as entradas. Acompanhe os próximos lançamentos.',
    );
  } else {
    lines.push(
      'O fluxo analisado está sustentável. Preserve margem para despesas inesperadas.',
    );
  }

  return lines.join('\n\n');
}

export async function getInvestmentAdvice(
  balance: number,
  fixedOutflow: number,
  totalInvested: number,
  activeGoals: any[],
  budgets: any[],
): Promise<InvestmentAdvice> {
  const safeBalance = Math.max(0, Number(balance || 0));
  const commitments = Math.max(0, Number(fixedOutflow || 0));
  const budgetBase = (budgets || []).reduce(
    (sum: number, budget: any) =>
      sum + Math.max(0, Number(budget?.limit_amount || 0)),
    0,
  );
  const monthlyBase = Math.max(commitments, budgetBase);
  const reserveTarget = monthlyBase > 0 ? monthlyBase * 3 : 0;
  const reserveGap = Math.max(
    0,
    reserveTarget - Math.max(0, Number(totalInvested || 0)),
  );
  const liquidAfterCommitments = Math.max(0, safeBalance - commitments);

  let recommendedAmount = 0;
  let strategy = 'Preservar liquidez';
  let reasoning =
    'O saldo disponível deve permanecer líquido até que os compromissos estejam cobertos.';

  if (safeBalance <= commitments) {
    reasoning =
      'O saldo atual não supera as obrigações informadas; não há margem segura para um novo aporte.';
  } else if (reserveGap > 0) {
    recommendedAmount = Math.min(liquidAfterCommitments * 0.2, reserveGap);
    strategy = 'Formar reserva de emergência';
    reasoning = `Priorize uma reserva líquida. A meta local estimada é ${money(reserveTarget)} e ainda faltam aproximadamente ${money(reserveGap)}.`;
  } else {
    recommendedAmount = liquidAfterCommitments * 0.25;
    strategy = 'Aporte diversificado e gradual';
    reasoning =
      'As obrigações e a reserva estimada estão cobertas. Um aporte parcial preserva liquidez para imprevistos.';
  }

  const openGoals = (activeGoals || [])
    .map((goal: any) => ({
      name: String(goal?.name || 'Meta'),
      gap: Math.max(
        0,
        Number(goal?.target_amount || 0) - Number(goal?.current_amount || 0),
      ),
      deadline: goal?.deadline ? new Date(goal.deadline) : null,
    }))
    .filter((goal: any) => goal.gap > 0)
    .sort((a: any, b: any) => {
      const aTime =
        a.deadline && !Number.isNaN(a.deadline.getTime())
          ? a.deadline.getTime()
          : Number.MAX_SAFE_INTEGER;
      const bTime =
        b.deadline && !Number.isNaN(b.deadline.getTime())
          ? b.deadline.getTime()
          : Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    });

  if (openGoals[0] && recommendedAmount > 0) {
    recommendedAmount = Math.min(recommendedAmount, openGoals[0].gap);
    reasoning += ` A meta prioritária é “${openGoals[0].name}”, com ${money(openGoals[0].gap)} ainda necessários.`;
  }

  return {
    recommendedAmount: Number(Math.max(0, recommendedAmount).toFixed(2)),
    strategy,
    reasoning,
  };
}

export interface FundamentalistAnalysis {
  score: number;
  verdict: 'Comprar' | 'Manter' | 'Vender' | 'Aguardar';
  pros: string[];
  cons: string[];
  analysisNote: string;
}

export async function getFundamentalistAnalysis(
  name: string,
  metrics: {
    pl?: number;
    roe?: number;
    ebitda?: number;
    liquid_debt?: number;
    dy?: number;
  },
): Promise<FundamentalistAnalysis> {
  let score = 5;
  const pros: string[] = [];
  const cons: string[] = [];

  const pl = Number(metrics.pl);
  if (Number.isFinite(pl)) {
    if (pl > 0 && pl <= 15) {
      score += 1.5;
      pros.push('P/L em faixa moderada');
    } else if (pl <= 0) {
      score -= 1.5;
      cons.push('P/L não positivo, exigindo análise dos resultados');
    } else if (pl > 30) {
      score -= 0.75;
      cons.push('P/L elevado em relação ao lucro informado');
    }
  }

  const roe = Number(metrics.roe);
  if (Number.isFinite(roe)) {
    if (roe >= 15) {
      score += 1.5;
      pros.push('ROE forte nos dados informados');
    } else if (roe >= 8) {
      score += 0.5;
      pros.push('ROE positivo');
    } else if (roe < 0) {
      score -= 1.5;
      cons.push('ROE negativo');
    }
  }

  const ebitda = Number(metrics.ebitda);
  if (Number.isFinite(ebitda)) {
    if (ebitda > 0) {
      score += 0.5;
      pros.push('EBITDA positivo');
    } else {
      score -= 0.5;
      cons.push('EBITDA não positivo');
    }
  }

  const dy = Number(metrics.dy);
  if (Number.isFinite(dy)) {
    if (dy >= 2 && dy <= 12) {
      score += 0.75;
      pros.push('Dividend yield em faixa observável');
    } else if (dy > 15) {
      score -= 0.5;
      cons.push('Dividend yield muito alto pode não ser recorrente');
    }
  }

  const debt = Number(metrics.liquid_debt);
  if (Number.isFinite(debt) && debt < 0) {
    score += 0.5;
    pros.push('Caixa líquido nos dados informados');
  }

  score = Number(clamp(score, 0, 10).toFixed(1));
  const verdict: FundamentalistAnalysis['verdict'] =
    score >= 7.5 ? 'Manter' : score >= 5 ? 'Aguardar' : 'Aguardar';

  if (pros.length === 0)
    pros.push('Preencha os indicadores para uma avaliação mais completa');
  if (cons.length === 0)
    cons.push(
      'A avaliação não inclui preço de mercado, setor, governança ou demonstrações completas',
    );

  return {
    score,
    verdict,
    pros,
    cons,
    analysisNote: `Avaliação local e educacional de ${name || 'ativo'}, calculada somente com os indicadores informados. Não é recomendação de compra ou venda.`,
  };
}
