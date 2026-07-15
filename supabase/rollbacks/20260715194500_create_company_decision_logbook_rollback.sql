drop function if exists public.search_active_company_decisions(jsonb, timestamptz, integer);
drop function if exists public.request_company_decision_changes(uuid, text, text, text);
drop function if exists public.approve_company_decision(uuid, text, text, text);
drop function if exists public.submit_company_decision(uuid, text, text, text);
drop function if exists public.create_company_decision_draft(jsonb);

delete from public.company_events
where event_key in (
  select 'decision-approved:' || id::text
  from public.company_decisions
  where decision_key = 'company-brain-foundation'
);

drop table if exists public.company_decision_audit_log;
drop table if exists public.company_decision_outcomes;
drop table if exists public.company_decision_evidence;
drop table if exists public.company_decisions;

drop function if exists public.guard_company_decision_immutability();
