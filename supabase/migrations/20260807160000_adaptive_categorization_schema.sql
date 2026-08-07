-- Adaptive categorization schema.

alter table public.mf_categorization_rules
  add column if not exists rule_origin text not null default 'manual',
  add column if not exists confidence_score numeric(5,4) not null default 1,
  add column if not exists confirmation_count integer not null default 0,
  add column if not exists pattern_key text,
  add column if not exists last_confirmed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.mf_categorization_rules'::regclass
      and conname = 'mf_categorization_rules_origin_check'
  ) then
    alter table public.mf_categorization_rules
      add constraint mf_categorization_rules_origin_check
      check (rule_origin in ('manual', 'adaptive'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.mf_categorization_rules'::regclass
      and conname = 'mf_categorization_rules_confidence_check'
  ) then
    alter table public.mf_categorization_rules
      add constraint mf_categorization_rules_confidence_check
      check (confidence_score between 0 and 1);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.mf_categorization_rules'::regclass
      and conname = 'mf_categorization_rules_confirmation_count_check'
  ) then
    alter table public.mf_categorization_rules
      add constraint mf_categorization_rules_confirmation_count_check
      check (confirmation_count >= 0);
  end if;
end $$;

create unique index if not exists mf_categorization_rules_adaptive_pattern_unique
  on public.mf_categorization_rules (
    user_id,
    coalesce(account_id, '00000000-0000-0000-0000-000000000000'::uuid),
    pattern_key,
    coalesce(transaction_type, 'both')
  )
  where rule_origin = 'adaptive' and pattern_key is not null;

create table if not exists public.mf_adaptive_feedback_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  extraction_id uuid not null references public.mf_document_extractions(id) on delete cascade,
  extraction_item_id uuid not null references public.mf_document_extraction_items(id) on delete cascade,
  account_id uuid,
  institution_key text,
  pattern_key text not null,
  transaction_type text not null check (transaction_type in ('income', 'expense')),
  category_id uuid not null,
  review_status text not null check (review_status in ('accepted', 'edited')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mf_adaptive_feedback_events_item_key unique (extraction_item_id),
  constraint mf_adaptive_feedback_events_account_user_fk
    foreign key (account_id, user_id) references public.mf_financial_accounts(id, user_id) on delete cascade,
  constraint mf_adaptive_feedback_events_category_user_fk
    foreign key (category_id, user_id) references public.mf_transaction_categories(id, user_id) on delete cascade
);

create index if not exists mf_adaptive_feedback_events_pattern_idx
  on public.mf_adaptive_feedback_events (
    user_id, account_id, pattern_key, transaction_type, updated_at desc
  );
create index if not exists mf_adaptive_feedback_events_category_idx
  on public.mf_adaptive_feedback_events (category_id, updated_at desc);

alter table public.mf_adaptive_feedback_events enable row level security;

drop policy if exists mf_adaptive_feedback_events_select_own on public.mf_adaptive_feedback_events;
create policy mf_adaptive_feedback_events_select_own
  on public.mf_adaptive_feedback_events for select to authenticated
  using ((select auth.uid()) = user_id);

grant select on public.mf_adaptive_feedback_events to authenticated;
revoke insert, update, delete on public.mf_adaptive_feedback_events from authenticated;
revoke all on public.mf_adaptive_feedback_events from anon;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'mf_adaptive_feedback_events_touch_updated_at'
  ) then
    create trigger mf_adaptive_feedback_events_touch_updated_at
      before update on public.mf_adaptive_feedback_events
      for each row execute function mf_private.mf_touch_updated_at();
  end if;
end $$;

create or replace function mf_private.mf_learning_pattern(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_token text;
  v_text text := lower(regexp_replace(btrim(coalesce(p_value, '')), '[^[:alnum:]À-ÿ]+', ' ', 'g'));
begin
  for v_token in
    select token
    from unnest(regexp_split_to_array(v_text, '[[:space:]]+')) token
  loop
    if char_length(v_token) < 4
      or v_token ~ '^[0-9]+$'
      or v_token in (
        'compra', 'pagamento', 'pagto', 'debito', 'credito', 'cartao',
        'transferencia', 'recebimento', 'transacao', 'parcela', 'estorno',
        'saque', 'deposito', 'agendamento', 'lancamento'
      )
    then
      continue;
    end if;
    return left(v_token, 80);
  end loop;
  return null;
end;
$$;
