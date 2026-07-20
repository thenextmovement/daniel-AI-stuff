alter table public.workflow_audit_log
  drop constraint if exists workflow_audit_log_status_check;

update public.workflow_audit_log
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('rollback_original_status', status),
    status = case
      when status in ('pending', 'queued', 'running', 'leased', 'processing', 'retry', 'retry_scheduled', 'waiting') then 'pending'
      when status in ('success', 'sent', 'completed', 'duplicate', 'ok') then 'success'
      when status in ('cancelled', 'canceled', 'skipped') then 'skipped'
      else 'error'
    end
where status not in ('success', 'error', 'skipped', 'pending');

alter table public.workflow_audit_log
  add constraint workflow_audit_log_status_check check (
    status in ('success', 'error', 'skipped', 'pending')
  );
