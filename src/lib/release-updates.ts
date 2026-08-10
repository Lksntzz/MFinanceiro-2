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
  summary: 'O MF Financeiro ficou mais claro, personalizável e previsível para ajudar você a organizar o mês e usar cada ferramenta sem interrupções desnecessárias.',
  highlights: [
    'Planejamento agora mostra o progresso entre Conta, Receita, Compromissos e Orçamento e leva ao Simulador quando a base estiver pronta.',
    'Os tutoriais não interrompem mais a entrada em cada ferramenta: a orientação automática fica na Início e qualquer tutorial pode ser aberto pelo botão ?.',
    'Preferências, busca rápida, linha do tempo, qualidade dos dados, privacidade e exportação ficaram mais integradas ao uso diário.',
  ],
};

export function releaseReadKey(update: ReleaseUpdate = LATEST_WEB_UPDATE) {
  return `mf-release-read:${update.id}`;
}