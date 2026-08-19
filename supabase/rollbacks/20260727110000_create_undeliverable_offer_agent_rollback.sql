-- Destructive: export undeliverable_offer_cases/events and obtain approval before use.
drop function if exists public.complete_undeliverable_offer_execution_v1(uuid,text,text,text,text,text);
drop function if exists public.apply_undeliverable_email_correction_v1(uuid,text);
drop function if exists public.claim_undeliverable_offer_execution_v1(text,uuid);
drop function if exists public.review_undeliverable_offer_v1(uuid,text,text,text,uuid);
drop function if exists public.propose_undeliverable_offer_email_v1(uuid,text,numeric,jsonb,boolean,text,uuid);
drop function if exists public.ingest_undeliverable_offer_v1(text,text,text,timestamptz,text,text,text,text,text,text,text,text,uuid);
drop trigger if exists touch_undeliverable_offer_case_v1 on public.undeliverable_offer_cases;
drop function if exists public.touch_undeliverable_offer_case_v1();
drop table if exists public.undeliverable_offer_events;
drop table if exists public.undeliverable_offer_cases;
drop table if exists public.undeliverable_offer_settings;
