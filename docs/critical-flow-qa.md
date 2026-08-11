# QA de fluxos críticos do MF Financeiro

Este documento define duas camadas complementares de validação de navegador para mudanças que afetam a experiência financeira principal. A suíte automática usa um backend Supabase simulado e isolado; o smoke de Preview usa uma conta de QA não produtiva. Nenhuma das duas deve escrever em produção.

## Camada 1 — E2E automático e hermético

Executado pelo workflow `E2E CI` em pull requests para `main` e nos pushes da branch de hardening.

- navegador Chromium real via Playwright fixado no projeto;
- aplicação real servida pelo Vite;
- Supabase interceptado no nível HTTP em um domínio de teste inexistente;
- nenhum secret de produção é necessário;
- nenhum request financeiro é enviado ao Supabase real;
- estado separado por usuário para detectar vazamento entre sessões;
- fixture CSV determinística versionada no repositório.

### Fluxos automatizados no bloco 3

1. **Autenticação e pedido de acesso** — valida resposta pública genérica, ausência de enumeração e login de conta existente.
2. **Lançamento manual** — cria despesa pela interface, confirma feedback e reaparecimento no ledger sem F5, além do contrato da RPC financeira.
3. **Importação e conciliação** — importa CSV, confirma duas linhas, valida histórico do lote, desfaz o lote e confirma remoção dos lançamentos preservando a trilha do lote.
4. **Logout e troca de usuário** — entra como usuário A, sai, entra como usuário B e confirma que ledger e cache permanecem segregados por `user_id`.

O teste interage com o tutorial pela própria UI (`Pular tour` → `Pular tudo`) em vez de desativá-lo artificialmente. Isso preserva o comportamento real do produto durante a execução.

## Camada 2 — smoke autenticado de Preview

Executado manualmente pelo workflow `Critical E2E Smoke` contra o Preview Vercel do commit exato.

### Ambiente

- informar a URL do Preview Vercel do commit exato;
- usar `MF_E2E_EMAIL` e `MF_E2E_PASSWORD` de uma conta de QA não produtiva;
- nunca usar a conta financeira real do cliente;
- não executar cenários destrutivos ou importações contra produção;
- registrar commit, Preview e resultado da rodada.

O smoke autenticado usa a mesma versão de Playwright do projeto, mas uma configuração própria (`playwright.preview.config.ts`) para não misturar backend real de QA com a suíte hermética.

## Fluxos críticos ainda previstos para expansão

1. **Login e sessão** — autenticar, atualizar a página e confirmar que a sessão continua válida.
2. **Onboarding** — confirmar que atualização de release não reinicia onboarding nem tutorial concluído.
3. **Tours** — validar `Pular nesta ferramenta`, `Pular tudo` e início manual posterior.
4. **Lançamento** — criar entrada e saída; confirmar saldo, histórico e feedback.
5. **Exclusão + Desfazer** — excluir lançamento, usar `Desfazer` dentro da janela e confirmar restauração financeira.
6. **Importação** — importar arquivo pequeno, revisar e confirmar; validar contagem de novos/duplicados/rejeitados.
7. **Agenda** — criar recorrência e confirmar calendário + linha do tempo.
8. **Cartões** — configurar fechamento/vencimento/limite e confirmar alerta de uso elevado quando aplicável.
9. **Planejamento** — configurar conta, receita e orçamento; confirmar progressão sem duplicar ferramentas.
10. **Insights** — confirmar que histórico incompleto é sinalizado e que a área não inventa score.
11. **Busca global** — `Ctrl/⌘ + K`, pesquisar Lançar, Agenda, cartão e uma conta cadastrada.
12. **Preferências** — alterar widgets da Início, notificações, contraste e tours; atualizar a página e confirmar persistência.
13. **Privacidade** — `Alt + P` e botão de privacidade devem ocultar valores sem alterar os dados.
14. **Exportação** — baixar pacote JSON e confirmar presença de dados estruturados do usuário sem arquivos privados do Storage.
15. **MFA/admin** — em conta de QA administrativa, validar AAL e TOTP antes de publicar qualquer migration que exija AAL2 no servidor.

## Gates de aceite

- E2E automático hermético verde no commit exato;
- Application CI e Mobile CI verdes no commit exato;
- nenhum erro fatal no navegador durante os fluxos validados;
- nenhum dado de outro usuário acessível;
- nenhuma ação destrutiva em massa disponível na interface comum;
- nenhuma duplicação financeira entre fatura e parcela vinculada;
- release, onboarding e tutorial mantêm estados independentes;
- Preview do commit exato precisa estar `READY` antes de merge;
- smoke autenticado de Preview é obrigatório antes de uma publicação que altere os fluxos cobertos por ele.
