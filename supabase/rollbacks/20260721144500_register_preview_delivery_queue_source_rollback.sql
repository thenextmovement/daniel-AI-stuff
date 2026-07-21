-- Keep the registry key while Company Brain rows reference it. Removing a
-- referenced source would either violate foreign keys or break queue incident
-- reconciliation. An unused source can be removed completely.

do $$
begin
  if not exists (
    select 1
    from public.company_brain_operational_incidents
    where source_key = 'preview_delivery_queue'
  )
  and not exists (
    select 1
    from public.company_data_quality_issues
    where source_key = 'preview_delivery_queue'
  )
  and not exists (
    select 1
    from public.company_decision_evidence
    where source_key = 'preview_delivery_queue'
  )
  and not exists (
    select 1
    from public.company_entity_aliases
    where source_key = 'preview_delivery_queue'
  )
  and not exists (
    select 1
    from public.company_entity_registry
    where source_key = 'preview_delivery_queue'
  )
  and not exists (
    select 1
    from public.company_events
    where source_key = 'preview_delivery_queue'
  )
  and not exists (
    select 1
    from public.company_evidence
    where source_key = 'preview_delivery_queue'
  )
  and not exists (
    select 1
    from public.company_identity_resolution_log
    where source_key = 'preview_delivery_queue'
  )
  and not exists (
    select 1
    from public.company_identity_review_queue
    where source_key = 'preview_delivery_queue'
  )
  and not exists (
    select 1
    from public.company_workflow_registry
    where source_key = 'preview_delivery_queue'
  ) then
    delete from public.company_source_registry
    where source_key = 'preview_delivery_queue';
  else
    update public.company_source_registry
    set active = false,
        metadata = metadata || jsonb_build_object(
          'rollback_retained_for_referential_integrity', true,
          'rollback_recorded_at', now()
        ),
        updated_at = now()
    where source_key = 'preview_delivery_queue';
  end if;
end;
$$;
