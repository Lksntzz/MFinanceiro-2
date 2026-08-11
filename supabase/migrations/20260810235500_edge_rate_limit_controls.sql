begin;

-- Persistent fixed-window rate limiting for Supabase Edge Functions.
-- Only service_role may write/read these buckets; browser roles never see raw
-- request identifiers. Edge Functions send only HMAC/SHA-256 identifiers.
create table if not exists public.mf_rate_limit_windows (
  scope text not null check (scope ~ '^[a-z0-9_.-]{3,80}$'),
  key_hash text not null check (key_hash ~ '^[a-f0-9]{64}$'),
  window_start timestamptz not null,
  hit_count integer not null default 1 check (hit_count >= 1),
  expires_at timestamptz not null,
  primary key (scope, key_hash, window_start)
);

create index if not exists mf_rate_limit_windows_expires_at_idx
  on public.mf_rate_limit_windows (expires_at);

alter table public.mf_rate_limit_windows enable row level security;
revoke all on table public.mf_rate_limit_windows from public, anon, authenticated;
grant all on table public.mf_rate_limit_windows to service_role;

comment on table public.mf_rate_limit_windows is
  'Service-only fixed-window rate limit buckets. key_hash must be non-reversible request/user identifiers, never raw IP/e-mail/token data.';

create or replace function public.mf_consume_rate_limit(
  p_scope text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns table(
  allowed boolean,
  remaining integer,
  retry_after_seconds integer
)
language plpgsql
security definer
set search_path = 'pg_catalog', 'public', 'pg_temp'
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window_start timestamptz;
  v_expires_at timestamptz;
  v_hit_count integer;
begin
  if p_scope is null or p_scope !~ '^[a-z0-9_.-]{3,80}$' then
    raise exception 'invalid rate limit scope';
  end if;
  if p_key_hash is null or p_key_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid rate limit key';
  end if;
  if p_limit < 1 or p_limit > 10000 then
    raise exception 'invalid rate limit';
  end if;
  if p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid rate limit window';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds
  );
  v_expires_at := v_window_start + make_interval(secs => p_window_seconds * 2);

  -- Opportunistic cleanup is scoped to the current subject so the limiter does
  -- not perform an unbounded delete on the hot request path.
  delete from public.mf_rate_limit_windows
  where scope = p_scope
    and key_hash = p_key_hash
    and expires_at < v_now;

  insert into public.mf_rate_limit_windows(scope, key_hash, window_start, hit_count, expires_at)
  values (p_scope, p_key_hash, v_window_start, 1, v_expires_at)
  on conflict (scope, key_hash, window_start)
  do update set
    hit_count = public.mf_rate_limit_windows.hit_count + 1,
    expires_at = greatest(public.mf_rate_limit_windows.expires_at, excluded.expires_at)
  returning hit_count into v_hit_count;

  return query
  select
    v_hit_count <= p_limit,
    greatest(p_limit - v_hit_count, 0),
    greatest(
      ceil(extract(epoch from ((v_window_start + make_interval(secs => p_window_seconds)) - v_now)))::integer,
      1
    );
end;
$$;

revoke all on function public.mf_consume_rate_limit(text, text, integer, integer) from public;
revoke all on function public.mf_consume_rate_limit(text, text, integer, integer) from anon, authenticated;
grant execute on function public.mf_consume_rate_limit(text, text, integer, integer) to service_role;

commit;
