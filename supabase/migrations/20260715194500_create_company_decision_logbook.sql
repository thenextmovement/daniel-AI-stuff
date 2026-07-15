-- Governed decision history. Decisions are versioned and superseded, never
-- overwritten in place after approval.

create table if not exists public.company_decisions (
  id uuid primary key default gen_random_uuid(),
  decision_key text not null,
  version_number integer not null default 1,
  decision_type text not null default 'decision',
  status text not null default 'draft',
  title text not null,
  scope_type text not null,
  scope_key text not null,
  owner_team text not null,
  objective text not null,
  problem_statement text not null,
  context text not null,
  constraints jsonb not null default '[]'::jsonb,
  options jsonb not null,
  chosen_option text,
  rationale text,
  assumptions jsonb not null default '[]'::jsonb,
  expected_outcomes jsonb not null default '[]'::jsonb,
  risks jsonb not null default '[]'::jsonb,
  guardrails jsonb not null default '[]'::jsonb,
  consequences jsonb not null default '[]'::jsonb,
  rollback_plan text,
  supersedes_decision_id uuid references public.company_decisions(id) on delete set null,
  decided_at timestamptz,
  review_at timestamptz not null,
  valid_from timestamptz,
  valid_until timestamptz,
  created_by text not null,
  submitted_by text,
  submitted_at timestamptz,
  approved_by text,
  approved_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_decisions_key_version unique (decision_key, version_number),
  constraint company_decisions_key_check check (decision_key ~ '^[a-z0-9][a-z0-9_.-]{2,119}$'),
  constraint company_decisions_version_check check (version_number > 0),
  constraint company_decisions_type_check check (
    decision_type in ('decision', 'policy', 'architecture', 'incident_resolution', 'experiment')
  ),
  constraint company_decisions_status_check check (
    status in ('draft', 'review', 'approved', 'superseded', 'reversed', 'expired')
  ),
  constraint company_decisions_scope_check check (
    scope_type in ('global', 'team', 'process', 'entity', 'workflow', 'metric')
    and char_length(btrim(scope_key)) between 1 and 200
  ),
  constraint company_decisions_required_text_check check (
    char_length(btrim(title)) between 3 and 240
    and char_length(btrim(objective)) between 10 and 4000
    and char_length(btrim(problem_statement)) between 10 and 4000
    and char_length(btrim(context)) between 10 and 12000
  ),
  constraint company_decisions_payload_check check (
    jsonb_typeof(constraints) = 'array'
    and jsonb_typeof(options) = 'array'
    and jsonb_array_length(options) >= 1
    and jsonb_typeof(assumptions) = 'array'
    and jsonb_typeof(expected_outcomes) = 'array'
    and jsonb_typeof(risks) = 'array'
    and jsonb_typeof(guardrails) = 'array'
    and jsonb_typeof(consequences) = 'array'
  ),
  constraint company_decisions_submission_check check (
    status = 'draft' or (submitted_by is not null and submitted_at is not null)
  ),
  constraint company_decisions_approval_check check (
    status not in ('approved', 'superseded', 'reversed', 'expired')
    or (
      approved_by is not null and approved_at is not null and decided_at is not null
      and chosen_option is not null and rationale is not null and rollback_plan is not null
      and valid_from is not null
    )
  ),
  constraint company_decisions_validity_check check (
    valid_until is null or valid_from is null or valid_until > valid_from
  ),
  constraint company_decisions_review_check check (
    status <> 'approved' or review_at > approved_at
  )
);

create unique index if not exists company_decisions_one_active_version_idx
  on public.company_decisions (decision_key)
  where status = 'approved';
create index if not exists company_decisions_scope_status_idx
  on public.company_decisions (scope_type, scope_key, status, valid_from desc nulls last);
create index if not exists company_decisions_review_due_idx
  on public.company_decisions (review_at, owner_team)
  where status = 'approved';

create table if not exists public.company_decision_evidence (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.company_decisions(id) on delete cascade,
  evidence_id uuid references public.company_evidence(id) on delete restrict,
  source_key text references public.company_source_registry(source_key),
  source_ref text,
  evidence_role text not null default 'supporting',
  summary text not null,
  snapshot_hash text,
  created_by text not null,
  created_at timestamptz not null default now(),
  constraint company_decision_evidence_source_check check (
    evidence_id is not null or (source_key is not null and source_ref is not null)
  ),
  constraint company_decision_evidence_role_check check (
    evidence_role in ('supporting', 'opposing', 'constraint', 'outcome')
  ),
  constraint company_decision_evidence_summary_check check (char_length(btrim(summary)) between 3 and 2000)
);

create unique index if not exists company_decision_evidence_record_key
  on public.company_decision_evidence (
    decision_id,
    coalesce(evidence_id::text, ''),
    coalesce(source_key, ''),
    coalesce(source_ref, ''),
    evidence_role
  );
create index if not exists company_decision_evidence_decision_idx
  on public.company_decision_evidence (decision_id, created_at);

create table if not exists public.company_decision_outcomes (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.company_decisions(id) on delete cascade,
  outcome_key text not null,
  metric_key text,
  baseline_value numeric,
  target_value numeric,
  actual_value numeric,
  unit text,
  evaluation_status text not null default 'pending',
  evaluation_start timestamptz,
  evaluation_end timestamptz not null,
  observed_at timestamptz,
  finding text,
  lessons_learned text,
  evidence_refs jsonb not null default '[]'::jsonb,
  recorded_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_decision_outcomes_key unique (decision_id, outcome_key),
  constraint company_decision_outcomes_status_check check (
    evaluation_status in ('pending', 'met', 'missed', 'inconclusive', 'cancelled')
  ),
  constraint company_decision_outcomes_period_check check (
    evaluation_start is null or evaluation_end > evaluation_start
  ),
  constraint company_decision_outcomes_result_check check (
    evaluation_status = 'pending'
    or (observed_at is not null and finding is not null)
  ),
  constraint company_decision_outcomes_evidence_check check (jsonb_typeof(evidence_refs) = 'array')
);

create index if not exists company_decision_outcomes_due_idx
  on public.company_decision_outcomes (evaluation_end, evaluation_status);

create table if not exists public.company_decision_audit_log (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.company_decisions(id) on delete restrict,
  action text not null,
  from_status text,
  to_status text not null,
  actor text not null,
  correlation_id text not null,
  note text,
  snapshot jsonb not null,
  occurred_at timestamptz not null default now(),
  constraint company_decision_audit_action_check check (
    action in ('created', 'submitted', 'approved', 'changes_requested', 'superseded', 'reversed', 'expired', 'outcome_recorded')
  ),
  constraint company_decision_audit_snapshot_check check (jsonb_typeof(snapshot) = 'object')
);

create index if not exists company_decision_audit_decision_time_idx
  on public.company_decision_audit_log (decision_id, occurred_at desc);
create index if not exists company_decision_audit_correlation_idx
  on public.company_decision_audit_log (correlation_id, occurred_at desc);

drop trigger if exists trg_company_decisions_updated_at on public.company_decisions;
create trigger trg_company_decisions_updated_at
before update on public.company_decisions
for each row execute function public.touch_company_brain_updated_at();

drop trigger if exists trg_company_decision_outcomes_updated_at on public.company_decision_outcomes;
create trigger trg_company_decision_outcomes_updated_at
before update on public.company_decision_outcomes
for each row execute function public.touch_company_brain_updated_at();

create or replace function public.guard_company_decision_immutability()
returns trigger
language plpgsql
as $$
begin
  if old.status in ('approved', 'superseded', 'reversed', 'expired')
    and coalesce(current_setting('app.company_decision_transition', true), '') <> 'allowed' then
    raise exception 'approved_decision_is_immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists trg_company_decisions_immutable on public.company_decisions;
create trigger trg_company_decisions_immutable
before update or delete on public.company_decisions
for each row execute function public.guard_company_decision_immutability();

create or replace function public.create_company_decision_draft(
  p_payload jsonb
)
returns public.company_decisions
language plpgsql
security invoker
set search_path = public
as $$
declare
  decision_row public.company_decisions;
  normalized_key text := lower(btrim(p_payload ->> 'decision_key'));
  next_version integer;
begin
  if normalized_key is null or normalized_key !~ '^[a-z0-9][a-z0-9_.-]{2,119}$' then
    raise exception 'invalid_decision_key';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('company_decision:' || normalized_key, 0));
  select coalesce(max(version_number), 0) + 1
  into next_version
  from public.company_decisions
  where decision_key = normalized_key;

  insert into public.company_decisions (
    decision_key, version_number, decision_type, status, title, scope_type, scope_key,
    owner_team, objective, problem_statement, context, constraints, options,
    chosen_option, rationale, assumptions, expected_outcomes, risks, guardrails,
    consequences, rollback_plan, review_at, valid_from, valid_until, created_by
  ) values (
    normalized_key,
    next_version,
    coalesce(nullif(btrim(p_payload ->> 'decision_type'), ''), 'decision'),
    'draft',
    p_payload ->> 'title',
    p_payload ->> 'scope_type',
    p_payload ->> 'scope_key',
    p_payload ->> 'owner_team',
    p_payload ->> 'objective',
    p_payload ->> 'problem_statement',
    p_payload ->> 'context',
    coalesce(p_payload -> 'constraints', '[]'::jsonb),
    coalesce(p_payload -> 'options', '[]'::jsonb),
    nullif(btrim(p_payload ->> 'chosen_option'), ''),
    nullif(btrim(p_payload ->> 'rationale'), ''),
    coalesce(p_payload -> 'assumptions', '[]'::jsonb),
    coalesce(p_payload -> 'expected_outcomes', '[]'::jsonb),
    coalesce(p_payload -> 'risks', '[]'::jsonb),
    coalesce(p_payload -> 'guardrails', '[]'::jsonb),
    coalesce(p_payload -> 'consequences', '[]'::jsonb),
    nullif(btrim(p_payload ->> 'rollback_plan'), ''),
    (p_payload ->> 'review_at')::timestamptz,
    nullif(p_payload ->> 'valid_from', '')::timestamptz,
    nullif(p_payload ->> 'valid_until', '')::timestamptz,
    p_payload ->> 'created_by'
  )
  returning * into decision_row;

  insert into public.company_decision_audit_log (
    decision_id, action, from_status, to_status, actor, correlation_id, note, snapshot
  ) values (
    decision_row.id,
    'created',
    null,
    'draft',
    decision_row.created_by,
    'decision:' || decision_row.id::text || ':created',
    null,
    to_jsonb(decision_row)
  );

  return decision_row;
end;
$$;

create or replace function public.submit_company_decision(
  p_decision_id uuid,
  p_actor text,
  p_note text,
  p_correlation_id text
)
returns public.company_decisions
language plpgsql
security invoker
set search_path = public
as $$
declare
  decision_row public.company_decisions;
begin
  if nullif(btrim(p_actor), '') is null or nullif(btrim(p_correlation_id), '') is null then
    raise exception 'decision_actor_and_correlation_required';
  end if;
  select * into decision_row
  from public.company_decisions
  where id = p_decision_id
  for update;

  if not found then
    raise exception 'decision_not_found';
  end if;
  if decision_row.status <> 'draft' then
    raise exception 'decision_not_draft';
  end if;

  update public.company_decisions
  set status = 'review',
      submitted_by = btrim(p_actor),
      submitted_at = now(),
      review_note = nullif(btrim(p_note), '')
  where id = p_decision_id
  returning * into decision_row;

  insert into public.company_decision_audit_log (
    decision_id, action, from_status, to_status, actor, correlation_id, note, snapshot
  ) values (
    decision_row.id, 'submitted', 'draft', 'review', btrim(p_actor), btrim(p_correlation_id),
    nullif(btrim(p_note), ''), to_jsonb(decision_row)
  );

  return decision_row;
end;
$$;

create or replace function public.approve_company_decision(
  p_decision_id uuid,
  p_actor text,
  p_note text,
  p_correlation_id text
)
returns public.company_decisions
language plpgsql
security invoker
set search_path = public
as $$
declare
  decision_row public.company_decisions;
  prior_row public.company_decisions;
  approval_time timestamptz := now();
begin
  if nullif(btrim(p_actor), '') is null or nullif(btrim(p_correlation_id), '') is null then
    raise exception 'decision_actor_and_correlation_required';
  end if;
  select * into decision_row
  from public.company_decisions
  where id = p_decision_id
  for update;

  if not found then
    raise exception 'decision_not_found';
  end if;
  if decision_row.status <> 'review' then
    raise exception 'decision_not_in_review';
  end if;
  if nullif(btrim(decision_row.chosen_option), '') is null
    or nullif(btrim(decision_row.rationale), '') is null
    or nullif(btrim(decision_row.rollback_plan), '') is null then
    raise exception 'decision_approval_fields_missing';
  end if;
  if decision_row.review_at <= approval_time then
    raise exception 'decision_review_date_must_be_future';
  end if;

  select * into prior_row
  from public.company_decisions
  where decision_key = decision_row.decision_key
    and status = 'approved'
    and id <> decision_row.id
  for update;

  if found then
    perform set_config('app.company_decision_transition', 'allowed', true);
    update public.company_decisions
    set status = 'superseded',
        valid_until = approval_time,
        review_note = concat_ws(' | ', nullif(review_note, ''), 'Superseded by ' || decision_row.id::text)
    where id = prior_row.id;

    update public.company_decisions
    set supersedes_decision_id = prior_row.id
    where id = decision_row.id;

    insert into public.company_decision_audit_log (
      decision_id, action, from_status, to_status, actor, correlation_id, note, snapshot
    ) values (
      prior_row.id, 'superseded', 'approved', 'superseded', btrim(p_actor), btrim(p_correlation_id),
      'Superseded by ' || decision_row.id::text, to_jsonb(prior_row)
    );
  end if;

  update public.company_decisions
  set status = 'approved',
      approved_by = btrim(p_actor),
      approved_at = approval_time,
      decided_at = coalesce(decided_at, approval_time),
      valid_from = coalesce(valid_from, approval_time),
      review_note = nullif(btrim(p_note), '')
  where id = p_decision_id
  returning * into decision_row;

  insert into public.company_decision_audit_log (
    decision_id, action, from_status, to_status, actor, correlation_id, note, snapshot
  ) values (
    decision_row.id, 'approved', 'review', 'approved', btrim(p_actor), btrim(p_correlation_id),
    nullif(btrim(p_note), ''), to_jsonb(decision_row)
  );

  insert into public.company_events (
    event_key, event_type, request_id, correlation_id, source_key, source_ref,
    trust_class, occurred_at, payload
  ) values (
    'decision-approved:' || decision_row.id::text,
    'decision.approved',
    case when decision_row.scope_type = 'entity' and decision_row.scope_key like 'request:%'
      then split_part(decision_row.scope_key, ':', 2) else null end,
    btrim(p_correlation_id),
    'ops_manual',
    'company_decisions:' || decision_row.id::text,
    'authoritative',
    approval_time,
    jsonb_build_object(
      'decision_id', decision_row.id,
      'decision_key', decision_row.decision_key,
      'scope_type', decision_row.scope_type,
      'scope_key', decision_row.scope_key,
      'version_number', decision_row.version_number
    )
  ) on conflict (event_key) do nothing;

  return decision_row;
end;
$$;

create or replace function public.request_company_decision_changes(
  p_decision_id uuid,
  p_actor text,
  p_note text,
  p_correlation_id text
)
returns public.company_decisions
language plpgsql
security invoker
set search_path = public
as $$
declare
  decision_row public.company_decisions;
begin
  if nullif(btrim(p_actor), '') is null or nullif(btrim(p_correlation_id), '') is null then
    raise exception 'decision_actor_and_correlation_required';
  end if;
  if nullif(btrim(p_note), '') is null then
    raise exception 'decision_review_note_required';
  end if;

  select * into decision_row
  from public.company_decisions
  where id = p_decision_id
  for update;

  if not found then raise exception 'decision_not_found'; end if;
  if decision_row.status <> 'review' then raise exception 'decision_not_in_review'; end if;

  update public.company_decisions
  set status = 'draft', review_note = btrim(p_note)
  where id = p_decision_id
  returning * into decision_row;

  insert into public.company_decision_audit_log (
    decision_id, action, from_status, to_status, actor, correlation_id, note, snapshot
  ) values (
    decision_row.id, 'changes_requested', 'review', 'draft', btrim(p_actor), btrim(p_correlation_id),
    btrim(p_note), to_jsonb(decision_row)
  );

  return decision_row;
end;
$$;

create or replace function public.search_active_company_decisions(
  p_scopes jsonb,
  p_at timestamptz default now(),
  p_limit integer default 20
)
returns table (
  id uuid,
  decision_key text,
  version_number integer,
  decision_type text,
  title text,
  scope_type text,
  scope_key text,
  owner_team text,
  objective text,
  chosen_option text,
  rationale text,
  guardrails jsonb,
  consequences jsonb,
  rollback_plan text,
  decided_at timestamptz,
  review_at timestamptz,
  valid_from timestamptz,
  valid_until timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  with requested_scopes as (
    select
      nullif(btrim(scope ->> 'scopeType'), '') as scope_type,
      nullif(btrim(scope ->> 'scopeKey'), '') as scope_key
    from jsonb_array_elements(
      case when jsonb_typeof(coalesce(p_scopes, '[]'::jsonb)) = 'array'
        then coalesce(p_scopes, '[]'::jsonb) else '[]'::jsonb end
    ) as scope
  )
  select
    decision.id,
    decision.decision_key,
    decision.version_number,
    decision.decision_type,
    decision.title,
    decision.scope_type,
    decision.scope_key,
    decision.owner_team,
    decision.objective,
    decision.chosen_option,
    decision.rationale,
    decision.guardrails,
    decision.consequences,
    decision.rollback_plan,
    decision.decided_at,
    decision.review_at,
    decision.valid_from,
    decision.valid_until
  from public.company_decisions as decision
  where decision.status = 'approved'
    and decision.valid_from <= p_at
    and (decision.valid_until is null or decision.valid_until > p_at)
    and (
      (decision.scope_type = 'global' and decision.scope_key = '*')
      or exists (
        select 1
        from requested_scopes as requested
        where requested.scope_type = decision.scope_type
          and requested.scope_key = decision.scope_key
      )
    )
  order by
    case when decision.scope_type = 'global' then 1 else 0 end,
    decision.valid_from desc,
    decision.version_number desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

insert into public.company_decisions (
  decision_key, version_number, decision_type, status, title, scope_type, scope_key,
  owner_team, objective, problem_statement, context, constraints, options,
  chosen_option, rationale, assumptions, expected_outcomes, risks, guardrails,
  consequences, rollback_plan, decided_at, review_at, valid_from,
  created_by, submitted_by, submitted_at, approved_by, approved_at, review_note
)
values (
  'company-brain-foundation', 1, 'architecture', 'approved',
  'Company Brain als governte Zugriffs- und Entscheidungsschicht',
  'global', '*', 'management',
  'Operative Fakten, Entscheidungen und Wissen nachvollziehbar verbinden, ohne Trello oder KI zur Source of Truth zu machen.',
  'Die vorhandenen Systeme enthalten viele Belege, aber keine einheitliche Identitaets-, Evidenz- und Entscheidungsstruktur.',
  'Die Umsetzung der freigegebenen Phasen 0 bis 3 schafft die kontrollierte Grundlage vor Retrieval-Ausbau und autonomen Aktionen.',
  '["Postgres bleibt Source of Truth", "Trello bleibt Projektion", "Kundenkommunikation bleibt freigabepflichtig"]'::jsonb,
  '[{"key":"governed_control_plane","label":"Relationale Control Plane in Postgres"},{"key":"document_rag","label":"Reine Dokumenten- und Vektorsuche"},{"key":"graph_database","label":"Separates Graph-Datenbanksystem"}]'::jsonb,
  'governed_control_plane',
  'Die relationale Control Plane nutzt bestehende Postgres-Sicherheits- und Betriebsmodelle und behebt Identitaets- und Provenienzprobleme vor semantischer Suche.',
  '["Bestehende operative Systeme bleiben erreichbar", "Fachliche Owner reviewen Entscheidungen"]'::jsonb,
  '[{"metric":"linked_cases","target":0.98},{"metric":"evidence_coverage","target":1.0}]'::jsonb,
  '["Falsche Alias-Zuordnung", "Unvollstaendige Backfills", "Zu fruehe Automatisierung"]'::jsonb,
  '["Keine automatische Kundenkommunikation", "Idempotente Side Effects", "Menschliche Freigabe fuer Entscheidungen"]'::jsonb,
  '["Neue Tabellen und Review-Prozesse", "Schrittweise Migration statt Big Bang"]'::jsonb,
  'Neue Company-Brain-Lesewege deaktivieren und die beiden Migrationen mit den versionierten Rollback-Dateien zuruecknehmen.',
  now(), now() + interval '90 days', now(),
  'codex', 'daniel', now(), 'daniel', now(), 'Freigabe fuer Phase 0 bis 3 am 2026-07-15.'
)
on conflict (decision_key, version_number) do nothing;

insert into public.company_decision_audit_log (
  decision_id, action, from_status, to_status, actor, correlation_id, note, snapshot
)
select
  decision.id,
  'approved',
  'review',
  'approved',
  'daniel',
  'decision:company-brain-foundation:v1',
  'Freigabe fuer Phase 0 bis 3 am 2026-07-15.',
  to_jsonb(decision)
from public.company_decisions as decision
where decision.decision_key = 'company-brain-foundation'
  and decision.version_number = 1
  and not exists (
    select 1 from public.company_decision_audit_log as audit
    where audit.decision_id = decision.id and audit.action = 'approved'
  );

insert into public.company_events (
  event_key, event_type, correlation_id, source_key, source_ref,
  trust_class, occurred_at, payload
)
select
  'decision-approved:' || decision.id::text,
  'decision.approved',
  'decision:company-brain-foundation:v1',
  'ops_manual',
  'company_decisions:' || decision.id::text,
  'authoritative',
  decision.approved_at,
  jsonb_build_object(
    'decision_id', decision.id,
    'decision_key', decision.decision_key,
    'scope_type', decision.scope_type,
    'scope_key', decision.scope_key,
    'version_number', decision.version_number
  )
from public.company_decisions as decision
where decision.decision_key = 'company-brain-foundation'
  and decision.version_number = 1
on conflict (event_key) do nothing;

comment on table public.company_decisions is 'Versioned decisions and policies with goals, alternatives, rationale, validity and rollback.';
comment on table public.company_decision_evidence is 'Immutable evidence references that supported or opposed a decision.';
comment on table public.company_decision_outcomes is 'Measured consequences and lessons learned for approved decisions.';
comment on table public.company_decision_audit_log is 'Append-only lifecycle audit for the Company Brain decision logbook.';

alter table public.company_decisions enable row level security;
alter table public.company_decision_evidence enable row level security;
alter table public.company_decision_outcomes enable row level security;
alter table public.company_decision_audit_log enable row level security;

revoke all on table public.company_decisions from public, anon, authenticated;
revoke all on table public.company_decision_evidence from public, anon, authenticated;
revoke all on table public.company_decision_outcomes from public, anon, authenticated;
revoke all on table public.company_decision_audit_log from public, anon, authenticated;

grant select, insert, update on table public.company_decisions to service_role;
grant select, insert, delete on table public.company_decision_evidence to service_role;
grant select, insert, update, delete on table public.company_decision_outcomes to service_role;
grant select, insert on table public.company_decision_audit_log to service_role;

revoke all on function public.submit_company_decision(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.create_company_decision_draft(jsonb) from public, anon, authenticated;
revoke all on function public.approve_company_decision(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.request_company_decision_changes(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.search_active_company_decisions(jsonb, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.submit_company_decision(uuid, text, text, text) to service_role;
grant execute on function public.create_company_decision_draft(jsonb) to service_role;
grant execute on function public.approve_company_decision(uuid, text, text, text) to service_role;
grant execute on function public.request_company_decision_changes(uuid, text, text, text) to service_role;
grant execute on function public.search_active_company_decisions(jsonb, timestamptz, integer) to service_role;

drop policy if exists company_decisions_service_role_all on public.company_decisions;
create policy company_decisions_service_role_all on public.company_decisions
  for all to service_role using (true) with check (true);
drop policy if exists company_decision_evidence_service_role_all on public.company_decision_evidence;
create policy company_decision_evidence_service_role_all on public.company_decision_evidence
  for all to service_role using (true) with check (true);
drop policy if exists company_decision_outcomes_service_role_all on public.company_decision_outcomes;
create policy company_decision_outcomes_service_role_all on public.company_decision_outcomes
  for all to service_role using (true) with check (true);
drop policy if exists company_decision_audit_log_service_role_all on public.company_decision_audit_log;
create policy company_decision_audit_log_service_role_all on public.company_decision_audit_log
  for all to service_role using (true) with check (true);
