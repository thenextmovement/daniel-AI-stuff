-- Remove only this migration's unused registration. Existing ownership choices
-- are preserved. Any referencing evidence makes the FK reject this deletion;
-- never delete or relabel that evidence merely to roll back a registry row.
delete from public.company_source_registry
where source_key = 'workflow_attempt'
  and metadata->>'registration' = '20261026-workflow-attempt-source';
