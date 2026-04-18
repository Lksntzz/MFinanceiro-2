-- Governanca e seguranca para tabelas financeiras:
-- 1) Padroniza colunas de auditoria (created_at, updated_at, created_by, updated_by, source_import)
-- 2) Ativa e reforca RLS
-- 3) Garante politicas por usuario (user_id = auth.uid())

create or replace function public.mf_set_audit_fields()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.created_at is null then
      new.created_at = now();
    end if;

    if new.updated_at is null then
      new.updated_at = now();
    end if;

    if new.created_by is null then
      new.created_by = coalesce(auth.uid(), new.user_id);
    end if;

    if new.updated_by is null then
      new.updated_by = coalesce(auth.uid(), new.created_by, new.user_id);
    end if;
  else
    new.updated_at = now();
    new.updated_by = coalesce(auth.uid(), new.updated_by, new.user_id, new.created_by);
  end if;

  if new.source_import is null or btrim(new.source_import) = '' then
    new.source_import = 'manual';
  end if;

  return new;
end;
$$;

do $$
declare
  financial_tables text[] := array[
    'mf_finance_ledger_entries',
    'mf_user_settings',
    'mf_credit_cards',
    'mf_card_installments',
    'mf_daily_bills',
    'mf_fixed_bills'
  ];
  t text;
  trigger_name text;
  policy_select text;
  policy_insert text;
  policy_update text;
  policy_delete text;
begin
  foreach t in array financial_tables loop
    if to_regclass('public.' || t) is null then
      raise notice 'Tabela public.% nao encontrada. Pulando.', t;
      continue;
    end if;

    execute format('alter table public.%I add column if not exists created_at timestamptz not null default now()', t);
    execute format('alter table public.%I add column if not exists updated_at timestamptz not null default now()', t);
    execute format('alter table public.%I add column if not exists created_by uuid', t);
    execute format('alter table public.%I add column if not exists updated_by uuid', t);
    execute format('alter table public.%I add column if not exists source_import text not null default ''manual''', t);

    execute format('alter table public.%I alter column created_by set default auth.uid()', t);
    execute format('alter table public.%I alter column updated_by set default auth.uid()', t);

    execute format('update public.%I set created_by = coalesce(created_by, user_id) where created_by is null', t);
    execute format('update public.%I set updated_by = coalesce(updated_by, created_by, user_id) where updated_by is null', t);
    execute format('update public.%I set source_import = ''manual'' where source_import is null or btrim(source_import) = ''''', t);

    trigger_name := 'trg_' || t || '_audit';
    policy_select := t || '_select_own';
    policy_insert := t || '_insert_own';
    policy_update := t || '_update_own';
    policy_delete := t || '_delete_own';

    execute format('drop trigger if exists %I on public.%I', trigger_name, t);
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function public.mf_set_audit_fields()',
      trigger_name,
      t
    );

    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);

    execute format('drop policy if exists %I on public.%I', policy_select, t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = auth.uid())', policy_select, t);

    execute format('drop policy if exists %I on public.%I', policy_insert, t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = auth.uid())', policy_insert, t);

    execute format('drop policy if exists %I on public.%I', policy_update, t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
      policy_update,
      t
    );

    execute format('drop policy if exists %I on public.%I', policy_delete, t);
    execute format('create policy %I on public.%I for delete to authenticated using (user_id = auth.uid())', policy_delete, t);
  end loop;
end
$$;
