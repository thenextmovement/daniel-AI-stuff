do $$
begin
  if exists (
    select 1
    from public.arrival_label_runs
    where trigger_type = 'local_schedule'
  ) then
    raise exception 'Rollback blocked: arrival_label_runs contains local_schedule audit rows.';
  end if;
end
$$;

alter table public.arrival_label_runs
  drop constraint if exists arrival_label_runs_trigger_check;

alter table public.arrival_label_runs
  add constraint arrival_label_runs_trigger_check
  check (trigger_type in ('manual_cli', 'manual_api', 'n8n_email', 'n8n_schedule', 'fixture_test'));

comment on column public.arrival_label_runs.trigger_type is null;
