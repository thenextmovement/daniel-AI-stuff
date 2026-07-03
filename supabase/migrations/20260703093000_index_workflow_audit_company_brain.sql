-- Company Brain needs fast read-only lookups from Trello cards and n8n execution metadata.
-- The audit payload stays in workflow_audit_log.metadata so existing writers keep working.

create index if not exists workflow_audit_log_audit_event_key_idx
  on public.workflow_audit_log ((metadata->>'audit_event_key'))
  where metadata ? 'audit_event_key';

create index if not exists workflow_audit_log_metadata_trello_card_id_idx
  on public.workflow_audit_log ((metadata->>'trello_card_id'))
  where metadata ? 'trello_card_id';

create index if not exists workflow_audit_log_metadata_request_id_idx
  on public.workflow_audit_log ((metadata->>'request_id'))
  where metadata ? 'request_id';

create index if not exists workflow_audit_log_metadata_execution_id_idx
  on public.workflow_audit_log ((metadata->>'execution_id'))
  where metadata ? 'execution_id';

create index if not exists workflow_audit_log_metadata_correlation_id_idx
  on public.workflow_audit_log ((metadata->>'correlation_id'))
  where metadata ? 'correlation_id';

create index if not exists workflow_audit_log_metadata_idempotency_key_idx
  on public.workflow_audit_log ((metadata->>'idempotency_key'))
  where metadata ? 'idempotency_key';

comment on index public.workflow_audit_log_audit_event_key_idx is
  'Lookup index for idempotent n8n workflow audit events consumed by Company Brain.';

comment on index public.workflow_audit_log_metadata_trello_card_id_idx is
  'Lookup index for Company Brain Trello-trigger diagnostics.';
