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
  v_user_id uuid := auth.uid();
  v_mode text := lower(coalesce(p_balance_mode, 'keep'));
  v_requested_count integer;
  v_inserted_count integer := 0;
  v_duplicate_count integer := 0;
  v_balance_before numeric;
  v_balance_after numeric;
  v_net_new numeric := 0;
begin
  if v_user_id is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to import a statement.';
  end if;

  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'Statement entries must be a JSON array.';
  end if;

  v_requested_count := jsonb_array_length(p_entries);

  if v_requested_count < 1 or v_requested_count > 1000 then
    raise exception using
      errcode = '22023',
      message = 'A statement import must contain between 1 and 1000 entries.';
  end if;

  if v_mode not in ('keep', 'apply_new', 'statement') then
    raise exception using
      errcode = '22023',
      message = 'Invalid statement balance mode.';
  end if;

  if v_mode = 'statement' and p_statement_balance is null then
    raise exception using
      errcode = '22023',
      message = 'A statement balance is required in statement mode.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_entries) as item(entry)
    where jsonb_typeof(entry) <> 'object'
      or coalesce(btrim(entry ->> 'date'), '') !~ '^\d{4}-\d{2}-\d{2}$'
      or coalesce(btrim(entry ->> 'description'), '') = ''
      or coalesce(entry ->> 'type', '') not in ('income', 'expense')
      or coalesce(entry ->> 'amount', '') !~ '^[0-9]+([.][0-9]+)?$'
      or (entry ->> 'amount')::numeric <= 0
  ) then
    raise exception using
      errcode = '22023',
      message = 'One or more statement entries are invalid.';
  end if;

  select coalesce(current_balance, 0)
  into v_balance_before
  from public.mf_user_settings
  where user_id = v_user_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'User financial settings were not found.';
  end if;

  with raw_entries as (
    select entry, ordinal
    from jsonb_array_elements(p_entries) with ordinality as item(entry, ordinal)
  ),
  parsed_entries as (
    select
      ordinal,
      (entry ->> 'date')::date as entry_date,
      btrim(entry ->> 'description') as description,
      coalesce(nullif(btrim(entry ->> 'category'), ''), 'Geral') as category,
      case
        when entry ->> 'type' = 'expense' then -abs((entry ->> 'amount')::numeric)
        else abs((entry ->> 'amount')::numeric)
      end as signed_amount,
      entry ->> 'type' as entry_type,
      coalesce(nullif(btrim(entry ->> 'source'), ''), 'Importado') as source,
      nullif(left(btrim(entry ->> 'external_id'), 240), '') as supplied_external_id,
      coalesce(entry -> 'metadata', '{}'::jsonb) as metadata
    from raw_entries
  ),
  canonical_entries as (
    select
      parsed_entries.*,
      concat_ws(
        '|',
        entry_date::text,
        round(signed_amount, 2)::text,
        lower(regexp_replace(description, '[^[:alnum:]]+', ' ', 'g')),
        lower(regexp_replace(source, '[^[:alnum:]]+', ' ', 'g'))
      ) as canonical_key
    from parsed_entries
  ),
  ranked_entries as (
    select
      canonical_entries.*,
      row_number() over (partition by canonical_key order by ordinal) as occurrence
    from canonical_entries
  ),
  existing_counts as (
    select
      concat_ws(
        '|',
        ledger.date::text,
        round(coalesce(ledger.amount, ledger.valor, 0), 2)::text,
        lower(regexp_replace(coalesce(ledger.description, ledger.descricao, ''), '[^[:alnum:]]+', ' ', 'g')),
        lower(regexp_replace(coalesce(ledger.source, ledger.origem, ''), '[^[:alnum:]]+', ' ', 'g'))
      ) as canonical_key,
      count(*) as existing_count
    from public.mf_finance_ledger_entries as ledger
    where ledger.user_id = v_user_id
      and ledger.date between
        (select min(entry_date) from ranked_entries)
        and (select max(entry_date) from ranked_entries)
    group by 1
  ),
  candidates as (
    select
      ranked_entries.*,
      coalesce(
        supplied_external_id,
        'statement:' || md5(canonical_key || '|' || occurrence::text)
      ) as external_id
    from ranked_entries
    left join existing_counts using (canonical_key)
    where supplied_external_id is not null
      or occurrence > coalesce(existing_count, 0)
  ),
  inserted as (
    insert into public.mf_finance_ledger_entries (
      user_id,
      external_id,
      date,
      description,
      category,
      amount,
      type,
      source,
      status,
      origem,
      status_importacao,
      metadata,
      source_import
    )
    select
      v_user_id,
      candidates.external_id,
      candidates.entry_date,
      candidates.description,
      candidates.category,
      candidates.signed_amount,
      candidates.entry_type,
      candidates.source,
      'paid',
      'extrato_importado',
      'valida',
      candidates.metadata || jsonb_build_object(
        'import_fingerprint', candidates.external_id,
        'balance_review_mode', v_mode,
        'reviewed_at', now()
      ),
      'statement_import'
    from candidates
    on conflict (user_id, external_id) do nothing
    returning amount
  )
  select count(*)::integer, coalesce(sum(amount), 0)
  into v_inserted_count, v_net_new
  from inserted;

  v_duplicate_count := v_requested_count - v_inserted_count;
  v_balance_after := v_balance_before;

  if v_mode = 'apply_new' then
    v_balance_after := round(v_balance_before + v_net_new, 2);
  elsif v_mode = 'statement' then
    v_balance_after := round(p_statement_balance, 2);
  end if;

  if v_mode <> 'keep' then
    update public.mf_user_settings
    set current_balance = v_balance_after,
        updated_at = now()
    where user_id = v_user_id;

    if not found then
      raise exception using
        errcode = 'P0002',
        message = 'User financial settings could not be updated.';
    end if;
  end if;

  return jsonb_build_object(
    'requested_count', v_requested_count,
    'inserted_count', v_inserted_count,
    'duplicate_count', v_duplicate_count,
    'net_new', round(v_net_new, 2),
    'balance_before', round(v_balance_before, 2),
    'balance_after', round(v_balance_after, 2),
    'balance_mode', v_mode
  );
end;
$$;

comment on function public.mf_commit_statement_import(jsonb, text, numeric)
is 'Atomically deduplicates statement entries, inserts the ledger batch, and applies the approved balance decision for the authenticated user.';

revoke execute on function public.mf_commit_statement_import(jsonb, text, numeric) from public;
revoke execute on function public.mf_commit_statement_import(jsonb, text, numeric) from anon;
grant execute on function public.mf_commit_statement_import(jsonb, text, numeric) to authenticated;
