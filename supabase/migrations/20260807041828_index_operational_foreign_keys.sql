create index if not exists mf_bank_sync_runs_account_user_fk_idx
  on public.mf_bank_sync_runs (account_id, user_id)
  where account_id is not null;

create index if not exists mf_bank_sync_runs_connection_user_fk_idx
  on public.mf_bank_sync_runs (connection_id, user_id);

create index if not exists mf_categorization_rules_account_user_fk_idx
  on public.mf_categorization_rules (account_id, user_id)
  where account_id is not null;

create index if not exists mf_categorization_rules_category_user_fk_idx
  on public.mf_categorization_rules (category_id, user_id)
  where category_id is not null;

create index if not exists mf_document_extraction_items_category_user_fk_idx
  on public.mf_document_extraction_items (category_id, user_id)
  where category_id is not null;

create index if not exists mf_document_extractions_account_user_fk_idx
  on public.mf_document_extractions (account_id, user_id)
  where account_id is not null;
