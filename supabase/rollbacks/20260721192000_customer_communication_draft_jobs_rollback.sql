-- Deactivate/restore dependent n8n workflows first. Preserve all draft and
-- audit evidence; rollback removes only the callable write interface.

drop function if exists public.mark_customer_communication_draft_unknown(text, text, uuid, text, text);
drop function if exists public.complete_customer_communication_draft(text, text, uuid, text, text);
drop function if exists public.claim_customer_communication_draft(text, text, text, text, integer);

revoke all on table public.customer_communication_draft_events from service_role;
revoke all on table public.customer_communication_draft_jobs from service_role;

comment on table public.customer_communication_draft_jobs is
  'Preserved customer draft evidence after rollback; do not delete until retention review is complete.';
comment on table public.customer_communication_draft_events is
  'Preserved append-only customer draft audit after rollback; do not delete until retention review is complete.';
