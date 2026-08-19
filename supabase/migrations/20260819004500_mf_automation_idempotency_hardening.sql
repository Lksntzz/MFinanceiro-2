-- Harden the n8n automation idempotency cache against cross-context reuse.
-- This migration is additive and must be applied together with the gateway foundation.

alter table mf_private.mf_automation_idempotency
  drop constraint if exists mf_automation_idempotency_context_fk;

alter table mf_private.mf_automation_idempotency
  add constraint mf_automation_idempotency_context_fk
  foreign key (context_ref)
  references mf_private.mf_automation_contexts(context_ref)
  on delete cascade;

-- The legacy one-argument getter does not bind cached responses to a context.
-- Keep it inaccessible so only the context-aware contract can be used.
revoke all on function public.mf_automation_idempotency_get(text) from public;
revoke all on function public.mf_automation_idempotency_get(text) from anon;
revoke all on function public.mf_automation_idempotency_get(text) from authenticated;
revoke all on function public.mf_automation_idempotency_get(text) from service_role;

create or replace function public.mf_automation_idempotency_get(
  p_key text,
  p_context_ref uuid
)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  select item.response
  from mf_private.mf_automation_idempotency item
  left join mf_private.mf_automation_contexts context
    on context.context_ref = item.context_ref
  where item.idempotency_key = p_key
    and item.expires_at > now()
    and (
      (
        p_context_ref is null
        and item.context_ref is null
      )
      or
      (
        p_context_ref is not null
        and item.context_ref = p_context_ref
        and context.context_ref is not null
        and context.revoked_at is null
        and context.expires_at > now()
        and context.use_count < context.max_uses
      )
    )
  limit 1;
$$;

revoke all on function public.mf_automation_idempotency_get(text, uuid) from public;
revoke all on function public.mf_automation_idempotency_get(text, uuid) from anon;
revoke all on function public.mf_automation_idempotency_get(text, uuid) from authenticated;
grant execute on function public.mf_automation_idempotency_get(text, uuid) to service_role;

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
declare
  v_rows integer := 0;
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
    updated_at = now()
  where mf_private.mf_automation_idempotency.action = excluded.action
    and mf_private.mf_automation_idempotency.correlation_id = excluded.correlation_id
    and mf_private.mf_automation_idempotency.context_ref is not distinct from excluded.context_ref;

  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'AUTOMATION_IDEMPOTENCY_COLLISION';
  end if;
end;
$$;

revoke all on function public.mf_automation_idempotency_put(text, text, uuid, uuid, jsonb, integer) from public;
revoke all on function public.mf_automation_idempotency_put(text, text, uuid, uuid, jsonb, integer) from anon;
revoke all on function public.mf_automation_idempotency_put(text, text, uuid, uuid, jsonb, integer) from authenticated;
grant execute on function public.mf_automation_idempotency_put(text, text, uuid, uuid, jsonb, integer) to service_role;
