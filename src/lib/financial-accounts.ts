import type { FinancialAccount } from '../types';

/** Converte as linhas da view mf_account_balances em números confiáveis. */
export function normalizeAccounts(rows: unknown[]): FinancialAccount[] {
  return rows.map((row) => {
    const item = row as Record<string, unknown>;
    return {
      ...item,
      opening_balance: Number(item.opening_balance || 0),
      current_balance: Number(item.current_balance || 0),
      transaction_count: Number(item.transaction_count || 0),
    } as FinancialAccount;
  });
}

/**
 * Saldo total = soma só das contas ATIVAS. A view do banco devolve também as
 * arquivadas (para poderem ser reativadas), então a soma precisa filtrar.
 */
export function sumActiveBalance(
  accounts: Pick<FinancialAccount, 'current_balance' | 'is_active'>[],
): number {
  return accounts.reduce(
    (sum, account) =>
      account.is_active === false
        ? sum
        : sum + Number(account.current_balance || 0),
    0,
  );
}

/** Tipos de conta que representam saldo real (cartão e investimento têm áreas próprias). */
export const REAL_BALANCE_ACCOUNT_TYPES = [
  { value: 'checking', label: 'Conta corrente' },
  { value: 'savings', label: 'Poupança' },
  { value: 'cash', label: 'Carteira / dinheiro' },
  { value: 'other', label: 'Outra' },
] as const;
