-- Carry rule origin and confidence into previews and applied ledger metadata.

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
  where category.id = v_rule.category_id
    and category.user_id = new.user_id
    and category.is_active;
  if v_match_key is null then
    return new;
  end if;

  new.category_id := v_rule.category_id;
  new.category := v_match_key;
  new.categoria := v_match_key;
  new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
    'categorization_rule_id', v_rule.id,
    'categorization_confidence', coalesce(v_rule.confidence_score, 1),
    'categorization_source', coalesce(v_rule.rule_origin, 'manual')
  );

  update public.mf_categorization_rules
  set hit_count = hit_count + 1,
      last_matched_at = now()
  where id = v_rule.id and user_id = new.user_id;
  return new;
end;
$$;

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
    'rule_origin', matched.rule_origin,
    'category_id', matched.category_id,
    'category_name', category.name,
    'account_id', matched.account_id,
    'confidence', case
      when matched.id is null then 0
      else coalesce(matched.confidence_score, 1)
    end
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
          else position(
            mf_private.mf_name_key(rule.match_value)
            in mf_private.mf_name_key(coalesce(item ->> 'description', '') || ' ' || coalesce(item ->> 'source', ''))
          ) > 0
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
