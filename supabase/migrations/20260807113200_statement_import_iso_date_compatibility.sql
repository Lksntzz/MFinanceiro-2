-- Keep statement imports compatible with parsers that emit ISO timestamps.
-- The original atomic importer is preserved as the core implementation; callers
-- using v2 transparently receive date normalization before the atomic commit.

do $$
begin
  if to_regprocedure('public.mf_commit_statement_import_v2_core(jsonb,uuid,text,numeric,text,text,bigint,text,text,jsonb)') is null then
    alter function public.mf_commit_statement_import_v2(jsonb, uuid, text, numeric, text, text, bigint, text, text, jsonb)
      rename to mf_commit_statement_import_v2_core;
  end if;
end;
$$;

create or replace function public.mf_commit_statement_import_v3(
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
  v_entries jsonb;
begin
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception using errcode = '22023', message = 'Os lançamentos devem ser enviados em uma lista JSON.';
  end if;

  select coalesce(
    jsonb_agg(
      case
        when coalesce(entry ->> 'date', '') ~ '^\d{4}-\d{2}-\d{2}'
          then jsonb_set(entry, '{date}', to_jsonb(left(entry ->> 'date', 10)), true)
        else entry
      end
      order by ordinal
    ),
    '[]'::jsonb
  )
  into v_entries
  from jsonb_array_elements(p_entries) with ordinality as source(entry, ordinal);

  return public.mf_commit_statement_import_v2_core(
    v_entries,
    p_account_id,
    p_balance_mode,
    p_statement_balance,
    p_file_name,
    p_file_type,
    p_file_size,
    p_file_hash,
    p_parser_name,
    coalesce(p_raw_metadata, '{}'::jsonb) || jsonb_build_object('date_normalized_by', 'mf_commit_statement_import_v3')
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
language sql
security invoker
set search_path = ''
as $$
  select public.mf_commit_statement_import_v3(
    p_entries,
    p_account_id,
    p_balance_mode,
    p_statement_balance,
    p_file_name,
    p_file_type,
    p_file_size,
    p_file_hash,
    p_parser_name,
    p_raw_metadata
  );
$$;

revoke execute on function public.mf_commit_statement_import_v2_core(jsonb, uuid, text, numeric, text, text, bigint, text, text, jsonb) from public;
revoke execute on function public.mf_commit_statement_import_v2_core(jsonb, uuid, text, numeric, text, text, bigint, text, text, jsonb) from anon;
grant execute on function public.mf_commit_statement_import_v2_core(jsonb, uuid, text, numeric, text, text, bigint, text, text, jsonb) to authenticated;

revoke execute on function public.mf_commit_statement_import_v3(jsonb, uuid, text, numeric, text, text, bigint, text, text, jsonb) from public;
revoke execute on function public.mf_commit_statement_import_v3(jsonb, uuid, text, numeric, text, text, bigint, text, text, jsonb) from anon;
grant execute on function public.mf_commit_statement_import_v3(jsonb, uuid, text, numeric, text, text, bigint, text, text, jsonb) to authenticated;

revoke execute on function public.mf_commit_statement_import_v2(jsonb, uuid, text, numeric, text, text, bigint, text, text, jsonb) from public;
revoke execute on function public.mf_commit_statement_import_v2(jsonb, uuid, text, numeric, text, text, bigint, text, text, jsonb) from anon;
grant execute on function public.mf_commit_statement_import_v2(jsonb, uuid, text, numeric, text, text, bigint, text, text, jsonb) to authenticated;

comment on function public.mf_commit_statement_import_v3(jsonb, uuid, text, numeric, text, text, bigint, text, text, jsonb)
is 'Normalizes ISO statement dates to YYYY-MM-DD before delegating to the atomic statement importer.';