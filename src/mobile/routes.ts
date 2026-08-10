export const MOBILE_BREAKPOINT_PX = 820;

export const MOBILE_ROUTES = {
  home: '/app',
  transactions: '/app/movimentacoes',
  cards: '/app/planejamento/cartoes',
  more: '/app/mobile/mais',
  inbox: '/app/mobile/inbox',
  documentInbox: '/app/mobile/inbox/documentos',
  canSpend: '/app/mobile/posso-gastar',
  purchaseImpact: '/app/mobile/impacto-compra',
  pulse: '/app/mobile/pulse',
  quick: '/quick',
  scan: '/scan',
  voice: '/voice',
  recurrences: '/recurrences',
} as const;

export type MobileRouteKey = keyof typeof MOBILE_ROUTES;

export const MOBILE_PRIMARY_NAV: readonly MobileRouteKey[] = [
  'home',
  'transactions',
  'cards',
  'more',
];
