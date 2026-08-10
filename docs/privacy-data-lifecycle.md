# MF Financeiro — Privacidade e ciclo de vida de dados

## Princípios

1. Coletar somente o necessário para executar a função financeira solicitada.
2. Documento bruto e dado financeiro estruturado são classes diferentes de informação.
3. OCR/IA nunca transforma uma extração em lançamento sem revisão/ação humana quando o fluxo exigir revisão.
4. Logs e telemetria não podem conter valores, saldos, descrições financeiras, e-mails, tokens, conteúdo de documentos ou identificadores de contas/cartões.
5. Exclusão automática de histórico financeiro não deve ser introduzida como efeito colateral de manutenção técnica.

## Documentos e OCR

- `mf-import-documents` deve permanecer privado.
- Arquivos são acessíveis somente pelo usuário proprietário e por processamento server-side autorizado.
- OCR deve validar JWT, usuário proprietário, MIME type e limite de tamanho antes de processar.
- Respostas de provedores externos usadas para diagnóstico não devem ser gravadas integralmente em `error_message` ou logs.
- Campos estruturados necessários à revisão podem ser persistidos; duplicatas de payload bruto devem ser evitadas quando não acrescentarem valor funcional.
- O envio à IA deve ocorrer por ação explícita do usuário nos fluxos de documento que adotam esse modelo.

## Telemetria

A tabela `mf_operational_events` aceita apenas contexto redigido e limitado. O cliente também bloqueia chaves relacionadas a:

- amount/balance;
- card/account;
- e-mail/nome;
- descrição/merchant;
- documento/arquivo/payload;
- token/secret/password;
- salário/receita/despesa.

Eventos operacionais não são uma trilha financeira e não devem ser usados para reconstruir comportamento monetário individual.

## Retenção

Não foi ativada nesta rodada nenhuma rotina destrutiva automática de retenção. Antes de automatizar expurgo de documentos, definir e publicar:

- prazo do documento bruto concluído;
- prazo de falhas de OCR;
- exceções legais/contratuais;
- impacto em suporte e contestação;
- mecanismo de exportação antes da exclusão quando aplicável.

A implementação de retenção deve ser separada do ledger: apagar um documento fonte não pode apagar silenciosamente um lançamento financeiro confirmado.

## Direitos e operações

O produto deve manter rotas/processos claros para:

- exportar histórico financeiro em formato portável;
- excluir lançamentos individualmente;
- encerrar conta por fluxo dedicado e fortemente confirmado;
- remover documentos fonte sem depender da exclusão do ledger;
- registrar auditoria de operações administrativas globais.

## Checklist de release

- [ ] nenhum segredo administrativo em variáveis `VITE_*`;
- [ ] Edge Functions sensíveis com JWT, salvo endpoint pré-login explicitamente revisado;
- [ ] Storage privado para documentos financeiros;
- [ ] logs sem payload financeiro bruto;
- [ ] telemetria redigida;
- [ ] política de retenção revisada antes de qualquer job de exclusão automática.
