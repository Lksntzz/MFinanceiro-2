-- MF Invest beta ledger.
-- Additive and isolated: this does not mutate the official investment or finance ledgers.

create table if not exists public.mf_investment_beta_operations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_type text not null check (operation_type in ('buy', 'sell')),
  asset_class text not null check (asset_class in ('stock', 'fii', 'etf', 'bdr', 'crypto', 'fixed_income', 'international', 'other')),
  symbol text not null,
  asset_name text,
  institution text,
  account_id uuid,
  account_name text,
  operation_date date not null,
  quantity numeric(24, 8) not null check (quantity > 0),
  unit_price numeric(24, 8) not null check (unit_price > 0),
  fees numeric(18, 2) not null default 0 check (fees >= 0),
  currency text not null default 'BRL',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mf_investment_beta_operations_user_date_idx
  on public.mf_investment_beta_operations (user_id, operation_date desc, created_at desc);
create index if not exists mf_investment_beta_operations_user_symbol_idx
  on public.mf_investment_beta_operations (user_id, asset_class, symbol);

alter table public.mf_investment_beta_operations enable row level security;

drop policy if exists "mf investment beta operations own rows" on public.mf_investment_beta_operations;
create policy "mf investment beta operations own rows"
  on public.mf_investment_beta_operations
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on table public.mf_investment_beta_operations to authenticated;

create table if not exists public.mf_investment_beta_targets (
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_class text not null check (asset_class in ('stock', 'fii', 'etf', 'bdr', 'crypto', 'fixed_income', 'international', 'other')),
  target_percentage numeric(7, 3) not null default 0 check (target_percentage >= 0 and target_percentage <= 100),
  updated_at timestamptz not null default now(),
  primary key (user_id, asset_class)
);

alter table public.mf_investment_beta_targets enable row level security;

drop policy if exists "mf investment beta targets own rows" on public.mf_investment_beta_targets;
create policy "mf investment beta targets own rows"
  on public.mf_investment_beta_targets
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on table public.mf_investment_beta_targets to authenticated;

comment on table public.mf_investment_beta_operations is 'Experimental MF Invest ledger. Beta-only and isolated from official financial balances.';
comment on table public.mf_investment_beta_targets is 'Experimental MF Invest allocation targets. Beta-only.';
