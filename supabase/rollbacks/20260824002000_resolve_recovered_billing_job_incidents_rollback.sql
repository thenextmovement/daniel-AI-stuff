drop trigger if exists billing_jobs_resolve_recovered_incidents on public.billing_jobs;

drop function if exists public.resolve_recovered_billing_job_incidents();
