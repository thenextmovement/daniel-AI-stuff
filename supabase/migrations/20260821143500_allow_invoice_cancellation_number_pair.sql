alter table public.billing_documents
  drop constraint if exists billing_documents_document_number_key;

create unique index if not exists billing_documents_type_document_number_key
  on public.billing_documents (document_type, document_number);
