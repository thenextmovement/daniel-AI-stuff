begin;

drop function if exists public.claim_dunning_email_if_unpaused(text, text);

drop function if exists public.apply_dunning_pause_action(
  text, text, text, text, text, timestamptz, bigint, timestamptz,
  text, integer, timestamptz, text
);

drop table if exists public.dunning_pause_events;

alter table public.dunning_status
  drop constraint if exists dunning_status_pause_shape_check,
  drop constraint if exists dunning_status_pause_version_check,
  drop constraint if exists dunning_status_paused_by_check,
  drop constraint if exists dunning_status_pause_reason_check,
  drop constraint if exists dunning_status_pause_until_check,
  drop constraint if exists dunning_status_pause_mode_check,
  drop column if exists pause_version,
  drop column if exists paused_by,
  drop column if exists paused_at,
  drop column if exists pause_reason,
  drop column if exists pause_until,
  drop column if exists pause_mode;

commit;
