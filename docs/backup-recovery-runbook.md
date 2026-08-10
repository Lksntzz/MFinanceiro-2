# MF Financeiro — Backup e recuperação

## Objetivo

Backup só é confiável quando a restauração foi exercitada. Este runbook define o mínimo operacional para mudanças de banco e incidentes.

## Antes de migration sensível

1. Confirmar qual ambiente e project ref serão alterados.
2. Confirmar a opção de backup/restore disponível no plano Supabase ativo; não presumir PITR ou frequência sem verificar o ambiente.
3. Registrar o SHA da aplicação e a versão da migration candidata.
4. Executar os checks de integridade de `scripts/verify-recovery-invariants.sql` no ambiente origem.
5. Guardar os resultados agregados do check, sem exportar dados financeiros para logs públicos.
6. Só então aplicar a migration.

## Ensaio de restore

O restore deve ser exercitado em ambiente descartável/isolado, nunca sobre produção como primeiro teste.

Validar, nesta ordem:

1. autenticação de usuário de teste;
2. RLS impedindo acesso cruzado;
3. contas e saldo derivado;
4. ledger e paginação;
5. cartões e parcelas;
6. recorrências/ocorrências;
7. Agenda e receitas previstas;
8. investimentos;
9. importações e documentos privados;
10. RPCs principais (`mf_create_finance_entry_v3`, leitura do ledger e pagamentos autorizados);
11. funções administrativas somente com papel correto;
12. Security Advisor sem regressões críticas.

## Critérios de integridade

Um restore não está aprovado se houver:

- ledger sem usuário proprietário;
- conta, cartão, categoria ou meta vinculada a usuário inexistente;
- ocorrência sem conta fixa correspondente quando a FK deveria garantir vínculo;
- documento de Storage acessível por outro usuário;
- função destrutiva em massa disponível para `authenticated`;
- função interna `SECURITY DEFINER` exposta a `anon`;
- tabela pública sem RLS.

## RTO/RPO

RTO e RPO não devem ser inventados. Definir metas formais depois de confirmar a capacidade contratada de backup do ambiente de produção e o volume real de dados.

## Após incidente

- preservar evidências e timestamps;
- evitar correções manuais linha a linha antes de entender a causa;
- restaurar primeiro em ambiente isolado quando possível;
- comparar invariantes antes/depois;
- documentar causa raiz e ação preventiva;
- comunicar ao usuário apenas impacto e ação necessária, sem detalhes que ampliem a superfície de ataque.
