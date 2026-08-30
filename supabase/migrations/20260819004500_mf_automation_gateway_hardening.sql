-- Hardening for the MF automation gateway foundation.

revoke all on public.mf_automation_preferences from service_role;
grant select, insert, update on public.mf_automation_preferences to service_role;

revoke all on public.mf_automation_notifications from service_role;
grant select, insert, update, delete on public.mf_automation_notifications to service_role;

create or replace function public.mf_peek_automation_context(
  p_context_ref uuid,
  p_required_scope text
)
returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'valid', true,
    'expires_at', context.expires_at,
    'remaining_uses', greatest(0, context.max_uses - context.use_count)
  )
  from mf_private.mf_automation_contexts context
  where context.context_ref = p_context_ref
    and context.revoked_at is null
    and context.expires_at > now()
    and context.use_count < context.max_uses
    and p_required_scope = any(context.scopes)
  limit 1;
$$;

revoke all on function public.mf_peek_automation_context(uuid, text) from public;
revoke all on function public.mf_peek_automation_context(uuid, text) from anon;
revoke all on function public.mf_peek_automation_context(uuid, text) from authenticated;
grant execute on function public.mf_peek_automation_context(uuid, text) to service_role;
