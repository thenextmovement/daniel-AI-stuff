-- Non-destructive production rollback.
-- Stop all enqueue/claim activity and remove the insert trigger while retaining
-- jobs and append-only delivery evidence for incident review.

update public.request_autoreply_settings
set mode = 'off',
    change_reason = 'rollback_disable_request_autoreply',
    updated_at = now(),
    updated_by = 'rollback'
where id = 1;

drop trigger if exists master_requests_enqueue_autoreply
  on public.master_requests;

revoke all on function public.configure_request_autoreply(text, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.enqueue_request_autoreply_canary(text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_request_autoreply_candidate(text, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.complete_request_autoreply_delivery(uuid, uuid, text, text, text, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.mark_request_autoreply_delivery_unknown(uuid, uuid, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.block_request_autoreply_delivery(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
