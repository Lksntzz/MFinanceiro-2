begin;

-- Open Finance / Pluggy integration over the canonical financial model.
-- This migration was never applied to production in its legacy form. The legacy
-- version attempted to mutate mf_account_balances, which is an aggregate view.
-- Provider ownership now lives on mf_financial_accounts; balances remain derived.

alter table public.mf_financial_accounts
  add column if not exists provider text,
  add column if not exists provider_account_ref text,
  add column if not exists bank_connection_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.mf_financial_accounts'::regclass
      and conname = 'mf_financial_accounts_bank_connection_fk'
  ) then
    alter table public.mf_financial_accounts
      add constraint mf_financial_accounts_bank_connection_fk
      foreign key (bank_connection_id)
      references public.mf_bank_connections(id)
      on delete set null;
  end if;
end
$$;

create unique index if not exists mf_financial_accounts_provider_account_ref_uidx
  on public.mf_financial_accounts(user_id, provider, provider_account_ref)
  where provider_account_ref is not null;

create index if not exists mf_financial_accounts_bank_connection_idx
  on public.mf_financial_accounts(user_id, bank_connection_id)
  where bank_connection_id is not null;

-- Preserve the existing view contract and append provider fields only at the end.
create or replace view public.mf_account_balances
with (security_invoker = true)
as
select
  account.id,
  account.user_id,
  account.name,
  account.account_type,
  account.currency,
  account.institution_name,
  account.opening_balance,
  account.is_default,
  account.is_active,
  account.created_at,
  account.updated_at,
  round(
    account.opening_balance + coalesce(sum(
      case
        when coalesce(ledger.status, 'paid') not in ('pending', 'duplicate', 'error', 'voided', 'reversed')
          and coalesce(ledger.affects_balance, true)
        then coalesce(ledger.amount, 0)
        else 0
      end
    ), 0),
    2
  ) as current_balance,
  count(ledger.id) as transaction_count,
  account.provider,
  account.provider_account_ref,
  account.bank_connection_id
from public.mf_financial_accounts account
left join public.mf_finance_ledger_entries ledger on ledger.account_id = account.id
group by account.id;

revoke all on public.mf_account_balances from public, anon;
grant select on public.mf_account_balances to authenticated;
grant select on public.mf_account_balances to service_role;

-- Server-only account upsert. A new provider account requires an authoritative
-- provider balance; otherwise we refuse to invent an opening balance.
create or replace function public.mf_upsert_open_finance_account_service(
  p_user_id uuid,
  p_connection_id uuid,
  p_provider text,
  p_provider_account_ref text,
  p_name text,
  p_account_type text,
  p_currency text,
  p_institution_name text,
  p_provider_balance numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account_id uuid;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'Usuário Open Finance inválido.';
  end if;

  if not exists (
    select 1
    from public.mf_bank_connections connection
    where connection.id = p_connection_id
      and connection.user_id = p_user_id
      and connection.provider = p_provider
  ) then
    raise exception using errcode = '23503', message = 'Conexão Open Finance inválida.';
  end if;

  select account.id
    into v_account_id
  from public.mf_financial_accounts account
  where account.user_id = p_user_id
    and account.provider = p_provider
    and account.provider_account_ref = p_provider_account_ref
  limit 1;

  if v_account_id is null then
    if p_provider_balance is null then
      raise exception using errcode = '22004', message = 'Saldo do provedor ausente para nova conta Open Finance.';
    end if;

    insert into public.mf_financial_accounts (
      user_id,
      name,
      account_type,
      currency,
      institution_name,
      opening_balance,
      is_default,
      is_active,
      provider,
      provider_account_ref,
      bank_connection_id
    ) values (
      p_user_id,
      coalesce(nullif(btrim(p_name), ''), 'Conta Open Finance'),
      coalesce(nullif(btrim(p_account_type), ''), 'checking'),
      coalesce(nullif(btrim(p_currency), ''), 'BRL'),
      nullif(btrim(p_institution_name), ''),
      round(p_provider_balance, 2),
      false,
      true,
      left(btrim(p_provider), 80),
      left(btrim(p_provider_account_ref), 240),
      p_connection_id
    )
    returning id into v_account_id;
  else
    update public.mf_financial_accounts account
    set
      name = coalesce(nullif(btrim(p_name), ''), account.name),
      account_type = coalesce(nullif(btrim(p_account_type), ''), account.account_type),
      currency = coalesce(nullif(btrim(p_currency), ''), account.currency),
      institution_name = coalesce(nullif(btrim(p_institution_name), ''), account.institution_name),
      bank_connection_id = p_connection_id,
      is_active = true,
      updated_at = now()
    where account.id = v_account_id
      and account.user_id = p_user_id;
  end if;

  return v_account_id;
end;
$$;

revoke execute on function public.mf_upsert_open_finance_account_service(uuid,uuid,text,text,text,text,text,text,numeric)
  from public, anon, authenticated;
grant execute on function public.mf_upsert_open_finance_account_service(uuid,uuid,text,text,text,text,text,text,numeric)
  to service_role;

-- Upsert provider-owned transaction fields while preserving the user's category
-- choice and any description edits on rows already present locally.
create or replace function public.mf_upsert_open_finance_entry_service(
  p_user_id uuid,
  p_account_id uuid,
  p_external_id text,
  p_description text,
  p_provider_category text,
  p_category_id uuid,
  p_amount numeric,
  p_date date,
  p_type text,
  p_payment_method text,
  p_status text,
  p_affects_balance boolean,
  p_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry_id uuid;
  v_existing boolean := false;
begin
  if p_type not in ('income', 'expense') then
    raise exception using errcode = '22023', message = 'Tipo Open Finance inválido.';
  end if;
  if p_external_id is null or btrim(p_external_id) = '' then
    raise exception using errcode = '22023', message = 'Identificador externo Open Finance ausente.';
  end if;
  if not exists (
    select 1
    from public.mf_financial_accounts account
    where account.id = p_account_id
      and account.user_id = p_user_id
      and account.provider = 'pluggy'
  ) then
    raise exception using errcode = '23503', message = 'Conta Open Finance inválida.';
  end if;
  if not exists (
    select 1
    from public.mf_transaction_categories category
    where category.id = p_category_id
      and category.user_id = p_user_id
      and category.is_active
      and category.category_type in ('both', p_type)
  ) then
    raise exception using errcode = '23503', message = 'Categoria Open Finance inválida.';
  end if;

  select entry.id
    into v_entry_id
  from public.mf_finance_ledger_entries entry
  where entry.user_id = p_user_id
    and entry.account_id = p_account_id
    and entry.external_id = p_external_id
  for update;

  if v_entry_id is not null then
    v_existing := true;
    update public.mf_finance_ledger_entries entry
    set
      date = p_date,
      amount = case when p_type = 'expense' then -abs(p_amount) else abs(p_amount) end,
      type = p_type,
      status = p_status,
      source = 'Open Finance · Pluggy',
      source_import = 'open_finance_pluggy',
      payment_method = p_payment_method,
      affects_balance = p_affects_balance,
      metadata = coalesce(entry.metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb),
      updated_by = p_user_id,
      updated_at = now()
    where entry.id = v_entry_id
      and entry.user_id = p_user_id;
  else
    insert into public.mf_finance_ledger_entries (
      user_id,
      external_id,
      description,
      category,
      category_id,
      amount,
      date,
      type,
      source,
      source_import,
      payment_method,
      status,
      affects_balance,
      account_id,
      metadata,
      created_by,
      updated_by
    ) values (
      p_user_id,
      left(btrim(p_external_id), 240),
      left(coalesce(nullif(btrim(p_description), ''), 'Movimentação Open Finance'), 240),
      left(coalesce(nullif(btrim(p_provider_category), ''), 'Outros'), 120),
      p_category_id,
      case when p_type = 'expense' then -abs(p_amount) else abs(p_amount) end,
      p_date,
      p_type,
      'Open Finance · Pluggy',
      'open_finance_pluggy',
      p_payment_method,
      p_status,
      p_affects_balance,
      p_account_id,
      coalesce(p_metadata, '{}'::jsonb),
      p_user_id,
      p_user_id
    )
    returning id into v_entry_id;
  end if;

  return jsonb_build_object('id', v_entry_id, 'inserted', not v_existing);
end;
$$;

revoke execute on function public.mf_upsert_open_finance_entry_service(uuid,uuid,text,text,text,uuid,numeric,date,text,text,text,boolean,jsonb)
  from public, anon, authenticated;
grant execute on function public.mf_upsert_open_finance_entry_service(uuid,uuid,text,text,text,uuid,numeric,date,text,text,text,boolean,jsonb)
  to service_role;

create or replace function public.mf_void_open_finance_entries_service(
  p_user_id uuid,
  p_connection_id uuid,
  p_external_ids text[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  if coalesce(array_length(p_external_ids, 1), 0) = 0 then
    return 0;
  end if;

  update public.mf_finance_ledger_entries entry
  set
    status = 'voided',
    affects_balance = false,
    metadata = coalesce(entry.metadata, '{}'::jsonb) || jsonb_build_object('provider_deleted', true),
    updated_by = p_user_id,
    updated_at = now()
  where entry.user_id = p_user_id
    and entry.source_import = 'open_finance_pluggy'
    and entry.external_id = any(p_external_ids)
    and entry.account_id in (
      select account.id
      from public.mf_financial_accounts account
      where account.user_id = p_user_id
        and account.bank_connection_id = p_connection_id
        and account.provider = 'pluggy'
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.mf_void_open_finance_entries_service(uuid,uuid,text[])
  from public, anon, authenticated;
grant execute on function public.mf_void_open_finance_entries_service(uuid,uuid,text[])
  to service_role;

-- Reconcile the derived account balance without writing to the balance view.
-- opening_balance becomes provider balance minus the complete local ledger effect.
create or replace function public.mf_reconcile_open_finance_account_balance_service(
  p_user_id uuid,
  p_account_id uuid,
  p_provider_balance numeric
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ledger_net numeric := 0;
  v_opening numeric;
begin
  if p_provider_balance is null then
    raise exception using errcode = '22004', message = 'Saldo do provedor ausente.';
  end if;

  perform 1
  from public.mf_financial_accounts account
  where account.id = p_account_id
    and account.user_id = p_user_id
    and account.provider = 'pluggy'
  for update;
  if not found then
    raise exception using errcode = '23503', message = 'Conta Open Finance inválida.';
  end if;

  select coalesce(sum(
    case
      when coalesce(entry.status, 'paid') not in ('pending', 'duplicate', 'error', 'voided', 'reversed')
        and coalesce(entry.affects_balance, true)
      then coalesce(entry.amount, 0)
      else 0
    end
  ), 0)
  into v_ledger_net
  from public.mf_finance_ledger_entries entry
  where entry.user_id = p_user_id
    and entry.account_id = p_account_id;

  v_opening := round(p_provider_balance - v_ledger_net, 2);

  update public.mf_financial_accounts account
  set opening_balance = v_opening, updated_at = now()
  where account.id = p_account_id
    and account.user_id = p_user_id;

  return v_opening;
end;
$$;

revoke execute on function public.mf_reconcile_open_finance_account_balance_service(uuid,uuid,numeric)
  from public, anon, authenticated;
grant execute on function public.mf_reconcile_open_finance_account_balance_service(uuid,uuid,numeric)
  to service_role;

commit;
