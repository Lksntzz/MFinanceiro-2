import { supabase } from '../lib/supabase';

export interface TickerData {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  lastUpdate: string;
}

/**
 * Simula a busca de cotações em tempo real.
 * Em um cenário real, você buscaria de uma API como BravoAPI ou Yahoo Finance.
 */
export async function getRealTimeQuotes(symbols: string[]): Promise<TickerData[]> {
  // Simular latência de rede
  await new Promise(r => setTimeout(r, 500));

  return symbols.map(symbol => {
    // Gerar uma cotação simulada baseada no nome (para ser determinística por símbolo mas parecer real)
    const basePrice = (symbol.length * 10) + (symbol.charCodeAt(0) % 50);
    const variation = (Math.random() - 0.5) * 2; // -1% a +1%
    const currentPrice = basePrice + (basePrice * (variation / 100));
    
    return {
      symbol: symbol.toUpperCase(),
      price: currentPrice,
      change: currentPrice - basePrice,
      changePercent: variation,
      lastUpdate: new Date().toISOString()
    };
  });
}

/**
 * Helper para atualizar os preços atuais no Supabase baseado nas cotações.
 */
export async function syncInvestmentsWithMarket(userId: string) {
  try {
    const { data: investments, error } = await supabase
      .from('mf_investments')
      .select('id, name')
      .eq('user_id', userId);

    if (error) throw error;
    if (!investments || investments.length === 0) return;

    const symbols = investments.map(inv => inv.name.split(' ')[0]); // Tenta pegar o Ticker (ex: PETR4)
    const quotes = await getRealTimeQuotes(symbols);

    for (const inv of investments) {
      const ticker = inv.name.split(' ')[0];
      const quote = quotes.find(q => q.symbol === ticker.toUpperCase());
      
      if (quote) {
        await supabase
          .from('mf_investments')
          .update({ current_price: quote.price })
          .eq('id', inv.id);
      }
    }

    return true;
  } catch (err) {
    console.error('Error syncing investments:', err);
    return false;
  }
}
