
import { BankAdapter, FileFormat } from '../types';
import { NormalizedTransaction } from '../../../types';
import { normalizeAmount, suggestCategory, generateDuplicateKey } from '../utils';

export const nubankAdapter: BankAdapter = {
  id: 'nubank',
  name: 'Nubank',
  supportedFormats: ['csv', 'ofx'],
  
  canHandle: (content: string, format: FileFormat) => {
    if (format === 'csv') {
      return content.includes('Data,Valor,Identificador,Descrição') || content.includes('date,amount,id,description');
    }
    if (format === 'ofx') {
      return content.includes('<ORG>Nubank') || content.includes('NU PAGAMENTOS');
    }
    return false;
  },

  parse: async (content: any, format: FileFormat): Promise<NormalizedTransaction[]> => {
    if (format === 'csv') {
      // Assuming content is an array of objects from PapaParse
      return content.map((row: any, index: number) => {
        const amount = normalizeAmount(row.Valor || row.amount);
        const description = row.Descrição || row.description || '';
        const dateStr = row.Data || row.date || '';
        
        // Convert DD/MM/YYYY to YYYY-MM-DD if needed
        let date = dateStr;
        if (dateStr.includes('/')) {
          const [d, m, y] = dateStr.split('/');
          date = `${y}-${m}-${d}`;
        }

        const normalized: Partial<NormalizedTransaction> = {
          id: `nu-${index}-${Date.now()}`,
          bankName: 'Nubank',
          sourceFormat: 'csv',
          transactionDate: new Date(date).toISOString(),
          description: description,
          normalizedDescription: description.toUpperCase(),
          amount: Math.abs(amount),
          direction: amount < 0 ? 'expense' : 'income',
          categorySuggested: suggestCategory(description),
          categoryConfidence: 0.8,
          importConfidence: 0.9,
          rawRow: row,
          status: 'ready'
        };

        normalized.duplicateKey = generateDuplicateKey(normalized);
        return normalized as NormalizedTransaction;
      });
    }
    
    if (format === 'ofx') {
      // Simple OFX parsing logic (STMTTRN blocks)
      const transactions: NormalizedTransaction[] = [];
      const regex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/g;
      let match;
      let index = 0;

      while ((match = regex.exec(content)) !== null) {
        const block = match[1];
        const trnType = /<TRNTYPE>(.*)/.exec(block)?.[1];
        const dtPosted = /<DTPOSTED>(.*)/.exec(block)?.[1];
        const trnAmt = /<TRNAMT>(.*)/.exec(block)?.[1];
        const fitId = /<FITID>(.*)/.exec(block)?.[1];
        const memo = /<MEMO>(.*)/.exec(block)?.[1] || /<NAME>(.*)/.exec(block)?.[1] || '';

        if (dtPosted && trnAmt) {
          const year = dtPosted.substring(0, 4);
          const month = dtPosted.substring(4, 6);
          const day = dtPosted.substring(6, 8);
          const date = `${year}-${month}-${day}`;
          
          const amount = parseFloat(trnAmt);

          const normalized: Partial<NormalizedTransaction> = {
            id: fitId || `nu-ofx-${index}`,
            bankName: 'Nubank',
            sourceFormat: 'ofx',
            externalReference: fitId,
            transactionDate: new Date(date).toISOString(),
            description: memo,
            normalizedDescription: memo.toUpperCase(),
            amount: Math.abs(amount),
            direction: amount < 0 ? 'expense' : 'income',
            categorySuggested: suggestCategory(memo),
            categoryConfidence: 0.9,
            importConfidence: 1.0,
            rawRow: block,
            status: 'ready'
          };

          normalized.duplicateKey = generateDuplicateKey(normalized);
          transactions.push(normalized as NormalizedTransaction);
        }
        index++;
      }
      return transactions;
    }

    return [];
  }
};
