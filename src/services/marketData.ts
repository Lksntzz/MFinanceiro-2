import { supabase } from '../lib/supabase';

export interface TickerData {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  lastUpdate: string;
}

/**
 * O aplicativo não possui uma fonte externa de cotações configurada.
 * Para não exibir preços inventados, nenhuma cotação é fabricada localmente.
 */
export async function getRealTimeQuotes(
  _symbols: string[],
): Promise<TickerData[]> {
  return [];
}

/**
 * Recalcula o patrimônio de cada ativo usando somente dados informados pelo
 * usuário: quantidade x preço atual. Ativos sem preço atual permanecem iguais.
 */
export async function syncInvestmentsWithMarket(
  userId: string,
): Promise<boolean> {
  try {
    const { data: investments, error } = await supabase
      .from('mf_investments')
      .select('id,amount,quantity,current_price')
      .eq('user_id', userId);

    if (error) throw error;
    if (!investments || investments.length === 0) return true;

    const updates = investments
      .map((investment: any) => {
        const quantity = Number(investment.quantity || 0);
        const currentPrice = Number(investment.current_price || 0);
        const currentAmount = Number(investment.amount || 0);

        if (
          !Number.isFinite(quantity) ||
          !Number.isFinite(currentPrice) ||
          quantity <= 0 ||
          currentPrice <= 0
        ) {
          return null;
        }

        const calculatedAmount = Number((quantity * currentPrice).toFixed(2));
        if (Math.abs(calculatedAmount - currentAmount) < 0.01) return null;

        return supabase
          .from('mf_investments')
          .update({ amount: calculatedAmount })
          .eq('id', investment.id)
          .eq('user_id', userId);
      })
      .filter(Boolean) as Array<PromiseLike<{ error: any }>>;

    const results = await Promise.all(updates);
    const failed = results.find((result) => result.error);
    if (failed?.error) throw failed.error;

    return true;
  } catch (error) {
    console.error('Falha ao recalcular investimentos:', error);
    return false;
  }
}
