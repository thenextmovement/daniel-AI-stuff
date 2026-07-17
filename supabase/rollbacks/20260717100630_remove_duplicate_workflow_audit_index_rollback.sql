create index if not exists workflow_audit_log_created_at_desc_idx
  on public.workflow_audit_log (created_at desc);
