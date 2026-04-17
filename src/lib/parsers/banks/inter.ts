
import { BankAdapter, FileFormat } from '../types';
import { NormalizedTransaction } from '../../../types';
import { normalizeAmount, suggestCategory, generateDuplicateKey } from '../utils';

export const interAdapter: BankAdapter = {
  id: 'inter',
  name: 'Banco Inter',
  supportedFormats: ['csv', 'ofx', 'xlsx'],
  
  canHandle: (content: string, format: FileFormat) => {
    return content.includes('BANCO INTER') || content.includes('Data Lançamento;Descrição;Valor');
  },

  parse: async (content: any, format: FileFormat): Promise<NormalizedTransaction[]> => {
    if (format === 'csv' || format === 'xlsx') {
      const rows = Array.isArray(content) ? content : [];
      return rows.map((row: any, index: number) => {
        const amount = normalizeAmount(row.Valor || row['Valor (R$)'] || 0);
        const description = row.Descrição || row.Historico || '';
        const dateStr = row.Data || row['Data Lançamento'] || '';
        
        let date = dateStr;
        if (dateStr.includes('/')) {
          const [d, m, y] = dateStr.split('/');
          date = `${y}-${m}-${d}`;
        }

        const normalized: Partial<NormalizedTransaction> = {
          id: `inter-${index}-${Date.now()}`,
          bankName: 'Banco Inter',
          sourceFormat: format,
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
    return [];
  }
};
