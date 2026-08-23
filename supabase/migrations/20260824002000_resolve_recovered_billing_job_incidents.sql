create or replace function public.resolve_recovered_billing_job_incidents()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'DONE' and old.status is distinct from 'DONE' then
    update public.billing_incidents
    set
      status = 'RESOLVED',
      resolved_by = 'billing-job-recovery',
      resolved_at = now(),
      updated_at = now()
    where billing_case_id = new.billing_case_id
      and incident_key in (
        'job-blocked:' || new.id::text,
        'change-request-notification-blocked:' || new.id::text
      )
      and status <> 'RESOLVED';
  end if;

  return new;
end;
$$;

drop trigger if exists billing_jobs_resolve_recovered_incidents on public.billing_jobs;

create trigger billing_jobs_resolve_recovered_incidents
after update of status on public.billing_jobs
for each row
execute function public.resolve_recovered_billing_job_incidents();
