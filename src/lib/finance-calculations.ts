
import { Transaction, UserSettings, FinanceSummary, RhythmData, PriorityItem, FixedBill, CreditCard, DailyBill, CardInstallment } from '../types';
import { 
  differenceInCalendarDays,
  startOfDay, 
  endOfDay, 
  isWithinInterval, 
  addMonths, 
  setDate, 
  isAfter,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  eachWeekOfInterval,
  format,
  isSameDay,
  isSameWeek,
  isSameMonth,
  subDays,
  subMonths,
  startOfWeek,
  endOfWeek
} from 'date-fns';
import { ptBR } from 'date-fns/locale';

export function calculateFinanceSummary(
  transactions: Transaction[],
  settings: UserSettings,
  fixedBills: FixedBill[] = [],
  cards: CreditCard[] = [],
  dailyBills: DailyBill[] = [],
  installments: CardInstallment[] = [],
  currentDate: Date = new Date()
): FinanceSummary {
  // 1. Determine next payday
  const nextPayday = getNextPayday(settings, currentDate);
  const daysRemaining = Math.max(1, differenceInCalendarDays(nextPayday, currentDate));

  // 2. Balances & Commitments
  const currentBalance = settings.current_balance;
  
  // Calculate pending fixed commitments until next payday
  const pendingBillsTotal = fixedBills
    .filter(bill => bill.status === 'pending')
    .reduce((sum, bill) => sum + bill.amount, 0);
    
  // Calculate card usage (current balance on cards)
  const cardsTotal = cards.reduce((sum, card) => sum + (card.used || 0), 0);

  // Calculate upcoming installments for the current cycle
  // (Assuming installments are monthly and due in the current cycle)
  const installmentsTotal = installments.reduce((sum, inst) => sum + inst.monthly_amount, 0);
  
  // Calculate expected daily bills until payday
  const dailyBillsCommitment = dailyBills.reduce((sum, bill) => {
    if (bill.frequency === 'weekly') {
      const weeksRemaining = Math.ceil(daysRemaining / 7);
      return sum + (bill.average_amount * weeksRemaining);
    } else {
      // Monthly - assume it happens once in the cycle if not already spent
      return sum + bill.average_amount;
    }
  }, 0);
  
  // The "Real" available balance is what's left after all commitments
  const totalCommitments = pendingBillsTotal + cardsTotal + installmentsTotal + dailyBillsCommitment;
  const availableForDaily = Math.max(0, currentBalance - totalCommitments);
  const projectedBalance = currentBalance - pendingBillsTotal - installmentsTotal;

  // 3. Cycle dates (from last payday to next payday)
  const lastPayday = subDays(nextPayday, settings.payday_cycle === 'biweekly' ? 15 : 30);
  const cycleInterval = { start: startOfDay(lastPayday), end: endOfDay(nextPayday) };

  // 4. Spending stats
  const todayStart = startOfDay(currentDate);
  const todayEnd = endOfDay(currentDate);
  
  const cycleExpenses = transactions.filter(t => {
    try {
      const d = new Date(t.date);
      if (isNaN(d.getTime())) return false;
      return t.type === 'expense' && isWithinInterval(d, cycleInterval);
    } catch {
      return false;
    }
  });

  const todaySpent = cycleExpenses
    .filter(t => {
      try {
        const d = new Date(t.date);
        return isWithinInterval(d, { start: todayStart, end: todayEnd });
      } catch {
        return false;
      }
    })
    .reduce((acc, t) => acc + Math.abs(t.amount), 0);

  const totalSpentInCycle = cycleExpenses.reduce((acc, t) => acc + Math.abs(t.amount), 0);
  const totalIncomesInCycle = transactions
    .filter(t => {
      try {
        const d = new Date(t.date);
        return t.type === 'income' && isWithinInterval(d, cycleInterval);
      } catch { return false; }
    })
    .reduce((acc, t) => acc + Math.abs(t.amount), 0);
  
  const daysPassedInCycle = Math.max(1, differenceInCalendarDays(currentDate, lastPayday));
  const averageDailySpent = totalSpentInCycle / daysPassedInCycle;

  // 5. Daily limit
  const dailyLimit = availableForDaily / daysRemaining;

  // 6. Dominant category & Top categories
  const categoryTotals: Record<string, number> = {};
  cycleExpenses.forEach(t => {
    categoryTotals[t.category] = (categoryTotals[t.category] || 0) + Math.abs(t.amount);
  });
  
  const sortedCategories = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([name, amount]) => ({
      name,
      amount,
      percentage: totalSpentInCycle > 0 ? (amount / totalSpentInCycle) * 100 : 0
    }));

  const dominantCategory = sortedCategories[0]?.name || 'Nenhuma';

  // 7. Rhythm Data
  const rhythm = calculateRhythm(transactions, currentDate, fixedBills, dailyBills);

  // 8. Smart Alert
  let smartAlert: FinanceSummary['smartAlert'] = null;
  
  // Logic for a "fresh" or "empty" cycle
  const isBrandNewCycle = totalSpentInCycle === 0 && totalIncomesInCycle === 0;

  // Expected income for the remainder of the cycle
  const nextPaydayDate = getNextPayday(settings, currentDate);
  const p1 = Number(settings.payday_1) || 5;
  const isPayday1 = nextPaydayDate.getDate() === p1;
  const slotPercentage = isPayday1 ? (settings.payday_1_percentage || 50) : (settings.payday_2_percentage || 50);
  const expectedImmediateIncome = (settings.net_salary_estimated * slotPercentage) / 100;

  if (currentBalance < 0) {
    smartAlert = { message: "Seu saldo está negativo! Priorize cobrir o rombo imediatamente.", type: 'danger' };
  } else if (isBrandNewCycle && totalCommitments > 0) {
    smartAlert = { message: "Boas-vindas! Registre seu salário ou saldo inicial para cobrir seus compromissos agendados.", type: 'warning' };
  } else if (totalCommitments > currentBalance) {
    // Check if expected income covers the gap
    if (expectedImmediateIncome + currentBalance >= totalCommitments) {
      smartAlert = { 
        message: `Saldo atual (R$ ${Math.max(0, currentBalance).toLocaleString('pt-BR')}) não cobre compromissos, mas seu próximo salário resolve isso.`, 
        type: 'warning' 
      };
    } else {
      smartAlert = { 
        message: `Aviso: Seus compromissos (R$ ${totalCommitments.toLocaleString('pt-BR')}) superam o saldo + próximo salário. Planeje um corte.`, 
        type: 'danger' 
      };
    }
  } else if (dailyLimit < averageDailySpent * 0.7 && dailyLimit > 0) {
    smartAlert = { message: "Atenção: Seu ritmo de gastos está acima do limite diário projetado.", type: 'warning' };
  } else if (daysRemaining < 3 && currentBalance > 500) {
    smartAlert = { message: "Parabéns! Você chegou ao fim do ciclo com uma boa reserva.", type: 'success' };
  } else {
    smartAlert = { message: "Tudo sob controle. Seu saldo e previsões cobrem os compromissos do mês.", type: 'success' };
  }

  // 9. Insights
  const insights: string[] = [];
  if (dailyLimit < 50 && dailyLimit > 0) insights.push("Seu limite diário está crítico. Corte gastos supérfluos hoje.");
  if (pendingBillsTotal > 0) insights.push(`Você ainda tem R$ ${pendingBillsTotal.toLocaleString('pt-BR')} em contas fixas pendentes.`);
  
  if (settings.payday_cycle === 'biweekly') {
    const nextPaydayDate = getNextPayday(settings, currentDate);
    const isPayday1 = nextPaydayDate.getDate() === settings.payday_1;
    const percentage = isPayday1 ? (settings.payday_1_percentage || 50) : (settings.payday_2_percentage || 50);
    const expectedAmount = (settings.net_salary_estimated * percentage) / 100;
    insights.push(`Previsão de recebimento no dia ${nextPaydayDate.getDate()}: R$ ${expectedAmount.toLocaleString('pt-BR')} (${percentage}% do salário).`);
  }

  if (cardsTotal > 0) insights.push(`Sua fatura de cartão atual soma R$ ${cardsTotal.toLocaleString('pt-BR')}.`);
  if (installmentsTotal > 0) insights.push(`Você tem R$ ${installmentsTotal.toLocaleString('pt-BR')} em parcelas de cartão para este ciclo.`);
  if (dailyBillsCommitment > 0) insights.push(`Previsão de R$ ${dailyBillsCommitment.toLocaleString('pt-BR')} em gastos cotidianos (café, pão, etc) até o fim do ciclo.`);
  
  if (dominantCategory !== 'Nenhuma' && sortedCategories[0].percentage > 40) {
    insights.push(`A categoria ${dominantCategory} representa ${sortedCategories[0].percentage.toFixed(0)}% dos seus gastos.`);
  }
  if (averageDailySpent > dailyLimit && dailyLimit > 0) {
    insights.push("Você está gastando mais do que o ideal. Tente reduzir R$ " + (averageDailySpent - dailyLimit).toFixed(2) + " por dia.");
  }

  // 10. Priorities
  const priorities: PriorityItem[] = [];
  
  // Critical Balance - only if they've had some income but spent it, or if it's deeply zero
  if (currentBalance < 100 && !isBrandNewCycle) {
    priorities.push({ id: 'p-balance', title: 'Saldo Crítico', message: 'Evite qualquer gasto não essencial até o próximo pagamento.', type: 'urgent' });
  } else if (currentBalance === 0 && isBrandNewCycle) {
    priorities.push({ id: 'p-welcome', title: 'Ciclo Vazio', message: 'Registre seu saldo inicial ou renda para começar o planejamento.', type: 'info' });
  }
  
  // Over-commitment
  if (totalCommitments > currentBalance && !isBrandNewCycle) {
    priorities.push({ id: 'p-commit', title: 'Comprometimento Alto', message: 'Seus compromissos financeiros já consomem todo seu saldo disponível.', type: 'urgent' });
  }
  
  // Pending Bills
  fixedBills.filter(bill => bill.status === 'pending').forEach(bill => {
    const today = currentDate.getDate();
    const isDueSoon = bill.due_day === today || bill.due_day === today + 1;
    
    priorities.push({
      id: `bill-${bill.id}`,
      title: isDueSoon ? 'Pagar Hoje/Amanhã' : 'Conta Pendente',
      message: `${bill.name}: R$ ${bill.amount.toLocaleString('pt-BR')} (Vence dia ${bill.due_day})`,
      type: isDueSoon ? 'urgent' : 'warning'
    });
  });

  // Credit Card Bills
  cards.forEach(card => {
    const today = currentDate.getDate();
    const isDueSoon = card.due_day === today || card.due_day === today + 1;
    
    if (card.used > 0) {
      priorities.push({
        id: `card-${card.id}`,
        title: isDueSoon ? 'Vencimento Cartão' : 'Fatura Cartão',
        message: `${card.name}: R$ ${card.used.toLocaleString('pt-BR')} (Vence dia ${card.due_day})`,
        type: isDueSoon ? 'urgent' : 'info'
      });
    }
  });

  if (daysRemaining > 10 && availableForDaily < 500) {
    priorities.push({ id: 'p-pressure', title: 'Pressão no Ciclo', message: 'Ainda faltam muitos dias e o saldo livre está baixo.', type: 'warning' });
  }
  
  if (todaySpent > dailyLimit && dailyLimit > 0) {
    priorities.push({ id: 'p-limit', title: 'Meta Diária', message: 'Você já ultrapassou o limite de hoje.', type: 'info' });
  }

  return {
    currentBalance: Math.max(0, currentBalance),
    projectedBalance: Math.max(0, projectedBalance),
    dailyLimit,
    daysRemaining,
    todaySpent,
    totalSpentInCycle,
    averageDailySpent,
    nextPaydayDate: format(nextPayday, 'dd/MM/yyyy'),
    nextPaydayLabel: format(nextPayday, 'dd/MM'),
    dominantCategory,
    spendingTrend: averageDailySpent > dailyLimit ? 'up' : 'down',
    insights,
    dailyInsight: insights[0] || '',
    smartAlert,
    rhythm,
    topCategories: sortedCategories.slice(0, 5),
    priorities
  };
}

function calculateRhythm(
  transactions: Transaction[], 
  now: Date, 
  fixedBills: FixedBill[] = [], 
  dailyBills: DailyBill[] = []
): FinanceSummary['rhythm'] {
  // Use last 30 days for a more continuous rhythm view
  const startDate = subDays(now, 29);
  const days = eachDayOfInterval({ start: startDate, end: now });
  
  const dayLabels = days.map(d => format(d, 'dd/MM'));
  const dayData = days.map(d => {
    const dateKey = format(d, 'yyyy-MM-dd');
    
    // 1. Real transactions (Manual + Imported)
    const dayTransactions = transactions.filter(t => {
      try {
        const tDateKey = t.date.split('T')[0];
        return tDateKey === dateKey;
      } catch {
        return false;
      }
    });

    const expenseTotal = dayTransactions
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + Math.abs(Number(t.amount) || 0), 0);

    const incomeTotal = dayTransactions
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + Math.abs(Number(t.amount) || 0), 0);

    // 2. Fixed bills due on this specific day
    const fixedTotal = fixedBills
      .filter(b => b.due_day === d.getDate())
      .reduce((sum, b) => sum + (Number(b.amount) || 0), 0);

    return { expense: expenseTotal + fixedTotal, income: incomeTotal };
  });

  const dayExpenses = dayData.map(d => d.expense);
  const dayIncomes = dayData.map(d => d.income);

  // Week rhythm (Last 4 weeks)
  const weekStart = subDays(now, 28);
  const weeks = eachWeekOfInterval({ start: weekStart, end: now }, { locale: ptBR, weekStartsOn: 0 });
  const weekLabels = weeks.map((w, i) => format(w, 'dd/MM'));
  const weekData = weeks.map(w => {
    const wInterval = { start: startOfWeek(w, { locale: ptBR }), end: endOfWeek(w, { locale: ptBR }) };
    
    const weekTransactions = transactions.filter(t => {
      try {
        const td = new Date(t.date);
        return isWithinInterval(td, wInterval);
      } catch {
        return false;
      }
    });

    const transExpense = weekTransactions
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + Math.abs(Number(t.amount) || 0), 0);

    const transIncome = weekTransactions
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + Math.abs(Number(t.amount) || 0), 0);

    const fixedTotal = fixedBills
      .filter(b => {
        const dueDate = setDate(now, b.due_day);
        return isWithinInterval(dueDate, wInterval);
      })
      .reduce((sum, b) => sum + (Number(b.amount) || 0), 0);

    return { expense: transExpense + fixedTotal, income: transIncome };
  });

  const weekExpenses = weekData.map(w => w.expense);
  const weekIncomes = weekData.map(w => w.income);

  // Month rhythm (Last 6 months)
  const monthLabels: string[] = [];
  const monthExpenses: number[] = [];
  const monthIncomes: number[] = [];
  
  for (let i = 5; i >= 0; i--) {
    const mDate = subMonths(now, i);
    const mStart = startOfMonth(mDate);
    const mEnd = endOfMonth(mDate);
    
    monthLabels.push(format(mDate, 'MMM', { locale: ptBR }));
    
    const monthTransactions = transactions.filter(t => {
      try {
        const td = new Date(t.date);
        return isWithinInterval(td, { start: mStart, end: mEnd });
      } catch {
        return false;
      }
    });

    const mExpense = monthTransactions
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + Math.abs(Number(t.amount) || 0), 0);
    
    const mIncome = monthTransactions
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + Math.abs(Number(t.amount) || 0), 0);

    // For historical months, we only really have transactions
    const isCurrentMonth = isSameMonth(mDate, now);
    const fixedCurrent = isCurrentMonth ? fixedBills.filter(b => b.status === 'pending').reduce((s,b) => s + b.amount, 0) : 0;
    
    monthExpenses.push(mExpense + fixedCurrent);
    monthIncomes.push(mIncome);
  }

  return {
    day: { labels: dayLabels, data: dayExpenses, incomeData: dayIncomes },
    week: { labels: weekLabels, data: weekExpenses, incomeData: weekIncomes },
    month: { labels: monthLabels, data: monthExpenses, incomeData: monthIncomes }
  };
}

function getNextPayday(settings: UserSettings, now: Date): Date {
  const today = startOfDay(now);
  
  // Default to payday_1
  const p1 = Number(settings.payday_1) || 5;
  let paydayDate = startOfDay(setDate(now, p1));
  
  // If today is payday or after payday, move to next month
  if (isAfter(today, paydayDate) || isSameDay(today, paydayDate)) {
    paydayDate = addMonths(paydayDate, 1);
  }

  // For biweekly, we have two potential dates each month
  if (settings.payday_cycle === 'biweekly') {
    const p2 = Number(settings.payday_2) || 20;

    const candidates: Date[] = [
      startOfDay(setDate(now, p1)),
      startOfDay(setDate(addMonths(now, 1), p1)),
      startOfDay(setDate(now, p2)),
      startOfDay(setDate(addMonths(now, 1), p2))
    ];

    const futureCandidates = candidates
      .filter(d => isAfter(d, today))
      .sort((a, b) => a.getTime() - b.getTime());

    if (futureCandidates.length > 0) {
      return futureCandidates[0];
    }
  }

  return paydayDate;
}

export function calculateBrazilianTaxes(grossSalary: number): { inss: number; irrf: number; totalDeductions: number } {
  // INSS 2024/2025
  let inss = 0;
  if (grossSalary <= 1412.00) {
    inss = grossSalary * 0.075;
  } else if (grossSalary <= 2666.68) {
    inss = (1412.00 * 0.075) + ((grossSalary - 1412.00) * 0.09);
  } else if (grossSalary <= 4000.03) {
    inss = (1412.00 * 0.075) + ((2666.68 - 1412.00) * 0.09) + ((grossSalary - 2666.68) * 0.12);
  } else if (grossSalary <= 7786.02) {
    inss = (1412.00 * 0.075) + ((2666.68 - 1412.00) * 0.09) + ((4000.03 - 2666.68) * 0.12) + ((grossSalary - 4000.03) * 0.14);
  } else {
    inss = 908.85; // Ceiling
  }

  // IRRF 2024/2025
  const irrfBase = grossSalary - inss;
  let irrf = 0;
  if (irrfBase <= 2259.20) {
    irrf = 0;
  } else if (irrfBase <= 2826.65) {
    irrf = (irrfBase * 0.075) - 169.44;
  } else if (irrfBase <= 3751.05) {
    irrf = (irrfBase * 0.15) - 381.44;
  } else if (irrfBase <= 4664.68) {
    irrf = (irrfBase * 0.225) - 662.77;
  } else {
    irrf = (irrfBase * 0.275) - 896.00;
  }

  return {
    inss: Math.max(0, inss),
    irrf: Math.max(0, irrf),
    totalDeductions: Math.max(0, inss + irrf)
  };
}
