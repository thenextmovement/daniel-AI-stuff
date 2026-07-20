drop trigger if exists trg_preserve_company_brain_specific_workflow_cause on public.company_brain_operational_incidents;
drop function if exists public.preserve_company_brain_specific_workflow_cause();

drop trigger if exists trg_reconcile_company_brain_workflow_incident on public.workflow_audit_log;
drop function if exists public.reconcile_company_brain_workflow_incident_from_audit();

-- Incident state changes are intentionally not reopened during rollback because
-- they were closed by immutable successful delivery evidence.
