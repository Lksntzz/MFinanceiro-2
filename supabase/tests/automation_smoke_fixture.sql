-- Local-only fixture for the MF automation gateway smoke test.
-- This file is intentionally NOT a production migration.

create table if not exists public.mf_budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  limit_amount numeric not null default 0
);

create table if not exists public.mf_finance_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text,
  amount numeric not null default 0,
  type text not null default 'expense',
  status text not null default 'paid',
  date date not null default current_date,
  description text
);

create table if not exists public.mf_credit_cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  "limit" numeric not null default 0,
  used numeric not null default 0,
  closing_day integer not null default 1,
  due_day integer not null default 10
);

create table if not exists public.mf_financial_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_amount numeric not null default 0,
  current_amount numeric not null default 0,
  deadline date,
  status text not null default 'active'
);

create table if not exists public.mf_fixed_bills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  due_day integer not null default 1,
  status text not null default 'pending'
);

create table if not exists public.mf_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  due_day integer not null default 1,
  status text not null default 'active',
  billing_cycle text not null default 'monthly'
);

create table if not exists public.mf_card_installments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  due_day integer not null default 1,
  current_installment integer not null default 1,
  total_installments integer not null default 1
);

create table if not exists public.mf_document_extractions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null
);

create table if not exists public.mf_statement_import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null
);

create table if not exists public.mf_bank_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  sync_status text not null default 'idle'
);

-- The automation gateway reads the fixture tables only with the server-side role.
revoke all on public.mf_budgets from anon, authenticated;
revoke all on public.mf_finance_ledger_entries from anon, authenticated;
revoke all on public.mf_credit_cards from anon, authenticated;
revoke all on public.mf_financial_goals from anon, authenticated;
revoke all on public.mf_fixed_bills from anon, authenticated;
revoke all on public.mf_subscriptions from anon, authenticated;
revoke all on public.mf_card_installments from anon, authenticated;
revoke all on public.mf_document_extractions from anon, authenticated;
revoke all on public.mf_statement_import_batches from anon, authenticated;
revoke all on public.mf_bank_connections from anon, authenticated;
