revoke all on function public.refresh_design_batch_status(uuid) from service_role;
revoke all on function public.claim_next_design_batch_item(uuid, text, timestamptz, integer) from service_role;

drop function if exists public.refresh_design_batch_status(uuid);
drop function if exists public.claim_next_design_batch_item(uuid, text, timestamptz, integer);

drop table if exists public.design_batch_items;
drop table if exists public.design_batches;

drop index if exists public.design_jobs_card_action_idx;

alter table public.design_jobs
  drop constraint if exists design_jobs_attempt_count_check,
  drop constraint if exists design_jobs_action_type_check,
  drop column if exists finished_at,
  drop column if exists heartbeat_at,
  drop column if exists started_at,
  drop column if exists attempt_count,
  drop column if exists source_fingerprint,
  drop column if exists source_attachment_name,
  drop column if exists source_attachment_id,
  drop column if exists action_value,
  drop column if exists action_type;
