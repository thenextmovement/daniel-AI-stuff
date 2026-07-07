drop index if exists public.quote_email_log_idempotency_key_idx;
drop index if exists public.quote_email_log_source_event_id_idx;
drop index if exists public.quote_email_log_offer_id_idx;
drop index if exists public.quote_email_log_request_id_idx;

alter table if exists public.quote_email_log
  drop column if exists idempotency_key,
  drop column if exists source_event_id,
  drop column if exists offer_id,
  drop column if exists request_id;
