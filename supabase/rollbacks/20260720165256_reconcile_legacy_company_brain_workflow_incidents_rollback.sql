-- Restores the previous scanner guard. Incidents resolved by the forward
-- migration intentionally remain resolved; reopening them would create false
-- operational work after a proven delivery.

create or replace function public.preserve_company_brain_specific_workflow_cause()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  has_later_delivery boolean := false;
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

  if old.status = 'resolved' and new.status = 'open' then
    select exists (
      select 1
      from public.workflow_audit_log audit
      where lower(coalesce(audit.status,'')) in ('success','sent','completed','ok')
        and lower(coalesce(audit.action,'')) in ('initial_delivery_complete','guarded_offer_resend','offer_sent_recorded')
        and audit.created_at >= old.first_seen_at
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
