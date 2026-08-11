import type { ImportedTransaction } from '../../types';
import {
  findBestHeader,
  generateTransactionId,
  inferColumnByRatio,
  inferStatementCategory,
  looksLikeAmount,
  looksLikeDate,
  looksLikeText,
  normalizeStatementHeader,
  parseDelimitedLine,
  parseStatementAmount,
  parseStatementDate,
  pickStatementAmount,
  pickStatementDescription,
} from './statement-parser-utils';

export function parseCsvTransactions(content: string, bank: string): ImportedTransaction[] {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.replace(/\uFEFF/g, '').trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const dataSource = lines[0].toLowerCase().startsWith('sep=') ? lines.slice(1) : lines;
  if (dataSource.length < 2) return [];

  const header = findBestHeader(dataSource);
  const hasHeader = header.score >= 2;
  const rawHeaders = hasHeader ? parseDelimitedLine(dataSource[header.index], header.delimiter) : [];
  const headers = rawHeaders.map(normalizeStatementHeader);
  const findKey = (...keys: string[]) =>
    headers.findIndex((value) => keys.some((key) => value.includes(normalizeStatementHeader(key))));

  const dateIndex = findKey('data', 'date', 'dtposted');
  const descriptionIndex = findKey(
    'descricao', 'historico', 'memo', 'description', 'desc', 'transactiondescription',
    'transactiondetails', 'narrative', 'details', 'merchant',
  );
  const amountIndex = findKey(
    'valor', 'amount', 'valorrs', 'transactionamount', 'transactionnetamount',
    'netamount', 'paidamount', 'receivedamount',
  );
  const runningBalanceIndex = findKey(
    'partialbalance', 'balance', 'finalbalance', 'currentbalance', 'saldo', 'saldoparcial',
  );
  const debitIndex = findKey('debito', 'debit', 'saidas');
  const creditIndex = findKey('credito', 'credit', 'entradas');
  const categoryIndex = findKey('categoria', 'category', 'transactioncategory');
  const typeIndex = findKey('type', 'tipo', 'natureza', 'transactiontype');
  const dataLines = dataSource.slice(hasHeader ? header.index + 1 : 0);

  const releaseDateIndex = headers.indexOf('releasedate');
  const transactionTypeIndex = headers.indexOf('transactiontype');
  const referenceIdIndex = headers.indexOf('referenceid');
  const transactionNetAmountIndex = headers.indexOf('transactionnetamount') >= 0
    ? headers.indexOf('transactionnetamount')
    : headers.indexOf('transactionamount');
  const partialBalanceIndex = headers.indexOf('partialbalance');
  const knownFormat = releaseDateIndex >= 0 && transactionTypeIndex >= 0 && transactionNetAmountIndex >= 0;

  if (knownFormat) {
    return dataLines.map((line, index) => {
      const columns = parseDelimitedLine(line, header.delimiter);
      const description = (columns[transactionTypeIndex] || '').trim() || 'Sem descricao';
      const sourceId = referenceIdIndex >= 0 ? (columns[referenceIdIndex] || '').trim() : '';
      const signedAmount = parseStatementAmount(columns[transactionNetAmountIndex]);
      const amount = Math.abs(signedAmount);
      const type: ImportedTransaction['type'] = signedAmount >= 0 ? 'income' : 'expense';
      const rawBalance = partialBalanceIndex >= 0 ? parseStatementAmount(columns[partialBalanceIndex]) : Number.NaN;
      const status: ImportedTransaction['status'] = description !== 'Sem descricao' && amount > 0 ? 'ready' : 'error';
      return {
        id: generateTransactionId('csv-statement', index),
        date: parseStatementDate(columns[releaseDateIndex]),
        description,
        amount,
        source_id: sourceId || undefined,
        type,
        category: inferStatementCategory(description, type),
        status,
        confidence: status === 'ready' ? 0.98 : 0.35,
        original_description: description,
        bank_source: bank === 'auto' ? 'Importado CSV' : bank,
        running_balance: Number.isFinite(rawBalance) ? rawBalance : undefined,
      };
    });
  }

  const sampleRows = dataLines.slice(0, 20).map((line) => parseDelimitedLine(line, header.delimiter));
  const inferredDateIndex = dateIndex >= 0 ? dateIndex : inferColumnByRatio(sampleRows, looksLikeDate);
  const inferredAmountIndex = amountIndex >= 0 ? amountIndex : inferColumnByRatio(sampleRows, looksLikeAmount);
  const inferredDescriptionIndex = descriptionIndex >= 0
    ? descriptionIndex
    : inferColumnByRatio(sampleRows, looksLikeText, 0.35);

  return dataLines.map((line, index) => {
    const columns = parseDelimitedLine(line, header.delimiter);
    const description = pickStatementDescription(columns, inferredDescriptionIndex);
    const signedAmount = pickStatementAmount(columns, inferredAmountIndex, debitIndex, creditIndex);
    const explicitType = typeIndex >= 0 ? normalizeStatementHeader(columns[typeIndex]) : '';
    const type: ImportedTransaction['type'] =
      /(receita|income|credito|entrada|recebido|rendimentos|rendimento|deposito|ganho|bonus)/.test(explicitType)
      || signedAmount > 0 ? 'income' : 'expense';
    const category = ((categoryIndex >= 0 ? columns[categoryIndex] : '') || '').trim()
      || inferStatementCategory(description, type);
    const rawDate = inferredDateIndex >= 0 ? columns[inferredDateIndex] : (looksLikeDate(columns[0]) ? columns[0] : '');
    const amount = Math.abs(signedAmount);
    const status: ImportedTransaction['status'] = description !== 'Sem descricao' && amount > 0 ? 'ready' : 'error';
    const rawBalance = runningBalanceIndex >= 0 ? parseStatementAmount(columns[runningBalanceIndex]) : Number.NaN;
    const normalizedDescription = normalizeStatementHeader(description);
    const headerRow = ['transaction', 'description', 'amount', 'categoria']
      .some((keyword) => normalizedDescription.includes(keyword));

    return {
      id: generateTransactionId('csv', index),
      date: parseStatementDate(rawDate),
      description,
      amount,
      type,
      category,
      status: headerRow ? 'error' : status,
      confidence: headerRow ? 0.1 : status === 'ready' ? 0.9 : 0.35,
      original_description: description,
      bank_source: bank === 'auto' ? 'Importado CSV' : bank,
      running_balance: Number.isFinite(rawBalance) ? rawBalance : undefined,
    };
  });
}
