begin;
insert into company_brain_workflow_attempts(attempt_key,workflow_name,execution_id,request_id,action,stage,state,last_event_at)
values
  ('stale-running','Test','execution-running','request-one','design_field_alignment_v1','work','running',now()-interval '31 minutes'),
  ('stale-queued','Test','execution-queued','request-one','qc_auto_repair_v1','work','queued',now()-interval '31 minutes'),
  ('stale-retry','Test','execution-retry','request-two','email_bounce_detected','work','retry_scheduled',now()-interval '31 minutes'),
  ('fresh-running','Test','execution-fresh','request-fresh','create_and_send_offer','work','running',now()-interval '29 minutes'),
  ('terminal-success','Test','execution-success','request-done','create_and_send_offer','work','succeeded',now()-interval '2 days'),
  ('terminal-blocked','Test','execution-blocked','request-blocked','create_and_send_offer','work','blocked',now()-interval '2 days');
create temporary table protected_attempts as
  select * from company_brain_workflow_attempts where attempt_key like 'fresh-%' or attempt_key like 'terminal-%';
insert into company_brain_operational_incidents(fingerprint,incident_type,severity,status,title,detail,root_cause_code,request_id,resolved_at,resolved_by,resolution_note)
values
  ('workflow_failure:'||md5('request-one|create_and_send_offer'),'workflow_failure','warning','resolved','Resolved video case','Specific evidence','video_content_qc_failed','request-one',now(),'test','Provider completion verified'),
  ('workflow_failure:'||md5('request-two|create_and_send_offer'),'workflow_failure','critical','open','Open delivery hold','Specific evidence','preview_delivery_failed','request-two',null,null,null),
  ('workflow_failure:'||md5('request-two|email_bounce_detected'),'workflow_failure','warning','ignored','Ignored bounce','Specific evidence','customer_email_invalid','request-two',null,null,'Explicit business decision');
create temporary table protected_incidents as select * from company_brain_operational_incidents;

do $$
declare found_count integer; event_count integer;
begin
  -- On BASELINE this fails at the actual source-key FK, rolling back all state changes.
  select stale_count into found_count from scan_company_brain_workflow_attempt_gaps();
  assert found_count=3, 'eligible stale attempts were not processed';
  assert (select count(*)=3 from company_brain_workflow_attempts where state='stale'), 'stale state mismatch';
  assert not exists(select 1 from protected_attempts p join company_brain_workflow_attempts a using(id) where to_jsonb(p)<>to_jsonb(a)), 'fresh/terminal evidence changed';
  assert not exists(select 1 from protected_incidents p join company_brain_operational_incidents i using(id) where to_jsonb(p)<>to_jsonb(i)), 'existing business cause, hold or resolution changed';
  assert not exists(select 1 from company_brain_workflow_attempts where state='stale' and (terminal_at is null or metadata->>'stale_reason'<>'missing_terminal_event' or metadata->>'stale_detected_at' is null)), 'missing terminal evidence';
  assert (select count(*)=3 from company_brain_operational_incidents where incident_type='workflow_attempt_gap'), 'distinct attempts collapsed into business actions';
  assert not exists(select 1 from company_brain_operational_incidents where incident_type='workflow_attempt_gap' and (source_key<>'workflow_attempt' or root_cause_code<>'workflow_attempt_stale' or status<>'open')), 'incident provenance mismatch';
  assert not exists(select 1 from company_brain_operational_incidents i where incident_type='workflow_attempt_gap' and not exists(select 1 from company_brain_workflow_attempts a where i.source_ref='workflow_attempt:'||a.id::text and i.fingerprint='workflow_attempt_gap:'||a.id::text and i.workflow_execution_id=a.execution_id and i.metadata->>'action'=a.action)), 'immutable attempt/action binding missing';
  assert (select count(*)=3 from company_brain_incident_events where event_type='detected'), 'duplicate initial incident events';
  select count(*) into event_count from company_brain_incident_events;
  select stale_count into found_count from scan_company_brain_workflow_attempt_gaps();
  assert found_count=0, 'second scan reprocessed terminal attempts';
  assert (select count(*)=event_count from company_brain_incident_events), 'second scan duplicated history';
  update company_brain_operational_incidents set status='ignored' where request_id='request-two' and incident_type='workflow_attempt_gap';
  update company_brain_workflow_attempts set state='running' where attempt_key='stale-retry';
  perform scan_company_brain_workflow_attempt_gaps();
  assert (select status='ignored' from company_brain_operational_incidents where request_id='request-two' and incident_type='workflow_attempt_gap'), 'existing ignored gap reopened';
  assert not exists(select 1 from protected_incidents p join company_brain_operational_incidents i using(id) where to_jsonb(p)<>to_jsonb(i)), 'rescan changed business decisions';
end $$;
-- The actual queue consumer resolves business failures by case. A different
-- successful delivery in that case must not claim this attempt's terminal event.
insert into test_preview_delivery_queue(idempotency_key,status,request_id,n8n_execution_id)
values('separate-delivery-attempt','sent','request-one','later-unrelated-delivery');
do $$
begin
  assert (select count(*)=2 from company_brain_operational_incidents where request_id='request-one' and incident_type='workflow_attempt_gap' and status='open'), 'unrelated queue success falsely closed attempt gaps';
  assert (select count(*)=2 from company_brain_workflow_attempts where request_id='request-one' and state='stale'), 'unrelated queue success overwrote stale attempts';
end $$;
commit;
select 'PASS 15 scanner/consumer assertions (actual foreign key, immutable identity, business holds, dedupe and queue resolution)';
