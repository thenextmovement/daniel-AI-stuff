drop function if exists public.ops_record_offer_lifecycle_event(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  text,
  text,
  text,
  text,
  jsonb
);

alter table public.ops_offer_events
  drop constraint if exists ops_offer_events_event_type_check;

alter table public.ops_offer_events
  add constraint ops_offer_events_event_type_check
  check (event_type in ('offer_sent', 'offer_updated', 'offer_viewed', 'offer_accepted'));
