alter table public.mf_account_balances
  add column if not exists provider text,
  add column if not exists provider_account_ref text,
  add column if not exists bank_connection_id uuid references public.mf_bank_connections(id) on delete set null;

create unique index if not exists mf_account_balances_provider_account_ref_uidx
  on public.mf_account_balances(user_id, provider, provider_account_ref)
  where provider_account_ref is not null;

create unique index if not exists mf_finance_ledger_entries_pluggy_external_uidx
  on public.mf_finance_ledger_entries(user_id, external_id)
  where source_import = 'open_finance_pluggy' and external_id is not null;

create index if not exists mf_bank_connections_provider_ref_idx
  on public.mf_bank_connections(provider, provider_connection_ref)
  where provider_connection_ref is not null;

create or replace function public.mf_upsert_open_finance_account(
  p_connection_id uuid,
  p_provider text,
  p_provider_account_ref text,
  p_name text,
  p_account_type text,
  p_currency text,
  p_institution_name text,
  p_balance numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_account_id uuid;
begin
  if v_user_id is null then raise exception 'Autenticação necessária.'; end if;

  if not exists (
    select 1 from public.mf_bank_connections
    where id = p_connection_id and user_id = v_user_id
  ) then
    raise exception 'Conexão Open Finance inválida.';
  end if;

  insert into public.mf_account_balances (
    user_id, name, account_type, currency, institution_name,
    opening_balance, current_balance, is_default, is_active,
    provider, provider_account_ref, bank_connection_id
  ) values (
    v_user_id,
    coalesce(nullif(trim(p_name), ''), 'Conta Open Finance'),
    coalesce(nullif(trim(p_account_type), ''), 'checking'),
    coalesce(nullif(trim(p_currency), ''), 'BRL'),
    nullif(trim(p_institution_name), ''),
    coalesce(p_balance, 0),
    coalesce(p_balance, 0),
    false,
    true,
    p_provider,
    p_provider_account_ref,
    p_connection_id
  )
  on conflict (user_id, provider, provider_account_ref)
  where provider_account_ref is not null
  do update set
    name = excluded.name,
    account_type = excluded.account_type,
    currency = excluded.currency,
    institution_name = excluded.institution_name,
    current_balance = excluded.current_balance,
    bank_connection_id = excluded.bank_connection_id,
    is_active = true,
    updated_at = now()
  returning id into v_account_id;

  return v_account_id;
end;
$$;

grant execute on function public.mf_upsert_open_finance_account(uuid,text,text,text,text,text,text,numeric) to authenticated;
