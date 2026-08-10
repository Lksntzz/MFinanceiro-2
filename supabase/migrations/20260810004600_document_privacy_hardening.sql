begin;

-- Keep only the learning metadata that cannot be represented by the structured
-- extraction columns. OCR/model transaction payloads must not be duplicated indefinitely.
create or replace function public.mf_minimize_extraction_item_raw_payload()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.raw_payload is null then
    return new;
  end if;

  new.raw_payload := jsonb_strip_nulls(
    jsonb_build_object(
      'schema_version', 2,
      'learning', new.raw_payload -> 'learning'
    )
  );
  return new;
end;
$$;

revoke execute on function public.mf_minimize_extraction_item_raw_payload() from public, anon, authenticated;
grant execute on function public.mf_minimize_extraction_item_raw_payload() to service_role;

drop trigger if exists mf_minimize_extraction_item_raw_payload on public.mf_document_extraction_items;
create trigger mf_minimize_extraction_item_raw_payload
before insert or update of raw_payload on public.mf_document_extraction_items
for each row
execute function public.mf_minimize_extraction_item_raw_payload();

-- Provider responses can include source fragments or implementation diagnostics.
-- Persist a stable user-facing failure state instead of arbitrary external text.
create or replace function public.mf_redact_document_extraction_error()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'failed' and new.error_message is not null then
    new.error_message := 'Não foi possível processar este documento. Tente novamente ou revise os dados manualmente.';
  end if;
  return new;
end;
$$;

revoke execute on function public.mf_redact_document_extraction_error() from public, anon, authenticated;
grant execute on function public.mf_redact_document_extraction_error() to service_role;

drop trigger if exists mf_redact_document_extraction_error on public.mf_document_extractions;
create trigger mf_redact_document_extraction_error
before insert or update of status, error_message on public.mf_document_extractions
for each row
execute function public.mf_redact_document_extraction_error();

comment on function public.mf_minimize_extraction_item_raw_payload() is
  'Privacy boundary: prevents indefinite duplication of raw OCR/model transaction payloads.';
comment on function public.mf_redact_document_extraction_error() is
  'Privacy boundary: prevents arbitrary provider error bodies from being persisted with financial documents.';

commit;
