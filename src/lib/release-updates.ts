export type ReleaseUpdate = {
  id: string;
  title: string;
  dateLabel: string;
  summary: string;
  highlights: readonly string[];
};

export const LATEST_WEB_UPDATE: ReleaseUpdate = {
  id: '2026-08-10-product-maturity',
  title: 'Seu MF, do seu jeito',
  dateLabel: '10 de agosto de 2026',
  summary: 'O MF Financeiro ficou mais personalizável e previsível para ajudar você a encontrar o que precisa, acompanhar seus dados e manter o controle da sua experiência.',
  highlights: [
    'A Início e as notificações agora podem ser ajustadas às informações que você realmente quer acompanhar.',
    'Busca rápida, linha do tempo financeira e verificações de qualidade ajudam a encontrar ações e pendências com menos esforço.',
    'Privacidade, exportação de dados, histórico de alterações e opções de tutorial ganharam controles mais claros.',
  ],
};

export function releaseReadKey(update: ReleaseUpdate = LATEST_WEB_UPDATE) {
  return `mf-release-read:${update.id}`;
}
