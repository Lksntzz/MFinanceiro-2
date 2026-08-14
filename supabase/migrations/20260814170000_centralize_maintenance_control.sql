-- Centraliza o plano de controle de manutencao no MF Administracao.
-- O MF Financeiro continua sendo a fonte de verdade do estado de runtime
-- (mf_global_settings), mas nenhum usuario/browser do produto pode mais
-- executar as RPCs legadas de mutacao.
--
-- As funcoes sao preservadas temporariamente para rollback operacional.
-- O novo fluxo normal usa a Edge Function admin-maintenance-control.

revoke all on function public.mf_set_maintenance_mode(boolean, text)
  from public, anon, authenticated, service_role;

revoke all on function public.mf_set_maintenance_scope(text, boolean, text)
  from public, anon, authenticated, service_role;

-- Mantem somente o owner/postgres com capacidade de break-glass via banco.
-- Nao conceder novamente EXECUTE a anon/authenticated no fluxo normal.
