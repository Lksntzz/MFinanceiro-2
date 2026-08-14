-- Centraliza o plano de controle de aprovacao de usuarios no MF Administracao.
-- O MF Financeiro continua sendo a fonte de verdade das solicitacoes porque o
-- fluxo de autenticacao/ativacao depende deste estado local.

alter table public.mf_access_requests
  add column if not exists decision_admin_id uuid,
  add column if not exists decision_correlation_id uuid,
  add column if not exists decision_source text;

comment on column public.mf_access_requests.decision_admin_id is
  'UUID do operador no projeto MF Administracao. Nao possui FK local por ser identidade cross-project.';
comment on column public.mf_access_requests.decision_correlation_id is
  'Correlation ID que vincula a decisao ao registro de auditoria do MF Administracao.';
comment on column public.mf_access_requests.decision_source is
  'Origem da decisao administrativa; novas decisoes normais usam mf_administracao.';

-- O browser do MF Financeiro nao deve listar nem alterar solicitacoes.
-- Novas solicitacoes continuam entrando exclusivamente por submit_access_request,
-- que e SECURITY DEFINER e permanece liberada para anon/authenticated.
drop policy if exists "mf_access_requests_admin_select" on public.mf_access_requests;
drop policy if exists "mf_access_requests_admin_update" on public.mf_access_requests;

revoke all on table public.mf_access_requests from anon, authenticated;

-- O lookup de status tambem deixa de ser um RPC de browser. resolve-auth-state
-- continua utilizando-o internamente com service_role.
revoke all on function public.check_access_request_status(text) from public, anon, authenticated;
grant execute on function public.check_access_request_status(text) to service_role;

-- Preserva explicitamente o contrato publico de solicitacao de acesso.
grant execute on function public.submit_access_request(text, text) to anon, authenticated, service_role;
