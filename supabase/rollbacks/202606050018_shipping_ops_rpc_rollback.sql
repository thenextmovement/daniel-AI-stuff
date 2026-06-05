drop function if exists public.shipping_record_tracking_event(jsonb);
drop function if exists public.shipping_evaluate_shipment(uuid, timestamptz);
drop function if exists public.shipping_risk_level(text, boolean, boolean, boolean);
drop function if exists public.shipping_business_days_between(timestamptz, timestamptz);
drop function if exists public.shipping_normalize_status(text, text, text);
drop function if exists public.shipping_normalize_carrier(text);
