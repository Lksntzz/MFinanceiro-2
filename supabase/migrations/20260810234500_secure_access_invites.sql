-- Prepare an invite-only activation path that does not expose account/request
-- existence to unauthenticated callers. This migration is intentionally
-- additive: it does not delete existing access requests or users.

alter table public.mf_access_requests
  add column if not exists activation_token_hash text,
  add column if not exists activation_token_expires_at timestamptz,
  add column if not exists activation_last_sent_at timestamptz;

comment on column public.mf_access_requests.activation_token_hash is
  'SHA-256 hash of the short-lived server-generated token used by the Before User Created hook.';
comment on column public.mf_access_requests.activation_token_expires_at is
  'Expiry for the short-lived activation token. The raw token is never persisted.';
comment on column public.mf_access_requests.activation_last_sent_at is
  'Last successful invite send time, used by the server to suppress repeated invitation sends.';

create or replace function public.mf_prepare_access_request(p_nome text, p_email text)
returns table(
  request_id uuid,
  request_status text,
  normalized_email text,
  display_name text,
  existing_account boolean
)
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'pg_temp'
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := left(btrim(coalesce(p_nome, '')), 160);
  v_id uuid;
  v_status text;
begin
  if v_name = '' or v_email = '' or length(v_email) > 254
     or v_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    return;
  end if;

  if exists (
    select 1
    from auth.users u
    where lower(coalesce(u.email, '')) = v_email
      and u.deleted_at is null
  ) then
    return query select null::uuid, 'account'::text, v_email, v_name, true;
    return;
  end if;

  select r.id, lower(r.status), coalesce(nullif(btrim(r.nome), ''), v_name)
    into v_id, v_status, v_name
  from public.mf_access_requests r
  where lower(r.email) = v_email
  order by r.updated_at desc nulls last, r.created_at desc
  limit 1;

  if v_id is null then
    insert into public.mf_access_requests (nome, email, status)
    values (v_name, v_email, 'pendente')
    returning id, lower(status) into v_id, v_status;
  elsif v_status in ('negado', 'denied', 'rejected') then
    update public.mf_access_requests
       set nome = v_name,
           status = 'pendente',
           observacao = null,
           aprovado_por = null,
           aprovado_em = null,
           activation_token_hash = null,
           activation_token_expires_at = null,
           updated_at = now()
     where id = v_id;
    v_status := 'pendente';
  else
    update public.mf_access_requests
       set nome = coalesce(nullif(v_name, ''), nome),
           updated_at = now()
     where id = v_id;
  end if;

  return query select v_id, v_status, v_email, v_name, false;
end;
$$;

revoke all on function public.mf_prepare_access_request(text, text) from public;
revoke all on function public.mf_prepare_access_request(text, text) from anon, authenticated;
grant execute on function public.mf_prepare_access_request(text, text) to service_role;

-- The Auth hook receives metadata placed only by the trusted invitation Edge
-- Function. A direct public /signup call therefore cannot create an MF account.
create or replace function public.mf_before_user_created(event jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'extensions', 'pg_temp'
as $$
declare
  v_email text := lower(btrim(coalesce(event -> 'user' ->> 'email', '')));
  v_metadata jsonb := coalesce(event -> 'user' -> 'user_metadata', '{}'::jsonb);
  v_request_text text := btrim(coalesce(v_metadata ->> 'mf_access_request_id', ''));
  v_token text := coalesce(v_metadata ->> 'mf_invite_token', '');
  v_request_id uuid;
  v_token_hash text;
  v_allowed boolean := false;
begin
  if v_request_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     and length(v_token) between 32 and 256 then
    v_request_id := v_request_text::uuid;
    v_token_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

    select exists (
      select 1
      from public.mf_access_requests r
      where r.id = v_request_id
        and lower(r.email) = v_email
        and lower(r.status) in ('aprovado', 'approved')
        and r.activation_token_hash = v_token_hash
        and r.activation_token_expires_at > now()
    ) into v_allowed;
  end if;

  if not v_allowed then
    return jsonb_build_object(
      'error',
      jsonb_build_object(
        'http_code', 403,
        'message', 'Cadastro disponível apenas por convite válido.'
      )
    );
  end if;

  return '{}'::jsonb;
end;
$$;

revoke all on function public.mf_before_user_created(jsonb) from public;
revoke all on function public.mf_before_user_created(jsonb) from anon, authenticated, service_role;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.mf_before_user_created(jsonb) to supabase_auth_admin;

-- Retire the public discovery primitives. They may remain in the schema for
-- backwards compatibility, but unauthenticated/authenticated clients can no
-- longer execute them directly.
revoke execute on function public.mf_resolve_access_entry(text) from public, anon, authenticated;
revoke execute on function public.check_access_request_status(text) from public, anon, authenticated;
revoke execute on function public.submit_access_request(text, text) from public, anon, authenticated;
