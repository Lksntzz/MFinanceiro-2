-- Fix PostgreSQL ambiguity between the RETURNS TABLE output column `key`
-- and mf_global_settings.key inside mf_set_maintenance_scope.
-- No data, layout, or maintenance scope semantics are changed.

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
set search_path = public, pg_temp
as $function$
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
    on conflict on constraint mf_global_settings_pkey do update
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
    on conflict on constraint mf_global_settings_pkey do update
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
$function$;

revoke all on function public.mf_set_maintenance_scope(text, boolean, text) from public, anon;
grant execute on function public.mf_set_maintenance_scope(text, boolean, text) to authenticated, service_role;
