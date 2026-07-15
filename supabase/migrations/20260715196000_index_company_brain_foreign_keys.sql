create index if not exists company_data_quality_issues_entity_idx
  on public.company_data_quality_issues (entity_id);
create index if not exists company_data_quality_issues_source_idx
  on public.company_data_quality_issues (source_key);

create index if not exists company_decision_evidence_evidence_idx
  on public.company_decision_evidence (evidence_id);
create index if not exists company_decision_evidence_source_idx
  on public.company_decision_evidence (source_key);
create index if not exists company_decisions_supersedes_idx
  on public.company_decisions (supersedes_decision_id);

create index if not exists company_entity_relations_evidence_idx
  on public.company_entity_relations (evidence_id);
create index if not exists company_entity_relations_to_entity_idx
  on public.company_entity_relations (to_entity_id);
create index if not exists company_entity_state_source_event_idx
  on public.company_entity_state (source_event_id);
create index if not exists company_events_source_idx
  on public.company_events (source_key);
create index if not exists company_evidence_event_idx
  on public.company_evidence (event_id);
create index if not exists company_identity_resolution_entity_idx
  on public.company_identity_resolution_log (resolved_entity_id);
create index if not exists company_identity_resolution_source_idx
  on public.company_identity_resolution_log (source_key);
