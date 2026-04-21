
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
  // 1. Determine cycle boundaries
  const nextPayday = getNextPayday(settings, currentDate);
  const lastPayday = getLastPayday(settings, currentDate);
  const daysRemaining = Math.max(1, differenceInCalendarDays(nextPayday, currentDate));

  // 2. Balances & Commitments (INTELLIGENT CYCLE FILTERING)
  const currentBalance = settings.current_balance;
  
  // Define sub-cycle logic: only consider bills that fall BETWEEN lastPayday and nextPayday
  // For monthly, it's the standard month. For biweekly, it's the specific 15-day window.
  const isInCycle = (dueDay: number) => {
    const p1 = Number(settings.payday_1) || 5;
    const p2 = Number(settings.payday_2) || 20;
    
    // We create a virtual date for the bill in the "current" month of the cycle
    // A bit tricky: if lastPayday was the 20th and next is the 5th, 
    // a bill on the 2nd IS in cycle, but a bill on the 10th is NOT.
    const billDateLocal = new Date(currentDate.getFullYear(), currentDate.getMonth(), dueDay, 12, 0, 0);
    
    // If the due day is "behind" the lastPayday in the same month, it might belong to the previous cycle
    // or the end of the current one if it's a wrap-around.
    // Accurate check: is within [lastPayday, nextPayday]
    return isWithinInterval(billDateLocal, { start: startOfDay(lastPayday), end: endOfDay(nextPayday) }) ||
           isWithinInterval(addMonths(billDateLocal, 1), { start: startOfDay(lastPayday), end: endOfDay(nextPayday) }) ||
           isWithinInterval(subDays(billDateLocal, 30), { start: startOfDay(lastPayday), end: endOfDay(nextPayday) });
  };

  // Calculate pending fixed commitments that fall WITHIN THIS SPECIFIC SUB-CYCLE
  const pendingBillsTotal = fixedBills
    .filter(bill => bill.status === 'pending' && isInCycle(bill.due_day))
    .reduce((sum, bill) => sum + bill.amount, 0);
    
  // Calculate card usage - only if the due date is within this sub-cycle
  const cardsTotal = cards
    .filter(card => isInCycle(card.due_day))
    .reduce((sum, card) => sum + (card.used || 0), 0);

  // Calculate upcoming installments for THIS SPECIFIC SUB-CYCLE
  const installmentsTotal = installments
    .filter(inst => {
      const isFinished = inst.current_installment > inst.total_installments;
      return !isFinished && isInCycle(inst.due_day);
    })
    .reduce((sum, inst) => sum + inst.monthly_amount, 0);
  
  // Calculate expected daily bills until payday
  const dailyBillsCommitment = dailyBills.reduce((sum, bill) => {
    if (bill.frequency === 'weekly') {
      const weeksRemaining = Math.ceil(daysRemaining / 7);
      return sum + (bill.average_amount * weeksRemaining);
    } else {
      // Monthly - only if it falls in this sub-cycle
      return isInCycle(28) ? sum + bill.average_amount : sum; // Assume day 28 for general daily bills if no day specified
    }
  }, 0);
  
  // The "Real" available balance is what's left after commitments in THIS CYCLE
  const totalCommitments = pendingBillsTotal + cardsTotal + installmentsTotal + dailyBillsCommitment;
  const availableForDaily = Math.max(0, currentBalance - totalCommitments);
  const projectedBalance = currentBalance - pendingBillsTotal - installmentsTotal;

  // 3. Cycle interval for transaction filtering
  const cycleInterval = { start: startOfDay(lastPayday), end: endOfDay(nextPayday) };
  const cyclePeriodLabel = `${format(lastPayday, 'dd')} a ${format(nextPayday, 'dd')}`;

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

  // 20. Priorities (INTELLIGENT FILTERING)
  const priorities: PriorityItem[] = [];
  
  // Critical Balance 
  if (currentBalance < 100 && !isBrandNewCycle) {
    priorities.push({ id: 'p-balance', title: 'Saldo Crítico', message: 'Evite qualquer gasto não essencial até o próximo pagamento.', type: 'urgent' });
  } else if (currentBalance === 0 && isBrandNewCycle) {
    priorities.push({ id: 'p-welcome', title: 'Ciclo Vazio', message: 'Registre seu saldo inicial ou renda para começar o planejamento.', type: 'info' });
  }
  
  // Over-commitment
  if (totalCommitments > currentBalance && !isBrandNewCycle) {
    priorities.push({ id: 'p-commit', title: 'Comprometimento Alto', message: 'Seus compromissos no período atual já superam seu saldo.', type: 'urgent' });
  }
  
  // Pending Bills (Only in current sub-cycle)
  fixedBills.filter(bill => bill.status === 'pending' && isInCycle(bill.due_day)).forEach(bill => {
    const today = currentDate.getDate();
    const isDueSoon = bill.due_day === today || bill.due_day === today + 1;
    
    priorities.push({
      id: `bill-${bill.id}`,
      title: isDueSoon ? 'Pagar Hoje/Amanhã' : 'Conta do Ciclo',
      message: `${bill.name}: R$ ${bill.amount.toLocaleString('pt-BR')} (Vence dia ${bill.due_day})`,
      type: isDueSoon ? 'urgent' : 'warning'
    });
  });

  // Credit Card Bills (Only in current sub-cycle)
  cards.filter(card => isInCycle(card.due_day)).forEach(card => {
    const today = currentDate.getDate();
    const isDueSoon = card.due_day === today || card.due_day === today + 1;
    
    if (card.used > 0) {
      priorities.push({
        id: `card-${card.id}`,
        title: isDueSoon ? 'Vencimento Cartão' : 'Fatura no Ciclo',
        message: `${card.name}: R$ ${card.used.toLocaleString('pt-BR')} (Vence dia ${card.due_day})`,
        type: isDueSoon ? 'urgent' : 'info'
      });
    }
  });

  // Installments in Cycle
  installments.filter(inst => {
    const isFinished = inst.current_installment > inst.total_installments;
    return !isFinished && isInCycle(inst.due_day);
  }).forEach(inst => {
    priorities.push({
      id: `inst-prio-${inst.id}`,
      title: 'Parcela Pendente',
      message: `${inst.description}: R$ ${inst.monthly_amount.toLocaleString('pt-BR')} (Dia ${inst.due_day})`,
      type: 'info'
    });
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
    cyclePeriodLabel,
    cycleInterval,
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
  const p1 = Number(settings.payday_1) || 5;
  const p2 = Number(settings.payday_2) || 20;

  const candidates: Date[] = [
    startOfDay(setDate(now, p1)),
    startOfDay(setDate(addMonths(now, 1), p1)),
    startOfDay(setDate(subDays(now, 30), p1))
  ];

  if (settings.payday_cycle === 'biweekly') {
    candidates.push(
      startOfDay(setDate(now, p2)),
      startOfDay(setDate(addMonths(now, 1), p2)),
      startOfDay(setDate(subDays(now, 30), p2))
    );
  }

  const futureCandidates = candidates
    .filter(d => isAfter(d, today))
    .sort((a, b) => a.getTime() - b.getTime());

  return futureCandidates[0] || addMonths(today, 1);
}

function getLastPayday(settings: UserSettings, now: Date): Date {
  const today = startOfDay(now);
  const p1 = Number(settings.payday_1) || 5;
  const p2 = Number(settings.payday_2) || 20;

  const candidates: Date[] = [
    startOfDay(setDate(now, p1)),
    startOfDay(setDate(addMonths(now, 1), p1)),
    startOfDay(setDate(subDays(now, 30), p1))
  ];

  if (settings.payday_cycle === 'biweekly') {
    candidates.push(
      startOfDay(setDate(now, p2)),
      startOfDay(setDate(addMonths(now, 1), p2)),
      startOfDay(setDate(subDays(now, 30), p2))
    );
  }

  const pastCandidates = candidates
    .filter(d => !isAfter(d, today))
    .sort((a, b) => b.getTime() - a.getTime());

  return pastCandidates[0] || subDays(today, 15);
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
