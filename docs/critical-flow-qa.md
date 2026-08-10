# QA de fluxos críticos do MF Financeiro

Este documento define o smoke test autenticado obrigatório para mudanças que afetam a experiência financeira principal. Os checks estáticos e de build rodam no CI; os cenários abaixo exigem uma conta de teste não produtiva com dados controlados.

## Ambiente

- usar Preview Vercel do commit exato;
- usar usuário de QA, nunca a conta financeira real do cliente;
- não executar contra produção quando o cenário cria, exclui, importa ou paga dados;
- registrar o commit, Preview e resultado da rodada.

## Fluxos críticos

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

- nenhum erro fatal no console;
- nenhum dado de outro usuário acessível;
- nenhuma ação destrutiva em massa disponível na interface comum;
- nenhuma duplicação financeira entre fatura e parcela vinculada;
- release, onboarding e tutorial mantêm estados independentes;
- Preview do commit exato precisa estar `READY` antes de merge.
