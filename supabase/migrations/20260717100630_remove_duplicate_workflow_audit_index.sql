-- idx_wal_created already covers workflow_audit_log(created_at desc).
drop index if exists public.workflow_audit_log_created_at_desc_idx;
