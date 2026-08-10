begin;

-- MF Financeiro hardening: reduce RPC exposure without deleting financial history.
-- This migration is intentionally additive/idempotent over the current production schema.

-- Utility function reported by the security advisor: pin search_path.
alter function public.mf_fixed_bill_due_date(date, integer) set search_path = '';

-- Functions that are implementation details, legacy APIs, trigger handlers, or destructive
-- maintenance paths. They must never be callable by browser roles.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'check_access_request_status',
        'mf_create_finance_entry_v2',
        'mf_delete_all_finance_entries',
        'mf_fixed_bill_cycle_bounds',
        'mf_fixed_bill_due_date',
        'mf_infer_payment_method',
        'mf_link_fixed_bill_payment',
        'mf_resolve_access_entry',
        'mf_reverse_current_fixed_bill_payment_on_delete',
        'mf_set_audit_fields',
        'mf_sync_fixed_bill_snapshots',
        'set_mf_global_settings_updated_at',
        'set_updated_at'
      ])
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn.signature);
    execute format('grant execute on function %s to service_role', fn.signature);
  end loop;
end
$$;

-- SECURITY DEFINER operations that are legitimate authenticated product flows.
-- Revoke the implicit PUBLIC/anon exposure and make the intended roles explicit.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (array[
        'mf_create_fixed_bill_recurring',
        'mf_end_fixed_bill_recurring',
        'mf_ensure_fixed_bill_occurrences',
        'mf_pay_card_installment',
        'mf_pay_credit_card_bill_v2',
        'mf_pay_fixed_bill_occurrence',
        'mf_reopen_fixed_bill_occurrence',
        'mf_save_payroll_statement_v2',
        'mf_set_finance_entry_paid',
        'mf_set_maintenance_mode',
        'mf_skip_fixed_bill_occurrence',
        'mf_update_fixed_bill_future',
        'mf_update_fixed_bill_occurrence'
      ])
  loop
    execute format('revoke execute on function %s from public, anon', fn.signature);
    execute format('grant execute on function %s to authenticated, service_role', fn.signature);
  end loop;
end
$$;

-- Pre-auth access request is intentionally public. Keep only this write entrypoint available
-- to anon; account-state lookup is routed through the controlled Edge Function/service role.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'submit_access_request'
  loop
    execute format('revoke execute on function %s from public', fn.signature);
    execute format('grant execute on function %s to anon, authenticated, service_role', fn.signature);
  end loop;
end
$$;

-- Remove permissive duplicate legacy policies. The operation-specific owner policies remain.
drop policy if exists "Users can manage their own installments" on public.mf_card_installments;
drop policy if exists "Manage own credit cards" on public.mf_credit_cards;
drop policy if exists "Manage own ledger" on public.mf_finance_ledger_entries;
drop policy if exists "Users manage own finance ledger entries" on public.mf_finance_ledger_entries;
drop policy if exists "Manage own fixed bills" on public.mf_fixed_bills;
drop policy if exists "Users manage own investments" on public.mf_investments;
drop policy if exists "Manage own settings" on public.mf_user_settings;
drop policy if exists "Users can manage their own settings" on public.mf_user_settings;

-- Older occurrence policies had the public role even though their predicates used auth.uid().
-- Narrow their role explicitly to authenticated.
alter policy "fixed bill occurrences select own" on public.mf_fixed_bill_occurrences to authenticated;
alter policy "fixed bill occurrences insert own" on public.mf_fixed_bill_occurrences to authenticated;
alter policy "fixed bill occurrences update own" on public.mf_fixed_bill_occurrences to authenticated;
alter policy "fixed bill occurrences delete own" on public.mf_fixed_bill_occurrences to authenticated;

-- Redacted operational telemetry. No financial description, amount, document text, e-mail,
-- account/card identifiers, or raw exception payload belongs here.
create table if not exists public.mf_operational_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  event_name text not null check (event_name ~ '^[a-z0-9_.-]{3,80}$'),
  area text not null check (area ~ '^[a-z0-9_.-]{2,60}$'),
  severity text not null default 'error' check (severity in ('info', 'warning', 'error')),
  context jsonb not null default '{}'::jsonb check (
    jsonb_typeof(context) = 'object'
    and octet_length(context::text) <= 4096
  ),
  created_at timestamptz not null default now()
);

alter table public.mf_operational_events enable row level security;
revoke all on table public.mf_operational_events from public, anon, authenticated;
grant insert on table public.mf_operational_events to authenticated;
grant all on table public.mf_operational_events to service_role;

drop policy if exists "operational events insert own" on public.mf_operational_events;
create policy "operational events insert own"
on public.mf_operational_events
for insert
to authenticated
with check ((select auth.uid()) = user_id);

comment on table public.mf_operational_events is
  'Redacted client/runtime operational events. Never store raw financial or document data.';

-- Audit trail for privileged/global configuration mutations.
create table if not exists public.mf_admin_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null check (action ~ '^[a-z0-9_.-]{3,100}$'),
  context jsonb not null default '{}'::jsonb check (
    jsonb_typeof(context) = 'object'
    and octet_length(context::text) <= 4096
  ),
  created_at timestamptz not null default now()
);

alter table public.mf_admin_audit_events enable row level security;
revoke all on table public.mf_admin_audit_events from public, anon, authenticated;
grant select on table public.mf_admin_audit_events to authenticated;
grant all on table public.mf_admin_audit_events to service_role;

drop policy if exists "admin audit select admins" on public.mf_admin_audit_events;
create policy "admin audit select admins"
on public.mf_admin_audit_events
for select
to authenticated
using (public.mf_is_admin_user());

create or replace function public.mf_audit_global_settings_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.mf_admin_audit_events(actor_user_id, action, context)
  values (
    auth.uid(),
    'global_settings.update',
    jsonb_build_object(
      'maintenance_mode_before', old.maintenance_mode,
      'maintenance_mode_after', new.maintenance_mode
    )
  );
  return new;
end;
$$;

revoke execute on function public.mf_audit_global_settings_change() from public, anon, authenticated;
grant execute on function public.mf_audit_global_settings_change() to service_role;

drop trigger if exists mf_audit_global_settings_change on public.mf_global_settings;
create trigger mf_audit_global_settings_change
after update on public.mf_global_settings
for each row
when (old is distinct from new)
execute function public.mf_audit_global_settings_change();

comment on table public.mf_admin_audit_events is
  'Security audit trail for privileged/global configuration changes.';

commit;
