drop function if exists public.inbound_mark_notification_failed(uuid, text, jsonb, timestamptz);
drop function if exists public.inbound_mark_notification_sent(uuid, text, jsonb, timestamptz);
drop function if exists public.inbound_claim_pending_notifications(integer, timestamptz);
drop function if exists public.inbound_enqueue_notifications(timestamptz);
drop function if exists public.inbound_evaluate_shipment(uuid, timestamptz);
drop function if exists public.inbound_record_carrier_response(jsonb, timestamptz);
drop function if exists public.inbound_claim_due_tracking_shipments(integer, timestamptz);
drop function if exists public.inbound_record_trello_candidates(jsonb, timestamptz);
drop function if exists public.inbound_risk_level(text);
drop function if exists public.inbound_normalize_status(text, text, text);
drop function if exists public.inbound_parse_tracking_value(text);
drop function if exists public.inbound_normalize_carrier(text);

drop table if exists public.inbound_notifications;
drop table if exists public.inbound_incidents;
drop table if exists public.inbound_tracking_events;
drop table if exists public.inbound_shipments;
