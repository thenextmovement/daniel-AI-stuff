-- The preview delivery queue RPCs are SECURITY DEFINER functions. They must
-- never inherit PostgreSQL's default PUBLIC execute privilege because that
-- bypasses the queue table's RLS boundary.

revoke all on function public.enqueue_preview_delivery_jobs(jsonb)
  from public, anon, authenticated;
revoke all on function public.enqueue_preview_delivery_jobs(jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.claim_next_preview_delivery_job(text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.finish_preview_delivery_job(uuid, text, text, text, text, jsonb)
  from public, anon, authenticated;

grant execute on function public.enqueue_preview_delivery_jobs(jsonb)
  to service_role;
grant execute on function public.enqueue_preview_delivery_jobs(jsonb, jsonb)
  to service_role;
grant execute on function public.claim_next_preview_delivery_job(text, integer, integer)
  to service_role;
grant execute on function public.finish_preview_delivery_job(uuid, text, text, text, text, jsonb)
  to service_role;

