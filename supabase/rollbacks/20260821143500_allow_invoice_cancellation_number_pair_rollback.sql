drop index if exists public.billing_documents_type_document_number_key;

alter table public.billing_documents
  add constraint billing_documents_document_number_key unique (document_number);
