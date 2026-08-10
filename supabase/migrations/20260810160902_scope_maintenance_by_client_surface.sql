insert into public.mf_global_settings (key, maintenance_mode, maintenance_message, updated_at)
select 'mobile', maintenance_mode, maintenance_message, now()
from public.mf_global_settings
where key = 'global'
on conflict (key) do nothing;

insert into public.mf_global_settings (key, maintenance_mode, maintenance_message, updated_at)
select 'desktop', maintenance_mode, maintenance_message, now()
from public.mf_global_settings
where key = 'global'
on conflict (key) do nothing;

insert into public.mf_global_settings (key, maintenance_mode, maintenance_message, updated_at)
values
  ('mobile', false, 'Estamos realizando melhorias importantes. O MFinanceiro estará disponível novamente em breve.', now()),
  ('desktop', false, 'Estamos realizando melhorias importantes. O MFinanceiro estará disponível novamente em breve.', now())
on conflict (key) do nothing;

create or replace function public.mf_set_maintenance_mode(
  p_enabled boolean,
  p_message text default null
)
returns table(
  maintenance_mode boolean,
  maintenance_message text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_message text;
begin
  if auth.uid() is null or not public.mf_is_admin_user() then
    raise exception 'Apenas administradores podem alterar o modo de manutenção.'
      using errcode = '42501';
  end if;

  v_message := nullif(btrim(coalesce(p_message, '')), '');
  if v_message is null then
    v_message := 'Estamos realizando melhorias importantes. O MFinanceiro estará disponível novamente em breve.';
  end if;

  if coalesce(p_enabled, false) and char_length(v_message) < 10 then
    raise exception 'Informe uma mensagem de manutenção com pelo menos 10 caracteres.'
      using errcode = '22023';
  end if;

  insert into public.mf_global_settings (
    key,
    maintenance_mode,
    maintenance_message,
    updated_at
  )
  values (
    'desktop',
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
  where s.key = 'desktop';
end;
$$;

create or replace function public.mf_set_maintenance_scope(
  p_scope text,
  p_enabled boolean,
  p_message text default null
)
returns table(
  key text,
  maintenance_mode boolean,
  maintenance_message text,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_scope text := lower(btrim(coalesce(p_scope, '')));
  v_message text;
begin
  if auth.uid() is null or not public.mf_is_admin_user() then
    raise exception 'Apenas administradores podem alterar o modo de manutenção.'
      using errcode = '42501';
  end if;

  if v_scope not in ('mobile', 'desktop', 'both') then
    raise exception 'Escopo de manutenção inválido. Use mobile, desktop ou both.'
      using errcode = '22023';
  end if;

  v_message := nullif(btrim(coalesce(p_message, '')), '');
  if v_message is null then
    v_message := 'Estamos realizando melhorias importantes. O MFinanceiro estará disponível novamente em breve.';
  end if;

  if coalesce(p_enabled, false) and char_length(v_message) < 10 then
    raise exception 'Informe uma mensagem de manutenção com pelo menos 10 caracteres.'
      using errcode = '22023';
  end if;

  if v_scope in ('mobile', 'both') then
    insert into public.mf_global_settings (
      key,
      maintenance_mode,
      maintenance_message,
      updated_at
    )
    values (
      'mobile',
      coalesce(p_enabled, false),
      v_message,
      now()
    )
    on conflict (key) do update
      set maintenance_mode = excluded.maintenance_mode,
          maintenance_message = excluded.maintenance_message,
          updated_at = excluded.updated_at;
  end if;

  if v_scope in ('desktop', 'both') then
    insert into public.mf_global_settings (
      key,
      maintenance_mode,
      maintenance_message,
      updated_at
    )
    values (
      'desktop',
      coalesce(p_enabled, false),
      v_message,
      now()
    )
    on conflict (key) do update
      set maintenance_mode = excluded.maintenance_mode,
          maintenance_message = excluded.maintenance_message,
          updated_at = excluded.updated_at;
  end if;

  return query
  select s.key, s.maintenance_mode, s.maintenance_message, s.updated_at
  from public.mf_global_settings s
  where (v_scope = 'both' and s.key in ('mobile', 'desktop'))
     or (v_scope <> 'both' and s.key = v_scope)
  order by case s.key when 'mobile' then 1 else 2 end;
end;
$$;

revoke execute on function public.mf_set_maintenance_mode(boolean, text) from public;
revoke execute on function public.mf_set_maintenance_mode(boolean, text) from anon;
grant execute on function public.mf_set_maintenance_mode(boolean, text) to authenticated;

revoke execute on function public.mf_set_maintenance_scope(text, boolean, text) from public;
revoke execute on function public.mf_set_maintenance_scope(text, boolean, text) from anon;
grant execute on function public.mf_set_maintenance_scope(text, boolean, text) to authenticated;
