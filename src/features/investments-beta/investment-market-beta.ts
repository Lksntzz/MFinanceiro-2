import { supabase } from '../../lib/supabase';
import type {
  InvestmentAssetClass,
  InvestmentBetaIncomeEvent,
  InvestmentBetaMarketSource,
  InvestmentBetaQuote,
} from './investment-beta-domain';
import { normalizeSymbol } from './investment-beta-domain';

const BRAPI_BASE = 'https://brapi.dev';

function finite(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

async function invokeBetaMarketProxy(action: 'quote' | 'income', symbol: string, assetClass: InvestmentAssetClass) {
  try {
    const { data, error } = await supabase.functions.invoke('investment-market-beta', {
      body: { action, symbol, assetClass },
    });
    if (error || !data?.payload) return null;
    return data.payload;
  } catch {
    return null;
  }
}

async function fetchPublicSandbox(url: string, errorMessage: string) {
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('A fonte completa de mercado ainda não está conectada neste beta.');
    }
    throw new Error(String(payload?.message || errorMessage));
  }
  return payload;
}

function stockQuoteFromPayload(payload: any, symbol: string, source: InvestmentBetaMarketSource): InvestmentBetaQuote {
  const result = payload?.results?.[0];
  const item = result?.data || result;
  if (!item) throw new Error('Ativo não encontrado na fonte de mercado.');
  const price = finite(item.regularMarketPrice ?? item.price);
  if (price <= 0) throw new Error('A fonte não retornou uma cotação válida para este ativo.');
  return {
    symbol: normalizeSymbol(result?.symbol || item.symbol || symbol),
    name: item.shortName || item.longName || symbol,
    currency: item.currency || 'BRL',
    price,
    change: finite(item.regularMarketChange ?? item.change),
    changePercent: finite(item.regularMarketChangePercent ?? item.changePercent),
    updatedAt: item.regularMarketTime || payload?.requestedAt,
    source,
  };
}

function cryptoQuoteFromPayload(payload: any, symbol: string, source: InvestmentBetaMarketSource): InvestmentBetaQuote {
  const item = payload?.coins?.[0] || payload?.results?.[0] || payload?.data?.[0] || payload?.data;
  if (!item) throw new Error('Ativo não encontrado na fonte de mercado.');
  const price = finite(item.regularMarketPrice ?? item.price ?? item.marketPrice);
  if (price <= 0) throw new Error('A fonte não retornou uma cotação válida para este ativo.');
  return {
    symbol: normalizeSymbol(item.coin || item.symbol || symbol),
    name: item.coinName || item.name || symbol,
    currency: item.currency || 'BRL',
    price,
    change: finite(item.regularMarketChange ?? item.change ?? item.priceChange24h),
    changePercent: finite(item.regularMarketChangePercent ?? item.changePercent ?? item.priceChangePercent24h),
    updatedAt: item.regularMarketTime || item.updatedAt || payload?.requestedAt,
    source,
  };
}

export async function fetchBetaMarketQuote(symbolInput: string, assetClass: InvestmentAssetClass): Promise<InvestmentBetaQuote> {
  const symbol = normalizeSymbol(symbolInput);
  if (!symbol) throw new Error('Informe um ticker ou símbolo.');
  if (assetClass === 'fixed_income' || assetClass === 'international' || assetClass === 'other') {
    throw new Error('Esta classe ainda não está conectada à fonte de mercado no beta.');
  }

  const proxiedPayload = await invokeBetaMarketProxy('quote', symbol, assetClass);
  if (proxiedPayload) {
    return assetClass === 'crypto'
      ? cryptoQuoteFromPayload(proxiedPayload, symbol, 'brapi-backend')
      : stockQuoteFromPayload(proxiedPayload, symbol, 'brapi-backend');
  }

  if (assetClass === 'crypto') {
    const payload = await fetchPublicSandbox(
      `${BRAPI_BASE}/api/v2/crypto?coin=${encodeURIComponent(symbol)}&currency=BRL`,
      'Não foi possível consultar este criptoativo agora.',
    );
    return cryptoQuoteFromPayload(payload, symbol, 'brapi-sandbox');
  }

  const payload = await fetchPublicSandbox(
    `${BRAPI_BASE}/api/v2/stocks/quote?symbols=${encodeURIComponent(symbol)}`,
    'Não foi possível consultar este ativo agora.',
  );
  return stockQuoteFromPayload(payload, symbol, 'brapi-sandbox');
}

function extractDividendRows(payload: any): any[] {
  if (Array.isArray(payload?.dividends)) return payload.dividends;
  if (Array.isArray(payload?.results)) {
    return payload.results.flatMap((result: any) => {
      if (Array.isArray(result?.dividends)) return result.dividends;
      if (Array.isArray(result?.data?.dividends)) return result.data.dividends;
      return [];
    });
  }
  if (Array.isArray(payload?.data?.dividends)) return payload.data.dividends;
  return [];
}

function normalizeEventDate(value: unknown) {
  const text = String(value || '').trim();
  return text || undefined;
}

function incomeEventsFromPayload(
  payload: any,
  symbol: string,
  assetClass: 'stock' | 'fii' | 'etf' | 'bdr',
  source: InvestmentBetaMarketSource,
): InvestmentBetaIncomeEvent[] {
  return extractDividendRows(payload)
    .map((row: any, index: number) => {
      const eventSymbol = normalizeSymbol(row?.symbol || symbol);
      const rate = Math.max(0, finite(row?.rate ?? row?.value ?? row?.amount));
      const recordDate = normalizeEventDate(row?.lastDatePrior ?? row?.recordDate ?? row?.exDate);
      const paymentDate = normalizeEventDate(row?.paymentDate ?? row?.payDate);
      const approvedOn = normalizeEventDate(row?.approvedOn ?? row?.declaredDate);
      const label = String(row?.label || row?.type || 'PROVENTO').trim().toUpperCase();
      return {
        id: [eventSymbol, label, recordDate || '', paymentDate || '', String(rate), String(index)].join(':'),
        assetClass,
        symbol: eventSymbol,
        label,
        rate,
        currency: 'BRL',
        approvedOn,
        recordDate,
        paymentDate,
        source,
      } satisfies InvestmentBetaIncomeEvent;
    })
    .filter((event: InvestmentBetaIncomeEvent) => event.symbol && event.rate > 0)
    .sort((a: InvestmentBetaIncomeEvent, b: InvestmentBetaIncomeEvent) => String(b.paymentDate || b.recordDate || '').localeCompare(String(a.paymentDate || a.recordDate || '')));
}

export async function fetchBetaIncomeEvents(
  symbolInput: string,
  assetClass: InvestmentAssetClass,
): Promise<InvestmentBetaIncomeEvent[]> {
  const symbol = normalizeSymbol(symbolInput);
  if (!symbol) throw new Error('Informe um ticker ou símbolo.');
  if (!['stock', 'fii', 'etf', 'bdr'].includes(assetClass)) {
    throw new Error('Proventos automáticos estão conectados apenas a ações, FIIs, ETFs e BDRs neste beta.');
  }
  const incomeClass = assetClass as 'stock' | 'fii' | 'etf' | 'bdr';

  const proxiedPayload = await invokeBetaMarketProxy('income', symbol, assetClass);
  if (proxiedPayload) return incomeEventsFromPayload(proxiedPayload, symbol, incomeClass, 'brapi-backend');

  const url = assetClass === 'fii'
    ? `${BRAPI_BASE}/api/v2/fii/dividends?symbols=${encodeURIComponent(symbol)}`
    : `${BRAPI_BASE}/api/v2/stocks/dividends?symbols=${encodeURIComponent(symbol)}`;
  const payload = await fetchPublicSandbox(url, 'Não foi possível consultar os proventos deste ativo agora.');
  return incomeEventsFromPayload(payload, symbol, incomeClass, 'brapi-sandbox');
}
