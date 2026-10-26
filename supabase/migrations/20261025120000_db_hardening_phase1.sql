-- Fase 1 · Endurecimento de segurança e desempenho do banco.
-- Seguro para reexecutar. Não altera dados de usuários.

-- 1) EXECUTE: funções expostas só para quem está logado ------------------------
-- (PUBLIC precisa ser revogado, senão "anon" continua herdando o direito.)
do $$
declare
  fn text;
  user_facing text[] := array[
    'public.mf_create_finance_entry_v2(text,numeric,date,text,text,text,text,uuid,integer,date,text)',
    'public.mf_create_fixed_bill_recurring(text,numeric,integer,text)',
    'public.mf_end_fixed_bill_recurring(uuid)',
    'public.mf_ensure_fixed_bill_occurrences(integer)',
    'public.mf_pay_credit_card_bill_v2(uuid)',
    'public.mf_pay_fixed_bill_occurrence(uuid,text)',
    'public.mf_reopen_fixed_bill_occurrence(uuid)',
    'public.mf_set_finance_entry_paid(uuid)',
    'public.mf_skip_fixed_bill_occurrence(uuid)',
    'public.mf_update_fixed_bill_future(uuid,date,numeric,integer,text,text)',
    'public.mf_update_fixed_bill_occurrence(uuid,numeric,date,text)'
  ];
  internal_only text[] := array[
    -- ajudantes internos (chamados apenas por outras funções SECURITY DEFINER)
    'public.mf_sync_fixed_bill_snapshots(uuid)',
    'public.mf_fixed_bill_cycle_bounds(uuid,date)',
    -- funções de gatilho (triggers não exigem EXECUTE do usuário)
    'public.mf_link_fixed_bill_payment()',
    'public.mf_reverse_current_fixed_bill_payment_on_delete()',
    'public.mf_infer_payment_method()',
    'public.mf_set_audit_fields()',
    'public.set_updated_at()',
    'public.set_mf_global_settings_updated_at()'
  ];
begin
  foreach fn in array user_facing loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated, service_role', fn);
  end loop;
  foreach fn in array internal_only loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end $$;

-- submit_access_request continua público de propósito (pedido de acesso sem login).

-- 2) search_path fixo -----------------------------------------------------------
alter function public.mf_fixed_bill_due_date(date, integer) set search_path = pg_catalog;

-- 3) Evita o ciclo "atualiza -> realtime -> recarrega -> atualiza" ------------------
-- A função só grava quando o valor realmente mudou.
create or replace function public.mf_sync_fixed_bill_snapshots(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_start date;
  v_end date;
  v_bill record;
  v_occ record;
begin
  select cycle_start, cycle_end into v_start, v_end
  from public.mf_fixed_bill_cycle_bounds(p_user_id, current_date);

  for v_bill in
    select * from public.mf_fixed_bills
    where user_id = p_user_id
  loop
    select o.* into v_occ
    from public.mf_fixed_bill_occurrences o
    where o.fixed_bill_id = v_bill.id
      and o.due_date >= v_start
      and o.due_date < v_end
    order by o.due_date
    limit 1;

    if not found then
      select o.* into v_occ
      from public.mf_fixed_bill_occurrences o
      where o.fixed_bill_id = v_bill.id
        and o.due_date >= v_end
        and o.status <> 'skipped'
      order by o.due_date
      limit 1;
    end if;

    if found then
      update public.mf_fixed_bills
      set amount = v_occ.amount,
          due_day = extract(day from v_occ.due_date)::integer,
          status = case when v_occ.status = 'paid' then 'paid' else 'pending' end,
          last_paid_month = case
            when v_occ.status = 'paid' then to_char(v_occ.competence, 'YYYY-MM')
            else last_paid_month
          end,
          updated_at = now(),
          updated_by = p_user_id
      where id = v_bill.id
        and (
          amount is distinct from v_occ.amount
          or due_day is distinct from extract(day from v_occ.due_date)::integer
          or status is distinct from (case when v_occ.status = 'paid' then 'paid' else 'pending' end)
          or last_paid_month is distinct from (case
            when v_occ.status = 'paid' then to_char(v_occ.competence, 'YYYY-MM')
            else last_paid_month
          end)
        );
    else
      update public.mf_fixed_bills
      set amount = coalesce(default_amount, amount),
          due_day = coalesce(default_due_day, due_day),
          status = 'pending',
          updated_at = now(),
          updated_by = p_user_id
      where id = v_bill.id
        and (
          amount is distinct from coalesce(default_amount, amount)
          or due_day is distinct from coalesce(default_due_day, due_day)
          or status is distinct from 'pending'
        );
    end if;
  end loop;
end;
$function$;

revoke execute on function public.mf_sync_fixed_bill_snapshots(uuid) from public, anon, authenticated;
grant execute on function public.mf_sync_fixed_bill_snapshots(uuid) to service_role;

-- 4) RLS: remove políticas duplicadas (as políticas por comando já cobrem tudo) ----
drop policy if exists "Users can manage their own installments" on public.mf_card_installments;
drop policy if exists "Manage own credit cards" on public.mf_credit_cards;
drop policy if exists "Manage own ledger" on public.mf_finance_ledger_entries;
drop policy if exists "Users manage own finance ledger entries" on public.mf_finance_ledger_entries;
drop policy if exists "Manage own fixed bills" on public.mf_fixed_bills;
drop policy if exists "Users manage own investments" on public.mf_investments;
drop policy if exists "Manage own settings" on public.mf_user_settings;
drop policy if exists "Users can manage their own settings" on public.mf_user_settings;

-- 5) RLS: auth.uid() calculado uma vez por consulta (e não por linha) ---------------
do $$
declare
  r record;
  clauses text;
  changed boolean;
begin
  for r in
    select tablename, policyname, roles, qual, with_check
    from pg_policies
    where schemaname = 'public'
  loop
    clauses := '';
    changed := false;

    if r.qual is not null then
      if r.qual ~ 'auth\.uid\(\)' and r.qual !~* 'select auth\.uid\(\)' then
        clauses := clauses || format(' using (%s)', regexp_replace(r.qual, 'auth\.uid\(\)', '(select auth.uid())', 'g'));
        changed := true;
      end if;
    end if;

    if r.with_check is not null then
      if r.with_check ~ 'auth\.uid\(\)' and r.with_check !~* 'select auth\.uid\(\)' then
        clauses := clauses || format(' with check (%s)', regexp_replace(r.with_check, 'auth\.uid\(\)', '(select auth.uid())', 'g'));
        changed := true;
      end if;
    end if;

    if 'public' = any (r.roles) and r.qual is not null and r.qual ~ 'auth\.uid\(\)' then
      clauses := ' to authenticated' || clauses;
      changed := true;
    end if;

    if changed then
      execute format('alter policy %I on public.%I%s', r.policyname, r.tablename, clauses);
    end if;
  end loop;
end $$;

-- 6) Índices nas chaves estrangeiras ---------------------------------------------
create index if not exists mf_finance_ledger_entries_card_id_idx on public.mf_finance_ledger_entries (card_id);
create index if not exists mf_finance_ledger_entries_account_id_idx on public.mf_finance_ledger_entries (account_id);
create index if not exists mf_finance_ledger_entries_category_id_idx on public.mf_finance_ledger_entries (category_id);
create index if not exists mf_fixed_bill_occurrences_ledger_entry_id_idx on public.mf_fixed_bill_occurrences (ledger_entry_id);
