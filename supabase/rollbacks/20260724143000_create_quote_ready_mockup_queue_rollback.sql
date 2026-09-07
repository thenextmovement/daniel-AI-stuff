revoke all on function public.finalize_quote_ready_mockup_order(uuid,text) from service_role;
revoke all on function public.finish_quote_ready_mockup_item(uuid,text,text,text,uuid,text,text,text) from service_role;
revoke all on function public.claim_quote_ready_mockup_items(uuid,text,integer) from service_role;
revoke all on function public.claim_next_quote_ready_mockup_order(text,text,integer) from service_role;
revoke all on function public.enqueue_quote_ready_mockup_order(text,text,text,text,integer,text,jsonb) from service_role;

drop function if exists public.finalize_quote_ready_mockup_order(uuid,text);
drop function if exists public.finish_quote_ready_mockup_item(uuid,text,text,text,uuid,text,text,text);
drop function if exists public.claim_quote_ready_mockup_items(uuid,text,integer);
drop function if exists public.claim_next_quote_ready_mockup_order(text,text,integer);
drop function if exists public.enqueue_quote_ready_mockup_order(text,text,text,text,integer,text,jsonb);
drop table if exists public.quote_ready_mockup_events;
drop table if exists public.quote_ready_mockup_items;
drop table if exists public.quote_ready_mockup_orders;
