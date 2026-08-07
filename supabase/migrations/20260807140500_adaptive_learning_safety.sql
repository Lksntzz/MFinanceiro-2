-- Concurrency and precedence hardening for adaptive learning.

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

  -- Reviews are saved concurrently by the client. Serialize learning for the same
  -- user/merchant/type so promotion cannot create duplicate learned rules.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_user_id::text || '|' || v_key || '|' || p_transaction_type,
      0
    )
  );

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
          -- Never reactivate an existing learned rule automatically. This preserves
          -- a user pause. Falling below the safety threshold can still disable it.
          is_active = case when v_pattern.auto_apply and not v_pattern.suppressed then rule.is_active else false end,
          updated_at = now()
      where rule.id = v_rule_id and rule.user_id = p_user_id;
    end if;
  end loop;
end;
$$;

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
  order by
    case when rule.origin = 'manual' then 1 else 0 end desc,
    rule.priority desc,
    rule.created_at,
    rule.id
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
