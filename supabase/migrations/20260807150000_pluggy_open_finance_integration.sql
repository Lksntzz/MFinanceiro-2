-- Real Pluggy Open Finance integration.
-- This migration is additive and is intended to ship with the August Mega Update.

create table if not exists public.mf_bank_account_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null,
  provider_account_ref text not null,
  provider_account_type text not null check (provider_account_type in ('BANK', 'CREDIT')),
  provider_account_subtype text,
  account_name text not null,
  masked_number text,
  currency text not null default 'BRL',
  provider_balance numeric(14,2),
  provider_credit_limit numeric(14,2),
  provider_available_credit_limit numeric(14,2),
  financial_account_id uuid,
  card_id uuid,
  mapping_source text check (mapping_source is null or mapping_source in ('manual', 'created', 'automatic')),
  status text not null default 'discovered'
    check (status in ('discovered', 'mapped', 'active', 'error', 'disconnected')),
  last_synced_at timestamptz,
  local_balance_at_sync numeric(14,2),
  balance_delta numeric(14,2),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mf_bank_account_links_connection_user_fk
    foreign key (connection_id, user_id) references public.mf_bank_connections(id, user_id) on delete cascade,
  constraint mf_bank_account_links_financial_account_user_fk
    foreign key (financial_account_id, user_id) references public.mf_financial_accounts(id, user_id) on delete set null (financial_account_id),
  constraint mf_bank_account_links_card_fk
    foreign key (card_id) references public.mf_credit_cards(id) on delete set null,
  constraint mf_bank_account_links_provider_key unique (connection_id, provider_account_ref)
);

create index if not exists mf_bank_account_links_user_status_idx
  on public.mf_bank_account_links (user_id, status, updated_at desc);
create index if not exists mf_bank_account_links_financial_account_idx
  on public.mf_bank_account_links (financial_account_id) where financial_account_id is not null;

create table if not exists public.mf_bank_transaction_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null,
  bank_account_link_id uuid not null references public.mf_bank_account_links(id) on delete cascade,
  provider_transaction_ref text not null,
  provider_code text,
  ledger_entry_id uuid references public.mf_finance_ledger_entries(id) on delete set null,
  ledger_origin text not null default 'created' check (ledger_origin in ('created', 'matched')),
  status text not null default 'active' check (status in ('active', 'deleted')),
  provider_updated_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mf_bank_transaction_links_connection_user_fk
    foreign key (connection_id, user_id) references public.mf_bank_connections(id, user_id) on delete cascade,
  constraint mf_bank_transaction_links_provider_key unique (connection_id, provider_transaction_ref)
);

create index if not exists mf_bank_transaction_links_account_idx
  on public.mf_bank_transaction_links (bank_account_link_id, status, updated_at desc);
create index if not exists mf_bank_transaction_links_provider_code_idx
  on public.mf_bank_transaction_links (connection_id, bank_account_link_id, provider_code)
  where provider_code is not null;
create index if not exists mf_bank_transaction_links_ledger_idx
  on public.mf_bank_transaction_links (ledger_entry_id) where ledger_entry_id is not null;

create table if not exists public.mf_bank_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  connection_id uuid references public.mf_bank_connections(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  event_name text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'accepted' check (status in ('accepted', 'processed', 'ignored', 'failed')),
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint mf_bank_webhook_events_provider_event_key unique (provider, event_id)
);

create index if not exists mf_bank_webhook_events_connection_idx
  on public.mf_bank_webhook_events (connection_id, received_at desc)
  where connection_id is not null;

alter table public.mf_bank_sync_runs
  add column if not exists updated_count integer not null default 0 check (updated_count >= 0),
  add column if not exists mapping_required_count integer not null default 0 check (mapping_required_count >= 0);

alter table public.mf_bank_account_links enable row level security;
alter table public.mf_bank_transaction_links enable row level security;
alter table public.mf_bank_webhook_events enable row level security;

drop policy if exists mf_bank_account_links_select_own on public.mf_bank_account_links;
create policy mf_bank_account_links_select_own
  on public.mf_bank_account_links for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists mf_bank_transaction_links_select_own on public.mf_bank_transaction_links;
create policy mf_bank_transaction_links_select_own
  on public.mf_bank_transaction_links for select to authenticated
  using ((select auth.uid()) = user_id);

grant select on public.mf_bank_account_links to authenticated;
grant select on public.mf_bank_transaction_links to authenticated;
revoke insert, update, delete on public.mf_bank_account_links from authenticated;
revoke insert, update, delete on public.mf_bank_transaction_links from authenticated;
revoke all on public.mf_bank_webhook_events from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'mf_bank_account_links_touch_updated_at'
  ) then
    create trigger mf_bank_account_links_touch_updated_at
      before update on public.mf_bank_account_links
      for each row execute function mf_private.mf_touch_updated_at();
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'mf_bank_transaction_links_touch_updated_at'
  ) then
    create trigger mf_bank_transaction_links_touch_updated_at
      before update on public.mf_bank_transaction_links
      for each row execute function mf_private.mf_touch_updated_at();
  end if;
end $$;

create or replace function public.mf_stage_open_finance_account(
  p_connection_id uuid,
  p_provider_account jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.mf_bank_connections%rowtype;
  v_link public.mf_bank_account_links%rowtype;
  v_provider_ref text := nullif(btrim(p_provider_account ->> 'providerAccountId'), '');
  v_type text := upper(coalesce(p_provider_account ->> 'providerAccountType', ''));
  v_name text := left(coalesce(nullif(btrim(p_provider_account ->> 'name'), ''), 'Conta Open Finance'), 160);
  v_currency text := upper(left(coalesce(nullif(p_provider_account ->> 'currency', ''), 'BRL'), 3));
  v_candidate uuid;
  v_candidate_count integer := 0;
begin
  select * into v_connection
  from public.mf_bank_connections
  where id = p_connection_id
  for update;

  if v_connection.id is null then
    raise exception using errcode = 'P0002', message = 'Conexão Open Finance não encontrada.';
  end if;
  if v_provider_ref is null or v_type not in ('BANK', 'CREDIT') then
    raise exception using errcode = '22023', message = 'Conta Open Finance inválida.';
  end if;

  insert into public.mf_bank_account_links (
    user_id, connection_id, provider_account_ref, provider_account_type,
    provider_account_subtype, account_name, masked_number, currency,
    provider_balance, provider_credit_limit, provider_available_credit_limit,
    metadata
  ) values (
    v_connection.user_id,
    v_connection.id,
    v_provider_ref,
    v_type,
    nullif(left(p_provider_account ->> 'subtype', 80), ''),
    v_name,
    nullif(left(p_provider_account ->> 'maskedNumber', 32), ''),
    v_currency,
    case when coalesce(p_provider_account ->> 'balance', '') ~ '^-?[0-9]+([.][0-9]+)?$'
      then (p_provider_account ->> 'balance')::numeric else null end,
    case when coalesce(p_provider_account ->> 'creditLimit', '') ~ '^-?[0-9]+([.][0-9]+)?$'
      then (p_provider_account ->> 'creditLimit')::numeric else null end,
    case when coalesce(p_provider_account ->> 'availableCreditLimit', '') ~ '^-?[0-9]+([.][0-9]+)?$'
      then (p_provider_account ->> 'availableCreditLimit')::numeric else null end,
    coalesce(p_provider_account -> 'metadata', '{}'::jsonb)
  )
  on conflict (connection_id, provider_account_ref) do update set
    provider_account_type = excluded.provider_account_type,
    provider_account_subtype = excluded.provider_account_subtype,
    account_name = excluded.account_name,
    masked_number = excluded.masked_number,
    currency = excluded.currency,
    provider_balance = excluded.provider_balance,
    provider_credit_limit = excluded.provider_credit_limit,
    provider_available_credit_limit = excluded.provider_available_credit_limit,
    metadata = coalesce(public.mf_bank_account_links.metadata, '{}'::jsonb) || excluded.metadata
  returning * into v_link;

  if v_link.financial_account_id is null then
    select count(*), min(account.id)
      into v_candidate_count, v_candidate
    from public.mf_financial_accounts account
    where account.user_id = v_connection.user_id
      and account.is_active
      and lower(coalesce(account.institution_name, '')) = lower(coalesce(v_connection.institution_name, ''))
      and (
        (v_type = 'BANK' and account.account_type in ('checking', 'savings', 'cash', 'other'))
        or (v_type = 'CREDIT' and account.account_type = 'credit')
      );

    if v_candidate_count = 1 then
      update public.mf_bank_account_links
      set financial_account_id = v_candidate,
          mapping_source = 'automatic',
          status = 'mapped'
      where id = v_link.id
      returning * into v_link;
    end if;
  end if;

  return jsonb_build_object(
    'link_id', v_link.id,
    'mapped', v_link.financial_account_id is not null,
    'financial_account_id', v_link.financial_account_id,
    'card_id', v_link.card_id,
    'status', v_link.status
  );
end;
$$;

create or replace function public.mf_map_open_finance_account(
  p_link_id uuid,
  p_financial_account_id uuid default null,
  p_create_new boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_link public.mf_bank_account_links%rowtype;
  v_connection public.mf_bank_connections%rowtype;
  v_account_id uuid := p_financial_account_id;
  v_card_id uuid;
  v_account_type text;
  v_limit numeric := 0;
  v_used numeric := 0;
  v_closing_day integer := 1;
  v_due_day integer := 1;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Autenticação necessária.';
  end if;

  select * into v_link
  from public.mf_bank_account_links
  where id = p_link_id and user_id = v_user_id
  for update;
  if v_link.id is null then
    raise exception using errcode = 'P0002', message = 'Conta Open Finance não encontrada.';
  end if;

  select * into v_connection
  from public.mf_bank_connections
  where id = v_link.connection_id and user_id = v_user_id;

  if coalesce(p_create_new, false) then
    v_account_type := case
      when v_link.provider_account_type = 'CREDIT' then 'credit'
      when upper(coalesce(v_link.provider_account_subtype, '')) like '%SAVING%' then 'savings'
      else 'checking'
    end;

    insert into public.mf_financial_accounts (
      user_id, name, account_type, currency, institution_name,
      opening_balance, is_default, is_active
    ) values (
      v_user_id,
      left(coalesce(nullif(v_link.account_name, ''), v_connection.institution_name || ' Open Finance'), 120),
      v_account_type,
      coalesce(nullif(v_link.currency, ''), 'BRL'),
      v_connection.institution_name,
      case when v_link.provider_account_type = 'CREDIT' then 0 else coalesce(v_link.provider_balance, 0) end,
      false,
      true
    )
    returning id into v_account_id;
  elsif v_account_id is not null then
    perform 1
    from public.mf_financial_accounts
    where id = v_account_id and user_id = v_user_id and is_active;
    if not found then
      raise exception using errcode = '42501', message = 'Conta financeira inválida.';
    end if;
  else
    raise exception using errcode = '22023', message = 'Selecione uma conta ou crie uma nova.';
  end if;

  if v_link.provider_account_type = 'CREDIT' then
    v_limit := greatest(coalesce(v_link.provider_credit_limit, 0), 0);
    v_used := greatest(coalesce(v_link.provider_balance, 0), 0);
    if coalesce(v_link.metadata ->> 'closingDay', '') ~ '^[0-9]+$' then
      v_closing_day := greatest(1, least(31, (v_link.metadata ->> 'closingDay')::integer));
    end if;
    if coalesce(v_link.metadata ->> 'dueDay', '') ~ '^[0-9]+$' then
      v_due_day := greatest(1, least(31, (v_link.metadata ->> 'dueDay')::integer));
    end if;

    if v_link.card_id is null then
      insert into public.mf_credit_cards (
        user_id, name, brand, "limit", used, closing_day, due_day, source_import
      ) values (
        v_user_id,
        left(coalesce(nullif(v_link.account_name, ''), 'Cartão Open Finance'), 120),
        nullif(left(v_link.metadata ->> 'brand', 60), ''),
        v_limit,
        v_used,
        v_closing_day,
        v_due_day,
        'open_finance'
      )
      returning id into v_card_id;
    else
      v_card_id := v_link.card_id;
    end if;
  end if;

  update public.mf_bank_account_links
  set financial_account_id = v_account_id,
      card_id = coalesce(v_card_id, card_id),
      mapping_source = case when coalesce(p_create_new, false) then 'created' else 'manual' end,
      status = 'mapped'
  where id = v_link.id;

  return jsonb_build_object(
    'link_id', v_link.id,
    'financial_account_id', v_account_id,
    'card_id', coalesce(v_card_id, v_link.card_id),
    'status', 'mapped'
  );
end;
$$;

create or replace function public.mf_ingest_open_finance_account(
  p_connection_id uuid,
  p_provider_account_ref text,
  p_provider_balance numeric,
  p_transactions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.mf_bank_connections%rowtype;
  v_link public.mf_bank_account_links%rowtype;
  v_category_id uuid;
  v_category_name text := 'Geral';
  v_tx jsonb;
  v_provider_ref text;
  v_provider_code text;
  v_date date;
  v_description text;
  v_amount numeric;
  v_type text;
  v_status text;
  v_payment_method text;
  v_provider_updated_at timestamptz;
  v_existing public.mf_bank_transaction_links%rowtype;
  v_ledger_id uuid;
  v_received integer := 0;
  v_imported integer := 0;
  v_duplicates integer := 0;
  v_updated integer := 0;
  v_local_balance numeric := 0;
  v_is_first_created_sync boolean := false;
begin
  select * into v_connection
  from public.mf_bank_connections
  where id = p_connection_id;
  if v_connection.id is null then
    raise exception using errcode = 'P0002', message = 'Conexão Open Finance não encontrada.';
  end if;

  select * into v_link
  from public.mf_bank_account_links
  where connection_id = p_connection_id
    and provider_account_ref = p_provider_account_ref
  for update;
  if v_link.id is null or v_link.financial_account_id is null then
    raise exception using errcode = '55000', message = 'Mapeie a conta Open Finance antes da sincronização.';
  end if;

  insert into public.mf_transaction_categories (
    user_id, name, name_key, category_type, is_system, is_active, sort_order
  ) values (
    v_connection.user_id, 'Geral', 'geral', 'both', true, true, 0
  )
  on conflict (user_id, name_key) do nothing;

  select id, name into v_category_id, v_category_name
  from public.mf_transaction_categories
  where user_id = v_connection.user_id and name_key = 'geral' and is_active
  order by is_system desc, created_at
  limit 1;
  if v_category_id is null then
    raise exception using errcode = '55000', message = 'Categoria Geral indisponível.';
  end if;

  if p_transactions is null or jsonb_typeof(p_transactions) <> 'array' then
    raise exception using errcode = '22023', message = 'Transações Open Finance inválidas.';
  end if;

  v_is_first_created_sync := v_link.mapping_source = 'created' and v_link.last_synced_at is null;

  for v_tx in select value from jsonb_array_elements(p_transactions)
  loop
    v_received := v_received + 1;
    v_provider_ref := nullif(btrim(v_tx ->> 'providerTransactionId'), '');
    if v_provider_ref is null then
      continue;
    end if;
    v_provider_code := nullif(left(btrim(coalesce(v_tx ->> 'providerCode', '')), 180), '');
    begin
      v_date := (v_tx ->> 'transactionDate')::date;
    exception when others then
      continue;
    end;
    v_description := left(coalesce(nullif(btrim(v_tx ->> 'description'), ''), 'Movimentação Open Finance'), 500);
    if coalesce(v_tx ->> 'signedAmount', '') !~ '^-?[0-9]+([.][0-9]+)?$' then
      continue;
    end if;
    v_amount := (v_tx ->> 'signedAmount')::numeric;
    if v_amount = 0 then
      continue;
    end if;
    v_type := case when lower(v_tx ->> 'type') = 'income' then 'income' else 'expense' end;
    v_status := case when lower(v_tx ->> 'status') = 'pending' then 'pending' else 'paid' end;
    v_payment_method := coalesce(nullif(v_tx ->> 'paymentMethod', ''), 'unspecified');
    if v_payment_method not in ('unspecified','pix','debit_card','credit_card','cash','boleto','bank_transfer','benefit','other') then
      v_payment_method := 'unspecified';
    end if;
    begin
      v_provider_updated_at := nullif(v_tx ->> 'providerUpdatedAt', '')::timestamptz;
    exception when others then
      v_provider_updated_at := null;
    end;

    select * into v_existing
    from public.mf_bank_transaction_links
    where connection_id = p_connection_id
      and (
        provider_transaction_ref = v_provider_ref
        or (
          v_provider_code is not null
          and bank_account_link_id = v_link.id
          and provider_code = v_provider_code
        )
      )
    order by (provider_transaction_ref = v_provider_ref) desc
    limit 1
    for update;

    if v_existing.id is not null then
      update public.mf_bank_transaction_links
      set provider_transaction_ref = v_provider_ref,
          provider_code = coalesce(v_provider_code, provider_code),
          status = 'active',
          provider_updated_at = v_provider_updated_at,
          metadata = coalesce(metadata, '{}'::jsonb) || coalesce(v_tx -> 'metadata', '{}'::jsonb)
      where id = v_existing.id;

      if v_existing.ledger_origin = 'created' and v_existing.ledger_entry_id is not null then
        update public.mf_finance_ledger_entries
        set date = v_date,
            description = v_description,
            amount = v_amount,
            type = v_type,
            status = v_status,
            source = 'Open Finance · ' || v_connection.institution_name,
            source_import = 'open_finance',
            payment_method = v_payment_method,
            card_id = case when v_link.provider_account_type = 'CREDIT' then v_link.card_id else null end,
            affects_balance = v_link.provider_account_type <> 'CREDIT',
            metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
              'open_finance', true,
              'provider', v_connection.provider,
              'connection_id', v_connection.id,
              'provider_account_ref', v_link.provider_account_ref,
              'provider_transaction_ref', v_provider_ref
            ) || coalesce(v_tx -> 'metadata', '{}'::jsonb)
        where id = v_existing.ledger_entry_id and user_id = v_connection.user_id;
        v_updated := v_updated + 1;
      else
        v_duplicates := v_duplicates + 1;
      end if;
      continue;
    end if;

    select ledger.id into v_ledger_id
    from public.mf_finance_ledger_entries ledger
    where ledger.user_id = v_connection.user_id
      and ledger.account_id = v_link.financial_account_id
      and ledger.date = v_date
      and ledger.amount = v_amount
      and mf_private.mf_name_key(coalesce(ledger.description, ledger.descricao, '')) =
          mf_private.mf_name_key(v_description)
      and not exists (
        select 1 from public.mf_bank_transaction_links linked
        where linked.ledger_entry_id = ledger.id and linked.status = 'active'
      )
    order by ledger.created_at, ledger.id
    limit 1;

    if v_ledger_id is not null then
      insert into public.mf_bank_transaction_links (
        user_id, connection_id, bank_account_link_id,
        provider_transaction_ref, provider_code, ledger_entry_id,
        ledger_origin, status, provider_updated_at, metadata
      ) values (
        v_connection.user_id, v_connection.id, v_link.id,
        v_provider_ref, v_provider_code, v_ledger_id,
        'matched', 'active', v_provider_updated_at, coalesce(v_tx -> 'metadata', '{}'::jsonb)
      );
      v_duplicates := v_duplicates + 1;
      v_ledger_id := null;
      continue;
    end if;

    insert into public.mf_finance_ledger_entries (
      user_id, external_id, description, category, amount, date, type,
      source, status, metadata, source_import, payment_method, card_id,
      affects_balance, account_id, category_id
    ) values (
      v_connection.user_id,
      v_provider_ref,
      v_description,
      v_category_name,
      v_amount,
      v_date,
      v_type,
      'Open Finance · ' || v_connection.institution_name,
      v_status,
      jsonb_build_object(
        'open_finance', true,
        'provider', v_connection.provider,
        'connection_id', v_connection.id,
        'provider_account_ref', v_link.provider_account_ref,
        'provider_transaction_ref', v_provider_ref
      ) || coalesce(v_tx -> 'metadata', '{}'::jsonb),
      'open_finance',
      v_payment_method,
      case when v_link.provider_account_type = 'CREDIT' then v_link.card_id else null end,
      v_link.provider_account_type <> 'CREDIT',
      v_link.financial_account_id,
      v_category_id
    )
    returning id into v_ledger_id;

    insert into public.mf_bank_transaction_links (
      user_id, connection_id, bank_account_link_id,
      provider_transaction_ref, provider_code, ledger_entry_id,
      ledger_origin, status, provider_updated_at, metadata
    ) values (
      v_connection.user_id, v_connection.id, v_link.id,
      v_provider_ref, v_provider_code, v_ledger_id,
      'created', 'active', v_provider_updated_at, coalesce(v_tx -> 'metadata', '{}'::jsonb)
    );
    v_imported := v_imported + 1;
    v_ledger_id := null;
  end loop;

  if v_link.provider_account_type = 'CREDIT' and v_link.card_id is not null then
    update public.mf_credit_cards
    set used = greatest(coalesce(p_provider_balance, v_link.provider_balance, 0), 0),
        "limit" = greatest(coalesce(v_link.provider_credit_limit, "limit", 0), 0)
    where id = v_link.card_id and user_id = v_connection.user_id;
  end if;

  if v_is_first_created_sync and v_link.provider_account_type = 'BANK' and p_provider_balance is not null then
    update public.mf_financial_accounts account
    set opening_balance = round(
      p_provider_balance - coalesce((
        select sum(case
          when coalesce(ledger.status, 'paid') not in ('pending', 'duplicate', 'error', 'voided', 'reversed')
            and coalesce(ledger.affects_balance, true)
          then coalesce(ledger.amount, 0)
          else 0
        end)
        from public.mf_finance_ledger_entries ledger
        where ledger.account_id = account.id
      ), 0),
      2
    )
    where account.id = v_link.financial_account_id
      and account.user_id = v_connection.user_id;
  end if;

  select coalesce(current_balance, 0) into v_local_balance
  from public.mf_account_balances
  where id = v_link.financial_account_id and user_id = v_connection.user_id;

  update public.mf_bank_account_links
  set provider_balance = coalesce(p_provider_balance, provider_balance),
      local_balance_at_sync = v_local_balance,
      balance_delta = case
        when provider_account_type = 'BANK' and p_provider_balance is not null
          then round(p_provider_balance - v_local_balance, 2)
        else null
      end,
      status = 'active',
      last_synced_at = now()
  where id = v_link.id;

  return jsonb_build_object(
    'received', v_received,
    'imported', v_imported,
    'duplicate', v_duplicates,
    'updated', v_updated,
    'local_balance', round(v_local_balance, 2),
    'balance_delta', case
      when v_link.provider_account_type = 'BANK' and p_provider_balance is not null
        then round(p_provider_balance - v_local_balance, 2)
      else null
    end
  );
end;
$$;

create or replace function public.mf_mark_open_finance_transactions_deleted(
  p_connection_id uuid,
  p_provider_refs text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection public.mf_bank_connections%rowtype;
  v_link record;
  v_count integer := 0;
begin
  select * into v_connection
  from public.mf_bank_connections
  where id = p_connection_id;
  if v_connection.id is null then
    raise exception using errcode = 'P0002', message = 'Conexão Open Finance não encontrada.';
  end if;

  if p_provider_refs is null or cardinality(p_provider_refs) = 0 then
    return jsonb_build_object('deleted', 0);
  end if;

  for v_link in
    select id, ledger_entry_id, ledger_origin
    from public.mf_bank_transaction_links
    where connection_id = p_connection_id
      and provider_transaction_ref = any(p_provider_refs)
      and status = 'active'
    for update
  loop
    if v_link.ledger_origin = 'created' and v_link.ledger_entry_id is not null then
      update public.mf_finance_ledger_entries
      set status = 'reversed',
          affects_balance = false,
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'open_finance_deleted_at', now(),
            'open_finance_deleted_connection_id', p_connection_id
          )
      where id = v_link.ledger_entry_id and user_id = v_connection.user_id;
    end if;

    update public.mf_bank_transaction_links
    set status = 'deleted'
    where id = v_link.id;
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('deleted', v_count);
end;
$$;

revoke all on function public.mf_stage_open_finance_account(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.mf_ingest_open_finance_account(uuid, text, numeric, jsonb) from public, anon, authenticated;
revoke all on function public.mf_mark_open_finance_transactions_deleted(uuid, text[]) from public, anon, authenticated;
revoke all on function public.mf_map_open_finance_account(uuid, uuid, boolean) from public, anon;
grant execute on function public.mf_stage_open_finance_account(uuid, jsonb) to service_role;
grant execute on function public.mf_ingest_open_finance_account(uuid, text, numeric, jsonb) to service_role;
grant execute on function public.mf_mark_open_finance_transactions_deleted(uuid, text[]) to service_role;
grant execute on function public.mf_map_open_finance_account(uuid, uuid, boolean) to authenticated;
