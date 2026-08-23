import type {
  CardInstallment,
  CreditCard,
  FixedBill,
  Subscription,
  Transaction,
  UserSettings,
} from '../types';

export type IntelligenceSeverity = 'critical' | 'warning' | 'info' | 'positive';
export type ProjectionScenario = 'conservative' | 'base' | 'optimistic';

export interface FinancialGoalLike {
  id: string;
  name: string;
  target_amount: number;
  current_amount: number;
  deadline?: string | null;
  status?: string | null;
}

export interface ForecastPoint {
  day: number;
  date: string;
  balance: number;
}

export interface ProjectionSnapshot {
  horizonDays: 30 | 60 | 90;
  conservative: number;
  base: number;
  optimistic: number;
}

export interface IntelligenceAlert {
  id: string;
  severity: IntelligenceSeverity;
  title: string;
  message: string;
  metric?: string;
  value?: number;
  threshold?: number;
  action?: string;
}

export interface FinancialIntelligenceResult {
  generatedAt: string;
  confidence: number;
  confidenceLabel: 'baixa' | 'moderada' | 'alta';
  historyDays: number;
  observedTransactions: number;
  monthlyIncome: number;
  recurringMonthlyOutflow: number;
  variableMonthlyOutflow: number;
  monthlyFreeCash: number;
  safeDailySpend: number;
  cashRunwayDays: number | null;
  emergencyReserveTarget: number;
  emergencyReserveCoverage: number;
  subscriptionMonthlyCost: number;
  subscriptionIncomeShare: number | null;
  commitmentIncomeShare: number | null;
  expenseTrendPercent: number | null;
  goalMonthlyNeed: number;
  earliestRiskDate: string | null;
  projections: ProjectionSnapshot[];
  baseCurve: ForecastPoint[];
  alerts: IntelligenceAlert[];
  narrative: string[];
}

interface BuildFinancialIntelligenceInput {
  currentBalance: number;
  transactions: Transaction[];
  settings: UserSettings | null;
  fixedBills?: FixedBill[];
  cards?: CreditCard[];
  installments?: CardInstallment[];
  subscriptions?: Subscription[];
  goals?: FinancialGoalLike[];
  now?: Date;
}

type ForecastEvent = {
  date: Date;
  amount: number;
  kind:
    | 'income'
    | 'fixed'
    | 'subscription'
    | 'card'
    | 'installment'
    | 'pending';
  label: string;
};

function n(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function startOfDay(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function addDays(value: Date, days: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return startOfDay(next);
}

function addMonths(value: Date, months: number): Date {
  const next = new Date(value.getFullYear(), value.getMonth() + months, 1);
  return startOfDay(next);
}

function dayKey(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDate(value: unknown): Date | null {
  const text = String(value || '').trim();
  if (!text) return null;
  const dateOnly = text.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  const parsed = dateOnly ? new Date(`${dateOnly}T12:00:00`) : new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : startOfDay(parsed);
}

function safeRecurringDate(month: Date, rawDay: unknown): Date {
  const desired = Math.max(1, Math.min(31, Math.round(n(rawDay) || 1)));
  const lastDay = new Date(
    month.getFullYear(),
    month.getMonth() + 1,
    0,
  ).getDate();
  return new Date(
    month.getFullYear(),
    month.getMonth(),
    Math.min(desired, lastDay),
  );
}

function isSettled(transaction: Transaction): boolean {
  const status = String(transaction.status || 'paid').toLowerCase();
  return !['pending', 'duplicate', 'error', 'voided', 'reversed'].includes(
    status,
  );
}

function isPending(transaction: Transaction): boolean {
  return String(transaction.status || '').toLowerCase() === 'pending';
}

function isVariableExpense(transaction: Transaction): boolean {
  if (transaction.type !== 'expense' || !isSettled(transaction)) return false;
  const category = String(transaction.category || '').toLowerCase();
  const source = String(transaction.source || '').toLowerCase();
  const text = `${category} ${source} ${String(transaction.description || '').toLowerCase()}`;
  return ![
    'contas fixas',
    'assinatura',
    'subscription',
    'fatura',
    'parcelamento',
    'parcela',
    'fixed_bill',
  ].some((needle) => text.includes(needle));
}

function monthlySubscriptionCost(subscriptions: Subscription[]): number {
  return subscriptions
    .filter(
      (item) => String(item.status || 'active').toLowerCase() !== 'cancelled',
    )
    .reduce((sum, item) => {
      const amount = Math.abs(n(item.amount));
      return sum + (item.billing_cycle === 'yearly' ? amount / 12 : amount);
    }, 0);
}

function paymentAmounts(
  settings: UserSettings,
): Array<{ day: number; amount: number }> {
  const monthlyNet = Math.max(0, n(settings.net_salary_estimated));
  if (settings.payday_cycle !== 'biweekly') {
    return [
      {
        day: Math.max(1, Math.min(31, n(settings.payday_1) || 5)),
        amount: monthlyNet,
      },
    ];
  }

  const firstShare = clamp(n(settings.payday_1_percentage ?? 50), 0, 100) / 100;
  const first = Math.round(monthlyNet * firstShare * 100) / 100;
  return [
    {
      day: Math.max(1, Math.min(31, n(settings.payday_1) || 5)),
      amount: first,
    },
    {
      day: Math.max(1, Math.min(31, n(settings.payday_2) || 20)),
      amount: Math.max(0, monthlyNet - first),
    },
  ];
}

function buildRecurringEvents(
  settings: UserSettings | null,
  fixedBills: FixedBill[],
  cards: CreditCard[],
  installments: CardInstallment[],
  subscriptions: Subscription[],
  transactions: Transaction[],
  now: Date,
  horizonDays = 90,
): ForecastEvent[] {
  const end = addDays(now, horizonDays);
  const events: ForecastEvent[] = [];

  for (let monthOffset = 0; monthOffset <= 4; monthOffset += 1) {
    const month = addMonths(
      new Date(now.getFullYear(), now.getMonth(), 1),
      monthOffset,
    );

    if (settings) {
      paymentAmounts(settings).forEach((payment) => {
        const date = safeRecurringDate(month, payment.day);
        if (date >= now && date <= end && payment.amount > 0) {
          events.push({
            date,
            amount: payment.amount,
            kind: 'income',
            label: 'Recebimento previsto',
          });
        }
      });
    }

    fixedBills.forEach((bill) => {
      const active = (bill as FixedBill & { active?: boolean }).active;
      if (active === false) return;
      const date = safeRecurringDate(month, bill.due_day);
      const amount = Math.abs(
        n(
          (bill as FixedBill & { default_amount?: number }).default_amount ??
            bill.amount,
        ),
      );
      if (date >= now && date <= end && amount > 0) {
        events.push({
          date,
          amount: -amount,
          kind: 'fixed',
          label: bill.name || 'Conta fixa',
        });
      }
    });

    subscriptions
      .filter(
        (subscription) =>
          String(subscription.status || 'active').toLowerCase() !== 'cancelled',
      )
      .forEach((subscription) => {
        if (subscription.billing_cycle !== 'monthly') return;
        const date = safeRecurringDate(month, subscription.due_day);
        const amount = Math.abs(n(subscription.amount));
        if (date >= now && date <= end && amount > 0) {
          events.push({
            date,
            amount: -amount,
            kind: 'subscription',
            label: subscription.name || 'Assinatura',
          });
        }
      });
  }

  cards.forEach((card) => {
    const amount = Math.abs(n(card.used));
    if (amount <= 0) return;
    let date = safeRecurringDate(
      new Date(now.getFullYear(), now.getMonth(), 1),
      card.due_day,
    );
    if (date < now) date = safeRecurringDate(addMonths(date, 1), card.due_day);
    if (date <= end)
      events.push({
        date,
        amount: -amount,
        kind: 'card',
        label: card.name || 'Fatura de cartão',
      });
  });

  installments.forEach((installment) => {
    const current = Math.max(
      1,
      Math.round(n(installment.current_installment) || 1),
    );
    const total = Math.max(
      current,
      Math.round(n(installment.total_installments) || current),
    );
    const monthly = Math.abs(n(installment.monthly_amount));
    if (monthly <= 0 || current > total) return;

    let month = new Date(now.getFullYear(), now.getMonth(), 1);
    for (
      let installmentNumber = current;
      installmentNumber <= total;
      installmentNumber += 1
    ) {
      let date = safeRecurringDate(month, installment.due_day);
      if (date < now) {
        month = addMonths(month, 1);
        date = safeRecurringDate(month, installment.due_day);
      }
      if (date > end) break;
      const paidMonth = String(installment.last_paid_month || '');
      if (paidMonth !== dayKey(date).slice(0, 7)) {
        events.push({
          date,
          amount: -monthly,
          kind: 'installment',
          label: `${installment.description || 'Parcela'} ${installmentNumber}/${total}`,
        });
      }
      month = addMonths(month, 1);
    }
  });

  transactions.filter(isPending).forEach((transaction) => {
    const rawDueDate =
      (transaction as Transaction & { due_date?: string }).due_date ||
      transaction.date;
    const date = parseDate(rawDueDate);
    if (!date || date < now || date > end) return;
    const amount = Math.abs(n(transaction.amount));
    if (amount <= 0) return;
    events.push({
      date,
      amount: transaction.type === 'income' ? amount : -amount,
      kind: 'pending',
      label: transaction.description || 'Lançamento pendente',
    });
  });

  return events.sort((a, b) => a.date.getTime() - b.date.getTime());
}

function historicalMetrics(transactions: Transaction[], now: Date) {
  const usable = transactions
    .map((transaction) => ({ transaction, date: parseDate(transaction.date) }))
    .filter((row): row is { transaction: Transaction; date: Date } =>
      Boolean(row.date && row.date <= now),
    )
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const firstDate = usable[0]?.date || now;
  const historyDays = Math.max(
    0,
    Math.min(
      90,
      Math.round((now.getTime() - firstDate.getTime()) / 86_400_000) + 1,
    ),
  );
  const recent60Start = addDays(now, -59);
  const previous30Start = addDays(now, -59);
  const previous30End = addDays(now, -30);
  const recent30Start = addDays(now, -29);

  const variable60 = usable.filter(
    ({ transaction, date }) =>
      date >= recent60Start && isVariableExpense(transaction),
  );
  const variableTotal60 = variable60.reduce(
    (sum, row) => sum + Math.abs(n(row.transaction.amount)),
    0,
  );
  const denominator = Math.max(14, Math.min(60, historyDays || 14));
  const dailyVariable = variableTotal60 / denominator;

  const recent30Expense = usable
    .filter(
      ({ transaction, date }) =>
        date >= recent30Start &&
        transaction.type === 'expense' &&
        isSettled(transaction),
    )
    .reduce((sum, row) => sum + Math.abs(n(row.transaction.amount)), 0);
  const previous30Expense = usable
    .filter(
      ({ transaction, date }) =>
        date >= previous30Start &&
        date <= previous30End &&
        transaction.type === 'expense' &&
        isSettled(transaction),
    )
    .reduce((sum, row) => sum + Math.abs(n(row.transaction.amount)), 0);

  const expenseTrendPercent =
    previous30Expense > 0
      ? ((recent30Expense - previous30Expense) / previous30Expense) * 100
      : null;

  return {
    historyDays,
    observedTransactions: usable.length,
    dailyVariable,
    variableMonthly: dailyVariable * 30.4375,
    recent30Expense,
    previous30Expense,
    expenseTrendPercent,
  };
}

function buildCurve(
  currentBalance: number,
  events: ForecastEvent[],
  dailyVariable: number,
  now: Date,
  scenario: ProjectionScenario,
): ForecastPoint[] {
  const multiplier =
    scenario === 'conservative' ? 1.2 : scenario === 'optimistic' ? 0.85 : 1;
  const incomeMultiplier = scenario === 'conservative' ? 0.95 : 1;
  let balance = currentBalance;
  const byDay = new Map<string, ForecastEvent[]>();
  events.forEach((event) => {
    const key = dayKey(event.date);
    byDay.set(key, [...(byDay.get(key) || []), event]);
  });

  const points: ForecastPoint[] = [{ day: 0, date: dayKey(now), balance }];
  for (let day = 1; day <= 90; day += 1) {
    const date = addDays(now, day);
    balance -= dailyVariable * multiplier;
    (byDay.get(dayKey(date)) || []).forEach((event) => {
      balance +=
        event.amount > 0 ? event.amount * incomeMultiplier : event.amount;
    });
    points.push({
      day,
      date: dayKey(date),
      balance: Math.round(balance * 100) / 100,
    });
  }
  return points;
}

function pointAt(curve: ForecastPoint[], day: 30 | 60 | 90): number {
  return (
    curve.find((point) => point.day === day)?.balance ??
    curve[curve.length - 1]?.balance ??
    0
  );
}

function goalMonthlyNeed(goals: FinancialGoalLike[], now: Date): number {
  return goals
    .filter(
      (goal) => String(goal.status || 'active').toLowerCase() === 'active',
    )
    .reduce((sum, goal) => {
      const gap = Math.max(0, n(goal.target_amount) - n(goal.current_amount));
      if (gap <= 0) return sum;
      const deadline = parseDate(goal.deadline);
      if (!deadline || deadline <= now) return sum + gap;
      const months = Math.max(
        1,
        Math.ceil(
          (deadline.getTime() - now.getTime()) / (30.4375 * 86_400_000),
        ),
      );
      return sum + gap / months;
    }, 0);
}

function confidenceScore(
  historyDays: number,
  observedTransactions: number,
  settings: UserSettings | null,
): number {
  const historyScore = clamp(historyDays / 60, 0, 1) * 0.45;
  const volumeScore = clamp(observedTransactions / 80, 0, 1) * 0.35;
  const incomeScore =
    settings && n(settings.net_salary_estimated) > 0 ? 0.2 : 0.08;
  return clamp(historyScore + volumeScore + incomeScore, 0.18, 0.98);
}

function labelForConfidence(
  value: number,
): FinancialIntelligenceResult['confidenceLabel'] {
  if (value >= 0.78) return 'alta';
  if (value >= 0.52) return 'moderada';
  return 'baixa';
}

function money(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function buildFinancialIntelligence(
  input: BuildFinancialIntelligenceInput,
): FinancialIntelligenceResult {
  const now = startOfDay(input.now || new Date());
  const currentBalance = n(input.currentBalance);
  const transactions = input.transactions || [];
  const fixedBills = input.fixedBills || [];
  const cards = input.cards || [];
  const installments = input.installments || [];
  const subscriptions = input.subscriptions || [];
  const goals = input.goals || [];
  const settings = input.settings;

  const history = historicalMetrics(transactions, now);
  const monthlyIncome = Math.max(0, n(settings?.net_salary_estimated));
  const subscriptionsMonthly = monthlySubscriptionCost(subscriptions);
  const fixedMonthly = fixedBills
    .filter(
      (bill) => (bill as FixedBill & { active?: boolean }).active !== false,
    )
    .reduce(
      (sum, bill) =>
        sum +
        Math.abs(
          n(
            (bill as FixedBill & { default_amount?: number }).default_amount ??
              bill.amount,
          ),
        ),
      0,
    );
  const installmentMonthly = installments
    .filter((item) => n(item.current_installment) <= n(item.total_installments))
    .reduce((sum, item) => sum + Math.abs(n(item.monthly_amount)), 0);
  const recurringMonthlyOutflow =
    fixedMonthly + subscriptionsMonthly + installmentMonthly;
  const variableMonthlyOutflow = history.variableMonthly;
  const monthlyFreeCash =
    monthlyIncome - recurringMonthlyOutflow - variableMonthlyOutflow;
  const goalNeed = goalMonthlyNeed(goals, now);
  const emergencyReserveTarget =
    (recurringMonthlyOutflow + variableMonthlyOutflow) * 3;
  const emergencyReserveCoverage =
    emergencyReserveTarget > 0 ? currentBalance / emergencyReserveTarget : 1;
  const subscriptionIncomeShare =
    monthlyIncome > 0 ? subscriptionsMonthly / monthlyIncome : null;
  const commitmentIncomeShare =
    monthlyIncome > 0 ? recurringMonthlyOutflow / monthlyIncome : null;
  const safeDailySpend =
    Math.max(0, monthlyIncome - recurringMonthlyOutflow - goalNeed) / 30.4375;
  const cashRunwayDays =
    history.dailyVariable > 0 && currentBalance > 0
      ? Math.floor(currentBalance / history.dailyVariable)
      : currentBalance <= 0
        ? 0
        : null;

  const events = buildRecurringEvents(
    settings,
    fixedBills,
    cards,
    installments,
    subscriptions,
    transactions,
    now,
  );
  const conservativeCurve = buildCurve(
    currentBalance,
    events,
    history.dailyVariable,
    now,
    'conservative',
  );
  const baseCurve = buildCurve(
    currentBalance,
    events,
    history.dailyVariable,
    now,
    'base',
  );
  const optimisticCurve = buildCurve(
    currentBalance,
    events,
    history.dailyVariable,
    now,
    'optimistic',
  );
  const projections: ProjectionSnapshot[] = ([30, 60, 90] as const).map(
    (horizonDays) => ({
      horizonDays,
      conservative: pointAt(conservativeCurve, horizonDays),
      base: pointAt(baseCurve, horizonDays),
      optimistic: pointAt(optimisticCurve, horizonDays),
    }),
  );

  const firstNegative = baseCurve.find(
    (point) => point.day > 0 && point.balance < 0,
  );
  const confidence = confidenceScore(
    history.historyDays,
    history.observedTransactions,
    settings,
  );
  const alerts: IntelligenceAlert[] = [];

  if (currentBalance < 0) {
    alerts.push({
      id: 'negative-balance',
      severity: 'critical',
      title: 'Saldo atual negativo',
      message:
        'O saldo consolidado já está abaixo de zero. Priorize obrigações essenciais e receitas previstas.',
      metric: 'Saldo',
      value: currentBalance,
      threshold: 0,
      action: 'Revisar compromissos imediatos',
    });
  }
  if (firstNegative) {
    alerts.push({
      id: 'forecast-negative',
      severity: firstNegative.day <= 30 ? 'critical' : 'warning',
      title: 'Risco de saldo negativo',
      message: `No cenário base, o saldo pode ficar negativo por volta de ${new Date(`${firstNegative.date}T12:00:00`).toLocaleDateString('pt-BR')}.`,
      metric: 'Dias até risco',
      value: firstNegative.day,
      action: 'Reduzir gastos variáveis ou registrar receitas futuras',
    });
  }
  if (commitmentIncomeShare != null && commitmentIncomeShare >= 0.7) {
    alerts.push({
      id: 'high-commitment',
      severity: commitmentIncomeShare >= 0.9 ? 'critical' : 'warning',
      title: 'Renda muito comprometida',
      message: `${(commitmentIncomeShare * 100).toFixed(0)}% da renda mensal estimada está comprometida com despesas recorrentes cadastradas.`,
      metric: 'Comprometimento',
      value: commitmentIncomeShare * 100,
      threshold: 70,
      action: 'Revisar contas fixas e parcelas',
    });
  }
  if (
    history.expenseTrendPercent != null &&
    history.expenseTrendPercent >= 15
  ) {
    alerts.push({
      id: 'expense-acceleration',
      severity: history.expenseTrendPercent >= 35 ? 'critical' : 'warning',
      title: 'Aceleração dos gastos',
      message: `As saídas dos últimos 30 dias cresceram ${history.expenseTrendPercent.toFixed(0)}% contra os 30 dias anteriores.`,
      metric: 'Variação de gastos',
      value: history.expenseTrendPercent,
      threshold: 15,
      action: 'Ver categorias que mais cresceram',
    });
  }
  if (subscriptionIncomeShare != null && subscriptionIncomeShare >= 0.1) {
    alerts.push({
      id: 'subscription-pressure',
      severity: subscriptionIncomeShare >= 0.15 ? 'warning' : 'info',
      title: 'Assinaturas pesando na renda',
      message: `As assinaturas equivalem a ${(subscriptionIncomeShare * 100).toFixed(1)}% da renda líquida estimada.`,
      metric: 'Assinaturas/renda',
      value: subscriptionIncomeShare * 100,
      threshold: 10,
      action: 'Revisar assinaturas pouco usadas',
    });
  }
  const highlyUsedCard = cards
    .map((card) => ({
      card,
      ratio: n(card.limit) > 0 ? n(card.used) / n(card.limit) : 0,
    }))
    .sort((a, b) => b.ratio - a.ratio)[0];
  if (highlyUsedCard && highlyUsedCard.ratio >= 0.8) {
    alerts.push({
      id: `card-${highlyUsedCard.card.id}`,
      severity: highlyUsedCard.ratio >= 1 ? 'critical' : 'warning',
      title: 'Limite do cartão pressionado',
      message: `${highlyUsedCard.card.name} está com ${(highlyUsedCard.ratio * 100).toFixed(0)}% do limite utilizado.`,
      metric: 'Uso do limite',
      value: highlyUsedCard.ratio * 100,
      threshold: 80,
      action: 'Evitar novas compras no cartão até reduzir a fatura',
    });
  }
  if (goalNeed > 0 && monthlyFreeCash < goalNeed) {
    alerts.push({
      id: 'goal-pressure',
      severity: monthlyFreeCash < 0 ? 'warning' : 'info',
      title: 'Metas acima da folga mensal',
      message: `As metas ativas pedem cerca de ${money(goalNeed)}/mês, enquanto a folga projetada é ${money(Math.max(0, monthlyFreeCash))}/mês.`,
      metric: 'Necessidade das metas',
      value: goalNeed,
      action: 'Recalibrar prazo ou valor das metas',
    });
  }
  if (confidence < 0.52) {
    alerts.push({
      id: 'low-confidence',
      severity: 'info',
      title: 'Projeção ainda com pouca base histórica',
      message: `A inteligência está usando ${history.historyDays} dia(s) e ${history.observedTransactions} lançamento(s) observados. A precisão aumenta com mais histórico.`,
      metric: 'Confiança',
      value: confidence * 100,
      action: 'Importar extratos anteriores ou conectar Open Finance',
    });
  }
  if (
    !alerts.some(
      (alert) => alert.severity === 'critical' || alert.severity === 'warning',
    )
  ) {
    alerts.push({
      id: 'stable-flow',
      severity: 'positive',
      title: 'Fluxo projetado estável',
      message:
        'Os cenários analisados não indicam pressão financeira relevante no curto prazo com os dados atuais.',
      action: 'Manter acompanhamento e reserva de segurança',
    });
  }

  const narrative: string[] = [];
  narrative.push(
    `A projeção base estima ${money(projections[0].base)} em 30 dias, ${money(projections[1].base)} em 60 dias e ${money(projections[2].base)} em 90 dias.`,
  );
  if (monthlyIncome > 0) {
    narrative.push(
      `Renda líquida estimada: ${money(monthlyIncome)}; compromissos recorrentes: ${money(recurringMonthlyOutflow)}; gasto variável projetado: ${money(variableMonthlyOutflow)} por mês.`,
    );
  } else {
    narrative.push(
      'A renda líquida ainda não está configurada, então os cenários futuros dependem mais do histórico de movimentações e dos compromissos cadastrados.',
    );
  }
  if (monthlyFreeCash >= 0)
    narrative.push(
      `Folga mensal estimada antes das metas: ${money(monthlyFreeCash)}.`,
    );
  else
    narrative.push(
      `O fluxo mensal estimado apresenta déficit de ${money(Math.abs(monthlyFreeCash))}.`,
    );
  if (history.expenseTrendPercent != null)
    narrative.push(
      `Tendência de gastos em 30 dias: ${history.expenseTrendPercent >= 0 ? '+' : ''}${history.expenseTrendPercent.toFixed(0)}% versus o período anterior.`,
    );

  return {
    generatedAt: new Date().toISOString(),
    confidence,
    confidenceLabel: labelForConfidence(confidence),
    historyDays: history.historyDays,
    observedTransactions: history.observedTransactions,
    monthlyIncome,
    recurringMonthlyOutflow,
    variableMonthlyOutflow,
    monthlyFreeCash,
    safeDailySpend,
    cashRunwayDays,
    emergencyReserveTarget,
    emergencyReserveCoverage,
    subscriptionMonthlyCost: subscriptionsMonthly,
    subscriptionIncomeShare,
    commitmentIncomeShare,
    expenseTrendPercent: history.expenseTrendPercent,
    goalMonthlyNeed: goalNeed,
    earliestRiskDate: firstNegative?.date || null,
    projections,
    baseCurve,
    alerts: alerts.sort((a, b) => {
      const rank: Record<IntelligenceSeverity, number> = {
        critical: 0,
        warning: 1,
        info: 2,
        positive: 3,
      };
      return rank[a.severity] - rank[b.severity];
    }),
    narrative,
  };
}
