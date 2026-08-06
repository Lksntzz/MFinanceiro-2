import {
  CardInstallment,
  CreditCard,
  FinanceSummary,
  FixedBill,
  PriorityItem,
  Transaction,
  UserSettings,
} from '../types';
import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  eachDayOfInterval,
  eachWeekOfInterval,
  endOfWeek,
  format,
  getDaysInMonth,
  isAfter,
  isBefore,
  isWithinInterval,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { identifyCompany, normalizeText } from './company-aliases';
import { PAYMENT_ALIASES } from '../data/payment-aliases';
import { calculatePayrollFromGross } from './payroll-tax';

type CycleWindow = {
  start: Date;
  end: Date;
};

type ProcessedFixedBill = FixedBill & {
  reconciledStatus: 'paid_identified' | 'pending' | 'overdue' | 'off-cycle';
  dueDate?: string;
};

type DatedCard = CreditCard & { cycleDueDate: Date };
type DatedInstallment = CardInstallment & { cycleDueDate: Date };

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampDay(value: unknown): number {
  const day = Math.round(asNumber(value));
  return Math.max(1, Math.min(31, day || 1));
}

function dateAtRecurringDay(monthReference: Date, rawDay: unknown): Date {
  const monthStart = startOfMonth(monthReference);
  const safeDay = Math.min(clampDay(rawDay), getDaysInMonth(monthStart));
  return startOfDay(new Date(monthStart.getFullYear(), monthStart.getMonth(), safeDay));
}

function uniqueSortedDates(dates: Date[]): Date[] {
  const byTimestamp = new Map<number, Date>();
  dates.forEach((date) => byTimestamp.set(date.getTime(), date));
  return [...byTimestamp.values()].sort((a, b) => a.getTime() - b.getTime());
}

function getPaymentDatesAround(settings: UserSettings, reference: Date): Date[] {
  const paymentDays = settings.payday_cycle === 'biweekly'
    ? [clampDay(settings.payday_1 || 5), clampDay(settings.payday_2 || 20)]
    : [clampDay(settings.payday_1 || 5)];

  const dates: Date[] = [];
  for (let offset = -2; offset <= 2; offset += 1) {
    const month = addMonths(startOfMonth(reference), offset);
    paymentDays.forEach((day) => dates.push(dateAtRecurringDay(month, day)));
  }
  return uniqueSortedDates(dates);
}

function getCycleWindow(settings: UserSettings, reference: Date): CycleWindow {
  const today = startOfDay(reference);
  const candidates = getPaymentDatesAround(settings, today);
  const start = [...candidates].reverse().find((date) => !isAfter(date, today));
  const end = candidates.find((date) => isAfter(date, today));

  if (start && end) return { start, end };

  const fallbackStart = start || dateAtRecurringDay(today, settings.payday_1 || 5);
  const fallbackEnd = end || addMonths(fallbackStart, 1);
  return { start: fallbackStart, end: fallbackEnd };
}

function isInsideCycle(date: Date, cycle: CycleWindow): boolean {
  const value = startOfDay(date).getTime();
  return value >= cycle.start.getTime() && value < cycle.end.getTime();
}

function getRecurringDateInCycle(rawDay: unknown, cycle: CycleWindow): Date | null {
  const base = startOfMonth(cycle.start);
  for (let offset = -1; offset <= 2; offset += 1) {
    const candidate = dateAtRecurringDay(addMonths(base, offset), rawDay);
    if (isInsideCycle(candidate, cycle)) return candidate;
  }
  return null;
}

function parseTransactionDate(raw: string): Date | null {
  try {
    const parsed = parseISO(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  } catch {
    return null;
  }
}

function isSettledTransaction(transaction: Transaction): boolean {
  const status = String(transaction.status || 'paid').toLowerCase();
  return !['pending', 'duplicate', 'error'].includes(status);
}

function isSamePaymentMonth(lastPaidMonth: string | undefined, dueDate: Date): boolean {
  return Boolean(lastPaidMonth && lastPaidMonth === format(dueDate, 'yyyy-MM'));
}

function formatMoney(value: number): string {
  return asNumber(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function paymentAmountForDate(settings: UserSettings, payday: Date): { amount: number; percentage: number } {
  const net = Math.max(0, asNumber(settings.net_salary_estimated));
  if (settings.payday_cycle !== 'biweekly') return { amount: net, percentage: 100 };

  const firstPercentage = Math.max(0, Math.min(100, asNumber(settings.payday_1_percentage ?? 50)));
  const secondPercentage = Math.max(0, Math.min(100, asNumber(settings.payday_2_percentage ?? 50)));
  const firstAmount = Math.round((net * firstPercentage / 100) * 100) / 100;
  const secondAmount = Math.round((net - firstAmount) * 100) / 100;
  const isFirstPayment = payday.getDate() === clampDay(settings.payday_1 || 5);

  return isFirstPayment
    ? { amount: firstAmount, percentage: firstPercentage }
    : { amount: secondAmount, percentage: secondPercentage };
}

export function calculateFinanceSummary(
  transactions: Transaction[],
  settings: UserSettings,
  fixedBills: FixedBill[] = [],
  cards: CreditCard[] = [],
  installments: CardInstallment[] = [],
  currentDate: Date = new Date(),
): FinanceSummary {
  const today = startOfDay(currentDate);
  const cycle = getCycleWindow(settings, today);
  const lastPayday = cycle.start;
  const nextPayday = cycle.end;
  const daysRemaining = Math.max(0, differenceInCalendarDays(nextPayday, today));
  const divisorDays = Math.max(1, daysRemaining);
  const currentBalance = asNumber(settings.current_balance);

  const cycleTransactions = transactions.filter((transaction) => {
    const date = parseTransactionDate(transaction.date);
    return Boolean(date && isInsideCycle(date, cycle) && isSettledTransaction(transaction));
  });
  const cycleExpenses = cycleTransactions.filter((transaction) => transaction.type === 'expense');
  const cycleIncomes = cycleTransactions.filter((transaction) => transaction.type === 'income');

  const matchedTransactionIds = new Set<string>();
  const processedFixedBills: ProcessedFixedBill[] = fixedBills.map((bill) => {
    const dueDate = getRecurringDateInCycle(bill.due_day, cycle);
    if (!dueDate) return { ...bill, reconciledStatus: 'off-cycle' };

    const billValue = Math.abs(asNumber(bill.amount));
    const normalizedBillName = normalizeText(bill.name || '');
    const billKeywords = (bill.keywords || []).map(normalizeText);
    let knownCategoryKey = '';

    for (const [categoryKey, companies] of Object.entries(PAYMENT_ALIASES)) {
      if (normalizedBillName.includes(categoryKey.replace('_', ' '))) {
        knownCategoryKey = categoryKey;
        break;
      }
      if (companies.some((company) =>
        normalizedBillName.includes(normalizeText(company.displayName)) ||
        normalizedBillName.includes(normalizeText(company.officialName)))) {
        knownCategoryKey = categoryKey;
        break;
      }
    }

    const searchStart = startOfDay(subDays(dueDate, 5));
    const searchEnd = startOfDay(addDays(dueDate, 8));
    const match = cycleExpenses.find((transaction) => {
      if (matchedTransactionIds.has(transaction.id)) return false;
      const transactionDate = parseTransactionDate(transaction.date);
      if (!transactionDate || transactionDate < searchStart || transactionDate >= searchEnd) return false;

      const transactionAmount = Math.abs(asNumber(transaction.amount));
      const normalizedDescription = normalizeText(transaction.description || '');
      const valueMatch = Math.abs(transactionAmount - billValue) < Math.max(2, billValue * 0.005);
      let textMatch = normalizedDescription.includes(normalizedBillName) ||
        normalizedBillName.includes(normalizedDescription) ||
        billKeywords.some((keyword) => normalizedDescription.includes(keyword));

      if (!textMatch) {
        const identified = identifyCompany(transaction.description || '');
        if (identified && identified.confidence >= 0.7) {
          textMatch = normalizedBillName.includes(normalizeText(identified.company)) || knownCategoryKey === identified.category;
        }
      }

      return (valueMatch && textMatch) ||
        (textMatch && Math.abs(transactionAmount - billValue) < Math.max(2, billValue * 0.15));
    });

    if (match) {
      matchedTransactionIds.add(match.id);
      return { ...bill, dueDate: format(dueDate, 'yyyy-MM-dd'), reconciledStatus: 'paid_identified' };
    }

    if (bill.status === 'paid' && isSamePaymentMonth(bill.last_paid_month, dueDate)) {
      return { ...bill, dueDate: format(dueDate, 'yyyy-MM-dd'), reconciledStatus: 'paid_identified' };
    }

    return {
      ...bill,
      dueDate: format(dueDate, 'yyyy-MM-dd'),
      reconciledStatus: isBefore(dueDate, today) ? 'overdue' : 'pending',
    };
  });

  const pendingFixedBills = processedFixedBills
    .filter((bill) => bill.reconciledStatus === 'pending' || bill.reconciledStatus === 'overdue')
    .sort((a, b) => {
      if (a.reconciledStatus !== b.reconciledStatus) return a.reconciledStatus === 'overdue' ? -1 : 1;
      return String(a.dueDate).localeCompare(String(b.dueDate));
    });
  const pendingBillsTotal = pendingFixedBills.reduce((sum, bill) => sum + Math.abs(asNumber(bill.amount)), 0);

  const cycleCards: DatedCard[] = cards
    .map((card) => {
      const dueDate = getRecurringDateInCycle(card.due_day, cycle);
      return dueDate ? { ...card, cycleDueDate: dueDate } : null;
    })
    .filter((card): card is DatedCard => Boolean(card && asNumber(card.used) > 0))
    .sort((a, b) => a.cycleDueDate.getTime() - b.cycleDueDate.getTime());
  const cardsTotal = cycleCards.reduce((sum, card) => sum + Math.abs(asNumber(card.used)), 0);

  const cycleInstallments: DatedInstallment[] = installments
    .map((installment) => {
      const dueDate = getRecurringDateInCycle(installment.due_day, cycle);
      if (!dueDate) return null;
      const finished = asNumber(installment.current_installment) > asNumber(installment.total_installments);
      const alreadyPaidThisMonth = isSamePaymentMonth(installment.last_paid_month, dueDate);
      return !finished && !alreadyPaidThisMonth ? { ...installment, cycleDueDate: dueDate } : null;
    })
    .filter((installment): installment is DatedInstallment => Boolean(installment))
    .sort((a, b) => a.cycleDueDate.getTime() - b.cycleDueDate.getTime());
  const installmentsTotal = cycleInstallments.reduce((sum, installment) => sum + Math.abs(asNumber(installment.monthly_amount)), 0);

  const totalCommitments = pendingBillsTotal + cardsTotal + installmentsTotal;
  const availableForDaily = currentBalance - totalCommitments;
  const projectedBalance = currentBalance - totalCommitments;
  const cyclePeriodLabel = `${format(lastPayday, 'dd/MM')} a ${format(nextPayday, 'dd/MM')}`;

  const todaySpent = cycleExpenses
    .filter((transaction) => {
      const date = parseTransactionDate(transaction.date);
      return Boolean(date && startOfDay(date).getTime() === today.getTime());
    })
    .reduce((sum, transaction) => sum + Math.abs(asNumber(transaction.amount)), 0);
  const totalSpentInCycle = cycleExpenses.reduce((sum, transaction) => sum + Math.abs(asNumber(transaction.amount)), 0);
  const totalIncomesInCycle = cycleIncomes.reduce((sum, transaction) => sum + Math.abs(asNumber(transaction.amount)), 0);
  const daysPassedInCycle = Math.max(1, differenceInCalendarDays(today, lastPayday) + 1);
  const averageDailySpent = totalSpentInCycle / daysPassedInCycle;
  const dailyLimit = Math.max(0, availableForDaily) / divisorDays;

  const categoryTotals: Record<string, number> = {};
  cycleExpenses.forEach((transaction) => {
    const category = transaction.category || 'Geral';
    categoryTotals[category] = (categoryTotals[category] || 0) + Math.abs(asNumber(transaction.amount));
  });
  const sortedCategories = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([name, amount]) => ({
      name,
      amount,
      percentage: totalSpentInCycle > 0 ? amount / totalSpentInCycle * 100 : 0,
    }));
  const dominantCategory = sortedCategories[0]?.name || 'Nenhuma';
  const rhythm = calculateRhythm(transactions, currentDate);
  const isBrandNewCycle = totalSpentInCycle === 0 && totalIncomesInCycle === 0;
  const nextIncome = paymentAmountForDate(settings, nextPayday);

  let smartAlert: FinanceSummary['smartAlert'];
  if (currentBalance < 0) {
    smartAlert = { message: 'Seu saldo está negativo. Priorize os compromissos essenciais deste ciclo.', type: 'danger' };
  } else if (totalCommitments > currentBalance) {
    smartAlert = nextIncome.amount + currentBalance >= totalCommitments
      ? { message: 'O saldo atual não cobre o ciclo, mas o próximo recebimento cobre os compromissos cadastrados.', type: 'warning' }
      : { message: 'Os compromissos deste ciclo superam o saldo atual e o próximo recebimento previsto.', type: 'danger' };
  } else if (isBrandNewCycle && totalCommitments > 0) {
    smartAlert = { message: 'Novo ciclo iniciado. Confira as contas organizadas até o próximo pagamento.', type: 'warning' };
  } else if (dailyLimit > 0 && averageDailySpent > dailyLimit) {
    smartAlert = { message: 'Seu ritmo de gastos está acima do limite diário disponível neste ciclo.', type: 'warning' };
  } else {
    smartAlert = { message: `Ciclo ${cyclePeriodLabel} organizado com os compromissos cadastrados.`, type: 'success' };
  }

  const insights: string[] = [];
  insights.push(`Ciclo atual: ${cyclePeriodLabel}. As prioridades são renovadas automaticamente no próximo pagamento.`);
  if (pendingBillsTotal > 0) insights.push(`Contas fixas deste ciclo: R$ ${formatMoney(pendingBillsTotal)}.`);
  if (settings.payday_cycle === 'biweekly') {
    insights.push(`Previsão para o dia ${format(nextPayday, 'dd')}: R$ ${formatMoney(nextIncome.amount)} (${nextIncome.percentage}% da base do ciclo).`);
  }
  if (cardsTotal > 0) insights.push(`Faturas de cartão no ciclo: R$ ${formatMoney(cardsTotal)}.`);
  if (installmentsTotal > 0) insights.push(`Parcelas ainda pendentes no ciclo: R$ ${formatMoney(installmentsTotal)}.`);
  if (dominantCategory !== 'Nenhuma' && (sortedCategories[0]?.percentage || 0) > 40) {
    insights.push(`${dominantCategory} representa ${(sortedCategories[0]?.percentage || 0).toFixed(0)}% dos gastos do ciclo.`);
  }
  if (dailyLimit > 0 && averageDailySpent > dailyLimit) {
    insights.push(`Reduza aproximadamente R$ ${formatMoney(averageDailySpent - dailyLimit)} por dia para voltar ao limite.`);
  }

  const priorities: PriorityItem[] = [];

  pendingFixedBills.forEach((bill) => {
    const dueDate = parseISO(String(bill.dueDate));
    const daysUntilDue = differenceInCalendarDays(dueDate, today);
    const overdue = bill.reconciledStatus === 'overdue';
    const dueSoon = daysUntilDue >= 0 && daysUntilDue <= 1;
    priorities.push({
      id: `bill-${bill.id}`,
      title: overdue ? 'Conta fixa vencida' : dueSoon ? 'Conta fixa para pagar agora' : 'Conta fixa do ciclo',
      message: `${bill.name}: R$ ${formatMoney(bill.amount)} · ${overdue ? 'venceu' : 'vence'} em ${format(dueDate, 'dd/MM')}`,
      type: overdue || dueSoon ? 'urgent' : 'warning',
    });
  });

  cycleCards.forEach((card) => {
    const overdue = isBefore(card.cycleDueDate, today);
    const daysUntilDue = differenceInCalendarDays(card.cycleDueDate, today);
    priorities.push({
      id: `card-${card.id}`,
      title: overdue ? 'Fatura de cartão vencida' : daysUntilDue <= 1 ? 'Fatura próxima' : 'Fatura do ciclo',
      message: `${card.name}: R$ ${formatMoney(card.used)} · ${overdue ? 'venceu' : 'vence'} em ${format(card.cycleDueDate, 'dd/MM')}`,
      type: overdue || daysUntilDue <= 1 ? 'urgent' : 'warning',
    });
  });

  cycleInstallments.forEach((installment) => {
    const overdue = isBefore(installment.cycleDueDate, today);
    priorities.push({
      id: `installment-${installment.id}`,
      title: overdue ? 'Parcela vencida' : 'Parcela do ciclo',
      message: `${installment.description}: R$ ${formatMoney(installment.monthly_amount)} · parcela ${installment.current_installment}/${installment.total_installments} · ${overdue ? 'venceu' : 'vence'} em ${format(installment.cycleDueDate, 'dd/MM')}`,
      type: overdue ? 'urgent' : 'info',
    });
  });

  if (currentBalance < 100 && !isBrandNewCycle) {
    priorities.push({ id: 'p-balance', title: 'Saldo crítico', message: 'Evite gastos não essenciais até o próximo pagamento.', type: 'urgent' });
  }
  if (totalCommitments > currentBalance && !isBrandNewCycle) {
    priorities.push({ id: 'p-commit', title: 'Comprometimento alto', message: 'Os compromissos do ciclo superam o saldo atual.', type: 'urgent' });
  }
  if (daysRemaining > 10 && availableForDaily < 500) {
    priorities.push({ id: 'p-pressure', title: 'Pressão no ciclo', message: 'Ainda faltam muitos dias e o saldo livre está baixo.', type: 'warning' });
  }
  if (todaySpent > dailyLimit && dailyLimit > 0) {
    priorities.push({ id: 'p-limit', title: 'Limite diário ultrapassado', message: 'Os gastos de hoje passaram do limite calculado.', type: 'info' });
  }

  return {
    currentBalance,
    projectedBalance,
    dailyLimit,
    daysRemaining,
    todaySpent,
    totalSpentInCycle,
    averageDailySpent,
    nextPaydayDate: format(nextPayday, 'dd/MM/yyyy'),
    nextPaydayLabel: format(nextPayday, 'dd/MM'),
    cyclePeriodLabel,
    cycleInterval: cycle,
    dominantCategory,
    spendingTrend: dailyLimit > 0 && averageDailySpent > dailyLimit ? 'up' : averageDailySpent === dailyLimit ? 'stable' : 'down',
    insights,
    dailyInsight: insights[0] || '',
    smartAlert,
    rhythm,
    topCategories: sortedCategories.slice(0, 5),
    priorities,
    processedFixedBills,
  };
}

function calculateRhythm(transactions: Transaction[], now: Date): FinanceSummary['rhythm'] {
  const settledTransactions = transactions.filter(isSettledTransaction);
  const expenseForInterval = (start: Date, end: Date) => settledTransactions
    .filter((transaction) => {
      const date = parseTransactionDate(transaction.date);
      return Boolean(date && transaction.type === 'expense' && isWithinInterval(date, { start, end }));
    })
    .reduce((sum, transaction) => sum + Math.abs(asNumber(transaction.amount)), 0);
  const incomeForInterval = (start: Date, end: Date) => settledTransactions
    .filter((transaction) => {
      const date = parseTransactionDate(transaction.date);
      return Boolean(date && transaction.type === 'income' && isWithinInterval(date, { start, end }));
    })
    .reduce((sum, transaction) => sum + Math.abs(asNumber(transaction.amount)), 0);

  const days = eachDayOfInterval({ start: subDays(startOfDay(now), 29), end: startOfDay(now) });
  const dayLabels = days.map((day) => format(day, 'dd/MM'));
  const dayExpenses = days.map((day) => expenseForInterval(startOfDay(day), startOfDay(addDays(day, 1))));
  const dayIncomes = days.map((day) => incomeForInterval(startOfDay(day), startOfDay(addDays(day, 1))));

  const weeks = eachWeekOfInterval(
    { start: subDays(startOfDay(now), 28), end: startOfDay(now) },
    { locale: ptBR, weekStartsOn: 0 },
  );
  const weekLabels = weeks.map((week) => format(week, 'dd/MM'));
  const weekExpenses = weeks.map((week) => expenseForInterval(
    startOfWeek(week, { locale: ptBR, weekStartsOn: 0 }),
    endOfWeek(week, { locale: ptBR, weekStartsOn: 0 }),
  ));
  const weekIncomes = weeks.map((week) => incomeForInterval(
    startOfWeek(week, { locale: ptBR, weekStartsOn: 0 }),
    endOfWeek(week, { locale: ptBR, weekStartsOn: 0 }),
  ));

  const monthLabels: string[] = [];
  const monthExpenses: number[] = [];
  const monthIncomes: number[] = [];
  for (let offset = 5; offset >= 0; offset -= 1) {
    const month = subMonths(startOfMonth(now), offset);
    const nextMonth = addMonths(month, 1);
    monthLabels.push(format(month, 'MMM', { locale: ptBR }));
    monthExpenses.push(expenseForInterval(month, nextMonth));
    monthIncomes.push(incomeForInterval(month, nextMonth));
  }

  return {
    day: { labels: dayLabels, data: dayExpenses, incomeData: dayIncomes },
    week: { labels: weekLabels, data: weekExpenses, incomeData: weekIncomes },
    month: { labels: monthLabels, data: monthExpenses, incomeData: monthIncomes },
  };
}

export function calculateBrazilianTaxes(grossSalary: number): { inss: number; irrf: number; totalDeductions: number } {
  const payroll = calculatePayrollFromGross(Math.max(0, asNumber(grossSalary)), new Date());
  return {
    inss: Math.max(0, asNumber(payroll.inss)),
    irrf: Math.max(0, asNumber(payroll.irrf)),
    totalDeductions: Math.max(0, asNumber(payroll.totalDeductions)),
  };
}
