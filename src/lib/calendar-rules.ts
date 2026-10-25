/** Quantos meses `target` está à frente de `reference` (negativo = passado). */
export function monthOffset(reference: Date, target: Date): number {
  return (
    (target.getFullYear() - reference.getFullYear()) * 12 +
    (target.getMonth() - reference.getMonth())
  );
}

/**
 * Uma parcela só aparece nos meses em que ainda restam parcelas:
 * parcela atual 2 de 4 -> meses 0, 1 e 2 a partir de agora.
 */
export function installmentVisibleInMonth(
  current: number,
  total: number,
  offset: number,
): boolean {
  const safeCurrent = Math.max(1, Number(current) || 1);
  const safeTotal = Math.max(1, Number(total) || 1);
  return (
    safeCurrent <= safeTotal &&
    offset >= 0 &&
    offset < safeTotal - safeCurrent + 1
  );
}
