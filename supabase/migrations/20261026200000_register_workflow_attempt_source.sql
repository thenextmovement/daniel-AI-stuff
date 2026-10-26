-- The existing gap scanner already emits incidents with this source key.
-- Its missing registration rolls back both the incident and the stale marker.
-- Register the projection only; do not run the scanner, replay work, or change
-- its schedule, classification, grouping, or notification consumers.
insert into public.company_source_registry (
  source_key, display_name, source_kind, authority, owner_team, criticality,
  expected_freshness, contains_personal_data, active, description, metadata
)
values (
  'workflow_attempt', 'Workflow Attempt Projection', 'projection', 'projection',
  'engineering', 'critical', null, true, true,
  'Durable workflow-attempt state and missing-terminal-event incident evidence; never a recovery or delivery command.',
  jsonb_build_object(
    'attempt_table', 'company_brain_workflow_attempts',
    'scanner_function', 'scan_company_brain_workflow_attempt_gaps',
    'registration', '20261026-workflow-attempt-source'
  )
)
on conflict (source_key) do nothing;
