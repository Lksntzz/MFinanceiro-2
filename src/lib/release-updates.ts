export type ReleaseUpdate = {
  id: string;
  title: string;
  dateLabel: string;
  summary: string;
  highlights: readonly string[];
};

export const LATEST_WEB_UPDATE: ReleaseUpdate = {
  id: '2026-08-10-web-container-spacing',
  title: 'Mais espaço para ler e decidir',
  dateLabel: '10 de agosto de 2026',
  summary: 'A experiência web do MF Financeiro recebeu um ajuste de espaçamento para deixar cards, textos e controles mais confortáveis e consistentes entre as ferramentas.',
  highlights: [
    'Planejamento, Orçamento e Simulador agora mantêm uma distância mais adequada entre conteúdo e bordas.',
    'Linha do tempo, Qualidade dos dados e Primeiros passos seguem o mesmo padrão visual do restante do aplicativo.',
    'A correção foi restrita ao web/desktop e não altera a experiência mobile.',
  ],
};

export function releaseReadKey(update: ReleaseUpdate = LATEST_WEB_UPDATE) {
  return `mf-release-read:${update.id}`;
}
