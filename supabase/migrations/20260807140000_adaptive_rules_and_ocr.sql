-- Adaptive categorization and OCR quality learning.
-- Human review remains authoritative. Learned automation is only promoted after
-- repeated, consistent confirmations and can be paused independently.

alter table public.mf_categorization_rules
  drop constraint if exists mf_categorization_rules_match_field_check;

alter table public.mf_categorization_rules
  add constraint mf_categorization_rules_match_field_check
  check (match_field in ('description', 'source', 'description_or_source', 'merchant_key'));

alter table public.mf_categorization_rules
  add column if not exists origin text not null default 'manual',
  add column if not exists adaptive_confidence numeric(5,4),
  add column if not exists adaptive_confirmation_count integer not null default 0;

alter table public.mf_categorization_rules
  drop constraint if exists mf_categorization_rules_origin_check;

alter table public.mf_categorization_rules
  add constraint mf_categorization_rules_origin_check
  check (origin in ('manual', 'learned'));

alter table public.mf_categorization_rules
  drop constraint if exists mf_categorization_rules_adaptive_confidence_check;

alter table public.mf_categorization_rules
  add constraint mf_categorization_rules_adaptive_confidence_check
  check (adaptive_confidence is null or adaptive_confidence between 0 and 1);

create table if not exists public.mf_adaptive_category_patterns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  merchant_key text not null,
  transaction_type text not null check (transaction_type in ('income', 'expense')),
  category_id uuid not null,
  category_name text not null,
  confirmation_count integer not null default 0 check (confirmation_count >= 0),
  contradiction_count integer not null default 0 check (contradiction_count >= 0),
  confidence_score numeric(5,4) not null default 0 check (confidence_score between 0 and 1),
  auto_apply boolean not null default false,
  suppressed boolean not null default false,
  first_confirmed_at timestamptz,
  last_confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mf_adaptive_category_patterns_key_check check (char_length(btrim(merchant_key)) between 2 and 160),
  constraint mf_adaptive_category_patterns_category_user_fk
    foreign key (category_id, user_id) references public.mf_transaction_categories(id, user_id) on delete cascade,
  constraint mf_adaptive_category_patterns_unique unique (user_id, merchant_key, transaction_type, category_id),
  constraint mf_adaptive_category_patterns_id_user_key unique (id, user_id)
);

alter table public.mf_categorization_rules
  add column if not exists adaptive_pattern_id uuid;

alter table public.mf_categorization_rules
  drop constraint if exists mf_categorization_rules_adaptive_pattern_fk;

alter table public.mf_categorization_rules
  add constraint mf_categorization_rules_adaptive_pattern_fk
  foreign key (adaptive_pattern_id, user_id)
  references public.mf_adaptive_category_patterns(id, user_id)
  on delete set null (adaptive_pattern_id);

create unique index if not exists mf_categorization_rules_adaptive_pattern_uidx
  on public.mf_categorization_rules(adaptive_pattern_id)
  where adaptive_pattern_id is not null;

create index if not exists mf_adaptive_category_patterns_match_idx
  on public.mf_adaptive_category_patterns(user_id, merchant_key, transaction_type, auto_apply, suppressed);

create table if not exists public.mf_ocr_quality_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  institution_key text not null,
  reviewed_item_count integer not null default 0 check (reviewed_item_count >= 0),
  accepted_count integer not null default 0 check (accepted_count >= 0),
  edited_count integer not null default 0 check (edited_count >= 0),
  rejected_count integer not null default 0 check (rejected_count >= 0),
  correction_rate numeric(5,4) not null default 0 check (correction_rate between 0 and 1),
  review_threshold numeric(5,4) not null default 0.85 check (review_threshold between 0.75 and 0.98),
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mf_ocr_quality_profiles_institution_check check (char_length(btrim(institution_key)) between 1 and 160),
  constraint mf_ocr_quality_profiles_unique unique (user_id, institution_key)
);

create index if not exists mf_ocr_quality_profiles_user_idx
  on public.mf_ocr_quality_profiles(user_id, reviewed_item_count desc, updated_at desc);

create table if not exists public.mf_learning_feedback_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  extraction_id uuid references public.mf_document_extractions(id) on delete cascade,
  extraction_item_id uuid references public.mf_document_extraction_items(id) on delete cascade,
  institution_key text,
  merchant_key text,
  review_action text not null check (review_action in ('accepted', 'edited', 'rejected')),
  transaction_type text check (transaction_type is null or transaction_type in ('income', 'expense')),
  model_confidence numeric(5,4),
  original_payload jsonb not null default '{}'::jsonb,
  reviewed_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists mf_learning_feedback_events_user_created_idx
  on public.mf_learning_feedback_events(user_id, created_at desc);
create index if not exists mf_learning_feedback_events_pattern_idx
  on public.mf_learning_feedback_events(user_id, merchant_key, transaction_type)
  where merchant_key is not null;

alter table public.mf_adaptive_category_patterns enable row level security;
alter table public.mf_ocr_quality_profiles enable row level security;
alter table public.mf_learning_feedback_events enable row level security;

create policy mf_adaptive_category_patterns_select_own
  on public.mf_adaptive_category_patterns for select to authenticated
  using ((select auth.uid()) = user_id);
create policy mf_ocr_quality_profiles_select_own
  on public.mf_ocr_quality_profiles for select to authenticated
  using ((select auth.uid()) = user_id);
create policy mf_learning_feedback_events_select_own
  on public.mf_learning_feedback_events for select to authenticated
  using ((select auth.uid()) = user_id);

grant select on public.mf_adaptive_category_patterns to authenticated;
grant select on public.mf_ocr_quality_profiles to authenticated;
grant select on public.mf_learning_feedback_events to authenticated;
revoke all on public.mf_adaptive_category_patterns from anon;
revoke all on public.mf_ocr_quality_profiles from anon;
revoke all on public.mf_learning_feedback_events from anon;

create trigger mf_adaptive_category_patterns_touch_updated_at
before update on public.mf_adaptive_category_patterns
for each row execute function mf_private.mf_touch_updated_at();

create trigger mf_ocr_quality_profiles_touch_updated_at
before update on public.mf_ocr_quality_profiles
for each row execute function mf_private.mf_touch_updated_at();

create or replace function mf_private.mf_merchant_key(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(
    btrim(
      regexp_replace(
        regexp_replace(
          regexp_replace(lower(coalesce(p_value, '')), '[^[:alnum:][:space:]]+', ' ', 'g'),
          '\m[0-9]{3,}\M',
          ' ',
          'g'
        ),
        '[[:space:]]+',
        ' ',
        'g'
      )
    ),
    160
  );
$$;

revoke execute on function mf_private.mf_merchant_key(text) from public, anon, authenticated;

create or replace function mf_private.mf_update_ocr_quality_profile(
  p_user_id uuid,
  p_institution_key text,
  p_review_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := left(coalesce(nullif(btrim(p_institution_key), ''), '*'), 160);
begin
  insert into public.mf_ocr_quality_profiles (
    user_id,
    institution_key,
    reviewed_item_count,
    accepted_count,
    edited_count,
    rejected_count,
    last_reviewed_at
  ) values (
    p_user_id,
    v_key,
    1,
    case when p_review_status = 'accepted' then 1 else 0 end,
    case when p_review_status = 'edited' then 1 else 0 end,
    case when p_review_status = 'rejected' then 1 else 0 end,
    now()
  )
  on conflict (user_id, institution_key)
  do update set
    reviewed_item_count = public.mf_ocr_quality_profiles.reviewed_item_count + 1,
    accepted_count = public.mf_ocr_quality_profiles.accepted_count + case when p_review_status = 'accepted' then 1 else 0 end,
    edited_count = public.mf_ocr_quality_profiles.edited_count + case when p_review_status = 'edited' then 1 else 0 end,
    rejected_count = public.mf_ocr_quality_profiles.rejected_count + case when p_review_status = 'rejected' then 1 else 0 end,
    last_reviewed_at = now();

  update public.mf_ocr_quality_profiles profile
  set correction_rate = round((profile.edited_count + profile.rejected_count)::numeric / greatest(profile.reviewed_item_count, 1), 4),
      review_threshold = case
        when profile.reviewed_item_count < 10 then 0.85
        when (profile.edited_count + profile.rejected_count)::numeric / greatest(profile.reviewed_item_count, 1) >= 0.30 then 0.94
        when (profile.edited_count + profile.rejected_count)::numeric / greatest(profile.reviewed_item_count, 1) >= 0.20 then 0.92
        when (profile.edited_count + profile.rejected_count)::numeric / greatest(profile.reviewed_item_count, 1) >= 0.12 then 0.89
        when profile.reviewed_item_count >= 50
          and (profile.edited_count + profile.rejected_count)::numeric / greatest(profile.reviewed_item_count, 1) <= 0.03 then 0.80
        when profile.reviewed_item_count >= 30
          and (profile.edited_count + profile.rejected_count)::numeric / greatest(profile.reviewed_item_count, 1) <= 0.06 then 0.82
        else 0.85
      end,
      updated_at = now()
  where profile.user_id = p_user_id and profile.institution_key = v_key;
end;
$$;

create or replace function mf_private.mf_record_adaptive_category_pattern(
  p_user_id uuid,
  p_merchant_key text,
  p_transaction_type text,
  p_category_id uuid,
  p_category_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := left(btrim(coalesce(p_merchant_key, '')), 160);
  v_total integer := 0;
  v_pattern public.mf_adaptive_category_patterns%rowtype;
  v_rule_id uuid;
begin
  if char_length(v_key) < 2 or p_transaction_type not in ('income', 'expense') then
    return;
  end if;

  if not exists (
    select 1
    from public.mf_transaction_categories category
    where category.id = p_category_id
      and category.user_id = p_user_id
      and category.is_active
      and category.category_type in ('both', p_transaction_type)
  ) then
    return;
  end if;

  insert into public.mf_adaptive_category_patterns (
    user_id,
    merchant_key,
    transaction_type,
    category_id,
    category_name,
    confirmation_count,
    first_confirmed_at,
    last_confirmed_at
  ) values (
    p_user_id,
    v_key,
    p_transaction_type,
    p_category_id,
    left(coalesce(nullif(btrim(p_category_name), ''), 'Geral'), 120),
    1,
    now(),
    now()
  )
  on conflict (user_id, merchant_key, transaction_type, category_id)
  do update set
    category_name = excluded.category_name,
    confirmation_count = public.mf_adaptive_category_patterns.confirmation_count + 1,
    last_confirmed_at = now();

  select coalesce(sum(pattern.confirmation_count), 0)::integer
  into v_total
  from public.mf_adaptive_category_patterns pattern
  where pattern.user_id = p_user_id
    and pattern.merchant_key = v_key
    and pattern.transaction_type = p_transaction_type;

  update public.mf_adaptive_category_patterns pattern
  set contradiction_count = greatest(v_total - pattern.confirmation_count, 0),
      confidence_score = round(pattern.confirmation_count::numeric / greatest(v_total, 1), 4),
      auto_apply = (
        not pattern.suppressed
        and pattern.confirmation_count >= 3
        and pattern.confirmation_count::numeric / greatest(v_total, 1) >= 0.80
      ),
      updated_at = now()
  where pattern.user_id = p_user_id
    and pattern.merchant_key = v_key
    and pattern.transaction_type = p_transaction_type;

  for v_pattern in
    select *
    from public.mf_adaptive_category_patterns pattern
    where pattern.user_id = p_user_id
      and pattern.merchant_key = v_key
      and pattern.transaction_type = p_transaction_type
  loop
    select rule.id into v_rule_id
    from public.mf_categorization_rules rule
    where rule.user_id = p_user_id
      and rule.adaptive_pattern_id = v_pattern.id
    limit 1;

    if v_pattern.auto_apply and not v_pattern.suppressed and v_rule_id is null then
      insert into public.mf_categorization_rules (
        user_id,
        name,
        priority,
        match_field,
        match_operator,
        match_value,
        transaction_type,
        category_id,
        is_active,
        origin,
        adaptive_pattern_id,
        adaptive_confidence,
        adaptive_confirmation_count
      ) values (
        p_user_id,
        left('Aprendizado · ' || v_pattern.category_name || ' · ' || v_pattern.merchant_key, 120),
        60,
        'merchant_key',
        'exact',
        v_pattern.merchant_key,
        v_pattern.transaction_type,
        v_pattern.category_id,
        true,
        'learned',
        v_pattern.id,
        v_pattern.confidence_score,
        v_pattern.confirmation_count
      );
    elsif v_rule_id is not null then
      update public.mf_categorization_rules rule
      set adaptive_confidence = v_pattern.confidence_score,
          adaptive_confirmation_count = v_pattern.confirmation_count,
          is_active = case when v_pattern.auto_apply and not v_pattern.suppressed then rule.is_active else false end,
          updated_at = now()
      where rule.id = v_rule_id and rule.user_id = p_user_id;
    end if;
  end loop;
end;
$$;

create or replace function mf_private.mf_capture_document_review_learning()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_extraction public.mf_document_extractions%rowtype;
  v_institution_key text := '*';
  v_merchant_key text;
  v_category_id uuid := new.category_id;
  v_category_name text := coalesce(nullif(btrim(new.category_name), ''), 'Geral');
  v_model_confidence numeric := coalesce((old.raw_payload ->> 'confidence')::numeric, old.overall_confidence, 0);
begin
  if old.review_status <> 'pending'
    or new.review_status not in ('accepted', 'edited', 'rejected')
    or new.review_status = old.review_status
  then
    return new;
  end if;

  select * into v_extraction
  from public.mf_document_extractions extraction
  where extraction.id = new.extraction_id and extraction.user_id = new.user_id;

  if v_extraction.id is not null then
    v_institution_key := left(
      mf_private.mf_name_key(
        coalesce(nullif(v_extraction.result_metadata ->> 'institution_name', ''), 'desconhecida')
      ),
      160
    );
  end if;

  v_merchant_key := mf_private.mf_merchant_key(coalesce(old.description, new.description, ''));

  if v_category_id is null and char_length(btrim(v_category_name)) > 0 then
    select category.id, category.name
    into v_category_id, v_category_name
    from public.mf_transaction_categories category
    where category.user_id = new.user_id
      and category.is_active
      and category.name_key = mf_private.mf_name_key(v_category_name)
    limit 1;
  end if;

  insert into public.mf_learning_feedback_events (
    user_id,
    extraction_id,
    extraction_item_id,
    institution_key,
    merchant_key,
    review_action,
    transaction_type,
    model_confidence,
    original_payload,
    reviewed_payload
  ) values (
    new.user_id,
    new.extraction_id,
    new.id,
    v_institution_key,
    nullif(v_merchant_key, ''),
    new.review_status,
    new.transaction_type,
    greatest(0, least(1, coalesce(v_model_confidence, 0))),
    jsonb_build_object(
      'date', old.transaction_date,
      'description', old.description,
      'signed_amount', old.signed_amount,
      'type', old.transaction_type,
      'category_id', old.category_id,
      'category_name', old.category_name,
      'confidence', old.overall_confidence,
      'field_confidence', old.field_confidence
    ),
    jsonb_build_object(
      'date', new.transaction_date,
      'description', new.description,
      'signed_amount', new.signed_amount,
      'type', new.transaction_type,
      'category_id', v_category_id,
      'category_name', v_category_name,
      'review_status', new.review_status
    )
  );

  perform mf_private.mf_update_ocr_quality_profile(new.user_id, '*', new.review_status);
  if v_institution_key <> '*' then
    perform mf_private.mf_update_ocr_quality_profile(new.user_id, v_institution_key, new.review_status);
  end if;

  if new.review_status in ('accepted', 'edited')
    and v_category_id is not null
    and new.transaction_type in ('income', 'expense')
    and char_length(v_merchant_key) >= 2
  then
    perform mf_private.mf_record_adaptive_category_pattern(
      new.user_id,
      v_merchant_key,
      new.transaction_type,
      v_category_id,
      v_category_name
    );
  end if;

  return new;
end;
$$;

drop trigger if exists mf_capture_document_review_learning on public.mf_document_extraction_items;
create trigger mf_capture_document_review_learning
after update of review_status, transaction_date, description, signed_amount, transaction_type, category_id, category_name
on public.mf_document_extraction_items
for each row execute function mf_private.mf_capture_document_review_learning();

create or replace function mf_private.mf_suppress_deleted_learned_rule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.origin = 'learned' and old.adaptive_pattern_id is not null then
    update public.mf_adaptive_category_patterns
    set suppressed = true, auto_apply = false, updated_at = now()
    where id = old.adaptive_pattern_id and user_id = old.user_id;
  end if;
  return old;
end;
$$;

drop trigger if exists mf_suppress_deleted_learned_rule on public.mf_categorization_rules;
create trigger mf_suppress_deleted_learned_rule
after delete on public.mf_categorization_rules
for each row execute function mf_private.mf_suppress_deleted_learned_rule();

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
  v_merchant_key text := mf_private.mf_merchant_key(coalesce(new.description, ''));
  v_category_name text;
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
        when 'merchant_key' then
          case rule.match_operator
            when 'exact' then v_merchant_key = mf_private.mf_merchant_key(rule.match_value)
            when 'starts_with' then v_merchant_key like mf_private.mf_merchant_key(rule.match_value) || '%'
            else position(mf_private.mf_merchant_key(rule.match_value) in v_merchant_key) > 0
          end
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

  select category.name into v_category_name
  from public.mf_transaction_categories category
  where category.id = v_rule.category_id
    and category.user_id = new.user_id
    and category.is_active;
  if v_category_name is null then
    return new;
  end if;

  new.category_id := v_rule.category_id;
  new.category := v_category_name;
  new.categoria := v_category_name;
  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
    'categorization_rule_id', v_rule.id,
    'categorization_confidence', coalesce(v_rule.adaptive_confidence, 1),
    'categorization_source', case when v_rule.origin = 'learned' then 'adaptive_rule' else 'rule' end,
    'adaptive_pattern_id', v_rule.adaptive_pattern_id
  );

  update public.mf_categorization_rules
  set hit_count = hit_count + 1, last_matched_at = now()
  where id = v_rule.id and user_id = new.user_id;
  return new;
end;
$$;

comment on table public.mf_adaptive_category_patterns is
  'User-specific merchant/category patterns learned only from reviewed OCR items. Auto-apply requires at least 3 consistent confirmations and 80% agreement.';
comment on table public.mf_ocr_quality_profiles is
  'Calibrates the OCR review threshold from historical accepted, edited and rejected items, globally and per institution.';
comment on table public.mf_learning_feedback_events is
  'Immutable audit trail of human OCR review decisions used to improve deterministic suggestions.';
