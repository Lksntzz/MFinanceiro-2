
import { Transaction, UserSettings, FinanceSummary, RhythmData, PriorityItem, FixedBill, CreditCard, DailyBill, CardInstallment } from '../types';
import { 
  differenceInCalendarDays,
  startOfDay, 
  endOfDay, 
  isWithinInterval, 
  addMonths, 
  setDate, 
  getDaysInMonth,
  isAfter,
  startOfMonth,
  eachDayOfInterval,
  eachWeekOfInterval,
  format,
  isSameDay,
  isSameWeek,
  isSameMonth,
  subDays,
  subWeeks,
  subMonths,
  startOfWeek,
  endOfWeek
} from 'date-fns';
import { ptBR } from 'date-fns/locale';

function parseCalendarDate(value: string): Date | null {
  // ISO com horário (ex.: lançamento manual salvo com toISOString):
  // converte para dia LOCAL para evitar cair no dia seguinte/anterior por UTC.
  if (value.includes('T')) {
    const parsedIso = new Date(value);
    if (!isNaN(parsedIso.getTime())) {
      return new Date(
        parsedIso.getFullYear(),
        parsedIso.getMonth(),
        parsedIso.getDate(),
        12,
        0,
        0,
        0
      );
    }
  }

  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);
    return new Date(year, month - 1, day, 12, 0, 0, 0);
  }

  const br = value.match(/^(\d{2})[/-](\d{2})[/-](\d{2,4})/);
  if (br) {
    const day = Number(br[1]);
    const month = Number(br[2]);
    const year = Number(br[3].length === 2 ? `20${br[3]}` : br[3]);
    return new Date(year, month - 1, day, 12, 0, 0, 0);
  }

  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) return null;
  return new Date(
    parsed.getFullYear(),
    parsed.getMonth(),
    parsed.getDate(),
    12,
    0,
    0,
    0
  );
}

function toSignedAmount(t: Transaction): number {
  const raw = Number(t.amount) || 0;
  if (t.type === 'income') return Math.abs(raw);
  if (t.type === 'expense') return -Math.abs(raw);
  // transfer (ou legado): respeita sinal existente
  return raw;
}

function isOutflow(t: Transaction): boolean {
  return toSignedAmount(t) < 0;
}

function formatCurrencyBRL(value: number): string {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

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
  const daysRemaining = Math.max(
    0,
    differenceInCalendarDays(startOfDay(nextPayday), startOfDay(currentDate))
  );
  const daysRemainingForLimit = Math.max(1, daysRemaining);

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
  const cycleExpenses = transactions.filter(t => {
    const d = parseCalendarDate(t.date);
    if (!d) return false;
    return isOutflow(t) && isWithinInterval(d, cycleInterval);
  });

  const todaySpent = transactions
    .filter(t => {
      const d = parseCalendarDate(t.date);
      if (!d) return false;
      return isOutflow(t) && isSameDay(d, currentDate);
    })
    .reduce((acc, t) => acc + Math.abs(toSignedAmount(t)), 0);

  const totalSpentInCycle = cycleExpenses.reduce((acc, t) => acc + Math.abs(toSignedAmount(t)), 0);
  
  const daysPassedInCycle = Math.max(
    1,
    differenceInCalendarDays(startOfDay(currentDate), startOfDay(lastPayday))
  );
  const averageDailySpent = totalSpentInCycle / daysPassedInCycle;

  // 5. Daily limit
  const dailyLimit = availableForDaily / daysRemainingForLimit;

  // 6. Dominant category & Top categories (gasto real do usuário)
  // Usa todas as saídas registradas para refletir a categoria onde mais gasta.
  const allOutflows = transactions.filter(t => isOutflow(t));
  const categoryTotals: Record<string, number> = {};
  allOutflows.forEach(t => {
    const category = t.category || 'Geral';
    categoryTotals[category] = (categoryTotals[category] || 0) + Math.abs(toSignedAmount(t));
  });
  const totalCategorySpent = Object.values(categoryTotals).reduce((sum, amount) => sum + amount, 0);

  const sortedCategories = Object.entries(categoryTotals)
    .sort((a, b) => b[1] - a[1])
    .map(([name, amount]) => ({
      name,
      amount,
      percentage: totalCategorySpent > 0 ? (amount / totalCategorySpent) * 100 : 0
    }));

  const dominantCategory = sortedCategories[0]?.name || 'Nenhuma';

  // 7. Rhythm Data
  const rhythm = calculateRhythm(transactions, currentDate);

  const parsedTransactions = transactions
    .map(t => {
      const parsedDate = parseCalendarDate(t.date);
      if (!parsedDate) return null;
      return {
        ...t,
        parsedDate,
        signedAmount: toSignedAmount(t),
      };
    })
    .filter((t): t is Transaction & { parsedDate: Date; signedAmount: number } => t !== null);

  const latestTransactionDate = parsedTransactions.length > 0
    ? new Date(Math.max(...parsedTransactions.map(t => t.parsedDate.getTime())))
    : null;
  const referenceDateForAnalysis = latestTransactionDate ?? currentDate;

  // 8. Smart Alert
  let smartAlert: FinanceSummary['smartAlert'] = null;
  const paceProjection = currentBalance - (averageDailySpent * daysRemaining);
  const overspendRatio = dailyLimit > 0 ? (averageDailySpent / dailyLimit) : (averageDailySpent > 0 ? Number.POSITIVE_INFINITY : 1);
  const weekStart = startOfWeek(referenceDateForAnalysis, { locale: ptBR });
  const weekEnd = endOfWeek(referenceDateForAnalysis, { locale: ptBR });
  const weekOutflows = parsedTransactions.filter(t =>
    t.signedAmount < 0 &&
    isWithinInterval(t.parsedDate, { start: weekStart, end: weekEnd })
  );
  const weekSpentTotal = weekOutflows.reduce((sum, t) => sum + Math.abs(t.signedAmount), 0);
  const weekDailyTotals = eachDayOfInterval({ start: weekStart, end: weekEnd }).map(day => {
    const spent = weekOutflows
      .filter(t => isSameDay(t.parsedDate, day))
      .reduce((sum, t) => sum + Math.abs(t.signedAmount), 0);
    return { day, spent };
  });
  const peakWeekDay = weekDailyTotals.sort((a, b) => b.spent - a.spent)[0] || { day: referenceDateForAnalysis, spent: 0 };
  const weekAverageSpentPerDay = weekSpentTotal / 7;
  const hasWeeklySpike =
    peakWeekDay.spent > 0 &&
    weekAverageSpentPerDay > 0 &&
    peakWeekDay.spent >= Math.max(weekAverageSpentPerDay * 2, dailyLimit > 0 ? dailyLimit * 1.4 : 0);

  if (currentBalance < 0) {
    smartAlert = {
      message: `Saldo negativo de R$ ${formatCurrencyBRL(Math.abs(currentBalance))}. Priorize cobrir esse valor antes de novos gastos.`,
      type: 'danger'
    };
  } else if (paceProjection < 0) {
    smartAlert = {
      message: `No ritmo atual, voce fecha o ciclo com rombo de R$ ${formatCurrencyBRL(Math.abs(paceProjection))}. Reduza a media diaria para evitar saldo negativo.`,
      type: 'danger'
    };
  } else if (totalCommitments > currentBalance) {
    const deficit = totalCommitments - currentBalance;
    smartAlert = {
      message: `Compromissos de R$ ${formatCurrencyBRL(totalCommitments)} superam seu saldo atual em R$ ${formatCurrencyBRL(deficit)}.`,
      type: 'danger'
    };
  } else if (dailyLimit <= 0 && averageDailySpent > 0) {
    smartAlert = {
      message: `Sem margem diaria livre no ciclo, mas sua media atual e R$ ${formatCurrencyBRL(averageDailySpent)} por dia.`,
      type: 'warning'
    };
  } else if (overspendRatio >= 1.25 && dailyLimit > 0) {
    smartAlert = {
      message: `Ritmo de gastos acima do limite: media de R$ ${formatCurrencyBRL(averageDailySpent)}/dia vs limite de R$ ${formatCurrencyBRL(dailyLimit)}/dia.`,
      type: 'warning'
    };
  } else if (hasWeeklySpike) {
    const peakLabel = format(peakWeekDay.day, 'dd/MM', { locale: ptBR });
    const vsWeeklyAverage = ((peakWeekDay.spent / weekAverageSpentPerDay) - 1) * 100;
    smartAlert = {
      message: `Pico de gasto em ${peakLabel}: R$ ${formatCurrencyBRL(peakWeekDay.spent)} (${vsWeeklyAverage.toFixed(0)}% acima da media diaria da semana).`,
      type: 'warning'
    };
  } else if (transactions.length === 0) {
    smartAlert = {
      message: `Sem lancamentos no periodo. Registre movimentacoes para gerar alertas mais precisos.`,
      type: 'success'
    };
  } else {
    smartAlert = {
      message: `Ciclo sob controle: saldo de R$ ${formatCurrencyBRL(currentBalance)} com limite diario de R$ ${formatCurrencyBRL(dailyLimit)}.`,
      type: 'success'
    };
  }

  // 9. Insights (prioriza o insight do dia com base em dados reais)
  const insightReferenceDate = latestTransactionDate ?? currentDate;
  const insightDateLabel = format(insightReferenceDate, 'dd/MM', { locale: ptBR });

  const dayTransactions = parsedTransactions.filter(t => isSameDay(t.parsedDate, insightReferenceDate));
  const dayOutflows = dayTransactions.filter(t => t.signedAmount < 0);
  const dayInflows = dayTransactions.filter(t => t.signedAmount > 0);
  const daySpent = dayOutflows.reduce((sum, t) => sum + Math.abs(t.signedAmount), 0);
  const dayIncome = dayInflows.reduce((sum, t) => sum + t.signedAmount, 0);
  const dayNet = dayIncome - daySpent;

  const dayCategoryTotals: Record<string, number> = {};
  dayOutflows.forEach(t => {
    const category = t.category || 'Geral';
    dayCategoryTotals[category] = (dayCategoryTotals[category] || 0) + Math.abs(t.signedAmount);
  });
  const topDayCategory = Object.entries(dayCategoryTotals).sort((a, b) => b[1] - a[1])[0];

  let dailyInsight = '';
  if (parsedTransactions.length === 0) {
    dailyInsight = `Sem lancamentos ainda. Seu limite diario projetado e R$ ${formatCurrencyBRL(dailyLimit)} ate o proximo pagamento.`;
  } else if (daySpent === 0 && dayIncome === 0) {
    dailyInsight = `Sem movimentacoes no dia ${insightDateLabel}. Saldo disponivel atual: R$ ${formatCurrencyBRL(currentBalance)}.`;
  } else if (daySpent > 0 && dayIncome === 0) {
    if (dailyLimit > 0 && daySpent > dailyLimit) {
      dailyInsight = `No dia ${insightDateLabel}, voce gastou R$ ${formatCurrencyBRL(daySpent)}, acima do limite diario de R$ ${formatCurrencyBRL(dailyLimit)}.`;
    } else if (dailyLimit > 0) {
      dailyInsight = `No dia ${insightDateLabel}, voce gastou R$ ${formatCurrencyBRL(daySpent)}, dentro do limite diario de R$ ${formatCurrencyBRL(dailyLimit)}.`;
    } else {
      dailyInsight = `No dia ${insightDateLabel}, voce gastou R$ ${formatCurrencyBRL(daySpent)}.`;
    }
  } else if (dayIncome > 0 && daySpent === 0) {
    dailyInsight = `No dia ${insightDateLabel}, entraram R$ ${formatCurrencyBRL(dayIncome)} e nao houve saidas.`;
  } else {
    const dayNetLabel = dayNet >= 0 ? `+R$ ${formatCurrencyBRL(dayNet)}` : `-R$ ${formatCurrencyBRL(Math.abs(dayNet))}`;
    dailyInsight = `No dia ${insightDateLabel}, entraram R$ ${formatCurrencyBRL(dayIncome)} e sairam R$ ${formatCurrencyBRL(daySpent)} (saldo do dia: ${dayNetLabel}).`;
  }

  if (topDayCategory && daySpent > 0) {
    const topShare = (topDayCategory[1] / daySpent) * 100;
    dailyInsight += ` Maior impacto do dia: ${topDayCategory[0]} (${topShare.toFixed(0)}%).`;
  }

  const insights: string[] = [dailyInsight];
  const pushInsight = (message: string) => {
    if (!message) return;
    if (!insights.includes(message)) insights.push(message);
  };

  if (dailyLimit < 50 && dailyLimit > 0) pushInsight('Seu limite diario esta critico. Corte gastos superfluos hoje.');
  if (pendingBillsTotal > 0) pushInsight(`Voce ainda tem R$ ${formatCurrencyBRL(pendingBillsTotal)} em contas fixas pendentes.`);
  if (cardsTotal > 0) pushInsight(`Sua fatura de cartao atual soma R$ ${formatCurrencyBRL(cardsTotal)}.`);
  if (installmentsTotal > 0) pushInsight(`Voce tem R$ ${formatCurrencyBRL(installmentsTotal)} em parcelas de cartao para este ciclo.`);
  if (dailyBillsCommitment > 0) pushInsight(`Previsao de R$ ${formatCurrencyBRL(dailyBillsCommitment)} em gastos cotidianos ate o fim do ciclo.`);
  
  if (dominantCategory !== 'Nenhuma' && sortedCategories[0].percentage > 40) {
    pushInsight(`A categoria ${dominantCategory} representa ${sortedCategories[0].percentage.toFixed(0)}% dos seus gastos.`);
  }
  if (averageDailySpent > dailyLimit && dailyLimit > 0) {
    pushInsight(`Voce esta gastando mais do que o ideal. Tente reduzir R$ ${formatCurrencyBRL(averageDailySpent - dailyLimit)} por dia.`);
  }

  // 10. Priorities
  const priorities: PriorityItem[] = [];
  if (currentBalance < 100) {
    priorities.push({ id: '1', title: 'Saldo Crítico', message: 'Evite qualquer gasto não essencial até o próximo pagamento.', type: 'urgent' });
  }
  if (totalCommitments > currentBalance) {
    priorities.push({ id: '4', title: 'Comprometimento Alto', message: 'Seus compromissos financeiros já consomem todo seu saldo disponível.', type: 'urgent' });
  }
  if (daysRemaining > 10 && availableForDaily < 500) {
    priorities.push({ id: '2', title: 'Pressão no Ciclo', message: 'Ainda faltam muitos dias e o saldo livre está baixo.', type: 'warning' });
  }
  if (todaySpent > dailyLimit && dailyLimit > 0) {
    priorities.push({ id: '3', title: 'Meta Diária', message: 'Você já ultrapassou o limite de hoje.', type: 'info' });
  }

  return {
    currentBalance: currentBalance,
    projectedBalance: projectedBalance,
    dailyLimit,
    daysRemaining,
    nextPaydayDate: format(nextPayday, 'yyyy-MM-dd'),
    nextPaydayLabel: format(nextPayday, 'dd/MM'),
    todaySpent,
    totalSpentInCycle,
    averageDailySpent,
    dominantCategory,
    spendingTrend: averageDailySpent > dailyLimit ? 'up' : 'down',
    dailyInsight,
    insights,
    smartAlert,
    rhythm,
    topCategories: sortedCategories.slice(0, 5),
    priorities
  };
}

function calculateRhythm(transactions: Transaction[], now: Date): FinanceSummary['rhythm'] {
  const validDates = transactions
    .map(t => parseCalendarDate(t.date))
    .filter((d): d is Date => d !== null);

  // Sem extrato: usa a data atual.
  // Com extrato de período anterior: ancora no último dia real importado.
  const latestDate = validDates.length > 0
    ? new Date(Math.max(...validDates.map(d => d.getTime())))
    : now;

  // Day rhythm (últimos 30 dias da referência)
  const dayStart = startOfDay(subDays(latestDate, 29));
  const dayEnd = endOfDay(latestDate);
  const days = eachDayOfInterval({ start: dayStart, end: dayEnd });
  const dayLabels = days.map(d => format(d, 'dd/MM'));
  const dayData = days.map(d =>
    transactions
      .filter(t => {
        const td = parseCalendarDate(t.date);
        return !!td && isOutflow(t) && isSameDay(td, d);
      })
      .reduce((sum, t) => sum + Math.abs(toSignedAmount(t)), 0)
  );

  // Week rhythm (últimas 8 semanas da referência)
  const weekStart = startOfWeek(subWeeks(latestDate, 7), { locale: ptBR });
  const weekEnd = endOfWeek(latestDate, { locale: ptBR });
  const weeks = eachWeekOfInterval({ start: weekStart, end: weekEnd }, { locale: ptBR });
  const weekLabels = weeks.map(w => {
    const weekEndDate = endOfWeek(w, { locale: ptBR });
    return `${format(w, 'dd/MM')} - ${format(weekEndDate, 'dd/MM')}`;
  });
  const weekData = weeks.map(w =>
    transactions
      .filter(t => {
        const td = parseCalendarDate(t.date);
        return !!td && isOutflow(t) && isSameWeek(td, w, { locale: ptBR });
      })
      .reduce((sum, t) => sum + Math.abs(toSignedAmount(t)), 0)
  );

  // Month rhythm (últimos 6 meses da referência)
  const monthAnchors = Array.from({ length: 6 }, (_, idx) => startOfMonth(subMonths(latestDate, 5 - idx)));
  const monthLabels = monthAnchors.map(m => format(m, 'MMM/yy', { locale: ptBR }));
  const monthData = monthAnchors.map(m =>
    transactions
      .filter(t => {
        const td = parseCalendarDate(t.date);
        return !!td && isOutflow(t) && isSameMonth(td, m);
      })
      .reduce((sum, t) => sum + Math.abs(toSignedAmount(t)), 0)
  );

  return {
    day: { labels: dayLabels, data: dayData },
    week: { labels: weekLabels, data: weekData },
    month: { labels: monthLabels, data: monthData }
  };
}
function getNextPayday(settings: UserSettings, now: Date): Date {
  const today = startOfDay(now);
  const normalizePayday = (rawDay: number | undefined, fallbackDay: number): number => {
    const parsed = Number(rawDay);
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.min(Math.max(1, Math.round(parsed)), 31);
    }
    return Math.min(Math.max(1, Math.round(fallbackDay || 1)), 31);
  };

  const buildNextPayday = (paydayDay: number): Date => {
    const normalizedDay = Math.min(Math.max(1, paydayDay || 1), 31);

    const thisMonthDay = Math.min(normalizedDay, getDaysInMonth(today));
    let candidate = startOfDay(setDate(today, thisMonthDay));

    // Se o dia já passou, agenda no próximo mês.
    // Se for hoje, mantém hoje para exibir 0 dias restantes.
    if (isAfter(today, candidate)) {
      const nextMonth = addMonths(today, 1);
      const nextMonthDay = Math.min(normalizedDay, getDaysInMonth(nextMonth));
      candidate = startOfDay(setDate(nextMonth, nextMonthDay));
    }

    return candidate;
  };

  const firstPayday = normalizePayday(settings.payday_1, 5);
  const paydayDate = buildNextPayday(firstPayday);

  // Respeita o ciclo configurado na Base Financeira.
  // Se o ciclo for quinzenal e o segundo dia estiver vazio/inválido,
  // usa um dia inferido (+15 dias) para não quebrar o cálculo.
  if (settings.payday_cycle === 'biweekly') {
    const inferredSecondPayday = firstPayday >= 16 ? firstPayday - 15 : firstPayday + 15;
    const secondPayday = normalizePayday(settings.payday_2, inferredSecondPayday);
    const payday2Date = buildNextPayday(secondPayday);

    // Retorna sempre a data mais próxima entre os dois pagamentos.
    return isAfter(paydayDate, payday2Date) ? payday2Date : paydayDate;
  }

  return paydayDate;
}


