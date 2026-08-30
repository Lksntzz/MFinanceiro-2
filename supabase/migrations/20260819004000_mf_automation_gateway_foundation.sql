-- MF Financeiro automation gateway foundation.
-- Additive only. n8n never receives direct table access and never writes financial ledgers.

create schema if not exists mf_private;
revoke all on schema mf_private from public;
revoke all on schema mf_private from anon;
revoke all on schema mf_private from authenticated;

create table if not exists public.mf_automation_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  smart_notifications_enabled boolean not null default false,
  pulse_enabled boolean not null default false,
  smart_recurrence_enabled boolean not null default false,
  inbox_automation_enabled boolean not null default false,
  ocr_orchestrator_enabled boolean not null default false,
  open_finance_automation_enabled boolean not null default false,
  budget_watch_enabled boolean not null default false,
  card_watch_enabled boolean not null default false,
  goal_watch_enabled boolean not null default false,
  financial_agenda_enabled boolean not null default false,
  data_quality_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.mf_automation_preferences enable row level security;

drop policy if exists mf_automation_preferences_select_own on public.mf_automation_preferences;
create policy mf_automation_preferences_select_own
  on public.mf_automation_preferences for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists mf_automation_preferences_insert_own on public.mf_automation_preferences;
create policy mf_automation_preferences_insert_own
  on public.mf_automation_preferences for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists mf_automation_preferences_update_own on public.mf_automation_preferences;
create policy mf_automation_preferences_update_own
  on public.mf_automation_preferences for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.mf_automation_preferences from anon;
grant select, insert, update on public.mf_automation_preferences to authenticated;

insert into public.mf_automation_preferences (user_id)
select id from auth.users
on conflict (user_id) do nothing;

create table if not exists public.mf_automation_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null default 'automation',
  priority text not null default 'INFO'
    check (priority in ('INFO', 'ATTENTION', 'WARNING', 'CRITICAL')),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  message text not null check (char_length(btrim(message)) between 1 and 360),
  action_path text check (action_path is null or (action_path like '/app%' and char_length(action_path) <= 240)),
  source text not null default 'n8n' check (source in ('n8n', 'system')),
  correlation_id uuid,
  dedupe_key text,
  status text not null default 'unread'
    check (status in ('unread', 'read', 'dismissed', 'actioned')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object' and octet_length(metadata::text) <= 4096),
  read_at timestamptz,
  dismissed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mf_automation_notifications_dedupe_key_len
    check (dedupe_key is null or char_length(dedupe_key) between 1 and 180),
  constraint mf_automation_notifications_user_dedupe_key unique (user_id, dedupe_key)
);

create index if not exists mf_automation_notifications_user_status_created_idx
  on public.mf_automation_notifications (user_id, status, created_at desc);
create index if not exists mf_automation_notifications_expires_idx
  on public.mf_automation_notifications (expires_at)
  where expires_at is not null;

alter table public.mf_automation_notifications enable row level security;

drop policy if exists mf_automation_notifications_select_own on public.mf_automation_notifications;
create policy mf_automation_notifications_select_own
  on public.mf_automation_notifications for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists mf_automation_notifications_update_own on public.mf_automation_notifications;
create policy mf_automation_notifications_update_own
  on public.mf_automation_notifications for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.mf_automation_notifications from anon;
revoke insert, delete on public.mf_automation_notifications from authenticated;
grant select on public.mf_automation_notifications to authenticated;
grant update (status, read_at, dismissed_at) on public.mf_automation_notifications to authenticated;

create table if not exists mf_private.mf_automation_contexts (
  context_ref uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  scopes text[] not null,
  source text not null default 'system',
  use_count integer not null default 0 check (use_count >= 0),
  max_uses integer not null default 20 check (max_uses between 1 and 100),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint mf_automation_contexts_scope_check
    check (cardinality(scopes) between 1 and 16),
  constraint mf_automation_contexts_source_check
    check (char_length(source) between 1 and 120)
);

create index if not exists mf_automation_contexts_user_expires_idx
  on mf_private.mf_automation_contexts (user_id, expires_at desc);
create index if not exists mf_automation_contexts_expires_idx
  on mf_private.mf_automation_contexts (expires_at);

revoke all on mf_private.mf_automation_contexts from public;
revoke all on mf_private.mf_automation_contexts from anon;
revoke all on mf_private.mf_automation_contexts from authenticated;

create table if not exists mf_private.mf_automation_idempotency (
  idempotency_key text primary key,
  action text not null,
  correlation_id uuid not null,
  context_ref uuid,
  response jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mf_automation_idempotency_key_len check (char_length(idempotency_key) between 10 and 200),
  constraint mf_automation_idempotency_action_len check (char_length(action) between 3 and 80),
  constraint mf_automation_idempotency_response_size check (octet_length(response::text) <= 65536)
);

create index if not exists mf_automation_idempotency_expires_idx
  on mf_private.mf_automation_idempotency (expires_at);

revoke all on mf_private.mf_automation_idempotency from public;
revoke all on mf_private.mf_automation_idempotency from anon;
revoke all on mf_private.mf_automation_idempotency from authenticated;

create or replace function mf_private.mf_automation_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function mf_private.mf_automation_touch_updated_at() from public;
revoke execute on function mf_private.mf_automation_touch_updated_at() from anon;
revoke execute on function mf_private.mf_automation_touch_updated_at() from authenticated;

drop trigger if exists mf_automation_preferences_touch_updated_at on public.mf_automation_preferences;
create trigger mf_automation_preferences_touch_updated_at
before update on public.mf_automation_preferences
for each row execute function mf_private.mf_automation_touch_updated_at();

drop trigger if exists mf_automation_notifications_touch_updated_at on public.mf_automation_notifications;
create trigger mf_automation_notifications_touch_updated_at
before update on public.mf_automation_notifications
for each row execute function mf_private.mf_automation_touch_updated_at();

create or replace function public.mf_create_automation_context(
  p_user_id uuid,
  p_scopes text[],
  p_source text default 'system',
  p_ttl_seconds integer default 900,
  p_max_uses integer default 20
)
returns table (
  context_ref uuid,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'AUTOMATION_USER_INVALID';
  end if;
  if p_scopes is null or cardinality(p_scopes) < 1 or cardinality(p_scopes) > 16 then
    raise exception 'AUTOMATION_SCOPE_INVALID';
  end if;
  if exists (
    select 1
    from unnest(p_scopes) scope
    where scope !~ '^[a-z][a-z0-9_]{1,39}$'
  ) then
    raise exception 'AUTOMATION_SCOPE_INVALID';
  end if;

  return query
  insert into mf_private.mf_automation_contexts (
    user_id,
    scopes,
    source,
    max_uses,
    expires_at
  )
  values (
    p_user_id,
    array(select distinct scope from unnest(p_scopes) scope),
    left(coalesce(nullif(btrim(p_source), ''), 'system'), 120),
    greatest(1, least(coalesce(p_max_uses, 20), 100)),
    now() + make_interval(secs => greatest(60, least(coalesce(p_ttl_seconds, 900), 3600)))
  )
  returning
    mf_private.mf_automation_contexts.context_ref,
    mf_private.mf_automation_contexts.expires_at;
end;
$$;

revoke all on function public.mf_create_automation_context(uuid, text[], text, integer, integer) from public;
revoke all on function public.mf_create_automation_context(uuid, text[], text, integer, integer) from anon;
revoke all on function public.mf_create_automation_context(uuid, text[], text, integer, integer) from authenticated;
grant execute on function public.mf_create_automation_context(uuid, text[], text, integer, integer) to service_role;

create or replace function public.mf_resolve_automation_context(
  p_context_ref uuid,
  p_required_scope text
)
returns table (
  user_id uuid,
  scopes text[],
  expires_at timestamptz,
  use_count integer,
  max_uses integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_context_ref is null or p_required_scope is null then
    raise exception 'AUTOMATION_CONTEXT_INVALID';
  end if;

  return query
  update mf_private.mf_automation_contexts context
  set use_count = context.use_count + 1
  where context.context_ref = p_context_ref
    and context.revoked_at is null
    and context.expires_at > now()
    and context.use_count < context.max_uses
    and p_required_scope = any(context.scopes)
  returning
    context.user_id,
    context.scopes,
    context.expires_at,
    context.use_count,
    context.max_uses;

  if not found then
    raise exception 'AUTOMATION_CONTEXT_INVALID';
  end if;
end;
$$;

revoke all on function public.mf_resolve_automation_context(uuid, text) from public;
revoke all on function public.mf_resolve_automation_context(uuid, text) from anon;
revoke all on function public.mf_resolve_automation_context(uuid, text) from authenticated;
grant execute on function public.mf_resolve_automation_context(uuid, text) to service_role;

create or replace function public.mf_automation_idempotency_get(p_key text)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  select item.response
  from mf_private.mf_automation_idempotency item
  where item.idempotency_key = p_key
    and item.expires_at > now()
  limit 1;
$$;

revoke all on function public.mf_automation_idempotency_get(text) from public;
revoke all on function public.mf_automation_idempotency_get(text) from anon;
revoke all on function public.mf_automation_idempotency_get(text) from authenticated;
grant execute on function public.mf_automation_idempotency_get(text) to service_role;

create or replace function public.mf_automation_idempotency_put(
  p_key text,
  p_action text,
  p_correlation_id uuid,
  p_context_ref uuid,
  p_response jsonb,
  p_ttl_seconds integer default 86400
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_key is null or p_action is null or p_correlation_id is null or p_response is null then
    raise exception 'AUTOMATION_IDEMPOTENCY_INVALID';
  end if;

  insert into mf_private.mf_automation_idempotency (
    idempotency_key,
    action,
    correlation_id,
    context_ref,
    response,
    expires_at
  )
  values (
    left(p_key, 200),
    left(p_action, 80),
    p_correlation_id,
    p_context_ref,
    p_response,
    now() + make_interval(secs => greatest(300, least(coalesce(p_ttl_seconds, 86400), 604800)))
  )
  on conflict (idempotency_key) do update
  set
    response = excluded.response,
    expires_at = excluded.expires_at,
    updated_at = now();
end;
$$;

revoke all on function public.mf_automation_idempotency_put(text, text, uuid, uuid, jsonb, integer) from public;
revoke all on function public.mf_automation_idempotency_put(text, text, uuid, uuid, jsonb, integer) from anon;
revoke all on function public.mf_automation_idempotency_put(text, text, uuid, uuid, jsonb, integer) from authenticated;
grant execute on function public.mf_automation_idempotency_put(text, text, uuid, uuid, jsonb, integer) to service_role;

create or replace function public.mf_cleanup_automation_runtime()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contexts integer := 0;
  v_idempotency integer := 0;
begin
  delete from mf_private.mf_automation_contexts
  where expires_at < now() - interval '1 day'
     or revoked_at < now() - interval '1 day';
  get diagnostics v_contexts = row_count;

  delete from mf_private.mf_automation_idempotency
  where expires_at < now();
  get diagnostics v_idempotency = row_count;

  return jsonb_build_object(
    'contexts_deleted', v_contexts,
    'idempotency_deleted', v_idempotency
  );
end;
$$;

revoke all on function public.mf_cleanup_automation_runtime() from public;
revoke all on function public.mf_cleanup_automation_runtime() from anon;
revoke all on function public.mf_cleanup_automation_runtime() from authenticated;
grant execute on function public.mf_cleanup_automation_runtime() to service_role;
