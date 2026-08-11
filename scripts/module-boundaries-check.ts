import assert from 'node:assert/strict';

import {
  buildStatementImportCommand,
  calculateDashboardBalance,
  normalizeDashboardAccounts,
  normalizeDashboardLedgerPage,
  normalizeStatementImportResult,
} from '../src/features/dashboard/dashboard-domain';
import {
  appendDismissedAlert,
  buildDashboardNotifications,
  sanitizeDismissedAlerts,
  sortTransactionsByDateDesc,
} from '../src/features/dashboard/dashboard-notifications';
import { parseCsvTransactions } from '../src/features/importer/csv-parser';
import {
  analyzeDelimitedContent,
  detectFileFormat,
  inferEmptyResultReason,
  normalizeImportedTransactions,
} from '../src/features/importer/import-file';
import {
  calculateImportBalanceValidation,
  removeImportedTransaction,
  toggleImportedTransaction,
  updateImportedTransaction,
} from '../src/features/importer/import-review';
import { parseOfxTransactions } from '../src/features/importer/ofx-parser';
import { parseStatementAmount, parseStatementDate } from '../src/features/importer/statement-parser-utils';
import {
  buildPayrollSaveCommand,
  categoryFromDescription,
  derivePayrollSummary,
  emptyForm,
  legacyItems,
  normalizePayroll,
  normalizeSettings,
  sanitizeItems,
} from '../src/features/payroll/payroll-domain';
import type { PayrollItem } from '../src/lib/payroll-pdf-parser';
import type { CreditCard, FinancialAccount, FixedBill, ImportedTransaction, Transaction } from '../src/types';

function imported(patch: Partial<ImportedTransaction> = {}): ImportedTransaction {
  return {
    id: 'import-1',
    date: '2026-08-10',
    description: 'Compra teste',
    amount: 100,
    type: 'expense',
    category: 'Geral',
    status: 'ready',
    confidence: 0.9,
    original_description: 'Compra teste',
    ...patch,
  };
}

function payrollItem(patch: Partial<PayrollItem> = {}): PayrollItem {
  return {
    id: 'payroll-1',
    description: 'INSS',
    kind: 'deduction',
    category: 'inss',
    amount: 500,
    percentage: 0,
    source: 'manual',
    confidence: 1,
    ...patch,
  };
}

// Dashboard: normalize data returned by RPCs before React consumes it.
{
  const page = normalizeDashboardLedgerPage({
    items: [
      { id: '1', user_id: 'u', data: '2026-08-10', valor: '75.50', tipo: 'entrada', descricao: 'Pix' },
      { id: 'invalid' },
    ],
    has_more: true,
    total_count: '9',
    next_cursor: { date: '2026-08-10', created_at: '2026-08-10T12:00:00Z', id: '1' },
  });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].amount, 75.5);
  assert.equal(page.items[0].type, 'income');
  assert.equal(page.total_count, 9);
  assert.equal(page.has_more, true);

  const accounts = normalizeDashboardAccounts([
    { id: 'a', current_balance: '120.25', opening_balance: '100', transaction_count: '2' },
    { id: 'b', current_balance: '-20.25' },
  ]);
  assert.equal(calculateDashboardBalance(accounts), 100);
  assert.equal(calculateDashboardBalance([], 55), 55);
}

// Dashboard: import payload keeps only valid selections and normalizes the RPC summary.
{
  const command = buildStatementImportCommand([
    imported({ source_id: 'bank-1', bank_source: 'Banco Teste' }),
    imported({ id: 'bad', description: 'Sem descricao', status: 'error', amount: 0 }),
  ], 980, { accountId: 'account-1', fileName: 'extrato.csv' });
  assert.equal(command.balanceMode, 'statement');
  assert.equal(command.params.p_entries[0].external_id, 'statement:Banco Teste:bank-1');
  assert.equal(command.params.p_entries[1].selected, false);
  assert.equal(command.params.p_statement_balance, 980);
  assert.throws(
    () => buildStatementImportCommand([imported({ status: 'error', amount: 0 })], undefined, { accountId: 'a' }),
    /Nenhum lançamento válido/,
  );

  const result = normalizeStatementImportResult({
    batch_id: 'batch', inserted_count: '2', duplicate_count: null, rejected_count: '1',
    ignored_count: 0, net_new: '-10', balance_before: '100', balance_after: '90', balance_mode: 'keep',
  });
  assert.equal(result.inserted_count, 2);
  assert.equal(result.rejected_count, 1);
  assert.equal(result.balance_after, 90);
}

// Dashboard: notification rules and local dismissed-alert retention are deterministic.
{
  const bill = { id: 'bill', name: 'Internet', amount: 120, due_day: 10, status: 'pending' } as FixedBill;
  const card = { id: 'card', name: 'Principal', limit: 1000, used: 850, due_day: 15 } as CreditCard;
  const notifications = buildDashboardNotifications({
    fixedBills: [bill],
    cards: [card],
    qualityIssues: [{ id: 'quality', severity: 'medium', title: 'Revisar', description: 'Dados incompletos', actionLabel: 'Abrir', actionPath: '/app' }],
    dismissedIds: ['fixed-bill-2026-08'],
    monthKey: '2026-08',
    preferences: { commitments: true, cards: true, quality: true, release: true },
  });
  assert.deepEqual(notifications.map((item) => item.type), ['card', 'quality']);
  assert.equal(appendDismissedAlert(['a'], 'a').length, 1);
  assert.equal(sanitizeDismissedAlerts([...Array.from({ length: 260 }, (_, index) => `id-${index}`)]).length, 250);

  const transactions = [
    { id: 'old', date: '2026-08-01' },
    { id: 'new', date: '2026-08-11' },
  ] as Transaction[];
  assert.deepEqual(sortTransactionsByDateDesc(transactions).map((item) => item.id), ['new', 'old']);
}

// Importer: file detection, locale-aware parsing and balance reconciliation are UI-independent.
{
  assert.equal(detectFileFormat({ name: 'conta.XLSX', type: '' }).format, 'xlsx');
  assert.equal(detectFileFormat({ name: 'foto.png', type: 'image/png' }).format, 'image');
  assert.equal(detectFileFormat({ name: 'arquivo.zip', type: 'application/zip' }).supported, false);
  assert.equal(parseStatementAmount('R$ 1.234,56'), 1234.56);
  assert.equal(parseStatementAmount('(45,10)'), -45.1);
  assert.equal(parseStatementDate('10/08/2026').slice(0, 10), '2026-08-10');

  const csv = 'Data;Descrição;Valor\n10/08/2026;"Mercado; Central";-123,45';
  const parsed = parseCsvTransactions(csv, 'auto');
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].description, 'Mercado; Central');
  assert.equal(parsed[0].amount, 123.45);
  assert.equal(parsed[0].type, 'expense');
  assert.equal(parsed[0].date.slice(0, 10), '2026-08-10');

  const ofx = '<OFX>\n<BANKTRANLIST>\n<STMTTRN>\n<TRNTYPE>DEBIT\n<DTPOSTED>20260810120000\n<TRNAMT>-50.00\n<FITID>abc\n<MEMO>UBER\n</STMTTRN>\n</BANKTRANLIST>\n<LEDGERBAL><BALAMT>950.00</LEDGERBAL>\n</OFX>';
  const ofxRows = parseOfxTransactions(ofx, 'auto');
  assert.equal(ofxRows[0].id, 'abc');
  assert.equal(ofxRows[0].running_balance, 950);

  const analysis = analyzeDelimitedContent('Data;Descrição;Valor\n10/08/2026;Mercado;-20,00');
  assert.equal(analysis.hasTransactionSignals, true);
  assert.equal(inferEmptyResultReason({ format: 'csv', csvAnalysis: { nonEmptyLines: 1, hasHeaderKeywords: true, hasTransactionSignals: false } }), 'arquivo sem movimentacoes');

  const balancedRows = [
    imported({ id: 'one', date: '2026-08-01', amount: 100, type: 'expense', running_balance: 900 }),
    imported({ id: 'two', date: '2026-08-02', amount: 50, type: 'income', running_balance: 950 }),
  ];
  const balance = calculateImportBalanceValidation(balancedRows);
  assert.equal(balance?.expectedFinal, 950);
  assert.equal(balance?.isClose, true);
  assert.equal(toggleImportedTransaction(balancedRows, 'one')[0].status, 'pending');
  assert.equal(updateImportedTransaction(balancedRows, 'one', { description: '' })[0].status, 'error');
  assert.equal(removeImportedTransaction([imported({ extraction_item_id: 'ocr-1' })], 'import-1').rejectedExtractionItemId, 'ocr-1');
  assert.equal(normalizeImportedTransactions([imported({ amount: -20 })])[0].amount, 20);
}

// Payroll: stored rows, item classification, summary and save payload are testable without Supabase.
{
  assert.equal(categoryFromDescription('Desconto assistência médica'), 'health');
  assert.equal(categoryFromDescription('Empréstimo consignado'), 'loan');
  const settings = normalizeSettings({ user_id: 'u', gross_salary: '5000', payday_cycle: 'biweekly', payday_1_percentage: '60' });
  assert.equal(settings.gross_salary, 5000);
  assert.equal(settings.payday_1_percentage, 60);

  const row = normalizePayroll({
    id: 'row', competence: '2026-08-01', gross_salary: '5000', inss_amount: '500',
    irrf_amount: '200', other_deductions: '100', benefits: '50', payday_cycle: 'biweekly',
  });
  assert.equal(row.inss_amount, 500);
  assert.equal(legacyItems(row, (prefix) => `${prefix}-fixed`).length, 4);

  const sanitized = sanitizeItems(JSON.stringify([
    payrollItem({ id: 'valid', description: 'INSS', amount: 500 }),
    payrollItem({ id: 'noise', description: '123/2026-08', amount: 1 }),
  ]), 5000);
  assert.equal(sanitized.length, 1);
  assert.equal(sanitized[0].percentage, 10);

  const form = { ...emptyForm(settings, '2026-08'), grossSalary: '5000', payday1Percentage: '60', payday2Percentage: '40' };
  const items = [
    payrollItem({ id: 'inss', amount: 500, category: 'inss' }),
    payrollItem({ id: 'irrf', description: 'IRRF', amount: 200, category: 'irrf' }),
    payrollItem({ id: 'other', description: 'Vale transporte', amount: 100, category: 'transport' }),
  ];
  const summary = derivePayrollSummary(form, items);
  assert.equal(summary.totalDeductions, 800);
  assert.equal(summary.actualNet, 4200);
  assert.equal(summary.cycleBase, 4300);
  assert.equal(summary.firstPayment, 2580);
  assert.equal(summary.secondPayment, 1720);

  const command = buildPayrollSaveCommand(form, items, 'holerite.pdf');
  assert.equal(command.params.p_source_kind, 'mixed');
  assert.equal(command.params.p_items.length, 3);
  assert.equal(command.params.p_competence, '2026-08-01');
  assert.throws(
    () => buildPayrollSaveCommand({ ...form, grossSalary: '100' }, [payrollItem({ amount: 200 })], null),
    /descontos não podem superar/,
  );
}

console.log('Module checks passed: Dashboard, Importer and Payroll domains.');
