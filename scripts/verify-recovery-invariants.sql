-- MF Financeiro recovery/security invariants.
-- Read-only: safe to execute before a migration and after a restore.

-- 1. Every public table must have RLS.
select c.relname as table_name
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r'
  and not c.relrowsecurity
order by c.relname;

-- 2. No SECURITY DEFINER helper should be executable by anon, except the explicitly
-- reviewed pre-auth request entrypoint (which is not named mf_*).
select p.oid::regprocedure::text as exposed_security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prosecdef
  and p.proname like 'mf_%'
  and has_function_privilege('anon', p.oid, 'EXECUTE')
order by 1;

-- 3. Bulk ledger destruction must not be available to the authenticated browser role.
select p.oid::regprocedure::text as destructive_function_exposed
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'mf_delete_all_finance_entries'
  and has_function_privilege('authenticated', p.oid, 'EXECUTE');

-- 4. Internal cross-user helpers must not be browser-callable.
select p.oid::regprocedure::text as internal_helper_exposed
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('mf_sync_fixed_bill_snapshots', 'mf_fixed_bill_cycle_bounds')
  and (
    has_function_privilege('anon', p.oid, 'EXECUTE')
    or has_function_privilege('authenticated', p.oid, 'EXECUTE')
  )
order by 1;

-- 5. User-owned core tables should not contain rows for missing auth users.
select 'mf_finance_ledger_entries' as relation, count(*) as orphan_count
from public.mf_finance_ledger_entries t
left join auth.users u on u.id = t.user_id
where u.id is null
union all
select 'mf_financial_accounts', count(*)
from public.mf_financial_accounts t left join auth.users u on u.id = t.user_id where u.id is null
union all
select 'mf_credit_cards', count(*)
from public.mf_credit_cards t left join auth.users u on u.id = t.user_id where u.id is null
union all
select 'mf_fixed_bills', count(*)
from public.mf_fixed_bills t left join auth.users u on u.id = t.user_id where u.id is null
union all
select 'mf_document_extractions', count(*)
from public.mf_document_extractions t left join auth.users u on u.id = t.user_id where u.id is null
order by 1;

-- 6. Financial document bucket must remain private.
select id, public
from storage.buckets
where id = 'mf-import-documents';

-- Expected result for checks 1-4: zero rows.
-- Expected result for check 5: orphan_count = 0 for every relation.
-- Expected result for check 6: public = false.
