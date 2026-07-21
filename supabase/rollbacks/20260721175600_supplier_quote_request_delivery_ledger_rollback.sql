-- Roll back callable behavior without deleting delivery or audit evidence.
-- Deactivate/restore the n8n workflow before applying this rollback.

drop function if exists public.mark_supplier_quote_request_delivery_unknown(text, text, uuid, text, text);
drop function if exists public.complete_supplier_quote_request_delivery(text, text, uuid, text);
drop function if exists public.claim_supplier_quote_request_delivery(text, text, text, integer);

revoke all on table public.supplier_quote_request_delivery_events
  from service_role;
revoke all on table public.supplier_quote_request_deliveries
  from service_role;

comment on table public.supplier_quote_request_deliveries is
  'Preserved delivery evidence after rollback; do not delete until retention review is complete.';
comment on table public.supplier_quote_request_delivery_events is
  'Preserved append-only delivery audit after rollback; do not delete until retention review is complete.';
