-- Non-destructive rollback: keep claim columns and event evidence, disable the
-- v2 executors, and restore the legacy service-role functions.

revoke all on function public.claim_next_preview_delivery_job_v2(text, text, integer, integer)
  from service_role;
revoke all on function public.finish_preview_delivery_job_v2(uuid, uuid, text, text, text, text, jsonb)
  from service_role;

grant execute on function public.claim_next_preview_delivery_job(text, integer, integer)
  to service_role;
grant execute on function public.finish_preview_delivery_job(uuid, text, text, text, text, jsonb)
  to service_role;

grant select, insert, update, delete, truncate, references, trigger
  on table public.preview_delivery_jobs to anon, authenticated, service_role;

