-- Make workflow incidents event-driven and close offer failures as soon as a
-- later delivery audit proves that the same request was sent successfully.

create or replace function public.reconcile_company_brain_workflow_incident_from_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_status text := lower(coalesce(new.status, ''));
  request_ref text := coalesce(nullif(new.metadata->>'request_id',''), nullif(new.document_id,''));
  card_ref text := nullif(new.metadata->>'trello_card_id','');
  offer_ref text := nullif(new.metadata->>'offer_id','');
  case_ref text := coalesce(request_ref, card_ref, offer_ref, new.id::text);
  raw_error text := coalesce(new.metadata->>'raw_error', new.metadata->>'rawError', '');
  cause_code text;
  playbook text;
  incident_severity text;
  incident_detail text;
  incident_row public.company_brain_operational_incidents;
begin
  if normalized_status in ('error','failed','failure','blocked') then
    cause_code := case
      when raw_error ~* '(previewVideoUrl|previewVideoPosterUrl).{0,200}(invalid[_ ]format|invalid url)' then 'preview_media_invalid'
      when raw_error ~* 'database is not ready|service[_ ]unavailable|503 -' then 'offer_service_unavailable'
      when raw_error ~* 'CARD_CHANGED_AFTER_PREFLIGHT|card_changed_after_preflight' then 'source_changed_after_preflight'
      when coalesce(new.metadata->>'failure_type','') ~* 'size_ladder_technical_validation_failed'
        or coalesce(new.error_message,'') ~* 'groessenleiter|gr[oö][sß]enleiter|anchor_count_|anchor_[0-9]+_|offer_items_json' then 'size_ladder_validation_failed'
      when coalesce(new.metadata->>'failure_type','') = 'video_content_qc_inconclusive' then 'video_content_qc_inconclusive'
      when coalesce(new.metadata->>'failure_type','') = 'video_content_qc_unavailable' then 'video_content_qc_unavailable'
      when coalesce(new.metadata->>'failure_type','') = 'video_content_qc_failed' then 'video_content_qc_failed'
      when (coalesce(new.error_message,'') || ' ' || raw_error) ~* '(email|e-mail|empf[aä]nger).*(invalid|ung[uü]ltig|fehlt|missing)' then 'customer_email_invalid'
      else coalesce(nullif(new.metadata->>'automation_issue_key',''), nullif(new.metadata->>'failure_type',''), 'workflow_hard_error')
    end;
    playbook := case
      when cause_code in ('customer_email_missing','customer_email_invalid') then 'customer_email_invalid'
      when cause_code in ('video_content_qc_failed','video_content_qc_inconclusive','video_content_qc_unavailable') then 'video_content_qc_failed'
      when cause_code in ('asset_processing_failed','preview_media_invalid') then 'asset_processing_failed'
      when cause_code = 'source_mapping_conflict' then 'source_mapping_conflict'
      when cause_code in ('delivery_failure','outlook_auth_failed','send_guard_unavailable') then 'delivery_failure'
      when cause_code in ('offer_api_failed','offer_service_unavailable','source_changed_after_preflight','size_ladder_validation_failed','neontrip_offer_failed','neontrip_offer_transient_failure','neontrip_offer_locked') then 'offer_api_failed'
      else 'workflow_hard_error'
    end;
    incident_severity := case
      when cause_code in ('video_content_qc_inconclusive','video_content_qc_unavailable','offer_service_unavailable') then 'warning'
      else 'critical'
    end;
    incident_detail := case
      when cause_code = 'preview_media_invalid' then 'Vorschau-Video-/Poster-URL ist ungültig. Die Offer-API hat den Payload abgelehnt; es wurde nichts verschickt.'
      when cause_code = 'customer_email_invalid' then 'Die Kunden-E-Mail fehlt oder ist ungültig. Deshalb wurde kein Angebot verschickt.'
      when cause_code = 'offer_service_unavailable' then 'Offer-API oder Datenbank war vorübergehend nicht verfügbar. Idempotenten Retry-Status prüfen.'
      when cause_code = 'source_changed_after_preflight' then 'Die Trello-Karte wurde nach dem Preflight geändert. Der alte Payload wurde sicher verworfen.'
      when cause_code = 'size_ladder_validation_failed' then 'Die Größenleiter hat die technische Plausibilitätsprüfung nicht bestanden. Deshalb wurde kein Angebot verschickt.'
      when cause_code = 'video_content_qc_inconclusive' then 'Die Video-Prüfung war nicht eindeutig. Der geplante zweite Versuch muss abgewartet werden.'
      when cause_code = 'video_content_qc_unavailable' then 'Die Video-Prüfung war technisch nicht verfügbar. Der Versand wurde sicher gestoppt.'
      when cause_code = 'video_content_qc_failed' then 'Das Video hat die Qualitätsprüfung nicht bestanden. Der Versand wurde gestoppt.'
      else left(coalesce(nullif(new.error_message,''), nullif(new.metadata->>'summary',''), 'Automation meldet einen Fehler.'), 5000)
    end;

    perform public.upsert_company_brain_incident(
      'workflow_failure:' || md5(case_ref || '|' || coalesce(new.action,'unknown')),
      'workflow_failure', incident_severity,
      coalesce(new.workflow_name,'Automation') || ': ' || coalesce(new.action,'Fehler'),
      incident_detail, cause_code, playbook, 1, null,
      case when request_ref is not null then 'request:' || request_ref else 'workflow:' || case_ref end,
      request_ref, card_ref, offer_ref,
      coalesce(nullif(new.metadata->>'execution_id',''), nullif(new.metadata->>'n8n_execution_id',''), nullif(new.metadata->>'workflow_execution_id','')),
      'n8n', 'workflow_audit:' || new.id::text,
      jsonb_build_array('workflow_audit:' || new.id::text),
      case when playbook in ('video_content_qc_failed','asset_processing_failed') then 'design' else 'engineering' end,
      jsonb_strip_nulls(jsonb_build_object(
        'workflow_name', new.workflow_name,
        'action', new.action,
        'case_ref', case_ref,
        'failed_node', new.metadata->>'failed_node',
        'execution_id', coalesce(new.metadata->>'execution_id', new.metadata->>'n8n_execution_id', new.metadata->>'workflow_execution_id'),
        'retry_planned', new.metadata->'retry_planned',
        'current_attempt', new.metadata->'current_attempt',
        'automatic_video_attempt_limit', new.metadata->'automatic_video_attempt_limit'
      )),
      'company-brain-audit-trigger', true
    );
  elsif normalized_status in ('success','sent','completed','ok')
    and lower(coalesce(new.action,'')) in ('initial_delivery_complete','guarded_offer_resend','offer_sent_recorded')
    and (request_ref is not null or card_ref is not null or offer_ref is not null) then
    for incident_row in
      select incident.*
      from public.company_brain_operational_incidents incident
      where incident.incident_type = 'workflow_failure'
        and incident.status in ('open','acknowledged')
        and coalesce(incident.metadata->>'action','') in ('create_and_send_offer','offer_send')
        and incident.first_seen_at <= new.created_at
        and (
          (request_ref is not null and incident.request_id = request_ref)
          or (card_ref is not null and incident.trello_card_id = card_ref)
          or (offer_ref is not null and incident.offer_id = offer_ref)
        )
      for update
    loop
      perform public.transition_company_brain_incident(
        incident_row.id,
        'resolved',
        'company-brain-audit-trigger',
        'Ein späterer erfolgreicher Zustellungs-Audit belegt den Versand für denselben Fall.'
      );
    end loop;
  end if;
  return new;
end;
$$;

revoke all on function public.reconcile_company_brain_workflow_incident_from_audit() from public, anon, authenticated;
grant execute on function public.reconcile_company_brain_workflow_incident_from_audit() to service_role;

drop trigger if exists trg_reconcile_company_brain_workflow_incident on public.workflow_audit_log;
create trigger trg_reconcile_company_brain_workflow_incident
after insert on public.workflow_audit_log
for each row
execute function public.reconcile_company_brain_workflow_incident_from_audit();

-- The legacy scanner still runs every five minutes. Keep it as a fallback, but
-- do not let it downgrade exact trigger-derived causes or reopen an incident
-- after a later delivery audit has proven success.
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

drop trigger if exists trg_preserve_company_brain_specific_workflow_cause on public.company_brain_operational_incidents;
create trigger trg_preserve_company_brain_specific_workflow_cause
before update on public.company_brain_operational_incidents
for each row
execute function public.preserve_company_brain_specific_workflow_cause();

-- Reconcile stale incidents created before the event-driven trigger existed.
do $$
declare
  delivery_row record;
  incident_row public.company_brain_operational_incidents;
begin
  for delivery_row in
    select audit.created_at,
      coalesce(nullif(audit.metadata->>'request_id',''), nullif(audit.document_id,'')) request_id,
      nullif(audit.metadata->>'trello_card_id','') trello_card_id,
      nullif(audit.metadata->>'offer_id','') offer_id
    from public.workflow_audit_log audit
    where lower(coalesce(audit.status,'')) in ('success','sent','completed','ok')
      and lower(coalesce(audit.action,'')) in ('initial_delivery_complete','guarded_offer_resend','offer_sent_recorded')
      and audit.created_at >= now() - interval '60 days'
  loop
    for incident_row in
      select incident.*
      from public.company_brain_operational_incidents incident
      where incident.incident_type = 'workflow_failure'
        and incident.status in ('open','acknowledged')
        and coalesce(incident.metadata->>'action','') in ('create_and_send_offer','offer_send')
        and incident.first_seen_at <= delivery_row.created_at
        and (
          (delivery_row.request_id is not null and incident.request_id = delivery_row.request_id)
          or (delivery_row.trello_card_id is not null and incident.trello_card_id = delivery_row.trello_card_id)
          or (delivery_row.offer_id is not null and incident.offer_id = delivery_row.offer_id)
        )
      for update
    loop
      perform public.transition_company_brain_incident(
        incident_row.id,
        'resolved',
        'company-brain-migration',
        'Stale Workflow-Fehler durch späteren erfolgreichen Zustellungs-Audit geschlossen.'
      );
    end loop;
  end loop;
end;
$$;
