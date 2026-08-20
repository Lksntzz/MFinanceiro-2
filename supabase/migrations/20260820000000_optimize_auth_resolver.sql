create or replace function public.mf_resolve_access_entry(p_email text)
returns table(state text)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_status text;
  v_confirmed boolean := false;
  v_user_found boolean := false;
begin
  if v_email = '' or v_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    return query select 'new'::text;
    return;
  end if;

  select true, (u.email_confirmed_at is not null or u.confirmed_at is not null)
    into v_user_found, v_confirmed
  from auth.users u
  where lower(coalesce(u.email, '')) = v_email
    and u.deleted_at is null
  order by u.created_at desc
  limit 1;

  if v_user_found then
    if v_confirmed then
      return query select 'account'::text;
    else
      return query select 'confirmation_pending'::text;
    end if;
    return;
  end if;

  select lower(r.status)
    into v_status
  from public.mf_access_requests r
  where lower(r.email) = v_email
  order by r.updated_at desc nulls last, r.created_at desc
  limit 1;

  return query
  select case
    when v_status in ('aprovado', 'approved') then 'approved'
    when v_status in ('pendente', 'pending') then 'pending'
    when v_status in ('negado', 'denied', 'rejected') then 'denied'
    else 'new'
  end::text;
end;
$$;

revoke all on function public.mf_resolve_access_entry(text) from public, anon, authenticated;
grant execute on function public.mf_resolve_access_entry(text) to service_role;
