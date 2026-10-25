import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFinancialIntelligence,
  maskMoneyText,
} from '../src/lib/financial-intelligence';
import type { FixedBill, Transaction, UserSettings } from '../src/types';

const NOW = new Date(2026, 9, 15, 10, 0, 0); // 15/10/2026

const settings = {
  net_salary_estimated: 4000,
  gross_salary: 5000,
  payday_cycle: 'monthly',
  payday_1: 5,
} as unknown as UserSettings;

function bill(overrides: Partial<FixedBill>): FixedBill {
  return {
    id: 'b1',
    user_id: 'u',
    name: 'Aluguel',
    amount: 1000,
    due_day: 28,
    status: 'pending',
    category: 'Moradia',
    ...overrides,
  } as FixedBill;
}

function run(fixedBills: FixedBill[], extra: object = {}) {
  return buildFinancialIntelligence({
    currentBalance: 5000,
    transactions: [],
    settings: null,
    fixedBills,
    now: NOW,
    ...extra,
  });
}

test('conta fixa já paga no mês não vira saída futura', () => {
  const pending = run([bill({})]);
  const paid = run([
    bill({ status: 'paid', last_paid_month: '2026-10' } as Partial<FixedBill>),
  ]);
  assert.ok(pending.baseCurve.some((p) => p.balance <= 4000));
  assert.equal(paid.baseCurve[30].balance, 5000);
  assert.ok(pending.projections[0].base < paid.projections[0].base);
});

test('conta fixa vencida e não paga entra hoje na projeção', () => {
  const result = run([bill({ due_day: 10 })]);
  assert.equal(result.baseCurve[1].balance, 4000);
});

test('parcela vencida e não paga não some da projeção', () => {
  const result = run([], {
    installments: [
      {
        id: 'i1',
        user_id: 'u',
        description: 'TV',
        total_amount: 1200,
        monthly_amount: 100,
        current_installment: 2,
        total_installments: 3,
        due_day: 10,
      },
    ],
  });
  assert.equal(result.baseCurve[1].balance, 4900);
});

test('sem salário líquido usa o bruto como renda', () => {
  const result = buildFinancialIntelligence({
    currentBalance: 0,
    transactions: [],
    settings: { ...settings, net_salary_estimated: 0 } as UserSettings,
    now: NOW,
  });
  assert.equal(result.monthlyIncome, 5000);
});

test('tendência de gastos não dispara com menos de 60 dias de histórico', () => {
  const tx = (date: string, amount: number) =>
    ({
      id: date + amount,
      date,
      amount,
      type: 'expense',
      status: 'paid',
      description: 'Mercado',
      category: 'Alimentação',
    }) as unknown as Transaction;
  const result = buildFinancialIntelligence({
    currentBalance: 1000,
    transactions: [tx('2026-09-10', 50), tx('2026-10-10', 900)],
    settings,
    now: NOW,
  });
  assert.equal(result.expenseTrendPercent, null);
  assert.ok(!result.alerts.some((a) => a.id === 'expense-acceleration'));
});

test('assinatura cancelada ou inativa não conta', () => {
  const sub = (status: string) => ({
    id: status,
    name: status,
    amount: 50,
    billing_cycle: 'monthly',
    due_day: 20,
    status,
  });
  const result = run([], {
    subscriptions: [sub('active'), sub('cancelled'), sub('inactive')],
  });
  assert.equal(result.subscriptionMonthlyCost, 50);
});

test('modo privacidade esconde valores em reais nos textos', () => {
  const text =
    'Saldo de R$ 3.412,00 e déficit de -R$ 1.000,50 em 30 dias; renda R$ 5.000.';
  const masked = maskMoneyText(text, true);
  assert.ok(!/\d{3}/.test(masked.replace('30 dias', '')));
  assert.ok(masked.includes('••••••'));
  assert.equal(maskMoneyText(text, false), text);
});
