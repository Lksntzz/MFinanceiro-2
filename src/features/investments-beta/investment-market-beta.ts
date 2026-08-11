import type { InvestmentAssetClass, InvestmentBetaQuote } from './investment-beta-domain';
import { normalizeSymbol } from './investment-beta-domain';

const BRAPI_BASE = 'https://brapi.dev';

function finite(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export async function fetchBetaMarketQuote(symbolInput: string, assetClass: InvestmentAssetClass): Promise<InvestmentBetaQuote> {
  const symbol = normalizeSymbol(symbolInput);
  if (!symbol) throw new Error('Informe um ticker ou símbolo.');

  if (assetClass === 'crypto') {
    const response = await fetch(`${BRAPI_BASE}/api/v2/crypto?coin=${encodeURIComponent(symbol)}&currency=BRL`);
    if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'A fonte completa de mercado ainda não está conectada neste beta.' : 'Não foi possível consultar este criptoativo agora.');
    const payload = await response.json();
    const item = payload?.coins?.[0] || payload?.results?.[0] || payload?.data?.[0] || payload?.data;
    if (!item) throw new Error('Ativo não encontrado na fonte de mercado.');
    const price = finite(item.regularMarketPrice ?? item.price ?? item.marketPrice);
    const change = finite(item.regularMarketChange ?? item.change ?? item.priceChange24h);
    const changePercent = finite(item.regularMarketChangePercent ?? item.changePercent ?? item.priceChangePercent24h);
    if (price <= 0) throw new Error('A fonte não retornou uma cotação válida para este ativo.');
    return {
      symbol,
      name: item.coinName || item.name || symbol,
      currency: item.currency || 'BRL',
      price,
      change,
      changePercent,
      updatedAt: item.updatedAt || item.regularMarketTime || payload?.requestedAt,
      source: 'brapi-sandbox',
    };
  }

  if (assetClass === 'fixed_income' || assetClass === 'international' || assetClass === 'other') {
    throw new Error('Esta classe ainda não está conectada à fonte de mercado no beta inicial.');
  }

  const response = await fetch(`${BRAPI_BASE}/api/v2/stocks/quote?symbols=${encodeURIComponent(symbol)}`);
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'A fonte completa de mercado ainda não está conectada neste beta.' : 'Não foi possível consultar este ativo agora.');
  const payload = await response.json();
  const result = payload?.results?.[0];
  const item = result?.data || result;
  if (!item) throw new Error('Ativo não encontrado na fonte de mercado.');
  const price = finite(item.regularMarketPrice ?? item.price);
  if (price <= 0) throw new Error('A fonte não retornou uma cotação válida para este ativo.');
  return {
    symbol: result?.symbol || symbol,
    name: item.shortName || item.longName || symbol,
    currency: item.currency || 'BRL',
    price,
    change: finite(item.regularMarketChange ?? item.change),
    changePercent: finite(item.regularMarketChangePercent ?? item.changePercent),
    updatedAt: item.regularMarketTime || payload?.requestedAt,
    source: 'brapi-sandbox',
  };
}
