-- Restore the previous scanner only before any attempt incident evidence exists.
-- Preserve pre-existing source rows and never discard their incident evidence.
begin;
do $$
begin
  if not exists (
    select 1 from pg_proc
    where oid = to_regprocedure('public.scan_company_brain_workflow_attempt_gaps()')
      and md5(prosrc) in ('586275f42f145687dc0d7df33c0736ee', '90257d3d984f5351c8bb80e6efae0d4a')
  ) then
    raise exception 'workflow_attempt_scanner_definition_changed';
  end if;
  if exists (
    select 1 from public.company_brain_operational_incidents
    where source_key = 'workflow_attempt'
      or incident_type = 'workflow_attempt_gap'
      or fingerprint like 'workflow_attempt_gap:%'
  ) then
    raise exception 'workflow_attempt_incident_evidence_exists';
  end if;
end;
$$;
delete from public.company_source_registry
where source_key = 'workflow_attempt'
  and metadata->>'registration' = '20261026-workflow-attempt-source';

create or replace function public.scan_company_brain_workflow_attempt_gaps()
returns table(stale_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  attempt_row public.company_brain_workflow_attempts;
begin
  stale_count := 0;
  for attempt_row in
    update public.company_brain_workflow_attempts
    set state = 'stale',
        terminal_at = coalesce(terminal_at, now()),
        updated_at = now(),
        metadata = metadata || jsonb_build_object('stale_detected_at', now(), 'stale_reason', 'missing_terminal_event')
    where state in ('queued','running','retry_scheduled')
      and last_event_at < now() - interval '30 minutes'
    returning *
  loop
    stale_count := stale_count + 1;
    perform public.upsert_company_brain_incident(
      'workflow_failure:' || md5(coalesce(attempt_row.request_id, attempt_row.trello_card_id, attempt_row.offer_id, attempt_row.attempt_key) || '|create_and_send_offer'),
      'workflow_failure', 'critical',
      attempt_row.workflow_name || ': Lauf ohne Abschluss',
      'Der Workflow-Versuch hat seit mehr als 30 Minuten kein Terminal-Ereignis geliefert. Kein automatischer Versand-Retry wurde ausgelöst.',
      'workflow_attempt_stale', 'workflow_hard_error', 1, null,
      coalesce('request:' || attempt_row.request_id, 'workflow-attempt:' || attempt_row.attempt_key),
      attempt_row.request_id, attempt_row.trello_card_id, attempt_row.offer_id, attempt_row.execution_id,
      'workflow_attempt', 'workflow_attempt:' || attempt_row.id::text,
      jsonb_build_array('workflow_attempt:' || attempt_row.id::text),
      'engineering',
      jsonb_build_object('attempt_key', attempt_row.attempt_key, 'stage', attempt_row.stage, 'state', attempt_row.state),
      'company-brain-attempt-scanner', true
    );
  end loop;
  return next;
end;
$$;
commit;
