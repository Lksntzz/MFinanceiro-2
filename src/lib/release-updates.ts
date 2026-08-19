export type ReleaseUpdate = {
  id: string;
  title: string;
  dateLabel: string;
  summary: string;
  highlights: readonly string[];
};

export const LATEST_WEB_UPDATE: ReleaseUpdate = {
  id: '2026-08-11-desktop-readability-dashboard-stability',
  title: 'Mais legibilidade e uma Inicial mais estável',
  dateLabel: '11 de agosto de 2026',
  summary: 'O MF Financeiro Web recebeu ajustes de leitura, navegação e estabilidade para deixar o uso diário mais claro e consistente.',
  highlights: [
    'Nomes de ferramentas, subferramentas, textos funcionais e gráficos ganharam melhor legibilidade no desktop.',
    'A Inicial agora preserva o último estado válido ao trocar de ferramenta, evitando o flash temporário de valores zerados.',
    'Contas financeiras receberam mais espaçamento interno para melhorar a leitura sem alterar seus dados ou regras financeiras.',
  ],
};

export function releaseReadKey(update: ReleaseUpdate = LATEST_WEB_UPDATE) {
  return `mf-release-read:${update.id}`;
}
