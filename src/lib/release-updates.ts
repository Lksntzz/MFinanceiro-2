export type ReleaseUpdate = {
  id: string;
  title: string;
  dateLabel: string;
  summary: string;
  highlights: readonly string[];
};

export const LATEST_WEB_UPDATE: ReleaseUpdate = {
  id: '2026-08-10-home-alerts-and-connections',
  title: 'Início completo e alertas que ajudam',
  dateLabel: '10 de agosto de 2026',
  summary: 'O MF Financeiro recuperou a visão completa da Início e tornou alertas e ferramentas de organização mais claros, persistentes e acionáveis.',
  highlights: [
    'Gráficos, categorias, lançamentos recentes e cartões voltam a compor a visão completa da Início.',
    'Alertas dispensados não reaparecem ao trocar de ferramenta, e categorias genéricas podem ser organizadas em lote pelas suas regras.',
    'Categorias e Receitas previstas ganharam mais respiro; Open Finance agora aparece claramente como uma função em breve.',
  ],
};

export function releaseReadKey(update: ReleaseUpdate = LATEST_WEB_UPDATE) {
  return `mf-release-read:${update.id}`;
}
