begin;

-- User-visible activity history. This is deliberately separate from operational telemetry:
-- the user may read their own activity, but cannot rewrite or delete the audit trail.
create table if not exists public.mf_user_activity_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  action text not null check (action ~ '^[a-z0-9_.-]{3,100}$'),
  entity_type text not null check (entity_type ~ '^[a-z0-9_.-]{2,80}$'),
  entity_id text,
  summary text not null check (char_length(summary) between 3 and 240),
  metadata jsonb not null default '{}'::jsonb check (
    jsonb_typeof(metadata) = 'object'
    and octet_length(metadata::text) <= 4096
  ),
  created_at timestamptz not null default now()
);

create index if not exists mf_user_activity_events_user_created_idx
  on public.mf_user_activity_events (user_id, created_at desc);

alter table public.mf_user_activity_events enable row level security;

revoke all on table public.mf_user_activity_events from public, anon, authenticated;
grant select, insert on table public.mf_user_activity_events to authenticated;
grant all on table public.mf_user_activity_events to service_role;

drop policy if exists "user activity select own" on public.mf_user_activity_events;
create policy "user activity select own"
on public.mf_user_activity_events
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "user activity insert own" on public.mf_user_activity_events;
create policy "user activity insert own"
on public.mf_user_activity_events
for insert
to authenticated
with check ((select auth.uid()) = user_id);

comment on table public.mf_user_activity_events is
  'User-visible immutable activity history. Keep summaries concise and never store secret credentials, document payloads or raw financial values in metadata.';

commit;
