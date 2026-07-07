alter table if exists public.quote_email_log
  add column if not exists request_id text,
  add column if not exists offer_id text,
  add column if not exists source_event_id text,
  add column if not exists idempotency_key text;

create index if not exists quote_email_log_request_id_idx
  on public.quote_email_log (request_id)
  where request_id is not null;

create index if not exists quote_email_log_offer_id_idx
  on public.quote_email_log (offer_id)
  where offer_id is not null;

create index if not exists quote_email_log_source_event_id_idx
  on public.quote_email_log (source_event_id)
  where source_event_id is not null;

create index if not exists quote_email_log_idempotency_key_idx
  on public.quote_email_log (idempotency_key)
  where idempotency_key is not null;

comment on column public.quote_email_log.request_id is
  'Source-of-truth request identifier for Company Brain offer send evidence.';

comment on column public.quote_email_log.offer_id is
  'Ops offer identifier for Company Brain duplicate checks and send evidence lookup.';

comment on column public.quote_email_log.source_event_id is
  'Provider or offer-send event identifier that produced this outbound evidence.';

comment on column public.quote_email_log.idempotency_key is
  'Application idempotency key used for the send attempt.';
