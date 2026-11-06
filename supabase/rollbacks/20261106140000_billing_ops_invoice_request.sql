-- Removes only the new entrypoint; existing requests, locks and canonical jobs remain intact.
begin;
drop function if exists public.billing_ops_request_invoice(uuid,integer,timestamptz,text,text,text);
commit;
