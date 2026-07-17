-- Durable Company Brain incident control plane. Operational systems remain the
-- systems of record; incidents point to evidence and never replace it.

alter table public.company_brain_actor_roles
  add column if not exists expires_at timestamptz;

alter table public.company_brain_actor_roles
  drop constraint if exists company_brain_actor_roles_expiry_check;
alter table public.company_brain_actor_roles
  add constraint company_brain_actor_roles_expiry_check
  check (expires_at is null or expires_at > created_at);

create index if not exists company_brain_actor_roles_expiry_idx
  on public.company_brain_actor_roles (active, expires_at, actor_email);

create index if not exists workflow_audit_log_created_at_desc_idx
  on public.workflow_audit_log (created_at desc);

create table if not exists public.company_brain_playbooks (
  playbook_key text not null,
  version integer not null,
  title text not null,
  category text not null,
  owner_team text not null,
  purpose text not null,
  trigger_codes text[] not null default '{}',
  default_severity text not null default 'warning',
  diagnosis_steps jsonb not null default '[]'::jsonb,
  safe_actions jsonb not null default '[]'::jsonb,
  blocked_actions jsonb not null default '[]'::jsonb,
  escalation_steps jsonb not null default '[]'::jsonb,
  verification_steps jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  effective_from timestamptz not null default now(),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (playbook_key, version),
  constraint company_brain_playbooks_key_check check (playbook_key ~ '^[a-z0-9][a-z0-9_]{2,79}$'),
  constraint company_brain_playbooks_version_check check (version > 0),
  constraint company_brain_playbooks_category_check check (
    category in ('customer_data', 'delivery', 'identity', 'asset', 'video', 'automation', 'governance', 'quality')
  ),
  constraint company_brain_playbooks_severity_check check (default_severity in ('info', 'warning', 'critical')),
  constraint company_brain_playbooks_payload_check check (
    jsonb_typeof(diagnosis_steps) = 'array'
    and jsonb_typeof(safe_actions) = 'array'
    and jsonb_typeof(blocked_actions) = 'array'
    and jsonb_typeof(escalation_steps) = 'array'
    and jsonb_typeof(verification_steps) = 'array'
  )
);

create unique index if not exists company_brain_playbooks_one_active_idx
  on public.company_brain_playbooks (playbook_key)
  where active;

create table if not exists public.company_brain_operational_incidents (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  incident_type text not null,
  severity text not null,
  status text not null default 'open',
  title text not null,
  detail text not null,
  root_cause_code text not null,
  playbook_key text,
  playbook_version integer,
  entity_id uuid references public.company_entity_registry(id) on delete set null,
  case_key text,
  request_id text,
  trello_card_id text,
  offer_id text,
  workflow_execution_id text,
  source_key text references public.company_source_registry(source_key),
  source_ref text,
  evidence_refs jsonb not null default '[]'::jsonb,
  owner_team text not null default 'operations',
  assigned_to text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by text,
  resolved_at timestamptz,
  resolved_by text,
  resolution_note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_brain_operational_incidents_type_check check (incident_type ~ '^[a-z0-9][a-z0-9_]{2,79}$'),
  constraint company_brain_operational_incidents_fingerprint_check check (char_length(fingerprint) between 8 and 240),
  constraint company_brain_operational_incidents_severity_check check (severity in ('info', 'warning', 'critical')),
  constraint company_brain_operational_incidents_status_check check (status in ('open', 'acknowledged', 'resolved', 'ignored')),
  constraint company_brain_operational_incidents_playbook_check check (
    (playbook_key is null and playbook_version is null)
    or (playbook_key is not null and playbook_version is not null)
  ),
  constraint company_brain_operational_incidents_resolution_check check (
    status <> 'resolved' or (resolved_at is not null and resolved_by is not null and resolution_note is not null)
  ),
  constraint company_brain_operational_incidents_evidence_check check (jsonb_typeof(evidence_refs) = 'array'),
  constraint company_brain_operational_incidents_metadata_check check (jsonb_typeof(metadata) = 'object'),
  constraint company_brain_operational_incidents_playbook_fk foreign key (playbook_key, playbook_version)
    references public.company_brain_playbooks(playbook_key, version)
);

create table if not exists public.company_brain_incident_events (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.company_brain_operational_incidents(id) on delete cascade,
  event_type text not null,
  actor text not null,
  previous_status text,
  new_status text not null,
  note text,
  snapshot jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint company_brain_incident_events_type_check check (
    event_type in ('detected', 'reopened', 'acknowledged', 'resolved', 'ignored', 'reassigned', 'changed')
  ),
  constraint company_brain_incident_events_status_check check (
    new_status in ('open', 'acknowledged', 'resolved', 'ignored')
    and (previous_status is null or previous_status in ('open', 'acknowledged', 'resolved', 'ignored'))
  ),
  constraint company_brain_incident_events_snapshot_check check (jsonb_typeof(snapshot) = 'object')
);

create index if not exists company_brain_incidents_queue_idx
  on public.company_brain_operational_incidents (status, severity, last_seen_at desc)
  where status in ('open', 'acknowledged');
create index if not exists company_brain_incidents_case_idx
  on public.company_brain_operational_incidents (case_key, last_seen_at desc)
  where case_key is not null;
create index if not exists company_brain_incidents_request_idx
  on public.company_brain_operational_incidents (request_id, last_seen_at desc)
  where request_id is not null;
create index if not exists company_brain_incident_events_incident_idx
  on public.company_brain_incident_events (incident_id, occurred_at desc);

drop trigger if exists trg_company_brain_playbooks_updated_at on public.company_brain_playbooks;
create trigger trg_company_brain_playbooks_updated_at
before update on public.company_brain_playbooks
for each row execute function public.touch_company_brain_updated_at();

drop trigger if exists trg_company_brain_operational_incidents_updated_at on public.company_brain_operational_incidents;
create trigger trg_company_brain_operational_incidents_updated_at
before update on public.company_brain_operational_incidents
for each row execute function public.touch_company_brain_updated_at();

create or replace function public.guard_company_brain_incident_event_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'company_brain_incident_events_are_append_only';
end;
$$;

drop trigger if exists trg_company_brain_incident_events_immutable on public.company_brain_incident_events;
create trigger trg_company_brain_incident_events_immutable
before update or delete on public.company_brain_incident_events
for each row execute function public.guard_company_brain_incident_event_immutable();

create or replace function public.upsert_company_brain_incident(
  p_fingerprint text,
  p_incident_type text,
  p_severity text,
  p_title text,
  p_detail text,
  p_root_cause_code text,
  p_playbook_key text default null,
  p_playbook_version integer default null,
  p_entity_id uuid default null,
  p_case_key text default null,
  p_request_id text default null,
  p_trello_card_id text default null,
  p_offer_id text default null,
  p_workflow_execution_id text default null,
  p_source_key text default null,
  p_source_ref text default null,
  p_evidence_refs jsonb default '[]'::jsonb,
  p_owner_team text default 'operations',
  p_metadata jsonb default '{}'::jsonb,
  p_actor text default 'company-brain-scanner',
  p_reopen boolean default true
)
returns public.company_brain_operational_incidents
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_row public.company_brain_operational_incidents;
  saved_row public.company_brain_operational_incidents;
  normalized_fingerprint text := lower(btrim(p_fingerprint));
  normalized_actor text := lower(btrim(p_actor));
  should_reopen boolean := false;
  changed boolean := false;
begin
  if normalized_fingerprint = '' or normalized_actor = '' then
    raise exception 'company_brain_incident_identity_required';
  end if;
  if p_severity not in ('info', 'warning', 'critical') then
    raise exception 'company_brain_incident_invalid_severity';
  end if;

  select * into current_row
  from public.company_brain_operational_incidents
  where fingerprint = normalized_fingerprint
  for update;

  if current_row.id is null then
    insert into public.company_brain_operational_incidents (
      fingerprint, incident_type, severity, title, detail, root_cause_code,
      playbook_key, playbook_version, entity_id, case_key, request_id,
      trello_card_id, offer_id, workflow_execution_id, source_key, source_ref,
      evidence_refs, owner_team, metadata
    ) values (
      normalized_fingerprint, lower(btrim(p_incident_type)), p_severity,
      left(btrim(p_title), 500), left(btrim(p_detail), 5000), lower(btrim(p_root_cause_code)),
      nullif(lower(btrim(p_playbook_key)), ''), p_playbook_version, p_entity_id,
      nullif(btrim(p_case_key), ''), nullif(btrim(p_request_id), ''),
      nullif(btrim(p_trello_card_id), ''), nullif(btrim(p_offer_id), ''),
      nullif(btrim(p_workflow_execution_id), ''), nullif(lower(btrim(p_source_key)), ''),
      nullif(btrim(p_source_ref), ''), coalesce(p_evidence_refs, '[]'::jsonb),
      coalesce(nullif(lower(btrim(p_owner_team)), ''), 'operations'), coalesce(p_metadata, '{}'::jsonb)
    ) returning * into saved_row;

    insert into public.company_brain_incident_events (
      incident_id, event_type, actor, previous_status, new_status, note, snapshot
    ) values (
      saved_row.id, 'detected', normalized_actor, null, 'open',
      'Incident automatisch erkannt.',
      jsonb_build_object('fingerprint', saved_row.fingerprint, 'root_cause_code', saved_row.root_cause_code)
    );
    return saved_row;
  end if;

  should_reopen := p_reopen and current_row.status = 'resolved';
  changed := current_row.severity is distinct from p_severity
    or current_row.title is distinct from left(btrim(p_title), 500)
    or current_row.detail is distinct from left(btrim(p_detail), 5000)
    or current_row.root_cause_code is distinct from lower(btrim(p_root_cause_code))
    or current_row.source_ref is distinct from nullif(btrim(p_source_ref), '');

  update public.company_brain_operational_incidents
  set incident_type = lower(btrim(p_incident_type)),
      severity = p_severity,
      status = case when should_reopen then 'open' else status end,
      title = left(btrim(p_title), 500),
      detail = left(btrim(p_detail), 5000),
      root_cause_code = lower(btrim(p_root_cause_code)),
      playbook_key = nullif(lower(btrim(p_playbook_key)), ''),
      playbook_version = p_playbook_version,
      entity_id = coalesce(p_entity_id, entity_id),
      case_key = coalesce(nullif(btrim(p_case_key), ''), case_key),
      request_id = coalesce(nullif(btrim(p_request_id), ''), request_id),
      trello_card_id = coalesce(nullif(btrim(p_trello_card_id), ''), trello_card_id),
      offer_id = coalesce(nullif(btrim(p_offer_id), ''), offer_id),
      workflow_execution_id = coalesce(nullif(btrim(p_workflow_execution_id), ''), workflow_execution_id),
      source_key = coalesce(nullif(lower(btrim(p_source_key)), ''), source_key),
      source_ref = coalesce(nullif(btrim(p_source_ref), ''), source_ref),
      evidence_refs = coalesce(p_evidence_refs, evidence_refs),
      owner_team = coalesce(nullif(lower(btrim(p_owner_team)), ''), owner_team),
      last_seen_at = now(),
      acknowledged_at = case when should_reopen then null else acknowledged_at end,
      acknowledged_by = case when should_reopen then null else acknowledged_by end,
      resolved_at = case when should_reopen then null else resolved_at end,
      resolved_by = case when should_reopen then null else resolved_by end,
      resolution_note = case when should_reopen then null else resolution_note end,
      metadata = coalesce(p_metadata, metadata)
  where id = current_row.id
  returning * into saved_row;

  if should_reopen or changed then
    insert into public.company_brain_incident_events (
      incident_id, event_type, actor, previous_status, new_status, note, snapshot
    ) values (
      saved_row.id,
      case when should_reopen then 'reopened' else 'changed' end,
      normalized_actor,
      current_row.status,
      saved_row.status,
      case when should_reopen then 'Problem erneut belegt.' else 'Incident-Beleg wurde aktualisiert.' end,
      jsonb_build_object('source_ref', saved_row.source_ref, 'root_cause_code', saved_row.root_cause_code)
    );
  end if;
  return saved_row;
end;
$$;

create or replace function public.transition_company_brain_incident(
  p_incident_id uuid,
  p_status text,
  p_actor text,
  p_note text default null,
  p_assigned_to text default null
)
returns public.company_brain_operational_incidents
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_row public.company_brain_operational_incidents;
  saved_row public.company_brain_operational_incidents;
  normalized_status text := lower(btrim(p_status));
  normalized_actor text := lower(btrim(p_actor));
  normalized_note text := nullif(btrim(p_note), '');
begin
  if normalized_actor = '' then
    raise exception 'company_brain_incident_actor_required';
  end if;
  if normalized_status not in ('open', 'acknowledged', 'resolved', 'ignored') then
    raise exception 'company_brain_incident_invalid_transition';
  end if;
  if normalized_status in ('resolved', 'ignored') and char_length(coalesce(normalized_note, '')) < 10 then
    raise exception 'company_brain_incident_resolution_note_required';
  end if;

  select * into current_row
  from public.company_brain_operational_incidents
  where id = p_incident_id
  for update;
  if current_row.id is null then
    raise exception 'company_brain_incident_not_found';
  end if;

  if current_row.status = normalized_status
     and coalesce(current_row.assigned_to, '') = coalesce(nullif(lower(btrim(p_assigned_to)), ''), current_row.assigned_to, '') then
    return current_row;
  end if;

  update public.company_brain_operational_incidents
  set status = normalized_status,
      assigned_to = coalesce(nullif(lower(btrim(p_assigned_to)), ''), assigned_to),
      acknowledged_at = case when normalized_status = 'acknowledged' then now() when normalized_status = 'open' then null else acknowledged_at end,
      acknowledged_by = case when normalized_status = 'acknowledged' then normalized_actor when normalized_status = 'open' then null else acknowledged_by end,
      resolved_at = case when normalized_status = 'resolved' then now() when normalized_status = 'open' then null else resolved_at end,
      resolved_by = case when normalized_status = 'resolved' then normalized_actor when normalized_status = 'open' then null else resolved_by end,
      resolution_note = case when normalized_status in ('resolved', 'ignored') then normalized_note when normalized_status = 'open' then null else resolution_note end
  where id = current_row.id
  returning * into saved_row;

  insert into public.company_brain_incident_events (
    incident_id, event_type, actor, previous_status, new_status, note, snapshot
  ) values (
    saved_row.id,
    case normalized_status
      when 'acknowledged' then 'acknowledged'
      when 'resolved' then 'resolved'
      when 'ignored' then 'ignored'
      else 'reopened'
    end,
    normalized_actor,
    current_row.status,
    saved_row.status,
    normalized_note,
    jsonb_build_object('assigned_to', saved_row.assigned_to)
  );
  return saved_row;
end;
$$;

insert into public.company_brain_playbooks (
  playbook_key, version, title, category, owner_team, purpose, trigger_codes,
  default_severity, diagnosis_steps, safe_actions, blocked_actions,
  escalation_steps, verification_steps, created_by
)
values
  ('customer_email_invalid', 1, 'Kunden-E-Mail fehlt oder ist ungültig', 'customer_data', 'sales', 'Empfänger belegen, korrigieren und einen Doppelversand verhindern.', array['customer_email_missing','customer_email_invalid'], 'warning',
    '["Kundenakte und Angebot auf dieselbe Request-ID prüfen","Adresse syntaktisch und anhand einer Kundenquelle verifizieren","Bounce- und Versandbelege prüfen"]',
    '["Belegte Adresse intern korrigieren","Fall neu laden","Guarded Resend nur nach grünem Duplicate-Check freigeben"]',
    '["Nicht an die alte Adresse senden","Keine Adresse aus Firmennamen erraten"]',
    '["Sales bei unklarer Adresse einbeziehen"]',
    '["Kundenakte und Angebot zeigen dieselbe Adresse","Kein neuer Bounce","Eindeutiger Versandbeleg vorhanden"]', 'migration:20260717073542'),
  ('delivery_failure', 1, 'E-Mail-Zustellung fehlgeschlagen', 'delivery', 'sales', 'Bounce oder Empfängerfehler belegen und kontrolliert beheben.', array['delivery_failure','outlook_auth_failed','send_guard_unavailable'], 'critical',
    '["Outlook-, quote_email_log- und Workflow-Belege vergleichen","Empfänger und Fehlerzeitpunkt verifizieren"]',
    '["Adresse intern verifizieren","Guard nach Behebung erneut prüfen"]',
    '["Kein Blind-Retry","Keinen Versandbeleg aus Trello ableiten"]',
    '["Automation bei Graph-/Guard-Ausfall eskalieren"]',
    '["Zustellstatus strukturiert geloggt","Duplicate-Guard grün"]', 'migration:20260717073542'),
  ('source_mapping_conflict', 1, 'Fall-Zuordnung widersprüchlich', 'identity', 'operations', 'Kundenakte, Angebot und Trello-Projektion kanonisch zusammenführen.', array['source_mapping_conflict','no_source_record'], 'critical',
    '["Request-ID als Primärschlüssel prüfen","Offer-Bridge und Trello-Aliasse vergleichen","Konflikt in der Identity Review Queue öffnen"]',
    '["Eindeutigen Alias nach Vier-Augen-Prüfung korrigieren","Fall danach neu auflösen"]',
    '["Trello nie als Source of Truth verwenden","Keine Alias-Zuordnung bei mehreren Kandidaten erzwingen"]',
    '["Operations oder Engineering bei Mehrdeutigkeit einbeziehen"]',
    '["Genau eine Request-ID","Angebot und alle Karten-Aliasse zeigen auf denselben kanonischen Fall"]', 'migration:20260717073542'),
  ('video_content_qc_failed', 1, 'Video-Inhaltsprüfung abgelehnt', 'video', 'design', 'Abweichende oder unklare Videos vor Kundenkontakt stoppen.', array['video_content_qc_failed','video_content_qc_unavailable'], 'warning',
    '["QC-Code, Mockup und verwendete Assets vergleichen","Automatische Versuchsanzahl prüfen"]',
    '["Genau einen automatischen QC-Neuversuch zulassen","Danach Mockup und Video manuell prüfen"]',
    '["Keinen Versand ohne positiven QC-Beleg","Keine unbegrenzten Retries"]',
    '["Design nach ausgeschöpftem Retry übernehmen"]',
    '["QC bestanden","Video gehört zum richtigen Angebot","Versandbeleg erst danach"]', 'migration:20260717073542'),
  ('asset_processing_failed', 1, 'Design- oder Upload-Asset fehlt', 'asset', 'design', 'Relevante Anhänge vollständig und eindeutig verfügbar machen.', array['asset_processing_failed','upload_failed'], 'warning',
    '["Trello-, Outlook-, Storage- und Offer-Asset-Referenzen vergleichen","Dateityp, URL und Zugriff prüfen"]',
    '["Fehlendes Asset neu verknüpfen oder gesichert hochladen","Fall danach neu laden"]',
    '["Kein Kundenversand mit fehlendem relevantem Design"]',
    '["Design bei beschädigter oder unklarer Quelldatei einbeziehen"]',
    '["Alle ausgewählten Designs verfügbar","Asset gehört zur richtigen Request-ID"]', 'migration:20260717073542'),
  ('offer_api_failed', 1, 'Angebotsanlage oder Validierung fehlgeschlagen', 'automation', 'engineering', 'Angebotspayload, Preisleiter und Idempotenz vor Versand reparieren.', array['offer_api_failed','offer_validation_failed'], 'critical',
    '["Execution und fehlerhaften Node prüfen","Offer-Payload und Größen-/Preisleiter validieren","Vorhandenen Angebotssnapshot suchen"]',
    '["Deterministischen Validierungsfehler korrigieren","Idempotenten Erstelllauf erneut freigeben"]',
    '["Kein Versand ohne belastbaren Angebotssnapshot","Kein Workflow-Change ohne Backup, Diff, Test und Rollback"]',
    '["Engineering bei Schema- oder Preislogikfehler einbeziehen"]',
    '["Angebot eindeutig erstellt","Preisleiter validiert","Kein doppeltes Angebot"]', 'migration:20260717073542'),
  ('workflow_hard_error', 1, 'Automation hart fehlgeschlagen', 'automation', 'engineering', 'Fehlerursache anhand der Execution beheben, ohne Side Effects zu duplizieren.', array['workflow_hard_error','automation_failed'], 'critical',
    '["Execution, Node und API-Antwort prüfen","Idempotency-Key und spätere Erfolgsbelege suchen"]',
    '["Ursache intern korrigieren","Gezielten Testlauf mit derselben Korrelation durchführen"]',
    '["Kein produktiver Retry bei unklarer Versandlage","Kein Continue-on-Fail für kritische Aktionen"]',
    '["Automation Admin bei wiederholtem Fehler einbeziehen"]',
    '["Späterer Erfolgsbeleg oder fachlich bestätigter Abschluss","Keine doppelten Side Effects"]', 'migration:20260717073542'),
  ('stuck_action', 1, 'Freigabe oder Aktion hängt', 'governance', 'operations', 'Offene Freigaben und laufende Aktionen zeitnah klären.', array['action_awaiting_approval','action_execution_stuck'], 'warning',
    '["Action Run, Risiko und Verantwortliche prüfen","Ausführungs- und Verifikationszeitpunkt vergleichen"]',
    '["Zuständige Person zuweisen","Blockierten Run mit Begründung abschließen"]',
    '["Keine zweite Ausführung mit anderem Idempotency-Key starten"]',
    '["Automation Admin bei laufender Aktion über 15 Minuten einbeziehen"]',
    '["Action Run terminal","Verifikationsbeleg gespeichert"]', 'migration:20260717073542'),
  ('identity_conflict', 1, 'Identitätsprüfung offen', 'identity', 'operations', 'Mehrdeutige Aliasse ohne falsche Zusammenführung klären.', array['identity_review_open'], 'warning',
    '["Kandidaten und Beleg-Hashes prüfen","Request-ID und Source-of-Truth vergleichen"]',
    '["Eindeutige Zuordnung bestätigen oder Vorschlag ablehnen"]',
    '["Keine automatische Zusammenführung bei Mehrdeutigkeit"]',
    '["Company Admin bei konfliktären harten Identifikatoren einbeziehen"]',
    '["Review terminal","Alias zeigt auf genau einen aktiven Fall"]', 'migration:20260717073542'),
  ('data_quality_issue', 1, 'Datenqualitätsproblem offen', 'quality', 'engineering', 'Strukturelle Wissenslücken messbar abbauen.', array['data_quality_issue'], 'warning',
    '["Betroffene Quelle, Umfang und Freshness messen","Stichprobe gegen Source of Truth prüfen"]',
    '["Deterministischen Backfill oder Vertrag ergänzen","Qualitätsmetrik erneut berechnen"]',
    '["Keinen KI-Fuzzy-Match als harte Zuordnung speichern"]',
    '["Owner Team bei kritischer Lücke einbeziehen"]',
    '["Messwert unter Zielgrenze","Neue Datensätze erfüllen den Korrelationsvertrag"]', 'migration:20260717073542')
on conflict (playbook_key, version) do update set
  title = excluded.title,
  category = excluded.category,
  owner_team = excluded.owner_team,
  purpose = excluded.purpose,
  trigger_codes = excluded.trigger_codes,
  default_severity = excluded.default_severity,
  diagnosis_steps = excluded.diagnosis_steps,
  safe_actions = excluded.safe_actions,
  blocked_actions = excluded.blocked_actions,
  escalation_steps = excluded.escalation_steps,
  verification_steps = excluded.verification_steps,
  active = true;

create or replace function public.scan_company_brain_operational_incidents()
returns table (detected integer, resolved integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  audit_row record;
  action_row record;
  review_row record;
  quality_row record;
  incident_row public.company_brain_operational_incidents;
  detected_count integer := 0;
  resolved_count integer := 0;
  case_ref text;
  incident_fingerprint text;
  cause_code text;
  playbook text;
  incident_severity text;
begin
  for audit_row in
    with ranked as (
      select audit.*,
        coalesce(nullif(audit.metadata->>'request_id',''), nullif(audit.document_id,''), nullif(audit.metadata->>'trello_card_id',''), audit.id::text) as case_ref,
        row_number() over (
          partition by coalesce(nullif(audit.metadata->>'request_id',''), nullif(audit.document_id,''), nullif(audit.metadata->>'trello_card_id',''), audit.id::text), coalesce(audit.action,'unknown')
          order by audit.created_at desc, audit.id desc
        ) as row_rank
      from public.workflow_audit_log audit
      where audit.created_at >= now() - interval '14 days'
    )
    select * from ranked where row_rank = 1
  loop
    case_ref := audit_row.case_ref;
    incident_fingerprint := 'workflow_failure:' || md5(case_ref || '|' || coalesce(audit_row.action,'unknown'));
    if lower(coalesce(audit_row.status,'')) in ('error','failed','failure','blocked') then
      cause_code := coalesce(nullif(audit_row.metadata->>'automation_issue_key',''),
        case
          when coalesce(audit_row.error_message,'') ~* 'video.*(qc|inhaltspr|qualit).*(failed|abgelehnt|nicht bestanden)|design_morph|color_shift' then 'video_content_qc_failed'
          when coalesce(audit_row.error_message,'') ~* 'video.*(unavailable|nicht sicher|konnte nicht)' then 'video_content_qc_unavailable'
          when coalesce(audit_row.error_message,'') ~* '(asset|upload|anhang|image|mockup|datei).*(failed|fehlt|error|404)' then 'asset_processing_failed'
          when coalesce(audit_row.error_message,'') ~* '(email|e-mail|empf[aä]nger).*(invalid|ung[uü]ltig|fehlt|missing)' then 'customer_email_invalid'
          when coalesce(audit_row.error_message,'') ~* '(groessenleiter|gr[oö][sß]enleiter|offer_items_json|anchor_.*larger_but_cheaper|angebot.*valid)' then 'offer_api_failed'
          else 'workflow_hard_error'
        end);
      playbook := case
        when cause_code in ('customer_email_missing','customer_email_invalid') then 'customer_email_invalid'
        when cause_code in ('delivery_failure','outlook_auth_failed','send_guard_unavailable') then 'delivery_failure'
        when cause_code = 'source_mapping_conflict' then 'source_mapping_conflict'
        when cause_code in ('video_content_qc_failed','video_content_qc_unavailable') then 'video_content_qc_failed'
        when cause_code = 'asset_processing_failed' then 'asset_processing_failed'
        when cause_code = 'offer_api_failed' then 'offer_api_failed'
        else 'workflow_hard_error'
      end;
      incident_severity := case when playbook in ('workflow_hard_error','offer_api_failed','delivery_failure','source_mapping_conflict') then 'critical' else 'warning' end;
      perform public.upsert_company_brain_incident(
        incident_fingerprint, 'workflow_failure', incident_severity,
        coalesce(audit_row.workflow_name,'Automation') || ': ' || coalesce(audit_row.action,'Fehler'),
        left(coalesce(nullif(audit_row.error_message,''), nullif(audit_row.metadata->>'summary',''), 'Automation meldet einen Fehler.'), 5000),
        cause_code, playbook, 1, null,
        'request:' || case_ref, nullif(audit_row.metadata->>'request_id',''),
        nullif(audit_row.metadata->>'trello_card_id',''), nullif(audit_row.metadata->>'offer_id',''),
        coalesce(nullif(audit_row.metadata->>'execution_id',''), nullif(audit_row.metadata->>'n8n_execution_id','')),
        'n8n', 'workflow_audit:' || audit_row.id::text,
        jsonb_build_array('workflow_audit:' || audit_row.id::text),
        case when playbook in ('video_content_qc_failed','asset_processing_failed') then 'design' else 'engineering' end,
        jsonb_strip_nulls(jsonb_build_object(
          'workflow_name', audit_row.workflow_name,
          'action', audit_row.action,
          'case_ref', case_ref,
          'failed_node', audit_row.metadata->>'failed_node',
          'execution_id', coalesce(audit_row.metadata->>'execution_id', audit_row.metadata->>'n8n_execution_id')
        )),
        'company-brain-scanner', true
      );
      detected_count := detected_count + 1;
    else
      select * into incident_row from public.company_brain_operational_incidents
      where fingerprint = incident_fingerprint and status in ('open','acknowledged')
      for update;
      if incident_row.id is not null then
        perform public.transition_company_brain_incident(
          incident_row.id, 'resolved', 'company-brain-scanner',
          'Ein späterer erfolgreicher Workflow-Beleg hat denselben Fall und dieselbe Aktion abgeschlossen.'
        );
        resolved_count := resolved_count + 1;
      end if;
    end if;
  end loop;

  for action_row in
    select * from public.company_brain_action_runs
    where (status = 'awaiting_approval' and proposed_at < now() - interval '24 hours')
       or (status in ('executing','verifying') and coalesce(execution_started_at, updated_at) < now() - interval '15 minutes')
       or (status in ('failed','blocked') and updated_at >= now() - interval '7 days')
  loop
    cause_code := case
      when action_row.status = 'awaiting_approval' then 'action_awaiting_approval'
      when action_row.status in ('executing','verifying') then 'action_execution_stuck'
      else 'action_' || action_row.status
    end;
    incident_fingerprint := case when action_row.status in ('failed','blocked') then 'action_failure:' else 'action_stuck:' end || action_row.id::text;
    perform public.upsert_company_brain_incident(
      incident_fingerprint,
      case when action_row.status in ('failed','blocked') then 'action_failure' else 'stuck_action' end,
      case when action_row.status in ('executing','verifying','failed') then 'critical' else 'warning' end,
      'Company-Brain-Aktion ' || action_row.action_key || ' ist ' || action_row.status,
      coalesce(nullif(action_row.failure_detail,''), 'Action Run braucht eine operative Prüfung.'),
      cause_code, 'stuck_action', 1, null, action_row.case_key, action_row.request_id,
      null, null, null, 'supabase', 'company_brain_action_run:' || action_row.id::text,
      jsonb_build_array('company_brain_action_run:' || action_row.id::text),
      'operations', jsonb_build_object('action_run_id', action_row.id, 'action_key', action_row.action_key, 'status', action_row.status),
      'company-brain-scanner', true
    );
    detected_count := detected_count + 1;
  end loop;

  for incident_row in
    select incident.* from public.company_brain_operational_incidents incident
    where incident.incident_type = 'stuck_action'
      and incident.status in ('open','acknowledged')
      and not exists (
        select 1 from public.company_brain_action_runs run
        where run.id::text = incident.metadata->>'action_run_id'
          and ((run.status = 'awaiting_approval' and run.proposed_at < now() - interval '24 hours')
            or (run.status in ('executing','verifying') and coalesce(run.execution_started_at, run.updated_at) < now() - interval '15 minutes'))
      )
  loop
    perform public.transition_company_brain_incident(
      incident_row.id, 'resolved', 'company-brain-scanner',
      'Der Action Run ist nicht mehr überfällig oder befindet sich inzwischen in einem terminalen Status.'
    );
    resolved_count := resolved_count + 1;
  end loop;

  for review_row in select * from public.company_identity_review_queue where status = 'open'
  loop
    perform public.upsert_company_brain_incident(
      'identity_review:' || review_row.id::text, 'identity_conflict',
      case when review_row.created_at < now() - interval '24 hours' then 'critical' else 'warning' end,
      'Identitätsprüfung offen: ' || review_row.reason_code,
      review_row.summary, 'identity_review_open', 'identity_conflict', 1,
      review_row.proposed_entity_id, review_row.correlation_id, null, null, null, null,
      review_row.source_key, 'identity_review:' || review_row.id::text,
      coalesce(review_row.evidence_refs, '[]'::jsonb), 'operations',
      jsonb_build_object('review_id', review_row.id, 'reason_code', review_row.reason_code),
      'company-brain-scanner', true
    );
    detected_count := detected_count + 1;
  end loop;

  for incident_row in
    select incident.* from public.company_brain_operational_incidents incident
    where incident.incident_type = 'identity_conflict' and incident.status in ('open','acknowledged')
      and not exists (
        select 1 from public.company_identity_review_queue review
        where review.id::text = incident.metadata->>'review_id' and review.status = 'open'
      )
  loop
    perform public.transition_company_brain_incident(
      incident_row.id, 'resolved', 'company-brain-scanner',
      'Die Identitätsprüfung wurde fachlich abgeschlossen.'
    );
    resolved_count := resolved_count + 1;
  end loop;

  for quality_row in select * from public.company_data_quality_issues where status in ('open','acknowledged')
  loop
    perform public.upsert_company_brain_incident(
      'data_quality:' || quality_row.id::text, 'data_quality_issue', quality_row.severity,
      quality_row.title, quality_row.detail, quality_row.issue_type, 'data_quality_issue', 1,
      quality_row.entity_id, quality_row.issue_key, null, null, null, null,
      quality_row.source_key, 'data_quality_issue:' || quality_row.id::text,
      to_jsonb(quality_row.evidence_ids), 'engineering',
      jsonb_build_object('quality_issue_id', quality_row.id, 'detected_by', quality_row.detected_by),
      'company-brain-scanner', true
    );
    detected_count := detected_count + 1;
  end loop;

  for incident_row in
    select incident.* from public.company_brain_operational_incidents incident
    where incident.incident_type = 'data_quality_issue' and incident.status in ('open','acknowledged')
      and not exists (
        select 1 from public.company_data_quality_issues issue
        where issue.id::text = incident.metadata->>'quality_issue_id' and issue.status in ('open','acknowledged')
      )
  loop
    perform public.transition_company_brain_incident(
      incident_row.id, 'resolved', 'company-brain-scanner',
      'Das zugrunde liegende Datenqualitätsproblem wurde abgeschlossen.'
    );
    resolved_count := resolved_count + 1;
  end loop;

  return query select detected_count, resolved_count;
end;
$$;

create or replace function public.approve_company_brain_action_run(
  p_action_run_id uuid,
  p_actor text,
  p_note text default null
)
returns public.company_brain_action_runs
language plpgsql
security invoker
set search_path = public
as $$
declare
  action_run public.company_brain_action_runs;
  normalized_actor text := lower(btrim(p_actor));
begin
  if normalized_actor = '' then raise exception 'company_brain_actor_required'; end if;
  select * into action_run from public.company_brain_action_runs where id = p_action_run_id for update;
  if action_run.id is null then raise exception 'company_brain_action_run_not_found'; end if;
  if action_run.status <> 'awaiting_approval' then raise exception 'company_brain_action_run_not_open'; end if;
  if normalized_actor = action_run.proposed_by then raise exception 'company_brain_four_eyes_required'; end if;
  if not exists (
    select 1 from public.company_brain_actor_roles
    where actor_email = normalized_actor and active
      and (expires_at is null or expires_at > now())
      and role in ('approver', 'company_admin')
  ) then raise exception 'company_brain_approver_role_required'; end if;
  insert into public.company_brain_action_approvals (action_run_id, decision, decided_by, note, input_hash)
  values (action_run.id, 'approved', normalized_actor, nullif(btrim(p_note), ''), action_run.input_hash);
  update public.company_brain_action_runs
  set status = 'executing', approved_by = normalized_actor, approved_at = now(), execution_started_at = now()
  where id = action_run.id returning * into action_run;
  return action_run;
end;
$$;

alter table public.company_brain_playbooks enable row level security;
alter table public.company_brain_operational_incidents enable row level security;
alter table public.company_brain_incident_events enable row level security;

revoke all on table public.company_brain_playbooks from public, anon, authenticated;
revoke all on table public.company_brain_operational_incidents from public, anon, authenticated;
revoke all on table public.company_brain_incident_events from public, anon, authenticated;
grant select, insert, update, delete on table public.company_brain_playbooks to service_role;
grant select, insert, update on table public.company_brain_operational_incidents to service_role;
grant select, insert on table public.company_brain_incident_events to service_role;

drop policy if exists company_brain_playbooks_service_role_all on public.company_brain_playbooks;
create policy company_brain_playbooks_service_role_all on public.company_brain_playbooks
  for all to service_role using (true) with check (true);
drop policy if exists company_brain_operational_incidents_service_role_all on public.company_brain_operational_incidents;
create policy company_brain_operational_incidents_service_role_all on public.company_brain_operational_incidents
  for all to service_role using (true) with check (true);
drop policy if exists company_brain_incident_events_service_role_all on public.company_brain_incident_events;
create policy company_brain_incident_events_service_role_all on public.company_brain_incident_events
  for all to service_role using (true) with check (true);

revoke all on function public.guard_company_brain_incident_event_immutable() from public, anon, authenticated;
revoke all on function public.upsert_company_brain_incident(text,text,text,text,text,text,text,integer,uuid,text,text,text,text,text,text,text,jsonb,text,jsonb,text,boolean) from public, anon, authenticated;
revoke all on function public.transition_company_brain_incident(uuid,text,text,text,text) from public, anon, authenticated;
revoke all on function public.scan_company_brain_operational_incidents() from public, anon, authenticated;
grant execute on function public.upsert_company_brain_incident(text,text,text,text,text,text,text,integer,uuid,text,text,text,text,text,text,text,jsonb,text,jsonb,text,boolean) to service_role;
grant execute on function public.transition_company_brain_incident(uuid,text,text,text,text) to service_role;
grant execute on function public.scan_company_brain_operational_incidents() to service_role;

create extension if not exists pg_cron with schema pg_catalog;

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname = 'company-brain-operational-scan';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  perform cron.schedule(
    'company-brain-operational-scan',
    '*/5 * * * *',
    'select public.scan_company_brain_operational_incidents();'
  );
end;
$$;

comment on table public.company_brain_playbooks is 'Versioned, deterministic repair guidance. AI may explain but cannot authorize actions.';
comment on table public.company_brain_operational_incidents is 'Durable idempotent operational problem queue backed by source evidence.';
comment on table public.company_brain_incident_events is 'Append-only audit trail for incident lifecycle changes.';
