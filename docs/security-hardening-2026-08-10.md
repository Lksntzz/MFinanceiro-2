# MF Financeiro — Security hardening

Data da auditoria: 2026-08-10

## Escopo

Auditoria do projeto Supabase ativo, código do aplicativo, RPCs, RLS, Storage, Edge Functions, superfícies administrativas, CI e caminhos destrutivos.

## Estado encontrado

- Todas as tabelas do schema `public` expostas pela Data API estavam com RLS habilitado.
- O bucket `mf-import-documents` é privado e suas políticas de Storage limitam leitura/escrita à pasta do próprio usuário.
- O bucket `mf-avatars` é público apenas para leitura; upload/update/delete continuam limitados à pasta do próprio usuário.
- `statement-ocr`, `document-ocr` e `open-finance-session` exigem JWT.
- `resolve-auth-state` é pré-login e portanto não exige JWT; ele deve permanecer a única fronteira de consulta de estado de acesso antes da autenticação.
- Diversas funções antigas `SECURITY DEFINER` tinham `EXECUTE` concedido a `anon` por herança/default.
- `mf_sync_fixed_bill_snapshots(user_id)` e helpers correlatos não devem ser APIs de navegador.
- `mf_delete_all_finance_entries` ainda tinha execução para `authenticated`, apesar de não pertencer ao fluxo normal do produto.
- Existiam políticas RLS legadas duplicando políticas modernas por operação.
- O advisor do Supabase reportou proteção de senhas vazadas desativada.

## Correção versionada

A migration `20260810004500_security_architecture_hardening.sql`:

1. remove execução browser de helpers internos, triggers, RPCs legados e exclusão em massa;
2. mantém explicitamente apenas `authenticated` nos fluxos financeiros `SECURITY DEFINER` ainda necessários;
3. mantém `submit_access_request` como entrada pré-login e move a leitura de status para a Edge Function/service role;
4. remove políticas RLS duplicadas e restringe as policies de ocorrências fixas a `authenticated`;
5. fixa `search_path` do helper sinalizado pelo advisor;
6. cria telemetria operacional redigida e sem leitura pelo usuário comum;
7. cria trilha de auditoria para alterações globais/administrativas.

## Autenticação privilegiada

O painel de manutenção passa a consultar o Authenticator Assurance Level (AAL):

- se a conta já possui MFA e a sessão está em `aal1`, alterações globais são bloqueadas;
- uma sessão `aal2` pode prosseguir;
- contas administrativas ainda sem fator cadastrado recebem aviso explícito, sem bloqueio retroativo nesta etapa.

### Gate de publicação

Antes de classificar o hardening como completo em produção:

- habilitar proteção contra senhas vazadas no Supabase Auth;
- cadastrar MFA para contas `admin`/`owner` e validar o fluxo de desafio;
- aplicar a migration somente após backup/snapshot compatível com o plano;
- reexecutar Security Advisor e revisar qualquer warning restante;
- confirmar que nenhum fluxo normal depende dos RPCs revogados.

## Divergência de migrations

O histórico remoto contém versões que não estão materializadas na árvore atual do repositório. Não criar migrations fictícias para mascarar a divergência.

Antes de reconstruir um ambiente do zero, fazer um rebaseline controlado:

1. exportar a definição real do schema e funções do ambiente autoritativo;
2. comparar com os arquivos versionados;
3. produzir baseline/squash revisado;
4. validar em um projeto descartável;
5. somente então substituir a estratégia histórica de migrations.

A migration de hardening atual é aditiva sobre o schema real e não tenta reescrever esse histórico.
