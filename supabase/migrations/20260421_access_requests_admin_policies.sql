-- Permissoes admin para painel de solicitacoes de acesso
-- Mantem acesso bloqueado para usuarios comuns e libera apenas admin/owner.

create or replace function public.mf_is_admin_user()
returns boolean
language plpgsql
stable
as $$
declare
  v_role text;
  v_is_admin text;
begin
  v_role := lower(coalesce(auth.jwt() -> 'app_metadata' ->> 'role', ''));
  if v_role in ('admin', 'owner') then
    return true;
  end if;

  v_is_admin := lower(coalesce(auth.jwt() -> 'user_metadata' ->> 'is_admin', 'false'));
  return v_is_admin in ('true', '1');
end;
$$;

grant execute on function public.mf_is_admin_user() to authenticated;

drop policy if exists "mf_access_requests_admin_select" on public.mf_access_requests;
create policy "mf_access_requests_admin_select"
on public.mf_access_requests
for select
to authenticated
using (public.mf_is_admin_user());

drop policy if exists "mf_access_requests_admin_update" on public.mf_access_requests;
create policy "mf_access_requests_admin_update"
on public.mf_access_requests
for update
to authenticated
using (public.mf_is_admin_user())
with check (public.mf_is_admin_user());

