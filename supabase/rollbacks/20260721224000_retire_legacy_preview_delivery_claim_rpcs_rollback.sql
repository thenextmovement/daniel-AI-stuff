begin;

-- Restore only the pre-retirement service-role access. The anonymous and
-- authenticated roles remain denied as established by the earlier hardening.
grant execute on function public.claim_next_preview_delivery_job(text, integer, integer)
  to service_role;
grant execute on function public.finish_preview_delivery_job(uuid, text, text, text, text, jsonb)
  to service_role;

commit;
