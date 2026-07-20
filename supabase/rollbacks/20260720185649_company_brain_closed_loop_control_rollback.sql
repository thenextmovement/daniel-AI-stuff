do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'company-brain-workflow-attempt-scan';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
end;
$$;

drop trigger if exists trg_company_brain_workflow_attempt_from_audit on public.workflow_audit_log;
drop trigger if exists trg_company_brain_workflow_attempt_from_queue on public.preview_delivery_jobs;
drop trigger if exists trg_company_brain_workflow_attempts_updated_at on public.company_brain_workflow_attempts;

drop function if exists public.scan_company_brain_workflow_attempt_gaps();
drop function if exists public.reconcile_company_brain_workflow_attempt_from_queue();
drop function if exists public.reconcile_company_brain_workflow_attempt_from_audit();
drop table if exists public.company_brain_workflow_attempts;

delete from public.company_brain_action_policies where action_key = 'retry_media_pipeline';

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
    where actor_email = normalized_actor and active
      and (expires_at is null or expires_at > now())
      and role in ('approver', 'company_admin')
  ) then raise exception 'company_brain_approver_role_required'; end if;
  insert into public.company_brain_action_approvals (action_run_id, decision, decided_by, note, input_hash)
  values (action_run.id, 'approved', normalized_actor, nullif(btrim(p_note), ''), action_run.input_hash);
  update public.company_brain_action_runs
  set status = 'executing', approved_by = normalized_actor, approved_at = now(), execution_started_at = now()
  where id = action_run.id returning * into action_run;
  return action_run;
end;
$$;

revoke all on function public.approve_company_brain_action_run(uuid, text, text) from public, anon, authenticated;
grant execute on function public.approve_company_brain_action_run(uuid, text, text) to service_role;
