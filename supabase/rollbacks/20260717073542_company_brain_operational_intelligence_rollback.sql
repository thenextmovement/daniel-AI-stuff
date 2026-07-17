do $$
declare
  existing_job bigint;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select jobid into existing_job from cron.job where jobname = 'company-brain-operational-scan';
    if existing_job is not null then perform cron.unschedule(existing_job); end if;
  end if;
exception when undefined_table or undefined_function then
  null;
end;
$$;

drop function if exists public.scan_company_brain_operational_incidents();
drop function if exists public.transition_company_brain_incident(uuid,text,text,text,text);
drop function if exists public.upsert_company_brain_incident(text,text,text,text,text,text,text,integer,uuid,text,text,text,text,text,text,text,jsonb,text,jsonb,text,boolean);
drop function if exists public.guard_company_brain_incident_event_immutable();
drop table if exists public.company_brain_incident_events;
drop table if exists public.company_brain_operational_incidents;
drop table if exists public.company_brain_playbooks;

alter table public.company_brain_actor_roles
  drop constraint if exists company_brain_actor_roles_expiry_check;
drop index if exists public.company_brain_actor_roles_expiry_idx;
drop index if exists public.workflow_audit_log_created_at_desc_idx;
alter table public.company_brain_actor_roles drop column if exists expires_at;

create or replace function public.approve_company_brain_action_run(
  p_action_run_id uuid,
  p_actor text,
  p_note text default null
)
returns public.company_brain_action_runs
language plpgsql
security invoker
set search_path = public
as $$
declare
  action_run public.company_brain_action_runs;
  normalized_actor text := lower(btrim(p_actor));
begin
  if normalized_actor = '' then raise exception 'company_brain_actor_required'; end if;
  select * into action_run from public.company_brain_action_runs where id = p_action_run_id for update;
  if action_run.id is null then raise exception 'company_brain_action_run_not_found'; end if;
  if action_run.status <> 'awaiting_approval' then raise exception 'company_brain_action_run_not_open'; end if;
  if normalized_actor = action_run.proposed_by then raise exception 'company_brain_four_eyes_required'; end if;
  if not exists (
    select 1 from public.company_brain_actor_roles
    where actor_email = normalized_actor and active and role in ('approver', 'company_admin')
  ) then raise exception 'company_brain_approver_role_required'; end if;
  insert into public.company_brain_action_approvals (action_run_id, decision, decided_by, note, input_hash)
  values (action_run.id, 'approved', normalized_actor, nullif(btrim(p_note), ''), action_run.input_hash);
  update public.company_brain_action_runs
  set status = 'executing', approved_by = normalized_actor, approved_at = now(), execution_started_at = now()
  where id = action_run.id returning * into action_run;
  return action_run;
end;
$$;
