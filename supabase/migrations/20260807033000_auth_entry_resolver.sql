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
begin
  if v_email = '' or v_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    return query select 'new'::text;
    return;
  end if;

  if exists (
    select 1
    from auth.users u
    where lower(coalesce(u.email, '')) = v_email
      and u.deleted_at is null
  ) then
    return query select 'existing'::text;
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

revoke all on function public.mf_resolve_access_entry(text) from public;
grant execute on function public.mf_resolve_access_entry(text) to anon, authenticated;

create or replace function public.submit_access_request(p_nome text, p_email text)
returns table(request_id uuid, status text, message text)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $$
declare
  v_id uuid;
  v_status text;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_nome text := btrim(coalesce(p_nome, ''));
begin
  if v_nome = '' then
    raise exception 'nome_obrigatorio';
  end if;
  if v_email = '' or v_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    raise exception 'email_invalido';
  end if;

  if exists (
    select 1
    from auth.users u
    where lower(coalesce(u.email, '')) = v_email
      and u.deleted_at is null
  ) then
    raise exception 'conta_existente';
  end if;

  insert into public.mf_access_requests (nome, email, status)
  values (v_nome, v_email, 'pendente')
  on conflict ((lower(email)))
  do update set
    nome = excluded.nome,
    status = case when lower(public.mf_access_requests.status) in ('negado', 'denied', 'rejected') then 'pendente' else public.mf_access_requests.status end,
    observacao = case when lower(public.mf_access_requests.status) in ('negado', 'denied', 'rejected') then null else public.mf_access_requests.observacao end,
    aprovado_por = case when lower(public.mf_access_requests.status) in ('negado', 'denied', 'rejected') then null else public.mf_access_requests.aprovado_por end,
    aprovado_em = case when lower(public.mf_access_requests.status) in ('negado', 'denied', 'rejected') then null else public.mf_access_requests.aprovado_em end,
    updated_at = now()
  returning id, public.mf_access_requests.status into v_id, v_status;

  return query select v_id, v_status,
    case lower(v_status)
      when 'aprovado' then 'acesso_ja_aprovado'
      when 'approved' then 'acesso_ja_aprovado'
      when 'pendente' then 'solicitacao_recebida'
      when 'pending' then 'solicitacao_recebida'
      when 'negado' then 'solicitacao_negada'
      when 'denied' then 'solicitacao_negada'
      else 'status_desconhecido'
    end;
end;
$$;

revoke all on function public.submit_access_request(text, text) from public;
grant execute on function public.submit_access_request(text, text) to anon, authenticated;
