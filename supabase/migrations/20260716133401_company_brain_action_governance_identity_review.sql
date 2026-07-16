-- Company Brain action governance and deterministic identity review.
-- All access stays server-side through the service role.

create table if not exists public.company_brain_actor_roles (
  actor_email text not null,
  role text not null,
  active boolean not null default true,
  granted_by text not null,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (actor_email, role),
  constraint company_brain_actor_roles_email_check check (
    actor_email = lower(btrim(actor_email))
    and actor_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint company_brain_actor_roles_role_check check (
    role in ('viewer', 'operator', 'approver', 'automation_admin', 'company_admin')
  )
);

create table if not exists public.company_brain_action_policies (
  action_key text primary key,
  risk_level text not null,
  minimum_role text not null,
  approval_role text,
  requires_four_eyes boolean not null default false,
  customer_side_effect boolean not null default false,
  description text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_brain_action_policies_key_check check (
    action_key ~ '^[a-z0-9][a-z0-9_]{2,79}$'
  ),
  constraint company_brain_action_policies_risk_check check (
    risk_level in ('low', 'medium', 'high', 'critical')
  ),
  constraint company_brain_action_policies_role_check check (
    minimum_role in ('viewer', 'operator', 'approver', 'automation_admin', 'company_admin')
    and (
      approval_role is null
      or approval_role in ('approver', 'automation_admin', 'company_admin')
    )
  ),
  constraint company_brain_action_policies_four_eyes_check check (
    not requires_four_eyes or approval_role is not null
  )
);

create table if not exists public.company_brain_action_runs (
  id uuid primary key default gen_random_uuid(),
  action_key text not null references public.company_brain_action_policies(action_key),
  case_key text not null,
  request_id text,
  risk_level text not null,
  status text not null default 'proposed',
  proposed_by text not null,
  approved_by text,
  idempotency_key text not null unique,
  input_hash text not null,
  frozen_input jsonb not null,
  source_snapshot jsonb not null default '{}'::jsonb,
  preview jsonb not null default '{}'::jsonb,
  execution_result jsonb,
  verification_result jsonb,
  failure_code text,
  failure_detail text,
  rollback_plan text,
  proposed_at timestamptz not null default now(),
  approved_at timestamptz,
  execution_started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint company_brain_action_runs_risk_check check (
    risk_level in ('low', 'medium', 'high', 'critical')
  ),
  constraint company_brain_action_runs_status_check check (
    status in (
      'proposed', 'awaiting_approval', 'approved', 'executing',
      'verifying', 'resolved', 'blocked', 'failed', 'rejected', 'cancelled'
    )
  ),
  constraint company_brain_action_runs_input_check check (
    jsonb_typeof(frozen_input) = 'object'
    and jsonb_typeof(source_snapshot) = 'object'
    and jsonb_typeof(preview) = 'object'
    and (execution_result is null or jsonb_typeof(execution_result) = 'object')
    and (verification_result is null or jsonb_typeof(verification_result) = 'object')
  ),
  constraint company_brain_action_runs_four_eyes_check check (
    approved_by is null or approved_by <> proposed_by
  )
);

create table if not exists public.company_brain_action_approvals (
  id uuid primary key default gen_random_uuid(),
  action_run_id uuid not null references public.company_brain_action_runs(id) on delete cascade,
  decision text not null,
  decided_by text not null,
  note text,
  input_hash text not null,
  decided_at timestamptz not null default now(),
  constraint company_brain_action_approvals_decision_check check (
    decision in ('approved', 'rejected')
  ),
  constraint company_brain_action_approvals_actor_key unique (
    action_run_id, decided_by
  )
);

create table if not exists public.company_identity_review_queue (
  id uuid primary key default gen_random_uuid(),
  review_key text not null unique,
  status text not null default 'open',
  source_key text not null references public.company_source_registry(source_key),
  alias_type text not null,
  alias_value_hash text not null,
  candidate_entity_ids uuid[] not null default '{}',
  proposed_entity_id uuid references public.company_entity_registry(id) on delete set null,
  confidence numeric(5,4),
  reason_code text not null,
  summary text not null,
  evidence_refs jsonb not null default '[]'::jsonb,
  proposed_resolution jsonb not null default '{}'::jsonb,
  resolver_version text not null,
  correlation_id text,
  reviewed_by text,
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_identity_review_queue_status_check check (
    status in ('open', 'confirmed', 'rejected', 'superseded')
  ),
  constraint company_identity_review_queue_confidence_check check (
    confidence is null or confidence between 0 and 1
  ),
  constraint company_identity_review_queue_evidence_check check (
    jsonb_typeof(evidence_refs) = 'array'
    and jsonb_typeof(proposed_resolution) = 'object'
  ),
  constraint company_identity_review_queue_review_check check (
    status = 'open'
    or (reviewed_by is not null and reviewed_at is not null)
  )
);

create index if not exists company_brain_actor_roles_active_idx
  on public.company_brain_actor_roles (actor_email, active, role);
create index if not exists company_brain_action_runs_case_idx
  on public.company_brain_action_runs (case_key, proposed_at desc);
create index if not exists company_brain_action_runs_queue_idx
  on public.company_brain_action_runs (status, risk_level, proposed_at)
  where status in ('proposed', 'awaiting_approval', 'approved', 'executing', 'verifying');
create index if not exists company_brain_action_approvals_run_idx
  on public.company_brain_action_approvals (action_run_id, decided_at desc);
create index if not exists company_identity_review_queue_open_idx
  on public.company_identity_review_queue (status, confidence desc nulls last, created_at)
  where status = 'open';

create or replace function public.guard_company_brain_action_run_input()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.action_key <> new.action_key
    or old.case_key <> new.case_key
    or old.request_id is distinct from new.request_id
    or old.proposed_by <> new.proposed_by
    or old.idempotency_key <> new.idempotency_key
    or old.input_hash <> new.input_hash
    or old.frozen_input <> new.frozen_input
    or old.source_snapshot <> new.source_snapshot
  then
    raise exception 'company_brain_action_run_input_is_immutable';
  end if;
  return new;
end;
$$;

create or replace function public.guard_company_brain_action_approval()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  action_run public.company_brain_action_runs;
begin
  select * into action_run
  from public.company_brain_action_runs
  where id = new.action_run_id
  for update;

  if action_run.id is null then
    raise exception 'company_brain_action_run_not_found';
  end if;
  if new.decided_by = action_run.proposed_by then
    raise exception 'company_brain_four_eyes_required';
  end if;
  if new.input_hash <> action_run.input_hash then
    raise exception 'company_brain_action_input_hash_mismatch';
  end if;
  return new;
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
  if normalized_actor = '' then
    raise exception 'company_brain_actor_required';
  end if;

  select * into action_run
  from public.company_brain_action_runs
  where id = p_action_run_id
  for update;

  if action_run.id is null then
    raise exception 'company_brain_action_run_not_found';
  end if;
  if action_run.status <> 'awaiting_approval' then
    raise exception 'company_brain_action_run_not_open';
  end if;
  if normalized_actor = action_run.proposed_by then
    raise exception 'company_brain_four_eyes_required';
  end if;
  if not exists (
    select 1
    from public.company_brain_actor_roles
    where actor_email = normalized_actor
      and active
      and role in ('approver', 'company_admin')
  ) then
    raise exception 'company_brain_approver_role_required';
  end if;

  insert into public.company_brain_action_approvals (
    action_run_id, decision, decided_by, note, input_hash
  )
  values (
    action_run.id, 'approved', normalized_actor, nullif(btrim(p_note), ''), action_run.input_hash
  );

  update public.company_brain_action_runs
  set status = 'executing',
      approved_by = normalized_actor,
      approved_at = now(),
      execution_started_at = now()
  where id = action_run.id
  returning * into action_run;

  return action_run;
end;
$$;

drop trigger if exists trg_company_brain_actor_roles_updated_at on public.company_brain_actor_roles;
create trigger trg_company_brain_actor_roles_updated_at
before update on public.company_brain_actor_roles
for each row execute function public.touch_company_brain_updated_at();

drop trigger if exists trg_company_brain_action_policies_updated_at on public.company_brain_action_policies;
create trigger trg_company_brain_action_policies_updated_at
before update on public.company_brain_action_policies
for each row execute function public.touch_company_brain_updated_at();

drop trigger if exists trg_company_brain_action_runs_updated_at on public.company_brain_action_runs;
create trigger trg_company_brain_action_runs_updated_at
before update on public.company_brain_action_runs
for each row execute function public.touch_company_brain_updated_at();

drop trigger if exists trg_company_brain_action_runs_immutable on public.company_brain_action_runs;
create trigger trg_company_brain_action_runs_immutable
before update on public.company_brain_action_runs
for each row execute function public.guard_company_brain_action_run_input();

drop trigger if exists trg_company_brain_action_approvals_guard on public.company_brain_action_approvals;
create trigger trg_company_brain_action_approvals_guard
before insert on public.company_brain_action_approvals
for each row execute function public.guard_company_brain_action_approval();

drop trigger if exists trg_company_identity_review_queue_updated_at on public.company_identity_review_queue;
create trigger trg_company_identity_review_queue_updated_at
before update on public.company_identity_review_queue
for each row execute function public.touch_company_brain_updated_at();

insert into public.company_brain_action_policies (
  action_key, risk_level, minimum_role, approval_role,
  requires_four_eyes, customer_side_effect, description
)
values
  ('open_problem_case', 'low', 'operator', null, false, false, 'Creates an internal problem case and task.'),
  ('create_internal_task', 'low', 'operator', null, false, false, 'Creates an internal task without customer contact.'),
  ('save_case_note', 'low', 'operator', null, false, false, 'Stores an internal evidence-based case note.'),
  ('prepare_email_correction', 'low', 'operator', null, false, false, 'Prepares an internal email correction task.'),
  ('correct_customer_email', 'high', 'operator', 'approver', true, false, 'Changes canonical customer contact data.'),
  ('post_trello_status_comment', 'medium', 'operator', null, false, false, 'Writes a projection-only Trello status comment.'),
  ('repair_trello_projection', 'medium', 'operator', null, false, false, 'Repairs Trello only after authoritative send evidence.'),
  ('prepare_offer_retry', 'low', 'operator', null, false, false, 'Prepares an internal retry task.'),
  ('guarded_offer_resend', 'critical', 'operator', 'approver', true, true, 'Sends an offer after duplicate, ownership and delivery checks.'),
  ('repair_trello_alias', 'high', 'operator', 'approver', true, false, 'Changes cross-system Trello-to-request identity mapping.'),
  ('sync_n8n_workflows', 'medium', 'automation_admin', null, false, false, 'Reads n8n workflow metadata into the governed registry.'),
  ('approve_company_decision', 'high', 'approver', 'approver', true, false, 'Makes a governed company decision effective.')
on conflict (action_key) do update
set risk_level = excluded.risk_level,
    minimum_role = excluded.minimum_role,
    approval_role = excluded.approval_role,
    requires_four_eyes = excluded.requires_four_eyes,
    customer_side_effect = excluded.customer_side_effect,
    description = excluded.description,
    active = true;

insert into public.company_brain_actor_roles (
  actor_email, role, granted_by, reason
)
values
  ('daniel@neontrip.de', 'company_admin', 'migration:20260716133401', 'Initial Company Brain governance owner.')
on conflict (actor_email, role) do nothing;

comment on table public.company_brain_actor_roles is 'Explicit Company Brain role grants for verified Cloudflare Access identities.';
comment on table public.company_brain_action_policies is 'Server-side risk and approval contracts for every executable Company Brain action.';
comment on table public.company_brain_action_runs is 'Immutable action proposals with execution, verification and rollback evidence.';
comment on table public.company_brain_action_approvals is 'Append-only four-eyes decisions for Company Brain action runs.';
comment on table public.company_identity_review_queue is 'Manual review queue for ambiguous or conflicting cross-system identities.';

alter table public.company_brain_actor_roles enable row level security;
alter table public.company_brain_action_policies enable row level security;
alter table public.company_brain_action_runs enable row level security;
alter table public.company_brain_action_approvals enable row level security;
alter table public.company_identity_review_queue enable row level security;

revoke all on table public.company_brain_actor_roles from public, anon, authenticated;
revoke all on table public.company_brain_action_policies from public, anon, authenticated;
revoke all on table public.company_brain_action_runs from public, anon, authenticated;
revoke all on table public.company_brain_action_approvals from public, anon, authenticated;
revoke all on table public.company_identity_review_queue from public, anon, authenticated;

grant select, insert, update, delete on table public.company_brain_actor_roles to service_role;
grant select, insert, update, delete on table public.company_brain_action_policies to service_role;
grant select, insert, update on table public.company_brain_action_runs to service_role;
grant select, insert on table public.company_brain_action_approvals to service_role;
grant select, insert, update on table public.company_identity_review_queue to service_role;

revoke all on function public.guard_company_brain_action_run_input() from public, anon, authenticated;
revoke all on function public.guard_company_brain_action_approval() from public, anon, authenticated;
revoke all on function public.approve_company_brain_action_run(uuid, text, text) from public, anon, authenticated;
grant execute on function public.approve_company_brain_action_run(uuid, text, text) to service_role;

do $$
declare
  target_table text;
  policy_name text;
begin
  foreach target_table in array array[
    'company_brain_actor_roles',
    'company_brain_action_policies',
    'company_brain_action_runs',
    'company_brain_action_approvals',
    'company_identity_review_queue'
  ] loop
    policy_name := target_table || '_service_role_all';
    execute format('drop policy if exists %I on public.%I', policy_name, target_table);
    execute format(
      'create policy %I on public.%I for all to service_role using (true) with check (true)',
      policy_name,
      target_table
    );
  end loop;
end;
$$;
