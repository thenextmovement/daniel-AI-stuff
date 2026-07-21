-- Fail closed without deleting follow-up delivery audit evidence.
-- Deactivate the dependent n8n workflow before applying this rollback.

revoke execute on function public.claim_followup_delivery_candidate(text, integer)
  from service_role;
revoke execute on function public.block_followup_delivery(uuid, uuid, text, text)
  from service_role;
revoke execute on function public.complete_followup_delivery(uuid, uuid, text, text, text, text)
  from service_role;
revoke execute on function public.mark_followup_delivery_unknown(uuid, uuid, text, text)
  from service_role;

comment on table public.followup_delivery_attempts is
  'Retained follow-up delivery audit evidence. Automated claims are disabled by rollback.';
