begin;

-- Resolve the current fixed-bill occurrence and pay it through the existing
-- transactional occurrence RPC. This removes the client-side two-step window
-- (create ledger entry, then mark bill paid) that could leave inconsistent state.
create or replace function public.mf_pay_fixed_bill_current(
  p_fixed_bill_id uuid,
  p_payment_method text default 'unspecified'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_cycle_start date;
  v_cycle_end date;
  v_occurrence_id uuid;
begin
  if v_user is null then
    raise exception 'Usuário não autenticado';
  end if;

  if not exists (
    select 1
    from public.mf_fixed_bills bill
    where bill.id = p_fixed_bill_id
      and bill.user_id = v_user
      and coalesce(bill.active, true)
  ) then
    raise exception 'Conta fixa não encontrada';
  end if;

  perform public.mf_ensure_fixed_bill_occurrences(12);

  select cycle_start, cycle_end
    into v_cycle_start, v_cycle_end
  from public.mf_fixed_bill_cycle_bounds(v_user, current_date);

  select occurrence.id
    into v_occurrence_id
  from public.mf_fixed_bill_occurrences occurrence
  where occurrence.fixed_bill_id = p_fixed_bill_id
    and occurrence.user_id = v_user
    and occurrence.due_date >= v_cycle_start
    and occurrence.due_date < v_cycle_end
    and occurrence.status <> 'skipped'
  order by occurrence.due_date, occurrence.created_at
  limit 1;

  if v_occurrence_id is null then
    select occurrence.id
      into v_occurrence_id
    from public.mf_fixed_bill_occurrences occurrence
    where occurrence.fixed_bill_id = p_fixed_bill_id
      and occurrence.user_id = v_user
      and occurrence.due_date >= v_cycle_end
      and occurrence.status <> 'skipped'
    order by occurrence.due_date, occurrence.created_at
    limit 1;
  end if;

  if v_occurrence_id is null then
    raise exception 'Nenhuma competência disponível para pagamento';
  end if;

  return public.mf_pay_fixed_bill_occurrence(
    v_occurrence_id,
    coalesce(nullif(btrim(p_payment_method), ''), 'unspecified')
  );
end;
$$;

revoke execute on function public.mf_pay_fixed_bill_current(uuid,text) from public, anon;
grant execute on function public.mf_pay_fixed_bill_current(uuid,text) to authenticated, service_role;

commit;
