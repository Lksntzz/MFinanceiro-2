# MF Financeiro Mobile — Checkpoint

Checkpoint criado em 2026-08-08 para preservar o estado atual da integração mobile + reorganização de produto antes de novas rodadas de alterações.

## Branch oficial de continuidade

`agent/mobile-product-integration`

A partir deste checkpoint, novas correções e melhorias relacionadas ao mobile e à integração com a experiência desktop devem continuar nesta branch até a decisão explícita de envio final.

## Regra de publicação

- não fazer merge parcial das PRs #6 ou #7;
- usar a PR #8 como frente integrada;
- não promover para `main` ou produção enquanto houver novas alterações planejadas para este pacote;
- futuras mudanças devem ser commitadas e validadas na branch integrada;
- quando o pacote estiver fechado, executar QA final mobile + desktop e somente então decidir o merge único.

## Estado preservado neste checkpoint

### Mobile

- experiência mobile própria em `src/mobile`;
- Home simplificada;
- Movimentações;
- Cartões;
- menu Mais;
- MF Quick;
- MF Scan;
- MF Inbox persistente;
- Disponível de verdade;
- Posso gastar?;
- atalhos PWA para lançamento e scanner;
- suporte a deep links `/quick` e `/scan` via fallback SPA;
- `/app/lancar` redireciona para MF Quick no modo mobile.

### Desktop / produto

A branch integrada também contém a reorganização conceitual da PR #7, incluindo:

- navegação desktop simplificada;
- Contas e Categorias separadas;
- Recorrências na Agenda;
- Simulador;
- Insights reorganizado;
- lançamento universal desktop;
- redirects de compatibilidade para rotas antigas.

## Arquitetura protegida

- um backend e um núcleo financeiro compartilhado;
- apresentação mobile separada da apresentação desktop;
- `DashboardBootstrap.tsx` funciona como boundary entre as experiências;
- nenhuma migration ou schema novo foi necessário para esta etapa;
- MF Quick e MF Scan confirmado reutilizam o RPC financeiro existente;
- MF Inbox reutiliza Storage privado, RLS, tabelas de extração e fluxo de importação existentes.

## Validações já concluídas antes deste checkpoint

- TypeScript check: success;
- production build: success;
- Preview Vercel integrado: READY;
- PR #8: mergeable=true;
- branch integrada à frente da `main` e sem commits atrás no momento da consolidação;
- deep links PWA revisados;
- conflito entre PR #6 e PR #7 reconciliado no boundary.

## Pendências antes do envio final

- smoke test autenticado em 320 / 360 / 390 / 412 / 430 px;
- regressão visual desktop autenticada;
- teste do MF Inbox com extrato real;
- teste do MF Scan em aparelho real;
- câmera, galeria, teclado, safe areas e PWA;
- revisar novas correções e funcionalidades que forem adicionadas após este checkpoint;
- rodar novamente CI + preview antes do merge único.

## Próximas ideias já aprovadas para evolução mobile

- compartilhamento direto para o MF;
- OCR específico para contas e recibos, separado do OCR de extrato;
- MF Voice;
- recorrência inteligente;
- shortcuts/widgets e integrações nativas quando houver wrapper adequado;
- manter o mobile como companheiro financeiro diário, sem duplicar toda a complexidade do desktop.
