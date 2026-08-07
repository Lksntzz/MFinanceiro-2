-- Canonical financial data foundation.
-- This migration is intentionally additive: legacy ledger columns remain available
-- and are synchronized by a compatibility trigger during the transition.

create schema if not exists mf_private;
revoke all on schema mf_private from public;
revoke all on schema mf_private from anon;
revoke all on schema mf_private from authenticated;

create table public.mf_financial_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  account_type text not null default 'checking'
    check (account_type in ('checking', 'savings', 'cash', 'investment', 'credit', 'other')),
  currency text not null default 'BRL'
    check (currency ~ '^[A-Z]{3}$'),
  institution_name text,
  opening_balance numeric(14,2) not null default 0,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mf_financial_accounts_name_check check (char_length(btrim(name)) between 1 and 120),
  constraint mf_financial_accounts_id_user_key unique (id, user_id)
);

create unique index mf_financial_accounts_one_default_idx
  on public.mf_financial_accounts (user_id)
  where is_default and is_active;
create index mf_financial_accounts_user_active_idx
  on public.mf_financial_accounts (user_id, is_active, created_at);

create table public.mf_transaction_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  name_key text not null,
  category_type text not null default 'both'
    check (category_type in ('income', 'expense', 'both')),
  color text,
  icon text,
  is_system boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mf_transaction_categories_name_check check (char_length(btrim(name)) between 1 and 120),
  constraint mf_transaction_categories_user_name_key unique (user_id, name_key),
  constraint mf_transaction_categories_id_user_key unique (id, user_id)
);

create index mf_transaction_categories_user_active_idx
  on public.mf_transaction_categories (user_id, is_active, sort_order, name);

create table public.mf_statement_import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.mf_financial_accounts(id) on delete restrict,
  status text not null default 'uploaded'
    check (status in ('uploaded', 'parsed', 'reviewing', 'committing', 'completed', 'failed', 'reverted')),
  source_format text not null default 'unknown',
  file_name text,
  file_type text,
  file_size bigint check (file_size is null or file_size >= 0),
  file_hash text,
  parser_name text,
  period_start date,
  period_end date,
  balance_mode text not null default 'keep'
    check (balance_mode in ('keep', 'apply_new', 'statement')),
  statement_balance numeric(14,2),
  balance_before numeric(14,2),
  balance_after numeric(14,2),
  net_amount numeric(14,2) not null default 0,
  requested_count integer not null default 0 check (requested_count >= 0),
  inserted_count integer not null default 0 check (inserted_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  rejected_count integer not null default 0 check (rejected_count >= 0),
  ignored_count integer not null default 0 check (ignored_count >= 0),
  error_message text,
  raw_metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  reverted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index mf_statement_import_batches_user_created_idx
  on public.mf_statement_import_batches (user_id, created_at desc);
create index mf_statement_import_batches_account_created_idx
  on public.mf_statement_import_batches (user_id, account_id, created_at desc);
create index mf_statement_import_batches_file_hash_idx
  on public.mf_statement_import_batches (user_id, account_id, file_hash)
  where file_hash is not null;

create table public.mf_statement_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.mf_statement_import_batches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.mf_financial_accounts(id) on delete restrict,
  line_number integer not null check (line_number > 0),
  raw_payload jsonb not null default '{}'::jsonb,
  raw_text text,
  transaction_date date,
  description text,
  category_name text,
  signed_amount numeric(14,2),
  transaction_type text check (transaction_type is null or transaction_type in ('income', 'expense')),
  source_name text,
  external_id text,
  fingerprint text,
  status text not null default 'parsed'
    check (status in ('parsed', 'imported', 'duplicate', 'rejected', 'ignored', 'reconciled')),
  error_code text,
  error_message text,
  ledger_entry_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mf_statement_import_rows_batch_line_key unique (batch_id, line_number)
);

create index mf_statement_import_rows_batch_status_idx
  on public.mf_statement_import_rows (batch_id, status, line_number);
create index mf_statement_import_rows_user_fingerprint_idx
  on public.mf_statement_import_rows (user_id, account_id, fingerprint)
  where fingerprint is not null;

alter table public.mf_finance_ledger_entries
  add column account_id uuid,
  add column category_id uuid,
  add column import_batch_id uuid,
  add column import_row_id uuid;

alter table public.mf_finance_ledger_entries
  add constraint mf_ledger_account_fk
    foreign key (account_id) references public.mf_financial_accounts(id) on delete restrict,
  add constraint mf_ledger_category_fk
    foreign key (category_id) references public.mf_transaction_categories(id) on delete restrict,
  add constraint mf_ledger_import_batch_fk
    foreign key (import_batch_id) references public.mf_statement_import_batches(id) on delete set null,
  add constraint mf_ledger_import_row_fk
    foreign key (import_row_id) references public.mf_statement_import_rows(id) on delete set null;

alter table public.mf_statement_import_rows
  add constraint mf_statement_import_rows_ledger_fk
    foreign key (ledger_entry_id) references public.mf_finance_ledger_entries(id) on delete set null;

create table public.mf_reconciliation_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.mf_financial_accounts(id) on delete restrict,
  import_row_id uuid not null references public.mf_statement_import_rows(id) on delete cascade,
  ledger_entry_id uuid not null references public.mf_finance_ledger_entries(id) on delete cascade,
  match_type text not null default 'suggested'
    check (match_type in ('imported', 'external_id', 'exact', 'probable', 'manual', 'duplicate')),
  confidence numeric(5,4) not null default 1
    check (confidence between 0 and 1),
  status text not null default 'suggested'
    check (status in ('suggested', 'confirmed', 'rejected')),
  matched_by uuid references auth.users(id) on delete set null,
  matched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mf_reconciliation_row_ledger_key unique (import_row_id, ledger_entry_id)
);

create index mf_reconciliation_user_status_idx
  on public.mf_reconciliation_matches (user_id, status, created_at desc);
create index mf_reconciliation_ledger_idx
  on public.mf_reconciliation_matches (ledger_entry_id);

alter table public.mf_financial_accounts enable row level security;
alter table public.mf_transaction_categories enable row level security;
alter table public.mf_statement_import_batches enable row level security;
alter table public.mf_statement_import_rows enable row level security;
alter table public.mf_reconciliation_matches enable row level security;

create policy mf_financial_accounts_select_own
  on public.mf_financial_accounts for select to authenticated
  using ((select auth.uid()) = user_id);
create policy mf_financial_accounts_insert_own
  on public.mf_financial_accounts for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy mf_financial_accounts_update_own
  on public.mf_financial_accounts for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy mf_financial_accounts_delete_own
  on public.mf_financial_accounts for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy mf_transaction_categories_select_own
  on public.mf_transaction_categories for select to authenticated
  using ((select auth.uid()) = user_id);
create policy mf_transaction_categories_insert_own
  on public.mf_transaction_categories for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy mf_transaction_categories_update_own
  on public.mf_transaction_categories for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy mf_transaction_categories_delete_own
  on public.mf_transaction_categories for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy mf_statement_import_batches_select_own
  on public.mf_statement_import_batches for select to authenticated
  using ((select auth.uid()) = user_id);
create policy mf_statement_import_batches_insert_own
  on public.mf_statement_import_batches for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy mf_statement_import_batches_update_own
  on public.mf_statement_import_batches for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy mf_statement_import_batches_delete_own
  on public.mf_statement_import_batches for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy mf_statement_import_rows_select_own
  on public.mf_statement_import_rows for select to authenticated
  using ((select auth.uid()) = user_id);
create policy mf_statement_import_rows_insert_own
  on public.mf_statement_import_rows for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy mf_statement_import_rows_update_own
  on public.mf_statement_import_rows for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy mf_statement_import_rows_delete_own
  on public.mf_statement_import_rows for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy mf_reconciliation_matches_select_own
  on public.mf_reconciliation_matches for select to authenticated
  using ((select auth.uid()) = user_id);
create policy mf_reconciliation_matches_insert_own
  on public.mf_reconciliation_matches for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy mf_reconciliation_matches_update_own
  on public.mf_reconciliation_matches for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy mf_reconciliation_matches_delete_own
  on public.mf_reconciliation_matches for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.mf_financial_accounts to authenticated;
grant select, insert, update, delete on public.mf_transaction_categories to authenticated;
grant select, insert, update, delete on public.mf_statement_import_batches to authenticated;
grant select, insert, update, delete on public.mf_statement_import_rows to authenticated;
grant select, insert, update, delete on public.mf_reconciliation_matches to authenticated;
revoke all on public.mf_financial_accounts from anon;
revoke all on public.mf_transaction_categories from anon;
revoke all on public.mf_statement_import_batches from anon;
revoke all on public.mf_statement_import_rows from anon;
revoke all on public.mf_reconciliation_matches from anon;

create or replace function mf_private.mf_name_key(p_value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select lower(regexp_replace(btrim(p_value), '[[:space:]]+', ' ', 'g'));
$$;

revoke execute on function mf_private.mf_name_key(text) from public;

with users as (
  select user_id from public.mf_user_settings
  union
  select user_id from public.mf_finance_ledger_entries
),
ledger_totals as (
  select
    user_id,
    coalesce(sum(
      case
        when coalesce(status, 'paid') not in ('pending', 'duplicate', 'error', 'voided', 'reversed')
          and coalesce(affects_balance, true)
        then coalesce(amount, valor, 0)
        else 0
      end
    ), 0) as net_amount
  from public.mf_finance_ledger_entries
  group by user_id
)
insert into public.mf_financial_accounts (
  user_id, name, account_type, currency, opening_balance, is_default, is_active
)
select
  users.user_id,
  'Conta principal',
  'checking',
  'BRL',
  round(coalesce(settings.current_balance, 0) - coalesce(ledger_totals.net_amount, 0), 2),
  true,
  true
from users
left join public.mf_user_settings settings using (user_id)
left join ledger_totals using (user_id)
on conflict do nothing;

with users as (
  select user_id from public.mf_user_settings
  union
  select user_id from public.mf_finance_ledger_entries
),
defaults(name, category_type, sort_order) as (
  values
    ('Geral', 'both', 0),
    ('Alimentação', 'expense', 10),
    ('Transporte', 'expense', 20),
    ('Moradia', 'expense', 30),
    ('Contas Fixas', 'expense', 40),
    ('Saúde', 'expense', 50),
    ('Educação', 'expense', 60),
    ('Lazer', 'expense', 70),
    ('Rendimentos', 'income', 80),
    ('Salário', 'income', 90),
    ('Benefícios', 'income', 100),
    ('Transferência', 'both', 110),
    ('Outros', 'both', 120)
)
insert into public.mf_transaction_categories (
  user_id, name, name_key, category_type, is_system, sort_order
)
select
  users.user_id,
  defaults.name,
  mf_private.mf_name_key(defaults.name),
  defaults.category_type,
  true,
  defaults.sort_order
from users
cross join defaults
on conflict (user_id, name_key) do nothing;

insert into public.mf_transaction_categories (
  user_id, name, name_key, category_type, is_system, sort_order
)
select distinct
  ledger.user_id,
  left(coalesce(nullif(btrim(ledger.category), ''), nullif(btrim(ledger.categoria), ''), 'Geral'), 120),
  mf_private.mf_name_key(coalesce(nullif(btrim(ledger.category), ''), nullif(btrim(ledger.categoria), ''), 'Geral')),
  case
    when bool_and(coalesce(ledger.type, ledger.tipo, '') in ('income', 'entrada', 'receita')) then 'income'
    when bool_and(coalesce(ledger.type, ledger.tipo, '') in ('expense', 'saida', 'despesa')) then 'expense'
    else 'both'
  end,
  false,
  500
from public.mf_finance_ledger_entries ledger
group by
  ledger.user_id,
  coalesce(nullif(btrim(ledger.category), ''), nullif(btrim(ledger.categoria), ''), 'Geral')
on conflict (user_id, name_key) do nothing;

update public.mf_finance_ledger_entries ledger
set
  description = left(coalesce(nullif(btrim(ledger.description), ''), nullif(btrim(ledger.descricao), ''), 'Lançamento'), 240),
  category = left(coalesce(nullif(btrim(ledger.category), ''), nullif(btrim(ledger.categoria), ''), 'Geral'), 120),
  amount = coalesce(ledger.amount, ledger.valor, 0),
  date = coalesce(ledger.date, ledger.data::date, ledger.created_at::date, current_date),
  type = case
    when lower(coalesce(ledger.type, ledger.tipo, '')) in ('income', 'entrada', 'receita') then 'income'
    when lower(coalesce(ledger.type, ledger.tipo, '')) in ('expense', 'saida', 'despesa') then 'expense'
    when coalesce(ledger.amount, ledger.valor, 0) >= 0 then 'income'
    else 'expense'
  end,
  account_id = account.id,
  category_id = category.id
from public.mf_financial_accounts account,
     public.mf_transaction_categories category
where account.user_id = ledger.user_id
  and account.is_default
  and account.is_active
  and category.user_id = ledger.user_id
  and category.name_key = mf_private.mf_name_key(
    coalesce(nullif(btrim(ledger.category), ''), nullif(btrim(ledger.categoria), ''), 'Geral')
  );

update public.mf_finance_ledger_entries
set
  descricao = description,
  categoria = category,
  valor = amount,
  data = (date::timestamp + time '12:00') at time zone 'America/Sao_Paulo',
  tipo = case when type = 'income' then 'entrada' else 'saida' end;

alter table public.mf_finance_ledger_entries
  alter column account_id set not null,
  alter column category_id set not null;

alter table public.mf_finance_ledger_entries
  drop constraint if exists mf_finance_ledger_entries_user_external_id_key;
drop index if exists public.mf_finance_ledger_entries_user_external_id_key;

create unique index mf_ledger_user_account_external_id_key
  on public.mf_finance_ledger_entries (user_id, account_id, external_id)
  where external_id is not null;
create unique index mf_ledger_import_row_key
  on public.mf_finance_ledger_entries (import_row_id)
  where import_row_id is not null;
create index mf_ledger_user_account_page_idx
  on public.mf_finance_ledger_entries (user_id, account_id, date desc, created_at desc, id desc);
create index mf_ledger_user_page_idx
  on public.mf_finance_ledger_entries (user_id, date desc, created_at desc, id desc);
create index mf_ledger_category_date_idx
  on public.mf_finance_ledger_entries (user_id, category_id, date desc);
create index mf_ledger_import_batch_idx
  on public.mf_finance_ledger_entries (import_batch_id)
  where import_batch_id is not null;

comment on column public.mf_finance_ledger_entries.descricao is
  'Legacy alias of description. Kept synchronized during the canonical migration.';
comment on column public.mf_finance_ledger_entries.categoria is
  'Legacy alias of category. Kept synchronized during the canonical migration.';
comment on column public.mf_finance_ledger_entries.valor is
  'Legacy alias of amount. Kept synchronized during the canonical migration.';
comment on column public.mf_finance_ledger_entries.data is
  'Legacy timestamp alias of date. Kept synchronized during the canonical migration.';
comment on column public.mf_finance_ledger_entries.tipo is
  'Legacy Portuguese alias of type. Kept synchronized during the canonical migration.';
comment on column public.mf_user_settings.current_balance is
  'Legacy compatibility cache. The source of truth is account opening_balance plus confirmed ledger entries.';

create or replace function mf_private.mf_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger mf_financial_accounts_touch_updated_at
before update on public.mf_financial_accounts
for each row execute function mf_private.mf_touch_updated_at();
create trigger mf_transaction_categories_touch_updated_at
before update on public.mf_transaction_categories
for each row execute function mf_private.mf_touch_updated_at();
create trigger mf_statement_import_batches_touch_updated_at
before update on public.mf_statement_import_batches
for each row execute function mf_private.mf_touch_updated_at();
create trigger mf_statement_import_rows_touch_updated_at
before update on public.mf_statement_import_rows
for each row execute function mf_private.mf_touch_updated_at();
create trigger mf_reconciliation_matches_touch_updated_at
before update on public.mf_reconciliation_matches
for each row execute function mf_private.mf_touch_updated_at();

create or replace function mf_private.mf_normalize_category()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.name := left(btrim(new.name), 120);
  new.name_key := mf_private.mf_name_key(new.name);
  return new;
end;
$$;

create trigger mf_transaction_categories_normalize
before insert or update of name on public.mf_transaction_categories
for each row execute function mf_private.mf_normalize_category();

create or replace function mf_private.mf_normalize_ledger_entry()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_category_name text;
begin
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;

  if tg_op = 'UPDATE' then
    if new.descricao is distinct from old.descricao
      and new.description is not distinct from old.description
    then
      new.description := new.descricao;
    end if;
    if new.categoria is distinct from old.categoria
      and new.category is not distinct from old.category
    then
      new.category := new.categoria;
      new.category_id := null;
    end if;
    if new.valor is distinct from old.valor
      and new.amount is not distinct from old.amount
    then
      new.amount := new.valor;
    end if;
    if new.data is distinct from old.data
      and new.date is not distinct from old.date
    then
      new.date := new.data::date;
    end if;
    if new.tipo is distinct from old.tipo
      and new.type is not distinct from old.type
    then
      new.type := new.tipo;
    end if;
  elsif new.valor is not null and coalesce(new.amount, 0) = 0 then
    new.amount := new.valor;
  end if;

  new.description := left(
    coalesce(nullif(btrim(new.description), ''), nullif(btrim(new.descricao), ''), 'Lançamento'),
    240
  );
  new.category := left(
    coalesce(nullif(btrim(new.category), ''), nullif(btrim(new.categoria), ''), 'Geral'),
    120
  );
  new.amount := coalesce(new.amount, new.valor, 0);
  new.date := coalesce(new.date, new.data::date, new.created_at::date, current_date);
  new.type := case
    when lower(coalesce(new.type, new.tipo, '')) in ('income', 'entrada', 'receita') then 'income'
    when lower(coalesce(new.type, new.tipo, '')) in ('expense', 'saida', 'despesa') then 'expense'
    when new.amount >= 0 then 'income'
    else 'expense'
  end;
  new.amount := case when new.type = 'expense' then -abs(new.amount) else abs(new.amount) end;
  new.source := left(coalesce(nullif(btrim(new.source), ''), nullif(btrim(new.origem), ''), 'Manual'), 120);

  if tg_op = 'UPDATE'
    and new.category is distinct from old.category
    and new.category_id is not distinct from old.category_id
  then
    new.category_id := null;
  end if;

  if new.account_id is null then
    select account.id into new.account_id
    from public.mf_financial_accounts account
    where account.user_id = new.user_id
      and account.is_default
      and account.is_active
    order by account.created_at
    limit 1;

    if new.account_id is null then
      insert into public.mf_financial_accounts (
        user_id, name, account_type, currency, opening_balance, is_default, is_active
      ) values (
        new.user_id, 'Conta principal', 'checking', 'BRL', 0, true, true
      ) returning id into new.account_id;
    end if;
  elsif not exists (
    select 1 from public.mf_financial_accounts account
    where account.id = new.account_id and account.user_id = new.user_id
  ) then
    raise exception using errcode = '23503', message = 'A conta financeira não pertence ao usuário.';
  end if;

  if new.category_id is not null then
    select category.name into v_category_name
    from public.mf_transaction_categories category
    where category.id = new.category_id
      and category.user_id = new.user_id
      and category.is_active;

    if v_category_name is null then
      raise exception using errcode = '23503', message = 'A categoria não pertence ao usuário ou está inativa.';
    end if;
    new.category := v_category_name;
  else
    select category.id, category.name into new.category_id, v_category_name
    from public.mf_transaction_categories category
    where category.user_id = new.user_id
      and category.name_key = mf_private.mf_name_key(new.category)
    limit 1;

    if new.category_id is null then
      insert into public.mf_transaction_categories (
        user_id, name, name_key, category_type, is_system, sort_order
      ) values (
        new.user_id,
        new.category,
        mf_private.mf_name_key(new.category),
        new.type,
        false,
        500
      )
      on conflict (user_id, name_key) do update set name = excluded.name
      returning id, name into new.category_id, v_category_name;
    end if;
    new.category := coalesce(v_category_name, new.category);
  end if;

  new.descricao := new.description;
  new.categoria := new.category;
  new.valor := new.amount;
  new.data := (new.date::timestamp + time '12:00') at time zone 'America/Sao_Paulo';
  new.tipo := case when new.type = 'income' then 'entrada' else 'saida' end;
  return new;
end;
$$;

create trigger mf_00_normalize_finance_ledger_entry
before insert or update on public.mf_finance_ledger_entries
for each row execute function mf_private.mf_normalize_ledger_entry();

create or replace function mf_private.mf_calculate_account_balance(p_account_id uuid)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select round(
    account.opening_balance + coalesce(sum(
      case
        when coalesce(ledger.status, 'paid') not in ('pending', 'duplicate', 'error', 'voided', 'reversed')
          and coalesce(ledger.affects_balance, true)
        then coalesce(ledger.amount, 0)
        else 0
      end
    ), 0),
    2
  )
  from public.mf_financial_accounts account
  left join public.mf_finance_ledger_entries ledger on ledger.account_id = account.id
  where account.id = p_account_id
  group by account.id, account.opening_balance;
$$;

create or replace function mf_private.mf_calculate_user_balance(p_user_id uuid)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select round(
    coalesce(sum(account.opening_balance), 0) + coalesce((
      select sum(ledger.amount)
      from public.mf_finance_ledger_entries ledger
      where ledger.user_id = p_user_id
        and coalesce(ledger.status, 'paid') not in ('pending', 'duplicate', 'error', 'voided', 'reversed')
        and coalesce(ledger.affects_balance, true)
    ), 0),
    2
  )
  from public.mf_financial_accounts account
  where account.user_id = p_user_id;
$$;

create or replace function mf_private.mf_refresh_legacy_user_balance(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('mf.balance_sync', 'on', true);
  update public.mf_user_settings
  set current_balance = mf_private.mf_calculate_user_balance(p_user_id),
      updated_at = now()
  where user_id = p_user_id;
  perform set_config('mf.balance_sync', 'off', true);
end;
$$;

create or replace function mf_private.mf_guard_legacy_balance_cache()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.current_balance is distinct from old.current_balance
    and coalesce(current_setting('mf.balance_sync', true), 'off') <> 'on'
  then
    new.current_balance := mf_private.mf_calculate_user_balance(new.user_id);
  end if;
  return new;
end;
$$;

create trigger mf_guard_legacy_current_balance
before update of current_balance on public.mf_user_settings
for each row execute function mf_private.mf_guard_legacy_balance_cache();

create or replace function mf_private.mf_refresh_balance_after_ledger_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  for v_user_id in select distinct user_id from new_ledger_rows loop
    perform mf_private.mf_refresh_legacy_user_balance(v_user_id);
  end loop;
  return null;
end;
$$;

create or replace function mf_private.mf_refresh_balance_after_ledger_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  for v_user_id in
    select user_id from new_ledger_rows
    union
    select user_id from old_ledger_rows
  loop
    perform mf_private.mf_refresh_legacy_user_balance(v_user_id);
  end loop;
  return null;
end;
$$;

create or replace function mf_private.mf_refresh_balance_after_ledger_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  for v_user_id in select distinct user_id from old_ledger_rows loop
    perform mf_private.mf_refresh_legacy_user_balance(v_user_id);
  end loop;
  return null;
end;
$$;

create trigger mf_refresh_balance_after_ledger_insert
after insert on public.mf_finance_ledger_entries
referencing new table as new_ledger_rows
for each statement execute function mf_private.mf_refresh_balance_after_ledger_insert();
create trigger mf_refresh_balance_after_ledger_update
after update on public.mf_finance_ledger_entries
referencing old table as old_ledger_rows new table as new_ledger_rows
for each statement execute function mf_private.mf_refresh_balance_after_ledger_update();
create trigger mf_refresh_balance_after_ledger_delete
after delete on public.mf_finance_ledger_entries
referencing old table as old_ledger_rows
for each statement execute function mf_private.mf_refresh_balance_after_ledger_delete();

create or replace function mf_private.mf_refresh_balance_after_account_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform mf_private.mf_refresh_legacy_user_balance(old.user_id);
    return old;
  end if;

  perform mf_private.mf_refresh_legacy_user_balance(new.user_id);
  if tg_op = 'UPDATE' and old.user_id is distinct from new.user_id then
    perform mf_private.mf_refresh_legacy_user_balance(old.user_id);
  end if;
  return new;
end;
$$;

create trigger mf_refresh_balance_after_account_insert
after insert on public.mf_financial_accounts
for each row execute function mf_private.mf_refresh_balance_after_account_change();
create trigger mf_refresh_balance_after_account_update
after update of opening_balance, is_active on public.mf_financial_accounts
for each row execute function mf_private.mf_refresh_balance_after_account_change();
create trigger mf_refresh_balance_after_account_delete
after delete on public.mf_financial_accounts
for each row execute function mf_private.mf_refresh_balance_after_account_change();

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
  count(ledger.id) as transaction_count
from public.mf_financial_accounts account
left join public.mf_finance_ledger_entries ledger on ledger.account_id = account.id
group by account.id;

revoke all on public.mf_account_balances from public;
revoke all on public.mf_account_balances from anon;
grant select on public.mf_account_balances to authenticated;

create or replace function public.mf_ensure_financial_structure()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_account_id uuid;
  v_current_balance numeric;
  v_ledger_net numeric;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Usuário não autenticado.';
  end if;

  select account.id into v_account_id
  from public.mf_financial_accounts account
  where account.user_id = v_user_id and account.is_default and account.is_active
  order by account.created_at
  limit 1;

  if v_account_id is null then
    select coalesce(settings.current_balance, 0) into v_current_balance
    from public.mf_user_settings settings
    where settings.user_id = v_user_id;

    select coalesce(sum(
      case
        when coalesce(ledger.status, 'paid') not in ('pending', 'duplicate', 'error', 'voided', 'reversed')
          and coalesce(ledger.affects_balance, true)
        then coalesce(ledger.amount, 0)
        else 0
      end
    ), 0) into v_ledger_net
    from public.mf_finance_ledger_entries ledger
    where ledger.user_id = v_user_id;

    insert into public.mf_financial_accounts (
      user_id, name, account_type, currency, opening_balance, is_default, is_active
    ) values (
      v_user_id,
      'Conta principal',
      'checking',
      'BRL',
      round(coalesce(v_current_balance, 0) - coalesce(v_ledger_net, 0), 2),
      true,
      true
    ) returning id into v_account_id;

    update public.mf_finance_ledger_entries
    set account_id = v_account_id
    where user_id = v_user_id and account_id is null;
  end if;

  insert into public.mf_transaction_categories (
    user_id, name, name_key, category_type, is_system, sort_order
  )
  select
    v_user_id,
    category.name,
    mf_private.mf_name_key(category.name),
    category.category_type,
    true,
    category.sort_order
  from (values
    ('Geral', 'both', 0),
    ('Alimentação', 'expense', 10),
    ('Transporte', 'expense', 20),
    ('Moradia', 'expense', 30),
    ('Contas Fixas', 'expense', 40),
    ('Saúde', 'expense', 50),
    ('Educação', 'expense', 60),
    ('Lazer', 'expense', 70),
    ('Rendimentos', 'income', 80),
    ('Salário', 'income', 90),
    ('Benefícios', 'income', 100),
    ('Transferência', 'both', 110),
    ('Outros', 'both', 120)
  ) as category(name, category_type, sort_order)
  on conflict (user_id, name_key) do nothing;

  return jsonb_build_object(
    'default_account_id', v_account_id,
    'current_balance', mf_private.mf_calculate_user_balance(v_user_id)
  );
end;
$$;

create or replace function public.mf_set_account_balance(
  p_account_id uuid,
  p_balance numeric
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_current numeric;
  v_opening numeric;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Usuário não autenticado.';
  end if;
  if p_balance is null then
    raise exception using errcode = '22023', message = 'Informe um saldo válido.';
  end if;

  select account.opening_balance into v_opening
  from public.mf_financial_accounts account
  where account.id = p_account_id and account.user_id = v_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Conta financeira não encontrada.';
  end if;

  v_current := mf_private.mf_calculate_account_balance(p_account_id);
  update public.mf_financial_accounts
  set opening_balance = round(v_opening + round(p_balance, 2) - v_current, 2)
  where id = p_account_id and user_id = v_user_id;

  update public.mf_user_settings
  set balance_confirmed = true, updated_at = now()
  where user_id = v_user_id;

  return jsonb_build_object(
    'account_id', p_account_id,
    'balance_before', v_current,
    'balance_after', mf_private.mf_calculate_account_balance(p_account_id),
    'user_balance', mf_private.mf_calculate_user_balance(v_user_id)
  );
end;
$$;

create or replace function public.mf_create_finance_entry_v3(
  p_type text,
  p_amount numeric,
  p_date date,
  p_description text,
  p_account_id uuid default null,
  p_category_id uuid default null,
  p_category text default 'Geral',
  p_payment_method text default 'unspecified',
  p_status text default 'paid',
  p_source text default 'Manual',
  p_card_id uuid default null,
  p_due_date date default null,
  p_notes text default null,
  p_installment_count integer default 1
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_account_id uuid := p_account_id;
  v_category_id uuid := p_category_id;
  v_amount numeric(14,2);
  v_affects_balance boolean;
  v_entry_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Usuário não autenticado.';
  end if;
  if p_type not in ('income', 'expense') then
    raise exception using errcode = '22023', message = 'Tipo de lançamento inválido.';
  end if;
  if p_status not in ('paid', 'pending') then
    raise exception using errcode = '22023', message = 'Status do lançamento inválido.';
  end if;
  if coalesce(btrim(p_description), '') = '' then
    raise exception using errcode = '22023', message = 'Informe uma descrição.';
  end if;
  if coalesce(p_installment_count, 1) not between 1 and 48 then
    raise exception using errcode = '22023', message = 'A quantidade de parcelas deve ficar entre 1 e 48.';
  end if;

  v_amount := round(abs(coalesce(p_amount, 0)), 2);
  if v_amount <= 0 then
    raise exception using errcode = '22023', message = 'Informe um valor maior que zero.';
  end if;

  if v_account_id is null then
    select account.id into v_account_id
    from public.mf_financial_accounts account
    where account.user_id = v_user_id and account.is_default and account.is_active
    order by account.created_at
    limit 1;
  end if;

  if not exists (
    select 1 from public.mf_financial_accounts account
    where account.id = v_account_id and account.user_id = v_user_id and account.is_active
  ) then
    raise exception using errcode = '23503', message = 'Selecione uma conta financeira válida.';
  end if;

  if v_category_id is not null and not exists (
    select 1 from public.mf_transaction_categories category
    where category.id = v_category_id and category.user_id = v_user_id and category.is_active
  ) then
    raise exception using errcode = '23503', message = 'Selecione uma categoria válida.';
  end if;

  v_affects_balance := p_status = 'paid'
    and not (p_type = 'expense' and p_payment_method = 'credit_card');

  insert into public.mf_finance_ledger_entries (
    user_id, account_id, category_id, date, amount, type, description, category,
    source, origem, status, source_import, payment_method, card_id,
    affects_balance, due_date, notes, installment_count, metadata
  ) values (
    v_user_id,
    v_account_id,
    v_category_id,
    coalesce(p_date, current_date),
    case when p_type = 'expense' then -v_amount else v_amount end,
    p_type,
    left(btrim(p_description), 240),
    left(coalesce(nullif(btrim(p_category), ''), 'Geral'), 120),
    left(coalesce(nullif(btrim(p_source), ''), 'Manual'), 120),
    'manual',
    p_status,
    'manual',
    p_payment_method,
    p_card_id,
    v_affects_balance,
    p_due_date,
    nullif(left(btrim(coalesce(p_notes, '')), 1000), ''),
    coalesce(p_installment_count, 1),
    jsonb_build_object(
      'launcher_version', 3,
      'account_id', v_account_id,
      'category_id', v_category_id,
      'installment_count', coalesce(p_installment_count, 1)
    )
  ) returning id into v_entry_id;

  if p_type = 'expense' and p_payment_method = 'credit_card' and p_status = 'paid' then
    update public.mf_credit_cards
    set used = round(coalesce(used, 0) + v_amount, 2), updated_at = now()
    where id = p_card_id and user_id = v_user_id;
    if not found then
      raise exception using errcode = '23503', message = 'Cartão inválido para este usuário.';
    end if;
  end if;

  return jsonb_build_object(
    'entry_id', v_entry_id,
    'account_id', v_account_id,
    'current_balance', mf_private.mf_calculate_account_balance(v_account_id),
    'user_balance', mf_private.mf_calculate_user_balance(v_user_id)
  );
end;
$$;

create or replace function public.mf_delete_finance_entry(p_entry_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_account_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Usuário não autenticado.';
  end if;

  select ledger.account_id into v_account_id
  from public.mf_finance_ledger_entries ledger
  where ledger.id = p_entry_id and ledger.user_id = v_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Lançamento não encontrado.';
  end if;

  delete from public.mf_finance_ledger_entries
  where id = p_entry_id and user_id = v_user_id;

  return jsonb_build_object(
    'deleted_id', p_entry_id,
    'account_id', v_account_id,
    'current_balance', mf_private.mf_calculate_account_balance(v_account_id),
    'user_balance', mf_private.mf_calculate_user_balance(v_user_id)
  );
end;
$$;

create or replace function public.mf_delete_all_finance_entries(p_account_id uuid default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_deleted integer;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Usuário não autenticado.';
  end if;
  if p_account_id is not null and not exists (
    select 1 from public.mf_financial_accounts account
    where account.id = p_account_id and account.user_id = v_user_id
  ) then
    raise exception using errcode = 'P0002', message = 'Conta financeira não encontrada.';
  end if;

  delete from public.mf_finance_ledger_entries
  where user_id = v_user_id
    and (p_account_id is null or account_id = p_account_id);
  get diagnostics v_deleted = row_count;

  update public.mf_financial_accounts
  set opening_balance = 0
  where user_id = v_user_id
    and (p_account_id is null or id = p_account_id);

  return jsonb_build_object(
    'deleted_count', v_deleted,
    'user_balance', mf_private.mf_calculate_user_balance(v_user_id)
  );
end;
$$;

create or replace function public.mf_commit_statement_import_v2(
  p_entries jsonb,
  p_account_id uuid default null,
  p_balance_mode text default 'keep',
  p_statement_balance numeric default null,
  p_file_name text default null,
  p_file_type text default null,
  p_file_size bigint default null,
  p_file_hash text default null,
  p_parser_name text default null,
  p_raw_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_account_id uuid := p_account_id;
  v_mode text := lower(coalesce(p_balance_mode, 'keep'));
  v_batch_id uuid;
  v_requested_count integer;
  v_inserted_count integer := 0;
  v_duplicate_count integer := 0;
  v_rejected_count integer := 0;
  v_ignored_count integer := 0;
  v_balance_before numeric := 0;
  v_balance_after numeric := 0;
  v_current_balance numeric := 0;
  v_net_new numeric := 0;
  v_period_start date;
  v_period_end date;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Autenticação necessária para importar um extrato.';
  end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception using errcode = '22023', message = 'Os lançamentos devem ser enviados em uma lista JSON.';
  end if;

  v_requested_count := jsonb_array_length(p_entries);
  if v_requested_count < 1 or v_requested_count > 2000 then
    raise exception using errcode = '22023', message = 'Um lote deve conter entre 1 e 2000 linhas.';
  end if;
  if v_mode not in ('keep', 'apply_new', 'statement') then
    raise exception using errcode = '22023', message = 'Modo de saldo inválido.';
  end if;
  if v_mode = 'statement' and p_statement_balance is null then
    raise exception using errcode = '22023', message = 'Informe o saldo final do extrato.';
  end if;

  if v_account_id is null then
    select account.id into v_account_id
    from public.mf_financial_accounts account
    where account.user_id = v_user_id and account.is_default and account.is_active
    order by account.created_at
    limit 1;
  end if;
  if not exists (
    select 1 from public.mf_financial_accounts account
    where account.id = v_account_id and account.user_id = v_user_id and account.is_active
  ) then
    raise exception using errcode = '23503', message = 'Selecione uma conta financeira válida para o extrato.';
  end if;

  v_balance_before := coalesce(mf_private.mf_calculate_account_balance(v_account_id), 0);

  select
    min(case when coalesce(item ->> 'date', '') ~ '^\d{4}-\d{2}-\d{2}$' then (item ->> 'date')::date end),
    max(case when coalesce(item ->> 'date', '') ~ '^\d{4}-\d{2}-\d{2}$' then (item ->> 'date')::date end)
  into v_period_start, v_period_end
  from jsonb_array_elements(p_entries) item;

  insert into public.mf_statement_import_batches (
    user_id, account_id, status, source_format, file_name, file_type, file_size,
    file_hash, parser_name, period_start, period_end, balance_mode,
    statement_balance, balance_before, requested_count, raw_metadata
  ) values (
    v_user_id,
    v_account_id,
    'committing',
    coalesce(nullif(lower(split_part(coalesce(p_file_name, ''), '.', -1)), ''), 'unknown'),
    nullif(left(btrim(coalesce(p_file_name, '')), 240), ''),
    nullif(left(btrim(coalesce(p_file_type, '')), 160), ''),
    p_file_size,
    nullif(left(btrim(coalesce(p_file_hash, '')), 128), ''),
    nullif(left(btrim(coalesce(p_parser_name, '')), 160), ''),
    v_period_start,
    v_period_end,
    v_mode,
    p_statement_balance,
    v_balance_before,
    v_requested_count,
    coalesce(p_raw_metadata, '{}'::jsonb)
  ) returning id into v_batch_id;

  with raw_entries as (
    select entry, ordinal::integer as line_number
    from jsonb_array_elements(p_entries) with ordinality as source(entry, ordinal)
  ),
  parsed as (
    select
      entry,
      line_number,
      coalesce(entry ->> 'selected', 'true') <> 'false' as selected,
      coalesce(entry ->> 'status', '') as source_status,
      case when coalesce(entry ->> 'date', '') ~ '^\d{4}-\d{2}-\d{2}$'
        then (entry ->> 'date')::date end as entry_date,
      nullif(left(btrim(coalesce(entry ->> 'description', '')), 240), '') as description,
      left(coalesce(nullif(btrim(entry ->> 'category'), ''), 'Geral'), 120) as category_name,
      case when coalesce(entry ->> 'amount', '') ~ '^-?[0-9]+([.][0-9]+)?$'
        then abs((entry ->> 'amount')::numeric) end as absolute_amount,
      case when entry ->> 'type' in ('income', 'expense') then entry ->> 'type' end as entry_type,
      left(coalesce(nullif(btrim(entry ->> 'source'), ''), 'Importado'), 120) as source_name,
      nullif(left(btrim(coalesce(entry ->> 'external_id', '')), 240), '') as external_id
    from raw_entries
  ),
  normalized as (
    select
      parsed.*,
      case
        when entry_type = 'expense' then -absolute_amount
        when entry_type = 'income' then absolute_amount
      end as signed_amount,
      case
        when entry_date is not null and description is not null and absolute_amount > 0 and entry_type is not null
        then md5(concat_ws(
          '|',
          entry_date::text,
          round(case when entry_type = 'expense' then -absolute_amount else absolute_amount end, 2)::text,
          lower(regexp_replace(description, '[^[:alnum:]]+', ' ', 'g')),
          lower(regexp_replace(source_name, '[^[:alnum:]]+', ' ', 'g'))
        ))
      end as fingerprint
    from parsed
  )
  insert into public.mf_statement_import_rows (
    batch_id, user_id, account_id, line_number, raw_payload, transaction_date,
    description, category_name, signed_amount, transaction_type, source_name,
    external_id, fingerprint, status, error_code, error_message
  )
  select
    v_batch_id,
    v_user_id,
    v_account_id,
    line_number,
    entry,
    entry_date,
    description,
    category_name,
    signed_amount,
    entry_type,
    source_name,
    external_id,
    fingerprint,
    case
      when not selected and source_status = 'error' then 'rejected'
      when not selected then 'ignored'
      when entry_date is null or description is null or absolute_amount is null or absolute_amount <= 0 or entry_type is null then 'rejected'
      else 'parsed'
    end,
    case
      when not selected and source_status = 'error' then 'parser_rejected'
      when selected and (entry_date is null or description is null or absolute_amount is null or absolute_amount <= 0 or entry_type is null) then 'invalid_fields'
    end,
    case
      when not selected and source_status = 'error' then 'Linha rejeitada durante a revisão do arquivo.'
      when selected and (entry_date is null or description is null or absolute_amount is null or absolute_amount <= 0 or entry_type is null) then 'Data, descrição, valor ou tipo inválido.'
    end
  from normalized;

  with ranked_rows as (
    select
      row_data.*,
      row_number() over (partition by row_data.fingerprint order by row_data.line_number) as occurrence
    from public.mf_statement_import_rows row_data
    where row_data.batch_id = v_batch_id and row_data.status = 'parsed'
  ),
  existing_counts as (
    select
      md5(concat_ws(
        '|',
        ledger.date::text,
        round(coalesce(ledger.amount, 0), 2)::text,
        lower(regexp_replace(coalesce(ledger.description, ''), '[^[:alnum:]]+', ' ', 'g')),
        lower(regexp_replace(coalesce(ledger.source, ''), '[^[:alnum:]]+', ' ', 'g'))
      )) as fingerprint,
      count(*) as existing_count
    from public.mf_finance_ledger_entries ledger
    where ledger.user_id = v_user_id
      and ledger.account_id = v_account_id
      and ledger.date between v_period_start and v_period_end
    group by 1
  ),
  candidates as (
    select
      ranked_rows.*,
      coalesce(
        ranked_rows.external_id,
        'statement:' || ranked_rows.fingerprint || ':' || ranked_rows.occurrence::text
      ) as ledger_external_id
    from ranked_rows
    left join existing_counts using (fingerprint)
    where (
      ranked_rows.external_id is not null
      and not exists (
        select 1 from public.mf_finance_ledger_entries existing
        where existing.user_id = v_user_id
          and existing.account_id = v_account_id
          and existing.external_id = ranked_rows.external_id
      )
    ) or (
      ranked_rows.external_id is null
      and ranked_rows.occurrence > coalesce(existing_counts.existing_count, 0)
    )
  ),
  inserted as (
    insert into public.mf_finance_ledger_entries (
      user_id, account_id, date, description, category, amount, type, source,
      status, origem, status_importacao, metadata, source_import,
      external_id, import_batch_id, import_row_id, affects_balance
    )
    select
      v_user_id,
      v_account_id,
      candidates.transaction_date,
      candidates.description,
      candidates.category_name,
      candidates.signed_amount,
      candidates.transaction_type,
      candidates.source_name,
      'paid',
      'extrato_importado',
      'valida',
      candidates.raw_payload || jsonb_build_object(
        'import_fingerprint', candidates.fingerprint,
        'import_batch_id', v_batch_id,
        'reviewed_at', now()
      ),
      'statement_import',
      candidates.ledger_external_id,
      v_batch_id,
      candidates.id,
      true
    from candidates
    on conflict (user_id, account_id, external_id) where external_id is not null do nothing
    returning id, import_row_id, amount
  )
  update public.mf_statement_import_rows row_data
  set status = 'imported', ledger_entry_id = inserted.id
  from inserted
  where row_data.id = inserted.import_row_id;

  with duplicate_matches as (
    select
      row_data.id as row_id,
      coalesce(
        (
          select ledger.id
          from public.mf_finance_ledger_entries ledger
          where ledger.user_id = v_user_id
            and ledger.account_id = v_account_id
            and row_data.external_id is not null
            and ledger.external_id = row_data.external_id
          order by ledger.created_at
          limit 1
        ),
        (
          select ledger.id
          from public.mf_finance_ledger_entries ledger
          where ledger.user_id = v_user_id
            and ledger.account_id = v_account_id
            and md5(concat_ws(
              '|',
              ledger.date::text,
              round(coalesce(ledger.amount, 0), 2)::text,
              lower(regexp_replace(coalesce(ledger.description, ''), '[^[:alnum:]]+', ' ', 'g')),
              lower(regexp_replace(coalesce(ledger.source, ''), '[^[:alnum:]]+', ' ', 'g'))
            )) = row_data.fingerprint
          order by ledger.created_at
          limit 1
        )
      ) as ledger_id
    from public.mf_statement_import_rows row_data
    where row_data.batch_id = v_batch_id and row_data.status = 'parsed'
  )
  update public.mf_statement_import_rows row_data
  set status = 'duplicate', ledger_entry_id = duplicate_matches.ledger_id
  from duplicate_matches
  where row_data.id = duplicate_matches.row_id;

  insert into public.mf_reconciliation_matches (
    user_id, account_id, import_row_id, ledger_entry_id,
    match_type, confidence, status, matched_by, matched_at
  )
  select
    v_user_id,
    v_account_id,
    row_data.id,
    row_data.ledger_entry_id,
    case when row_data.status = 'imported' then 'imported' else 'duplicate' end,
    1,
    'confirmed',
    v_user_id,
    now()
  from public.mf_statement_import_rows row_data
  where row_data.batch_id = v_batch_id
    and row_data.status in ('imported', 'duplicate')
    and row_data.ledger_entry_id is not null
  on conflict (import_row_id, ledger_entry_id) do nothing;

  select
    count(*) filter (where status = 'imported'),
    count(*) filter (where status = 'duplicate'),
    count(*) filter (where status = 'rejected'),
    count(*) filter (where status = 'ignored')
  into v_inserted_count, v_duplicate_count, v_rejected_count, v_ignored_count
  from public.mf_statement_import_rows
  where batch_id = v_batch_id;

  select coalesce(sum(ledger.amount), 0) into v_net_new
  from public.mf_finance_ledger_entries ledger
  where ledger.import_batch_id = v_batch_id;

  v_current_balance := coalesce(mf_private.mf_calculate_account_balance(v_account_id), 0);
  if v_mode = 'keep' then
    update public.mf_financial_accounts
    set opening_balance = round(opening_balance - v_net_new, 2)
    where id = v_account_id and user_id = v_user_id;
  elsif v_mode = 'statement' then
    update public.mf_financial_accounts
    set opening_balance = round(opening_balance + round(p_statement_balance, 2) - v_current_balance, 2)
    where id = v_account_id and user_id = v_user_id;

    update public.mf_user_settings
    set balance_confirmed = true, updated_at = now()
    where user_id = v_user_id;
  end if;

  v_balance_after := coalesce(mf_private.mf_calculate_account_balance(v_account_id), 0);
  update public.mf_statement_import_batches
  set status = 'completed',
      inserted_count = v_inserted_count,
      duplicate_count = v_duplicate_count,
      rejected_count = v_rejected_count,
      ignored_count = v_ignored_count,
      net_amount = round(v_net_new, 2),
      balance_after = v_balance_after,
      completed_at = now()
  where id = v_batch_id and user_id = v_user_id;

  return jsonb_build_object(
    'batch_id', v_batch_id,
    'requested_count', v_requested_count,
    'inserted_count', v_inserted_count,
    'duplicate_count', v_duplicate_count,
    'rejected_count', v_rejected_count,
    'ignored_count', v_ignored_count,
    'net_new', round(v_net_new, 2),
    'balance_before', round(v_balance_before, 2),
    'balance_after', round(v_balance_after, 2),
    'balance_mode', v_mode,
    'account_id', v_account_id
  );
end;
$$;

create or replace function public.mf_commit_statement_import(
  p_entries jsonb,
  p_balance_mode text default 'keep',
  p_statement_balance numeric default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_entries jsonb;
begin
  select jsonb_agg(entry || jsonb_build_object('selected', true))
  into v_entries
  from jsonb_array_elements(p_entries) entry;

  return public.mf_commit_statement_import_v2(
    coalesce(v_entries, '[]'::jsonb),
    null,
    p_balance_mode,
    p_statement_balance,
    null,
    null,
    null,
    null,
    'legacy-client',
    jsonb_build_object('compatibility_wrapper', true)
  );
end;
$$;

create or replace function public.mf_get_ledger_page(
  p_page_size integer default 100,
  p_cursor_date date default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_page_size integer := least(greatest(coalesce(p_page_size, 100), 1), 250);
  v_items jsonb;
  v_has_more boolean;
  v_total_count bigint;
  v_next_cursor jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Usuário não autenticado.';
  end if;

  select count(*) into v_total_count
  from public.mf_finance_ledger_entries ledger
  where ledger.user_id = v_user_id;

  with page_plus_one as (
    select
      ledger.id,
      ledger.user_id,
      ledger.account_id,
      ledger.category_id,
      ledger.import_batch_id,
      ledger.import_row_id,
      ledger.external_id,
      ledger.date,
      ledger.created_at,
      ledger.updated_at,
      ledger.description,
      ledger.category,
      ledger.amount,
      ledger.type,
      ledger.source,
      ledger.status,
      ledger.payment_method,
      ledger.card_id,
      ledger.affects_balance,
      ledger.notes,
      ledger.due_date,
      row_number() over (order by ledger.date desc, ledger.created_at desc, ledger.id desc) as page_row
    from public.mf_finance_ledger_entries ledger
    where ledger.user_id = v_user_id
      and (
        p_cursor_date is null
        or p_cursor_created_at is null
        or p_cursor_id is null
        or (ledger.date, ledger.created_at, ledger.id) < (p_cursor_date, p_cursor_created_at, p_cursor_id)
      )
    order by ledger.date desc, ledger.created_at desc, ledger.id desc
    limit v_page_size + 1
  ),
  page_items as (
    select * from page_plus_one where page_row <= v_page_size
  )
  select
    coalesce(jsonb_agg(to_jsonb(page_items) - 'page_row' order by date desc, created_at desc, id desc), '[]'::jsonb),
    exists(select 1 from page_plus_one where page_row > v_page_size)
  into v_items, v_has_more
  from page_items;

  if jsonb_array_length(v_items) > 0 then
    v_next_cursor := jsonb_build_object(
      'date', v_items -> -1 ->> 'date',
      'created_at', v_items -> -1 ->> 'created_at',
      'id', v_items -> -1 ->> 'id'
    );
  end if;

  return jsonb_build_object(
    'items', v_items,
    'has_more', v_has_more,
    'total_count', v_total_count,
    'next_cursor', v_next_cursor
  );
end;
$$;

comment on function public.mf_commit_statement_import_v2(
  jsonb, uuid, text, numeric, text, text, bigint, text, text, jsonb
) is 'Persists the raw statement batch, deduplicates rows, creates reconciliation matches, and applies the balance decision atomically.';
comment on function public.mf_get_ledger_page(integer, date, timestamptz, uuid)
is 'Returns a keyset-paginated canonical ledger page for the authenticated user.';

revoke execute on function public.mf_ensure_financial_structure() from public;
revoke execute on function public.mf_ensure_financial_structure() from anon;
grant execute on function public.mf_ensure_financial_structure() to authenticated;
revoke execute on function public.mf_set_account_balance(uuid, numeric) from public;
revoke execute on function public.mf_set_account_balance(uuid, numeric) from anon;
grant execute on function public.mf_set_account_balance(uuid, numeric) to authenticated;
revoke execute on function public.mf_create_finance_entry_v3(
  text, numeric, date, text, uuid, uuid, text, text, text, text, uuid, date, text, integer
) from public;
revoke execute on function public.mf_create_finance_entry_v3(
  text, numeric, date, text, uuid, uuid, text, text, text, text, uuid, date, text, integer
) from anon;
grant execute on function public.mf_create_finance_entry_v3(
  text, numeric, date, text, uuid, uuid, text, text, text, text, uuid, date, text, integer
) to authenticated;
revoke execute on function public.mf_delete_finance_entry(uuid) from public;
revoke execute on function public.mf_delete_finance_entry(uuid) from anon;
grant execute on function public.mf_delete_finance_entry(uuid) to authenticated;
revoke execute on function public.mf_delete_all_finance_entries(uuid) from public;
revoke execute on function public.mf_delete_all_finance_entries(uuid) from anon;
grant execute on function public.mf_delete_all_finance_entries(uuid) to authenticated;
revoke execute on function public.mf_commit_statement_import_v2(
  jsonb, uuid, text, numeric, text, text, bigint, text, text, jsonb
) from public;
revoke execute on function public.mf_commit_statement_import_v2(
  jsonb, uuid, text, numeric, text, text, bigint, text, text, jsonb
) from anon;
grant execute on function public.mf_commit_statement_import_v2(
  jsonb, uuid, text, numeric, text, text, bigint, text, text, jsonb
) to authenticated;
revoke execute on function public.mf_commit_statement_import(jsonb, text, numeric) from public;
revoke execute on function public.mf_commit_statement_import(jsonb, text, numeric) from anon;
grant execute on function public.mf_commit_statement_import(jsonb, text, numeric) to authenticated;
revoke execute on function public.mf_get_ledger_page(integer, date, timestamptz, uuid) from public;
revoke execute on function public.mf_get_ledger_page(integer, date, timestamptz, uuid) from anon;
grant execute on function public.mf_get_ledger_page(integer, date, timestamptz, uuid) to authenticated;

revoke execute on all functions in schema mf_private from public;
revoke execute on all functions in schema mf_private from anon;
revoke execute on all functions in schema mf_private from authenticated;
grant usage on schema mf_private to authenticated;
grant execute on function mf_private.mf_name_key(text) to authenticated;
grant execute on function mf_private.mf_calculate_account_balance(uuid) to authenticated;
grant execute on function mf_private.mf_calculate_user_balance(uuid) to authenticated;

select mf_private.mf_refresh_legacy_user_balance(user_id)
from public.mf_user_settings;
