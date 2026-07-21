begin;

-- All active preview-delivery workers use the execution- and token-bound v2
-- functions. Keep the legacy functions present for a reversible rollback, but
-- remove every application role's ability to execute them.
revoke execute on function public.claim_next_preview_delivery_job(text, integer, integer)
  from public, anon, authenticated, service_role;
revoke execute on function public.finish_preview_delivery_job(uuid, text, text, text, text, jsonb)
  from public, anon, authenticated, service_role;

commit;
