begin;
insert into company_brain_workflow_attempts(attempt_key,workflow_name,execution_id,request_id,action,stage,state,last_event_at)
values
  ('stale-running','Test','execution-running','request-one','create_and_send_offer','work','running',now()-interval '31 minutes'),
  ('stale-queued','Test','execution-queued','request-one','create_and_send_offer','work','queued',now()-interval '31 minutes'),
  ('stale-retry','Test','execution-retry','request-two','create_and_send_offer','work','retry_scheduled',now()-interval '31 minutes'),
  ('fresh-running','Test','execution-fresh','request-fresh','create_and_send_offer','work','running',now()-interval '29 minutes'),
  ('terminal-success','Test','execution-success','request-done','create_and_send_offer','work','succeeded',now()-interval '2 days'),
  ('terminal-blocked','Test','execution-blocked','request-blocked','create_and_send_offer','work','blocked',now()-interval '2 days');
create temporary table protected_attempts as
  select * from company_brain_workflow_attempts where attempt_key like 'fresh-%' or attempt_key like 'terminal-%';

do $$
declare found_count integer; event_count integer;
begin
  -- On BASELINE this fails at the actual source-key FK, rolling back all state changes.
  select stale_count into found_count from scan_company_brain_workflow_attempt_gaps();
  assert found_count=3, 'eligible stale attempts were not processed';
  assert (select count(*)=3 from company_brain_workflow_attempts where state='stale'), 'stale state mismatch';
  assert not exists(select 1 from protected_attempts p join company_brain_workflow_attempts a using(id) where to_jsonb(p)<>to_jsonb(a)), 'fresh/terminal evidence changed';
  assert not exists(select 1 from company_brain_workflow_attempts where state='stale' and (terminal_at is null or metadata->>'stale_reason'<>'missing_terminal_event' or metadata->>'stale_detected_at' is null)), 'missing terminal evidence';
  assert (select count(*)=2 from company_brain_operational_incidents), 'fingerprint dedupe changed';
  assert not exists(select 1 from company_brain_operational_incidents where source_key<>'workflow_attempt' or root_cause_code<>'workflow_attempt_stale' or status<>'open'), 'incident provenance mismatch';
  assert not exists(select 1 from company_brain_operational_incidents i where not exists(select 1 from company_brain_workflow_attempts a where i.source_ref='workflow_attempt:'||a.id::text and i.workflow_execution_id=a.execution_id)), 'immutable attempt binding missing';
  assert (select count(*)=2 from company_brain_incident_events where event_type='detected'), 'duplicate initial incident events';
  select count(*) into event_count from company_brain_incident_events;
  select stale_count into found_count from scan_company_brain_workflow_attempt_gaps();
  assert found_count=0, 'second scan reprocessed terminal attempts';
  assert (select count(*)=event_count from company_brain_incident_events), 'second scan duplicated history';
  update company_brain_operational_incidents set status='ignored' where request_id='request-two';
  update company_brain_workflow_attempts set state='running' where attempt_key='stale-retry';
  perform scan_company_brain_workflow_attempt_gaps();
  assert (select status='ignored' from company_brain_operational_incidents where request_id='request-two'), 'existing ignored incident reopened';
end $$;
commit;
select 'PASS 11 scanner assertions (actual foreign key, provenance, terminal preservation and dedupe)';
