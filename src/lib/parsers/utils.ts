
import { NormalizedTransaction } from '../../types';

export function normalizeAmount(value: any): number {
  if (typeof value === 'number') return value;
  if (!value) return 0;
  
  // Remove currency symbols and thousands separators
  let clean = value.toString().replace(/[R$\s]/g, '');
  
  // Handle Brazilian format: 1.234,56 -> 1234.56
  if (clean.includes(',') && clean.includes('.')) {
    clean = clean.replace(/\./g, '').replace(',', '.');
  } else if (clean.includes(',')) {
    clean = clean.replace(',', '.');
  }
  
  return parseFloat(clean) || 0;
}

export function suggestCategory(description: string): string {
  const desc = description.toLowerCase();
  
  if (desc.includes('uber') || desc.includes('99app') || desc.includes('posto') || desc.includes('combustivel')) return 'Transporte';
  if (desc.includes('ifood') || desc.includes('restaurante') || desc.includes('padaria') || desc.includes('mercado') || desc.includes('supermercado')) return 'Alimentação';
  if (desc.includes('netflix') || desc.includes('spotify') || desc.includes('cinema') || desc.includes('ingresso')) return 'Lazer';
  if (desc.includes('farmacia') || desc.includes('hospital') || desc.includes('medico')) return 'Saúde';
  if (desc.includes('faculdade') || desc.includes('escola') || desc.includes('curso')) return 'Educação';
  if (desc.includes('aluguel') || desc.includes('condominio') || desc.includes('luz') || desc.includes('agua') || desc.includes('internet')) return 'Contas Fixas';
  if (desc.includes('pix recebido') || desc.includes('transferencia recebida')) return 'Transferência';
  
  return 'Geral';
}

export function generateDuplicateKey(t: Partial<NormalizedTransaction>): string {
  const date = t.transactionDate ? new Date(t.transactionDate).toISOString().split('T')[0] : '';
  const amount = t.amount?.toFixed(2) || '0.00';
  const desc = t.normalizedDescription || '';
  return `${date}_${amount}_${desc}`;
}
