drop function if exists public.shipping_mark_notification_failed(uuid, text, jsonb, timestamptz);
drop function if exists public.shipping_mark_notification_sent(uuid, text, jsonb, timestamptz);
drop function if exists public.shipping_claim_pending_notifications(integer, timestamptz);
drop function if exists public.shipping_enqueue_notifications(timestamptz);
drop table if exists public.shipping_notifications;
