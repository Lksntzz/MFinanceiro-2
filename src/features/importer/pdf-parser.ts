import type { ImportedTransaction } from '../../types';

export async function parsePdfTransactions(
  file: File,
  selectedBank: string,
  options?: { accountHolderName?: string; internalAccountAliases?: string[] },
): Promise<ImportedTransaction[]> {
  const { parsePdfStatementWithDebug } = await import('../../lib/import-parsers/pdf/parse-pdf-statement');
  const { transactions } = await parsePdfStatementWithDebug(file, selectedBank, options);
  return transactions;
}
