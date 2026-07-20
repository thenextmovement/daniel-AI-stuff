-- Legacy incidents were first created by the periodic scanner, sometimes after
-- the actual delivery had already succeeded. Compare delivery timestamps with
-- the originating failure audit instead of the incident insertion timestamp.

create or replace function public.preserve_company_brain_specific_workflow_cause()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  has_later_delivery boolean := false;
  failure_anchor_at timestamptz := old.first_seen_at;
begin
  if old.incident_type <> 'workflow_failure' then
    return new;
  end if;

  if old.root_cause_code not in ('workflow_hard_error','offer_api_failed','automation_failed','unknown')
    and new.root_cause_code in ('workflow_hard_error','offer_api_failed','automation_failed','unknown') then
    new.root_cause_code := old.root_cause_code;
    new.detail := old.detail;
    new.playbook_key := old.playbook_key;
    new.playbook_version := old.playbook_version;
    new.severity := old.severity;
    new.owner_team := old.owner_team;
    new.metadata := coalesce(old.metadata, '{}'::jsonb) || coalesce(new.metadata, '{}'::jsonb);
  end if;

  if old.source_ref like 'workflow_audit:%' then
    select audit.created_at
    into failure_anchor_at
    from public.workflow_audit_log audit
    where audit.id::text = split_part(old.source_ref, ':', 2)
    limit 1;
    failure_anchor_at := coalesce(failure_anchor_at, old.first_seen_at);
  end if;

  if old.status = 'resolved' and new.status = 'open' then
    select exists (
      select 1
      from public.workflow_audit_log audit
      where lower(coalesce(audit.status,'')) in ('success','sent','completed','ok')
        and lower(coalesce(audit.action,'')) in ('initial_delivery_complete','guarded_offer_resend','offer_sent_recorded')
        and audit.created_at >= failure_anchor_at
        and (
          (old.request_id is not null and coalesce(nullif(audit.metadata->>'request_id',''), nullif(audit.document_id,'')) = old.request_id)
          or (old.trello_card_id is not null and nullif(audit.metadata->>'trello_card_id','') = old.trello_card_id)
          or (old.offer_id is not null and nullif(audit.metadata->>'offer_id','') = old.offer_id)
        )
    ) into has_later_delivery;

    if has_later_delivery then
      new.status := old.status;
      new.acknowledged_at := old.acknowledged_at;
      new.acknowledged_by := old.acknowledged_by;
      new.resolved_at := old.resolved_at;
      new.resolved_by := old.resolved_by;
      new.resolution_note := old.resolution_note;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.preserve_company_brain_specific_workflow_cause() from public, anon, authenticated;
grant execute on function public.preserve_company_brain_specific_workflow_cause() to service_role;

do $$
declare
  incident_row public.company_brain_operational_incidents;
begin
  for incident_row in
    select incident.*
    from public.company_brain_operational_incidents incident
    join public.workflow_audit_log failure_audit
      on incident.source_ref = 'workflow_audit:' || failure_audit.id::text
    where incident.incident_type = 'workflow_failure'
      and incident.status in ('open','acknowledged')
      and exists (
        select 1
        from public.workflow_audit_log delivery_audit
        where lower(coalesce(delivery_audit.status,'')) in ('success','sent','completed','ok')
          and lower(coalesce(delivery_audit.action,'')) in ('initial_delivery_complete','guarded_offer_resend','offer_sent_recorded')
          and delivery_audit.created_at >= failure_audit.created_at
          and (
            (incident.request_id is not null and coalesce(nullif(delivery_audit.metadata->>'request_id',''), nullif(delivery_audit.document_id,'')) = incident.request_id)
            or (incident.trello_card_id is not null and nullif(delivery_audit.metadata->>'trello_card_id','') = incident.trello_card_id)
            or (incident.offer_id is not null and nullif(delivery_audit.metadata->>'offer_id','') = incident.offer_id)
          )
      )
    for update of incident
  loop
    perform public.transition_company_brain_incident(
      incident_row.id,
      'resolved',
      'company-brain-legacy-reconciliation',
      'Staler Workflow-Fehler anhand des ursprünglichen Fehler-Audits und eines späteren Zustellungs-Audits geschlossen.'
    );
  end loop;
end;
$$;
