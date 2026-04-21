/**
 * Utilitário para formatar valores sensíveis baseado na configuração de privacidade.
 */
export function formatCurrency(value: number, isPrivate: boolean = false): string {
  if (isPrivate) return '••••••';
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatPercent(value: number, isPrivate: boolean = false): string {
  if (isPrivate) return '•••%';
  return `${value.toFixed(2)}%`;
}

export function formatCompact(value: number, isPrivate: boolean = false): string {
  if (isPrivate) return '•••';
  return value.toLocaleString('pt-BR');
}
