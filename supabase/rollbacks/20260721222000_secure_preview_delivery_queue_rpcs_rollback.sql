-- Emergency compatibility rollback. This intentionally restores the exact
-- broad execute surface that existed before the hardening migration.

grant execute on function public.enqueue_preview_delivery_jobs(jsonb)
  to public, anon, authenticated;
grant execute on function public.enqueue_preview_delivery_jobs(jsonb, jsonb)
  to public, anon, authenticated;
grant execute on function public.claim_next_preview_delivery_job(text, integer, integer)
  to public, anon, authenticated;
grant execute on function public.finish_preview_delivery_job(uuid, text, text, text, text, jsonb)
  to public, anon, authenticated;

grant execute on function public.enqueue_preview_delivery_jobs(jsonb)
  to service_role;
grant execute on function public.enqueue_preview_delivery_jobs(jsonb, jsonb)
  to service_role;
grant execute on function public.claim_next_preview_delivery_job(text, integer, integer)
  to service_role;
grant execute on function public.finish_preview_delivery_job(uuid, text, text, text, text, jsonb)
  to service_role;

