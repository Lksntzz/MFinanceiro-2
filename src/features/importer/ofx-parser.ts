import type { ImportedTransaction } from '../../types';
import {
  generateTransactionId,
  inferStatementCategory,
  normalizeStatementHeader,
  parseStatementAmount,
  parseStatementDate,
} from './statement-parser-utils';

export function parseOfxTransactions(content: string, bank: string): ImportedTransaction[] {
  const blocks = content.match(/<STMTTRN>[\s\S]*?<\/STMTTRN>/gi) || [];
  const ledgerBalanceMatch = content.match(/<LEDGERBAL>[\s\S]*?<BALAMT>([\d.,-]+)/i);
  const finalLedgerBalance = ledgerBalanceMatch ? parseStatementAmount(ledgerBalanceMatch[1]) : undefined;

  return blocks.map((block, index) => {
    const fitId = (block.match(/<FITID>(.*)/i)?.[1] || '').trim();
    const transactionType = normalizeStatementHeader((block.match(/<TRNTYPE>(.*)/i)?.[1] || '').trim());
    const postedAt = (block.match(/<DTPOSTED>(.*)/i)?.[1] || '').trim();
    const memo = (block.match(/<MEMO>(.*)/i)?.[1] || '').trim();
    const name = (block.match(/<NAME>(.*)/i)?.[1] || '').trim();
    const signedAmount = parseStatementAmount((block.match(/<TRNAMT>(.*)/i)?.[1] || '').trim());
    const description = memo || name || 'Sem descricao';
    const rawDate = postedAt ? `${postedAt.slice(6, 8)}/${postedAt.slice(4, 6)}/${postedAt.slice(0, 4)}` : '';
    const type: ImportedTransaction['type'] = /(credit|dep|income)/.test(transactionType) || signedAmount > 0
      ? 'income'
      : 'expense';
    const status: ImportedTransaction['status'] = signedAmount !== 0 ? 'ready' : 'error';

    return {
      id: fitId || generateTransactionId('ofx', index),
      date: parseStatementDate(rawDate),
      description,
      amount: Math.abs(signedAmount),
      type,
      category: inferStatementCategory(description, type),
      status,
      confidence: signedAmount !== 0 ? 0.96 : 0.45,
      original_description: description,
      bank_source: bank === 'auto' ? 'Importado OFX' : bank,
      running_balance: index === blocks.length - 1 ? finalLedgerBalance : undefined,
    };
  });
}
