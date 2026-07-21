alter table public.arrival_label_runs
  drop constraint if exists arrival_label_runs_trigger_check;

alter table public.arrival_label_runs
  add constraint arrival_label_runs_trigger_check
  check (trigger_type in ('manual_cli', 'manual_api', 'n8n_email', 'n8n_schedule', 'local_schedule', 'fixture_test'));

comment on column public.arrival_label_runs.trigger_type is
  'Audited origin of a run. local_schedule is the macOS LaunchAgent using the authenticated internal API.';
