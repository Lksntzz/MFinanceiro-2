-- Cover foreign keys introduced by the canonical financial data foundation.
-- These indexes keep account/user deletions and reconciliation lookups efficient.

create index mf_reconciliation_account_fk_idx
  on public.mf_reconciliation_matches (account_id);

create index mf_reconciliation_matched_by_fk_idx
  on public.mf_reconciliation_matches (matched_by);

create index mf_statement_batches_account_fk_idx
  on public.mf_statement_import_batches (account_id);

create index mf_statement_rows_account_fk_idx
  on public.mf_statement_import_rows (account_id);

create index mf_statement_rows_ledger_fk_idx
  on public.mf_statement_import_rows (ledger_entry_id);
