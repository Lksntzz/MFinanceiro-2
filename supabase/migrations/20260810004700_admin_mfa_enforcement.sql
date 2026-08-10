begin;

create or replace function public.mf_admin_has_aal2()
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.mf_is_admin_user()
    and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

revoke execute on function public.mf_admin_has_aal2() from public, anon;
grant execute on function public.mf_admin_has_aal2() to authenticated, service_role;

-- Reading the admin queue remains role-gated; mutating access decisions requires MFA.
alter policy "mf_access_requests_admin_update"
on public.mf_access_requests
to authenticated
using ((select public.mf_admin_has_aal2()))
with check ((select public.mf_admin_has_aal2()));

create or replace function public.mf_set_maintenance_mode(
  p_enabled boolean,
  p_message text default null::text
)
returns table(
  maintenance_mode boolean,
  maintenance_message text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message text;
begin
  if auth.uid() is null or not public.mf_is_admin_user() then
    raise exception 'Apenas administradores podem alterar o modo de manutenção.'
      using errcode = '42501';
  end if;

  if coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'Confirme o segundo fator de autenticação antes de alterar uma configuração global.'
      using errcode = '42501';
  end if;

  v_message := nullif(btrim(coalesce(p_message, '')), '');
  if v_message is null then
    v_message := 'Estamos realizando melhorias importantes. O MFinanceiro estará disponível novamente em breve.';
  end if;

  if p_enabled and char_length(v_message) < 10 then
    raise exception 'Informe uma mensagem de manutenção com pelo menos 10 caracteres.'
      using errcode = '22023';
  end if;

  insert into public.mf_global_settings (
    key,
    maintenance_mode,
    maintenance_message,
    updated_at
  ) values (
    'global',
    coalesce(p_enabled, false),
    v_message,
    now()
  )
  on conflict (key) do update
    set maintenance_mode = excluded.maintenance_mode,
        maintenance_message = excluded.maintenance_message,
        updated_at = excluded.updated_at;

  return query
  select s.maintenance_mode, s.maintenance_message, s.updated_at
  from public.mf_global_settings s
  where s.key = 'global';
end;
$$;

revoke execute on function public.mf_set_maintenance_mode(boolean, text) from public, anon;
grant execute on function public.mf_set_maintenance_mode(boolean, text) to authenticated, service_role;

comment on function public.mf_admin_has_aal2() is
  'Server-side privileged-session guard: admin/owner role plus verified MFA (AAL2).';

commit;
