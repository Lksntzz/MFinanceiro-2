import assert from 'node:assert/strict';

import { parseFinancialCode } from '../src/mobile/lib/financial-code-parser';
import { detectRecurringExpenses, type RecurrenceHistoryItem } from '../src/mobile/lib/recurrence-detector';
import { parseVoiceEntry } from '../src/mobile/lib/voice-entry-parser';
import type { FinancialAccount, TransactionCategory } from '../src/types';

function tlv(id: string, value: string) {
  return `${id}${String(value.length).padStart(2, '0')}${value}`;
}

function category(id: string, name: string, categoryType: 'expense' | 'income' | 'both'): TransactionCategory {
  return {
    id,
    user_id: 'user-test',
    name,
    category_type: categoryType,
    color: null,
    icon: null,
    is_active: true,
    sort_order: 0,
    created_at: '',
    updated_at: '',
  } as TransactionCategory;
}

function account(id: string, name: string, institutionName: string, isDefault = false): FinancialAccount {
  return {
    id,
    user_id: 'user-test',
    name,
    institution_name: institutionName,
    is_default: isDefault,
    is_active: true,
    opening_balance: 0,
    current_balance: 0,
    transaction_count: 0,
  } as FinancialAccount;
}

function history(
  id: string,
  date: string,
  description: string,
  amount: number,
  categoryName = 'Moradia',
): RecurrenceHistoryItem {
  return {
    id,
    date,
    description,
    amount,
    category: categoryName,
    type: 'expense',
    status: 'paid',
    affects_balance: true,
  };
}

const categories = [
  category('fuel', 'Combustível', 'expense'),
  category('food', 'Alimentação', 'expense'),
  category('market', 'Supermercado', 'expense'),
  category('housing', 'Moradia', 'expense'),
  category('salary', 'Salário', 'income'),
];
const accounts = [
  account('checking', 'Conta principal', 'Nubank', true),
  account('backup', 'Reserva', 'Itaú'),
];

// MF Voice: expense, amount, semantic category and account detection.
{
  const parsed = parseVoiceEntry('Gastei 48 reais de gasolina no Nubank', categories, accounts);
  assert.equal(parsed.type, 'expense');
  assert.equal(parsed.amount, 48);
  assert.equal(parsed.categoryId, 'fuel');
  assert.equal(parsed.accountId, 'checking');
  assert.equal(parsed.confidence, 'high');
}

// MF Voice: income should not reuse an expense category.
{
  const parsed = parseVoiceEntry('Recebi 3.500,50 reais de salário', categories, accounts);
  assert.equal(parsed.type, 'income');
  assert.equal(parsed.amount, 3500.5);
  assert.equal(parsed.categoryId, 'salary');
}

// Pix BR Code: parser should recover merchant and amount from structured fields.
{
  const pixAccount = tlv('00', 'BR.GOV.BCB.PIX') + tlv('01', 'teste@pix.com');
  const payload = [
    tlv('00', '01'),
    tlv('26', pixAccount),
    tlv('52', '0000'),
    tlv('53', '986'),
    tlv('54', '123.45'),
    tlv('58', 'BR'),
    tlv('59', 'LOJA TESTE'),
    tlv('60', 'SAO PAULO'),
    tlv('62', tlv('05', 'ABC123')),
  ].join('');
  const parsed = parseFinancialCode(payload);
  assert.equal(parsed.kind, 'pix');
  assert.equal(parsed.draft.amount, 123.45);
  assert.equal(parsed.draft.merchant, 'LOJA TESTE');
  assert.equal(parsed.txid, 'ABC123');
}

// Bank barcode: amount comes from positions 10-19 and factor from positions 6-9.
{
  const barcode = `0019${'1000'}${'0000012345'}${'0'.repeat(25)}`;
  assert.equal(barcode.length, 44);
  const parsed = parseFinancialCode(barcode);
  assert.equal(parsed.kind, 'boleto');
  assert.equal(parsed.draft.amount, 123.45);
  assert.equal(parsed.draft.dueDate, '2025-02-22');
}

// Collection/utility code should not be mistaken for a bank boleto.
{
  const parsed = parseFinancialCode(`8${'0'.repeat(43)}`);
  assert.equal(parsed.kind, 'collection');
}

// Variable utility bill: monthly rhythm matters more than identical amount.
{
  const rows: RecurrenceHistoryItem[] = [
    history('e1', '2026-02-10', 'ENEL ENERGIA', 247.83),
    history('e2', '2026-03-11', 'ENEL ENERGIA', 282.14),
    history('e3', '2026-04-09', 'ENEL ENERGIA', 261.22),
    history('e4', '2026-05-10', 'ENEL ENERGIA', 299.9),
  ];
  const suggestions = detectRecurringExpenses(rows, []);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].distinctMonths, 4);
  assert.equal(suggestions[0].amountBehavior, 'variable');
  assert.ok(suggestions[0].dueDay >= 9 && suggestions[0].dueDay <= 11);
}

// Frequent merchant: appearing every month is not enough if it occurs many times per month.
{
  const rows: RecurrenceHistoryItem[] = [];
  let counter = 0;
  for (const month of ['02', '03', '04', '05']) {
    for (const day of ['03', '10', '17']) {
      counter += 1;
      rows.push(history(`m${counter}`, `2026-${month}-${day}`, 'SUPERMERCADO CENTRAL', 80 + counter, 'Supermercado'));
    }
  }
  assert.equal(detectRecurringExpenses(rows, []).length, 0);
}

// Already tracked recurrence should not be suggested again.
{
  const rows = [
    history('i1', '2026-02-15', 'INTERNET FIBRA', 119.9),
    history('i2', '2026-03-15', 'INTERNET FIBRA', 119.9),
    history('i3', '2026-04-15', 'INTERNET FIBRA', 119.9),
  ];
  assert.equal(detectRecurringExpenses(rows, [{ name: 'Internet Fibra' }]).length, 0);
}

console.log('Mobile logic checks passed: voice, financial codes and recurrence detection.');
