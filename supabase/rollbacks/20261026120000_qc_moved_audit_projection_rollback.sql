-- Roll back workflow patches first; retain real recorded terminal evidence.
drop trigger if exists trg_qc_moved_audit_projection on public.workflow_audit_log;
drop function if exists public.project_qc_moved_audit();
