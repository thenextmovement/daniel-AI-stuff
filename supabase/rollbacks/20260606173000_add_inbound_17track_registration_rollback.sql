drop function if exists public.inbound_record_17track_registration(jsonb, timestamptz);
drop function if exists public.inbound_claim_due_17track_registrations(integer, timestamptz);
drop table if exists public.inbound_tracking_registrations;
