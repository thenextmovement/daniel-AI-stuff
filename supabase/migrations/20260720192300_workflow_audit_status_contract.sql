-- workflow_audit_log is an event stream, not only a success/error ledger.
-- These states are emitted by n8n and governed Company Brain actions.

alter table public.workflow_audit_log
  drop constraint if exists workflow_audit_log_status_check;

alter table public.workflow_audit_log
  add constraint workflow_audit_log_status_check check (
    status in (
      'pending', 'queued', 'running', 'leased', 'processing',
      'retry', 'retry_scheduled', 'waiting',
      'success', 'sent', 'completed', 'duplicate', 'ok',
      'error', 'failed', 'failure', 'blocked', 'abandoned',
      'cancelled', 'canceled', 'skipped'
    )
  );

comment on constraint workflow_audit_log_status_check on public.workflow_audit_log is
  'Explicit workflow lifecycle states accepted from n8n and governed Company Brain actions.';
