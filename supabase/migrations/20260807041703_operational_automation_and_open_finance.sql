-- Operational automation foundation.
-- Additive and backwards compatible: existing imports and ledger rows remain valid.

create table public.mf_categorization_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  priority integer not null default 100 check (priority between 0 and 10000),
  match_field text not null default 'description'
    check (match_field in ('description', 'source', 'description_or_source')),
  match_operator text not null default 'contains'
    check (match_operator in ('contains', 'starts_with', 'exact')),
  match_value text not null,
  transaction_type text check (transaction_type is null or transaction_type in ('income', 'expense')),
  minimum_amount numeric(14,2) check (minimum_amount is null or minimum_amount >= 0),
  maximum_amount numeric(14,2) check (maximum_amount is null or maximum_amount >= 0),
  account_id uuid,
  category_id uuid not null,
  is_active boolean not null default true,
  hit_count bigint not null default 0 check (hit_count >= 0),
  last_matched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mf_categorization_rules_name_check check (char_length(btrim(name)) between 1 and 120),
  constraint mf_categorization_rules_value_check check (char_length(btrim(match_value)) between 2 and 160),
  constraint mf_categorization_rules_amount_range_check check (
    minimum_amount is null or maximum_amount is null or minimum_amount <= maximum_amount
  ),
  constraint mf_categorization_rules_account_user_fk
    foreign key (account_id, user_id) references public.mf_financial_accounts(id, user_id) on delete cascade,
  constraint mf_categorization_rules_category_user_fk
    foreign key (category_id, user_id) references public.mf_transaction_categories(id, user_id) on delete cascade
);

create index mf_categorization_rules_user_active_priority_idx
  on public.mf_categorization_rules (user_id, is_active, priority desc, created_at);
create index mf_categorization_rules_account_idx
  on public.mf_categorization_rules (account_id) where account_id is not null;
create index mf_categorization_rules_category_idx
  on public.mf_categorization_rules (category_id);

create table public.mf_document_extractions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid,
  source_file_path text not null,
  source_file_name text not null,
  source_mime_type text not null,
  source_file_size bigint not null check (source_file_size between 1 and 20971520),
  source_file_hash text,
  document_type text not null default 'statement'
    check (document_type in ('statement', 'payroll', 'other')),
  status text not null default 'uploaded'
    check (status in ('uploaded', 'processing', 'reviewing', 'completed', 'failed', 'cancelled')),
  provider text,
  model text,
  document_confidence numeric(5,4) check (document_confidence is null or document_confidence between 0 and 1),
  result_metadata jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mf_document_extractions_path_check check (char_length(btrim(source_file_path)) between 3 and 1024),
  constraint mf_document_extractions_account_user_fk
    foreign key (account_id, user_id) references public.mf_financial_accounts(id, user_id) on delete set null (account_id)
);

create index mf_document_extractions_user_status_created_idx
  on public.mf_document_extractions (user_id, status, created_at desc);
create index mf_document_extractions_account_idx
  on public.mf_document_extractions (account_id) where account_id is not null;
create index mf_document_extractions_hash_idx
  on public.mf_document_extractions (user_id, source_file_hash) where source_file_hash is not null;

create table public.mf_document_extraction_items (
  id uuid primary key default gen_random_uuid(),
  extraction_id uuid not null references public.mf_document_extractions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  line_number integer not null check (line_number > 0),
  transaction_date date,
  description text,
  signed_amount numeric(14,2),
  transaction_type text check (transaction_type is null or transaction_type in ('income', 'expense')),
  source_name text,
  external_id text,
  running_balance numeric(14,2),
  category_id uuid,
  category_name text,
  overall_confidence numeric(5,4) not null default 0 check (overall_confidence between 0 and 1),
  field_confidence jsonb not null default '{}'::jsonb,
  review_status text not null default 'pending'
    check (review_status in ('pending', 'accepted', 'edited', 'rejected')),
  reviewer_notes text,
  raw_payload jsonb not null default '{}'::jsonb,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mf_document_extraction_items_line_key unique (extraction_id, line_number),
  constraint mf_document_extraction_items_category_user_fk
    foreign key (category_id, user_id) references public.mf_transaction_categories(id, user_id) on delete set null (category_id)
);

create index mf_document_extraction_items_user_review_idx
  on public.mf_document_extraction_items (user_id, review_status, created_at desc);
create index mf_document_extraction_items_category_idx
  on public.mf_document_extraction_items (category_id) where category_id is not null;

create table public.mf_bank_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  provider_connection_ref text,
  institution_id text,
  institution_name text not null,
  display_name text,
  status text not null default 'pending'
    check (status in ('pending', 'authorizing', 'active', 'expiring', 'expired', 'revocation_pending', 'revoked', 'error')),
  sync_status text not null default 'idle'
    check (sync_status in ('idle', 'queued', 'syncing', 'completed', 'partial', 'error')),
  consent_id text,
  scopes text[] not null default array['ACCOUNTS_READ', 'RESOURCES_READ']::text[],
  consent_expires_at timestamptz,
  last_synced_at timestamptz,
  next_sync_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mf_bank_connections_id_user_key unique (id, user_id),
  constraint mf_bank_connections_provider_check check (char_length(btrim(provider)) between 2 and 80),
  constraint mf_bank_connections_institution_check check (char_length(btrim(institution_name)) between 2 and 160),
  constraint mf_bank_connections_provider_ref_key unique (user_id, provider, provider_connection_ref)
);

create index mf_bank_connections_user_status_idx
  on public.mf_bank_connections (user_id, status, updated_at desc);
create index mf_bank_connections_next_sync_idx
  on public.mf_bank_connections (next_sync_at)
  where status = 'active' and sync_status <> 'syncing';

create table public.mf_bank_sync_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid not null,
  account_id uuid,
  import_batch_id uuid references public.mf_statement_import_batches(id) on delete set null,
  trigger_source text not null default 'manual'
    check (trigger_source in ('initial', 'manual', 'scheduled', 'webhook', 'retry')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'partial', 'failed', 'cancelled')),
  cursor_before text,
  cursor_after text,
  requested_from date,
  requested_to date,
  received_count integer not null default 0 check (received_count >= 0),
  imported_count integer not null default 0 check (imported_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mf_bank_sync_runs_connection_user_fk
    foreign key (connection_id, user_id) references public.mf_bank_connections(id, user_id) on delete cascade,
  constraint mf_bank_sync_runs_account_user_fk
    foreign key (account_id, user_id) references public.mf_financial_accounts(id, user_id) on delete set null (account_id)
);

create index mf_bank_sync_runs_connection_created_idx
  on public.mf_bank_sync_runs (connection_id, created_at desc);
create index mf_bank_sync_runs_user_status_idx
  on public.mf_bank_sync_runs (user_id, status, created_at desc);
create index mf_bank_sync_runs_account_idx
  on public.mf_bank_sync_runs (account_id) where account_id is not null;
create index mf_bank_sync_runs_batch_idx
  on public.mf_bank_sync_runs (import_batch_id) where import_batch_id is not null;

alter table public.mf_statement_import_rows
  drop constraint mf_statement_import_rows_status_check;
alter table public.mf_statement_import_rows
  add constraint mf_statement_import_rows_status_check
  check (status in ('parsed', 'imported', 'duplicate', 'rejected', 'ignored', 'reconciled', 'reverted'));

alter table public.mf_statement_import_batches
  add column revert_reason text,
  add column reverted_by uuid references auth.users(id) on delete set null;

create index mf_statement_import_batches_reverted_by_idx
  on public.mf_statement_import_batches (reverted_by)
  where reverted_by is not null;

alter table public.mf_categorization_rules enable row level security;
alter table public.mf_document_extractions enable row level security;
alter table public.mf_document_extraction_items enable row level security;
alter table public.mf_bank_connections enable row level security;
alter table public.mf_bank_sync_runs enable row level security;

create policy mf_categorization_rules_select_own
  on public.mf_categorization_rules for select to authenticated
  using ((select auth.uid()) = user_id);
create policy mf_categorization_rules_insert_own
  on public.mf_categorization_rules for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy mf_categorization_rules_update_own
  on public.mf_categorization_rules for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy mf_categorization_rules_delete_own
  on public.mf_categorization_rules for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy mf_document_extractions_select_own
  on public.mf_document_extractions for select to authenticated
  using ((select auth.uid()) = user_id);
create policy mf_document_extractions_insert_own
  on public.mf_document_extractions for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy mf_document_extractions_update_own
  on public.mf_document_extractions for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy mf_document_extractions_delete_own
  on public.mf_document_extractions for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy mf_document_extraction_items_select_own
  on public.mf_document_extraction_items for select to authenticated
  using ((select auth.uid()) = user_id);
create policy mf_document_extraction_items_insert_own
  on public.mf_document_extraction_items for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy mf_document_extraction_items_update_own
  on public.mf_document_extraction_items for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy mf_document_extraction_items_delete_own
  on public.mf_document_extraction_items for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy mf_bank_connections_select_own
  on public.mf_bank_connections for select to authenticated
  using ((select auth.uid()) = user_id);
create policy mf_bank_connections_insert_own
  on public.mf_bank_connections for insert to authenticated
  with check ((select auth.uid()) = user_id and status = 'pending');
create policy mf_bank_connections_update_own
  on public.mf_bank_connections for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy mf_bank_connections_delete_own
  on public.mf_bank_connections for delete to authenticated
  using ((select auth.uid()) = user_id and status in ('pending', 'revoked', 'error'));

create policy mf_bank_sync_runs_select_own
  on public.mf_bank_sync_runs for select to authenticated
  using ((select auth.uid()) = user_id);
create policy mf_bank_sync_runs_insert_own
  on public.mf_bank_sync_runs for insert to authenticated
  with check ((select auth.uid()) = user_id and trigger_source = 'manual' and status = 'queued');

grant select, insert, update, delete on public.mf_categorization_rules to authenticated;
grant select, insert, update, delete on public.mf_document_extractions to authenticated;
grant select, insert, update, delete on public.mf_document_extraction_items to authenticated;
grant select, insert, delete on public.mf_bank_connections to authenticated;
grant select, insert on public.mf_bank_sync_runs to authenticated;

revoke update on public.mf_bank_connections from authenticated;

revoke all on public.mf_categorization_rules from anon;
revoke all on public.mf_document_extractions from anon;
revoke all on public.mf_document_extraction_items from anon;
revoke all on public.mf_bank_connections from anon;
revoke all on public.mf_bank_sync_runs from anon;

create trigger mf_categorization_rules_touch_updated_at
before update on public.mf_categorization_rules
for each row execute function mf_private.mf_touch_updated_at();
create trigger mf_document_extractions_touch_updated_at
before update on public.mf_document_extractions
for each row execute function mf_private.mf_touch_updated_at();
create trigger mf_document_extraction_items_touch_updated_at
before update on public.mf_document_extraction_items
for each row execute function mf_private.mf_touch_updated_at();
create trigger mf_bank_connections_touch_updated_at
before update on public.mf_bank_connections
for each row execute function mf_private.mf_touch_updated_at();
create trigger mf_bank_sync_runs_touch_updated_at
before update on public.mf_bank_sync_runs
for each row execute function mf_private.mf_touch_updated_at();

create or replace function mf_private.mf_apply_categorization_rule()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rule public.mf_categorization_rules%rowtype;
  v_description_key text := mf_private.mf_name_key(coalesce(new.description, ''));
  v_source_key text := mf_private.mf_name_key(coalesce(new.source, ''));
  v_match_key text;
begin
  if new.user_id is null
    or lower(coalesce(new.category, 'geral')) not in ('geral', 'outros', 'não categorizado', 'nao categorizado')
  then
    return new;
  end if;

  select rule.* into v_rule
  from public.mf_categorization_rules rule
  where rule.user_id = new.user_id
    and rule.is_active
    and (rule.account_id is null or rule.account_id = new.account_id)
    and (rule.transaction_type is null or rule.transaction_type = new.type)
    and (rule.minimum_amount is null or abs(new.amount) >= rule.minimum_amount)
    and (rule.maximum_amount is null or abs(new.amount) <= rule.maximum_amount)
    and (
      case rule.match_field
        when 'description' then
          case rule.match_operator
            when 'exact' then v_description_key = mf_private.mf_name_key(rule.match_value)
            when 'starts_with' then v_description_key like mf_private.mf_name_key(rule.match_value) || '%'
            else position(mf_private.mf_name_key(rule.match_value) in v_description_key) > 0
          end
        when 'source' then
          case rule.match_operator
            when 'exact' then v_source_key = mf_private.mf_name_key(rule.match_value)
            when 'starts_with' then v_source_key like mf_private.mf_name_key(rule.match_value) || '%'
            else position(mf_private.mf_name_key(rule.match_value) in v_source_key) > 0
          end
        else
          case rule.match_operator
            when 'exact' then mf_private.mf_name_key(rule.match_value) in (v_description_key, v_source_key)
            when 'starts_with' then v_description_key like mf_private.mf_name_key(rule.match_value) || '%'
              or v_source_key like mf_private.mf_name_key(rule.match_value) || '%'
            else position(mf_private.mf_name_key(rule.match_value) in v_description_key) > 0
              or position(mf_private.mf_name_key(rule.match_value) in v_source_key) > 0
          end
      end
    )
  order by rule.priority desc, rule.created_at, rule.id
  limit 1;

  if v_rule.id is null then
    return new;
  end if;

  select category.name into v_match_key
  from public.mf_transaction_categories category
  where category.id = v_rule.category_id and category.user_id = new.user_id and category.is_active;
  if v_match_key is null then
    return new;
  end if;

  new.category_id := v_rule.category_id;
  new.category := v_match_key;
  new.categoria := v_match_key;
  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
    'categorization_rule_id', v_rule.id,
    'categorization_confidence', 1,
    'categorization_source', 'rule'
  );

  update public.mf_categorization_rules
  set hit_count = hit_count + 1, last_matched_at = now()
  where id = v_rule.id and user_id = new.user_id;
  return new;
end;
$$;

create trigger mf_10_apply_categorization_rule
before insert or update of description, source, amount, type, account_id, category on public.mf_finance_ledger_entries
for each row execute function mf_private.mf_apply_categorization_rule();

create or replace function public.mf_preview_categorization_rules(p_entries jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Autenticação necessária.';
  end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) > 2000 then
    raise exception using errcode = '22023', message = 'Envie uma lista com até 2000 lançamentos.';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'entry_id', item ->> 'id',
    'rule_id', matched.id,
    'rule_name', matched.name,
    'category_id', matched.category_id,
    'category_name', category.name,
    'account_id', matched.account_id,
    'confidence', case when matched.id is null then 0 else 1 end
  ) order by ordinal), '[]'::jsonb)
  into v_result
  from jsonb_array_elements(p_entries) with ordinality source(item, ordinal)
  left join lateral (
    select rule.*
    from public.mf_categorization_rules rule
    where rule.user_id = v_user_id
      and rule.is_active
      and (rule.account_id is null or rule.account_id::text = nullif(item ->> 'account_id', ''))
      and (rule.transaction_type is null or rule.transaction_type = item ->> 'type')
      and (rule.minimum_amount is null or abs(
        case when coalesce(item ->> 'amount', '') ~ '^-?[0-9]+([.][0-9]+)?$'
          then (item ->> 'amount')::numeric else 0 end
      ) >= rule.minimum_amount)
      and (rule.maximum_amount is null or abs(
        case when coalesce(item ->> 'amount', '') ~ '^-?[0-9]+([.][0-9]+)?$'
          then (item ->> 'amount')::numeric else 0 end
      ) <= rule.maximum_amount)
      and (
        case rule.match_field
          when 'description' then
            case rule.match_operator
              when 'exact' then mf_private.mf_name_key(item ->> 'description') = mf_private.mf_name_key(rule.match_value)
              when 'starts_with' then mf_private.mf_name_key(item ->> 'description') like mf_private.mf_name_key(rule.match_value) || '%'
              else position(mf_private.mf_name_key(rule.match_value) in mf_private.mf_name_key(item ->> 'description')) > 0
            end
          when 'source' then
            case rule.match_operator
              when 'exact' then mf_private.mf_name_key(item ->> 'source') = mf_private.mf_name_key(rule.match_value)
              when 'starts_with' then mf_private.mf_name_key(item ->> 'source') like mf_private.mf_name_key(rule.match_value) || '%'
              else position(mf_private.mf_name_key(rule.match_value) in mf_private.mf_name_key(item ->> 'source')) > 0
            end
          else position(mf_private.mf_name_key(rule.match_value) in mf_private.mf_name_key(coalesce(item ->> 'description', '') || ' ' || coalesce(item ->> 'source', ''))) > 0
        end
      )
    order by rule.priority desc, rule.created_at, rule.id
    limit 1
  ) matched on true
  left join public.mf_transaction_categories category
    on category.id = matched.category_id and category.user_id = v_user_id;
  return v_result;
end;
$$;

create or replace function public.mf_revert_statement_import(
  p_batch_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_batch public.mf_statement_import_batches%rowtype;
  v_adjustment numeric := 0;
  v_reverted_count integer := 0;
  v_balance_after numeric := 0;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Autenticação necessária para desfazer um lote.';
  end if;

  select * into v_batch
  from public.mf_statement_import_batches batch
  where batch.id = p_batch_id and batch.user_id = v_user_id
  for update;

  if v_batch.id is null then
    raise exception using errcode = 'P0002', message = 'Lote não encontrado.';
  end if;
  if v_batch.status = 'reverted' then
    return jsonb_build_object(
      'batch_id', v_batch.id,
      'status', v_batch.status,
      'reverted_count', 0,
      'balance_after', mf_private.mf_calculate_account_balance(v_batch.account_id),
      'already_reverted', true
    );
  end if;
  if v_batch.status <> 'completed' then
    raise exception using errcode = '55000', message = 'Somente lotes concluídos podem ser desfeitos.';
  end if;

  v_adjustment := case v_batch.balance_mode
    when 'keep' then -coalesce(v_batch.net_amount, 0)
    when 'statement' then coalesce(v_batch.statement_balance, 0)
      - (coalesce(v_batch.balance_before, 0) + coalesce(v_batch.net_amount, 0))
    else 0
  end;

  update public.mf_finance_ledger_entries ledger
  set status = 'reversed',
      affects_balance = false,
      metadata = coalesce(ledger.metadata, '{}'::jsonb) || jsonb_build_object(
        'reverted_import_batch_id', v_batch.id,
        'reverted_at', now(),
        'reverted_by', v_user_id
      )
  where ledger.user_id = v_user_id
    and ledger.import_batch_id = v_batch.id
    and coalesce(ledger.status, 'paid') <> 'reversed';
  get diagnostics v_reverted_count = row_count;

  update public.mf_financial_accounts account
  set opening_balance = round(account.opening_balance - v_adjustment, 2)
  where account.id = v_batch.account_id and account.user_id = v_user_id;

  update public.mf_statement_import_rows row_data
  set status = 'reverted'
  where row_data.batch_id = v_batch.id and row_data.user_id = v_user_id and row_data.status = 'imported';

  update public.mf_reconciliation_matches match
  set status = 'rejected', matched_at = now(), matched_by = v_user_id
  where match.user_id = v_user_id
    and exists (
      select 1 from public.mf_statement_import_rows row_data
      where row_data.id = match.import_row_id
        and row_data.batch_id = v_batch.id
        and row_data.status = 'reverted'
    );

  v_balance_after := coalesce(mf_private.mf_calculate_account_balance(v_batch.account_id), 0);
  update public.mf_statement_import_batches
  set status = 'reverted',
      reverted_at = now(),
      reverted_by = v_user_id,
      revert_reason = nullif(left(btrim(coalesce(p_reason, '')), 500), ''),
      raw_metadata = coalesce(raw_metadata, '{}'::jsonb) || jsonb_build_object(
        'undo_balance_after', round(v_balance_after, 2),
        'undo_reverted_count', v_reverted_count
      )
  where id = v_batch.id and user_id = v_user_id;

  return jsonb_build_object(
    'batch_id', v_batch.id,
    'status', 'reverted',
    'reverted_count', v_reverted_count,
    'balance_after', round(v_balance_after, 2),
    'already_reverted', false
  );
end;
$$;

create or replace function public.mf_prepare_bank_connection(
  p_provider text,
  p_institution_id text,
  p_institution_name text,
  p_scopes text[] default array['ACCOUNTS_READ', 'RESOURCES_READ']::text[]
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_connection_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Autenticação necessária.';
  end if;
  if char_length(btrim(coalesce(p_provider, ''))) < 2
    or char_length(btrim(coalesce(p_institution_name, ''))) < 2
  then
    raise exception using errcode = '22023', message = 'Informe o provedor e a instituição.';
  end if;

  insert into public.mf_bank_connections (
    user_id, provider, institution_id, institution_name, status, sync_status, scopes
  ) values (
    v_user_id,
    left(lower(btrim(p_provider)), 80),
    nullif(left(btrim(coalesce(p_institution_id, '')), 160), ''),
    left(btrim(p_institution_name), 160),
    'pending',
    'idle',
    coalesce(p_scopes, array['ACCOUNTS_READ', 'RESOURCES_READ']::text[])
  ) returning id into v_connection_id;

  return jsonb_build_object('connection_id', v_connection_id, 'status', 'pending');
end;
$$;

revoke all on function public.mf_preview_categorization_rules(jsonb) from public, anon;
revoke all on function public.mf_revert_statement_import(uuid, text) from public, anon;
revoke all on function public.mf_prepare_bank_connection(text, text, text, text[]) from public, anon;
grant execute on function public.mf_preview_categorization_rules(jsonb) to authenticated;
grant execute on function public.mf_revert_statement_import(uuid, text) to authenticated;
grant execute on function public.mf_prepare_bank_connection(text, text, text, text[]) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'mf-import-documents',
  'mf-import-documents',
  false,
  20971520,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy mf_import_documents_select_own
  on storage.objects for select to authenticated
  using (
    bucket_id = 'mf-import-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy mf_import_documents_insert_own
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'mf-import-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy mf_import_documents_update_own
  on storage.objects for update to authenticated
  using (
    bucket_id = 'mf-import-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'mf-import-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy mf_import_documents_delete_own
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'mf-import-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

comment on table public.mf_categorization_rules is 'Deterministic, user-reviewed rules for automatic transaction categorization.';
comment on table public.mf_document_extractions is 'Private OCR/AI extraction jobs; source documents stay in an RLS-protected Storage bucket.';
comment on table public.mf_bank_connections is 'Open Finance connection state only. Provider tokens and bank credentials must never be stored here.';
comment on function public.mf_revert_statement_import(uuid, text) is 'Reverses a completed import batch without deleting its audit trail.';
