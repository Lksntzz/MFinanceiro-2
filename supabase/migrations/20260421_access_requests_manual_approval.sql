-- Sistema de solicitacao de acesso com aprovacao manual
-- Objetivo: permitir cadastro apenas para e-mails aprovados

create extension if not exists pgcrypto;

create table if not exists public.mf_access_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  note text,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ux_mf_access_requests_email_lower
  on public.mf_access_requests ((lower(email)));

create index if not exists ix_mf_access_requests_status
  on public.mf_access_requests (status);

create or replace function public.mf_set_access_requests_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_mf_access_requests_updated_at on public.mf_access_requests;
create trigger trg_mf_access_requests_updated_at
before update on public.mf_access_requests
for each row
execute procedure public.mf_set_access_requests_updated_at();

-- RLS: bloqueia acesso direto por anon/authenticated.
alter table public.mf_access_requests enable row level security;
alter table public.mf_access_requests force row level security;

revoke all on public.mf_access_requests from anon;
revoke all on public.mf_access_requests from authenticated;

-- Retorna status do e-mail de forma controlada.
create or replace function public.mf_get_access_status(p_email text)
returns table (
  status text,
  name text,
  email text,
  approved_at timestamptz,
  note text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if v_email = '' then
    return query
    select
      'not_found'::text,
      null::text,
      null::text,
      null::timestamptz,
      null::text;
    return;
  end if;

  return query
  select
    coalesce(r.status, 'not_found')::text,
    r.name,
    lower(r.email),
    r.approved_at,
    r.note
  from (
    select *
    from public.mf_access_requests
    where lower(email) = v_email
    order by created_at desc
    limit 1
  ) r;

  if not found then
    return query
    select
      'not_found'::text,
      null::text,
      null::text,
      null::timestamptz,
      null::text;
  end if;
end;
$$;

-- Registra/atualiza solicitacao de acesso.
create or replace function public.mf_request_access(p_name text, p_email text)
returns table (
  status text,
  name text,
  email text,
  approved_at timestamptz,
  note text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  if v_name = '' then
    raise exception 'Nome e obrigatorio.';
  end if;

  if v_email = '' then
    raise exception 'E-mail e obrigatorio.';
  end if;

  if v_email !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' then
    raise exception 'E-mail invalido.';
  end if;

  insert into public.mf_access_requests (name, email, status)
  values (v_name, v_email, 'pending')
  on conflict ((lower(email)))
  do update
    set
      name = excluded.name,
      email = excluded.email,
      status = case
        when public.mf_access_requests.status = 'approved' then 'approved'
        when public.mf_access_requests.status = 'denied' then 'denied'
        else 'pending'
      end,
      updated_at = now();

  return query
  select
    r.status,
    r.name,
    lower(r.email),
    r.approved_at,
    r.note
  from public.mf_access_requests r
  where lower(r.email) = v_email
  limit 1;
end;
$$;

grant execute on function public.mf_get_access_status(text) to anon, authenticated;
grant execute on function public.mf_request_access(text, text) to anon, authenticated;

-- Enforce de backend: bloqueia criacao de usuario sem aprovacao.
create or replace function public.mf_enforce_signup_approval()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_status text;
  v_email text := lower(trim(coalesce(new.email, '')));
begin
  if v_email = '' then
    raise exception 'MF_ACCESS_DENIED:invalid_email';
  end if;

  select r.status
    into v_status
  from public.mf_access_requests r
  where lower(r.email) = v_email
  order by r.created_at desc
  limit 1;

  if v_status is distinct from 'approved' then
    raise exception 'MF_ACCESS_DENIED:email_not_approved';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_mf_enforce_signup_approval on auth.users;
create trigger trg_mf_enforce_signup_approval
before insert on auth.users
for each row
execute procedure public.mf_enforce_signup_approval();

