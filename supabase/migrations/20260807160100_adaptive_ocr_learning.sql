-- Learn from reviewed OCR rows and maintain conservative adaptive rules.

create or replace function mf_private.mf_refresh_adaptive_rule(
  p_user_id uuid,
  p_account_id uuid,
  p_pattern_key text,
  p_transaction_type text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total integer := 0;
  v_dominant_count integer := 0;
  v_category_id uuid;
  v_category_name text;
  v_confidence numeric(5,4) := 0;
  v_rule public.mf_categorization_rules%rowtype;
begin
  if p_user_id is null or p_pattern_key is null or char_length(p_pattern_key) < 4
    or p_transaction_type not in ('income', 'expense')
  then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_user_id::text || ':' || coalesce(p_account_id::text, '*') || ':' || p_pattern_key || ':' || p_transaction_type,
    0
  ));

  select count(*) into v_total
  from public.mf_adaptive_feedback_events event
  where event.user_id = p_user_id
    and event.account_id is not distinct from p_account_id
    and event.pattern_key = p_pattern_key
    and event.transaction_type = p_transaction_type;

  select event.category_id, count(*)::integer
    into v_category_id, v_dominant_count
  from public.mf_adaptive_feedback_events event
  where event.user_id = p_user_id
    and event.account_id is not distinct from p_account_id
    and event.pattern_key = p_pattern_key
    and event.transaction_type = p_transaction_type
  group by event.category_id
  order by count(*) desc, max(event.updated_at) desc, event.category_id
  limit 1;

  v_confidence := case
    when v_total > 0 then round(v_dominant_count::numeric / v_total::numeric, 4)
    else 0
  end;

  select * into v_rule
  from public.mf_categorization_rules rule
  where rule.user_id = p_user_id
    and rule.rule_origin = 'adaptive'
    and rule.account_id is not distinct from p_account_id
    and rule.pattern_key = p_pattern_key
    and rule.transaction_type = p_transaction_type
  order by rule.created_at
  limit 1
  for update;

  if v_category_id is not null then
    select category.name into v_category_name
    from public.mf_transaction_categories category
    where category.id = v_category_id
      and category.user_id = p_user_id
      and category.is_active;
  end if;

  if v_dominant_count >= 3 and v_confidence >= 0.8 and v_category_name is not null then
    if v_rule.id is null then
      insert into public.mf_categorization_rules (
        user_id, name, priority, match_field, match_operator, match_value,
        transaction_type, account_id, category_id, is_active,
        rule_origin, confidence_score, confirmation_count, pattern_key, last_confirmed_at
      ) values (
        p_user_id,
        left('Aprendido · ' || p_pattern_key, 120),
        75,
        'description',
        'contains',
        p_pattern_key,
        p_transaction_type,
        p_account_id,
        v_category_id,
        true,
        'adaptive',
        v_confidence,
        v_dominant_count,
        p_pattern_key,
        now()
      );
    else
      update public.mf_categorization_rules
      set name = left('Aprendido · ' || p_pattern_key, 120),
          match_value = p_pattern_key,
          category_id = v_category_id,
          confidence_score = v_confidence,
          confirmation_count = v_dominant_count,
          last_confirmed_at = now()
      where id = v_rule.id;
    end if;
  elsif v_rule.id is not null then
    update public.mf_categorization_rules
    set confidence_score = v_confidence,
        confirmation_count = v_dominant_count,
        is_active = case
          when v_confidence < 0.7 or v_dominant_count < 2 then false
          else is_active
        end,
        last_confirmed_at = now()
    where id = v_rule.id;
  end if;
end;
$$;

create or replace function mf_private.mf_capture_ocr_feedback()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_extraction public.mf_document_extractions%rowtype;
  v_existing public.mf_adaptive_feedback_events%rowtype;
  v_category_id uuid;
  v_pattern_key text;
  v_institution_key text;
begin
  select * into v_existing
  from public.mf_adaptive_feedback_events event
  where event.extraction_item_id = new.id;

  select * into v_extraction
  from public.mf_document_extractions extraction
  where extraction.id = new.extraction_id
    and extraction.user_id = new.user_id;
  if v_extraction.id is null then
    return new;
  end if;

  v_pattern_key := mf_private.mf_learning_pattern(new.description);
  v_institution_key := left(mf_private.mf_name_key(coalesce(
    v_extraction.result_metadata ->> 'institution_name',
    new.source_name,
    ''
  )), 160);

  if new.review_status not in ('accepted', 'edited')
    or new.transaction_type not in ('income', 'expense')
    or v_pattern_key is null
    or lower(coalesce(new.category_name, '')) in ('', 'geral', 'outros', 'não categorizado', 'nao categorizado')
  then
    if v_existing.id is not null then
      delete from public.mf_adaptive_feedback_events where id = v_existing.id;
      perform mf_private.mf_refresh_adaptive_rule(
        v_existing.user_id,
        v_existing.account_id,
        v_existing.pattern_key,
        v_existing.transaction_type
      );
    end if;
    return new;
  end if;

  select category.id into v_category_id
  from public.mf_transaction_categories category
  where category.user_id = new.user_id
    and category.is_active
    and mf_private.mf_name_key(category.name) = mf_private.mf_name_key(new.category_name)
  order by category.is_system desc, category.created_at
  limit 1;

  if v_category_id is null then
    if v_existing.id is not null then
      delete from public.mf_adaptive_feedback_events where id = v_existing.id;
      perform mf_private.mf_refresh_adaptive_rule(
        v_existing.user_id,
        v_existing.account_id,
        v_existing.pattern_key,
        v_existing.transaction_type
      );
    end if;
    return new;
  end if;

  insert into public.mf_adaptive_feedback_events (
    user_id, extraction_id, extraction_item_id, account_id,
    institution_key, pattern_key, transaction_type, category_id, review_status
  ) values (
    new.user_id, new.extraction_id, new.id, v_extraction.account_id,
    nullif(v_institution_key, ''), v_pattern_key, new.transaction_type, v_category_id, new.review_status
  )
  on conflict (extraction_item_id) do update set
    account_id = excluded.account_id,
    institution_key = excluded.institution_key,
    pattern_key = excluded.pattern_key,
    transaction_type = excluded.transaction_type,
    category_id = excluded.category_id,
    review_status = excluded.review_status;

  if v_existing.id is not null and (
    v_existing.account_id is distinct from v_extraction.account_id
    or v_existing.pattern_key <> v_pattern_key
    or v_existing.transaction_type <> new.transaction_type
  ) then
    perform mf_private.mf_refresh_adaptive_rule(
      v_existing.user_id,
      v_existing.account_id,
      v_existing.pattern_key,
      v_existing.transaction_type
    );
  end if;

  perform mf_private.mf_refresh_adaptive_rule(
    new.user_id,
    v_extraction.account_id,
    v_pattern_key,
    new.transaction_type
  );
  return new;
end;
$$;

drop trigger if exists mf_capture_ocr_feedback on public.mf_document_extraction_items;
create trigger mf_capture_ocr_feedback
after update of transaction_date, description, signed_amount, transaction_type, category_name, review_status
on public.mf_document_extraction_items
for each row
when (
  old.review_status is distinct from new.review_status
  or old.description is distinct from new.description
  or old.transaction_type is distinct from new.transaction_type
  or old.category_name is distinct from new.category_name
)
execute function mf_private.mf_capture_ocr_feedback();

create or replace function mf_private.mf_feedback_deleted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform mf_private.mf_refresh_adaptive_rule(
    old.user_id,
    old.account_id,
    old.pattern_key,
    old.transaction_type
  );
  return old;
end;
$$;

drop trigger if exists mf_adaptive_feedback_after_delete on public.mf_adaptive_feedback_events;
create trigger mf_adaptive_feedback_after_delete
after delete on public.mf_adaptive_feedback_events
for each row execute function mf_private.mf_feedback_deleted();

create or replace function public.mf_get_adaptive_ocr_hints(
  p_account_id uuid default null,
  p_limit integer default 20
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with grouped as (
    select
      event.pattern_key,
      event.transaction_type,
      event.category_id,
      max(event.institution_key) as institution_key,
      count(*)::integer as confirmations,
      count(*) filter (where event.review_status = 'edited')::integer as edits,
      max(event.updated_at) as last_seen_at
    from public.mf_adaptive_feedback_events event
    where event.user_id = auth.uid()
      and (p_account_id is null or event.account_id = p_account_id)
    group by event.pattern_key, event.transaction_type, event.category_id
  ), totals as (
    select pattern_key, transaction_type, sum(confirmations)::integer as total
    from grouped
    group by pattern_key, transaction_type
  ), ranked as (
    select
      grouped.*,
      totals.total,
      round(grouped.confirmations::numeric / nullif(totals.total, 0), 4) as confidence,
      row_number() over (
        partition by grouped.pattern_key, grouped.transaction_type
        order by grouped.confirmations desc, grouped.last_seen_at desc, grouped.category_id
      ) as rank
    from grouped
    join totals using (pattern_key, transaction_type)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'pattern', selected.pattern_key,
    'transaction_type', selected.transaction_type,
    'category_id', selected.category_id,
    'category_name', category.name,
    'institution_key', selected.institution_key,
    'confirmations', selected.confirmations,
    'edits', selected.edits,
    'confidence', selected.confidence
  ) order by selected.confidence desc, selected.confirmations desc, selected.last_seen_at desc), '[]'::jsonb)
  from (
    select * from ranked
    where rank = 1 and confirmations >= 2 and confidence >= 0.6
    order by confidence desc, confirmations desc, last_seen_at desc
    limit greatest(1, least(coalesce(p_limit, 20), 50))
  ) selected
  join public.mf_transaction_categories category
    on category.id = selected.category_id
   and category.user_id = auth.uid()
   and category.is_active;
$$;

grant execute on function public.mf_get_adaptive_ocr_hints(uuid, integer) to authenticated;
revoke all on function public.mf_get_adaptive_ocr_hints(uuid, integer) from anon;
