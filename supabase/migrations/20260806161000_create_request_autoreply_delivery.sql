-- Durable, replay-safe acknowledgement delivery for newly inserted customer requests.
--
-- The database is the source of truth. Only explicitly allowlisted request sources
-- are enqueued, there is no historical backfill, and Outlook is attempted exactly
-- once. An expired lease or ambiguous provider result is quarantined as
-- delivery_unknown and is never retried automatically.

create table if not exists public.request_autoreply_settings (
  id smallint primary key default 1 check (id = 1),
  mode text not null default 'off' check (mode in ('off', 'canary', 'live')),
  delay_minutes integer not null default 6 check (delay_minutes between 1 and 60),
  canary_recipient text,
  policy_version text not null default 'request-autoreply-v1',
  change_reason text not null default 'initial_fail_closed_install',
  updated_at timestamptz not null default now(),
  updated_by text not null default 'migration'
);

insert into public.request_autoreply_settings (
  id,
  mode,
  delay_minutes,
  canary_recipient,
  policy_version,
  change_reason,
  updated_by
) values (
  1,
  'off',
  6,
  'support@neontrip.de',
  'request-autoreply-v1',
  'initial_fail_closed_install',
  'migration'
)
on conflict (id) do nothing;

create table if not exists public.request_autoreply_jobs (
  id uuid primary key default gen_random_uuid(),
  request_row_id uuid references public.master_requests(id) on delete restrict,
  request_id text not null,
  source_kind text not null,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'sent', 'blocked', 'delivery_unknown')),
  due_at timestamptz not null,
  policy_version text not null,
  attempt_count integer not null default 0 check (attempt_count between 0 and 1),
  claim_token uuid,
  claimed_at timestamptz,
  lease_until timestamptz,
  last_execution_id text,
  last_finish_token uuid,
  last_finish_execution_id text,
  recipient_mode text check (recipient_mode in ('canary', 'live')),
  provider_message_id text,
  provider_receipt_source text,
  sent_at timestamptz,
  body_source text check (body_source in ('ai', 'fallback')),
  email_subject text,
  content_fingerprint text,
  block_reason text,
  last_error_code text,
  last_error_message text,
  test_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint request_autoreply_jobs_request_key unique (request_id),
  constraint request_autoreply_jobs_request_row_key unique (request_row_id),
  constraint request_autoreply_jobs_source_kind_check check (
    source_kind in ('landing-page-form', '2418', 'outlook_email', 'canary')
  ),
  constraint request_autoreply_jobs_state_shape check (
    (
      status = 'queued'
      and claim_token is null
      and lease_until is null
      and sent_at is null
      and provider_message_id is null
      and attempt_count = 0
    )
    or (
      status = 'processing'
      and claim_token is not null
      and claimed_at is not null
      and lease_until is not null
      and sent_at is null
      and provider_message_id is null
      and attempt_count = 1
    )
    or (
      status = 'sent'
      and claim_token is null
      and lease_until is null
      and sent_at is not null
      and provider_message_id is not null
      and attempt_count = 1
    )
    or (
      status in ('blocked', 'delivery_unknown')
      and claim_token is null
      and lease_until is null
      and sent_at is null
      and provider_message_id is null
    )
  ),
  constraint request_autoreply_jobs_canary_shape check (
    (source_kind = 'canary' and request_row_id is null and test_payload is not null)
    or (source_kind <> 'canary' and request_row_id is not null and test_payload is null)
  )
);

create index if not exists request_autoreply_jobs_due_idx
  on public.request_autoreply_jobs (due_at, id)
  where status = 'queued';

create index if not exists request_autoreply_jobs_status_idx
  on public.request_autoreply_jobs (status, updated_at desc);

create table if not exists public.request_autoreply_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.request_autoreply_jobs(id) on delete restrict,
  event_key text not null unique,
  event_type text not null
    check (event_type in ('enqueued', 'claimed', 'sent', 'blocked', 'delivery_unknown')),
  workflow_execution_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists request_autoreply_events_job_idx
  on public.request_autoreply_events (job_id, created_at desc);

alter table public.request_autoreply_settings enable row level security;
alter table public.request_autoreply_jobs enable row level security;
alter table public.request_autoreply_events enable row level security;

revoke all on table public.request_autoreply_settings
  from public, anon, authenticated, service_role;
revoke all on table public.request_autoreply_jobs
  from public, anon, authenticated, service_role;
revoke all on table public.request_autoreply_events
  from public, anon, authenticated, service_role;

grant select, update on table public.request_autoreply_settings to service_role;
grant select, insert, update on table public.request_autoreply_jobs to service_role;
grant select, insert on table public.request_autoreply_events to service_role;

create or replace function public.enqueue_new_request_autoreply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_settings public.request_autoreply_settings%rowtype;
  request_json jsonb := to_jsonb(new);
  source_key text;
  stable_request_id text;
  inserted_job public.request_autoreply_jobs%rowtype;
begin
  select * into current_settings
  from public.request_autoreply_settings
  where id = 1;

  if not found or current_settings.mode <> 'live' then
    return new;
  end if;

  if lower(coalesce(request_json ->> 'status', 'new')) not in ('new', 'open') then
    return new;
  end if;

  if lower(coalesce(request_json #>> '{attribution_raw,auto_reply_suppressed}', 'false'))
     in ('true', '1', 'yes') then
    return new;
  end if;

  source_key := lower(coalesce(
    nullif(btrim(request_json ->> 'form_id'), ''),
    nullif(btrim(request_json #>> '{attribution_raw,source}'), ''),
    ''
  ));

  if source_key not in ('landing-page-form', '2418', 'outlook_email') then
    return new;
  end if;

  stable_request_id := left(nullif(btrim(request_json ->> 'request_id'), ''), 500);
  if stable_request_id is null then
    return new;
  end if;

  insert into public.request_autoreply_jobs (
    request_row_id,
    request_id,
    source_kind,
    status,
    due_at,
    policy_version
  ) values (
    new.id,
    stable_request_id,
    source_key,
    'queued',
    now() + make_interval(mins => current_settings.delay_minutes),
    current_settings.policy_version
  )
  on conflict (request_id) do nothing
  returning * into inserted_job;

  if found then
    insert into public.request_autoreply_events (
      job_id,
      event_key,
      event_type,
      metadata
    ) values (
      inserted_job.id,
      'request-autoreply:' || inserted_job.id::text || ':enqueued',
      'enqueued',
      jsonb_build_object(
        'source_kind', source_key,
        'due_at', inserted_job.due_at,
        'delay_minutes', current_settings.delay_minutes,
        'policy_version', current_settings.policy_version,
        'historical_backfill', false,
        'automatic_retry_allowed', false
      )
    );
  end if;

  return new;
end;
$$;

revoke all on function public.enqueue_new_request_autoreply()
  from public, anon, authenticated, service_role;

drop trigger if exists master_requests_enqueue_autoreply
  on public.master_requests;

create trigger master_requests_enqueue_autoreply
after insert on public.master_requests
for each row execute function public.enqueue_new_request_autoreply();

create or replace function public.configure_request_autoreply(
  p_mode text,
  p_reason text,
  p_canary_recipient text default null,
  p_actor text default 'n8n'
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  safe_mode text := lower(nullif(btrim(p_mode), ''));
  safe_reason text := left(nullif(btrim(p_reason), ''), 500);
  safe_actor text := left(coalesce(nullif(btrim(p_actor), ''), 'n8n'), 200);
  safe_canary_recipient text := lower(nullif(btrim(p_canary_recipient), ''));
  updated public.request_autoreply_settings%rowtype;
begin
  if safe_mode not in ('off', 'canary', 'live') then
    raise exception 'Unsupported request auto-reply mode';
  end if;
  if safe_reason is null then
    raise exception 'A change reason is required';
  end if;
  if safe_mode = 'canary' and (
    safe_canary_recipient is null
    or safe_canary_recipient !~ '^[^[:space:]@]+@neontrip\.de$'
  ) then
    raise exception 'Canary mode requires an internal @neontrip.de recipient';
  end if;

  update public.request_autoreply_settings
  set mode = safe_mode,
      canary_recipient = case
        when safe_mode = 'canary' then safe_canary_recipient
        else canary_recipient
      end,
      change_reason = safe_reason,
      updated_at = now(),
      updated_by = safe_actor
  where id = 1
  returning * into updated;

  if not found then
    raise exception 'Request auto-reply settings row is missing';
  end if;

  return jsonb_build_object(
    'ok', true,
    'mode', updated.mode,
    'delay_minutes', updated.delay_minutes,
    'policy_version', updated.policy_version,
    'updated_at', updated.updated_at,
    'automatic_retry_allowed', false
  );
end;
$$;

create or replace function public.enqueue_request_autoreply_canary(
  p_idempotency_key text,
  p_actor text default 'n8n'
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  safe_key text := left(nullif(btrim(p_idempotency_key), ''), 100);
  safe_actor text := left(coalesce(nullif(btrim(p_actor), ''), 'n8n'), 200);
  current_settings public.request_autoreply_settings%rowtype;
  job public.request_autoreply_jobs%rowtype;
  inserted boolean := false;
begin
  if safe_key is null or safe_key !~ '^[A-Za-z0-9._:-]+$' then
    raise exception 'A safe canary idempotency key is required';
  end if;

  select * into current_settings
  from public.request_autoreply_settings
  where id = 1;

  if not found or current_settings.mode <> 'canary' then
    raise exception 'Request auto-reply is not in canary mode';
  end if;
  if current_settings.canary_recipient !~ '^[^[:space:]@]+@neontrip\.de$' then
    raise exception 'A valid internal canary recipient is required';
  end if;

  insert into public.request_autoreply_jobs (
    request_row_id,
    request_id,
    source_kind,
    status,
    due_at,
    policy_version,
    test_payload
  ) values (
    null,
    'canary:' || safe_key,
    'canary',
    'queued',
    now(),
    current_settings.policy_version,
    jsonb_build_object(
      'customer_first_name', 'Test',
      'title', 'Interner Auto-Reply Canary',
      'description', 'Wir benötigen ein individuelles LED-Leuchtschild für den Außenbereich, ungefähr 120 x 60 cm.',
      'size', '120 x 60 cm',
      'application', 'Außenbereich',
      'actor', safe_actor
    )
  )
  on conflict (request_id) do nothing
  returning * into job;

  inserted := found;
  if not inserted then
    select existing.* into job
    from public.request_autoreply_jobs as existing
    where existing.request_id = 'canary:' || safe_key;
  else
    insert into public.request_autoreply_events (
      job_id,
      event_key,
      event_type,
      metadata
    ) values (
      job.id,
      'request-autoreply:' || job.id::text || ':enqueued',
      'enqueued',
      jsonb_build_object(
        'source_kind', 'canary',
        'actor', safe_actor,
        'automatic_retry_allowed', false
      )
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'inserted', inserted,
    'job_id', job.id,
    'request_id', job.request_id,
    'status', job.status,
    'mode', current_settings.mode
  );
end;
$$;

create or replace function public.claim_request_autoreply_candidate(
  p_workflow_execution_id text,
  p_lease_seconds integer default 900
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  safe_execution_id text := left(nullif(btrim(p_workflow_execution_id), ''), 200);
  safe_lease_seconds integer := least(greatest(coalesce(p_lease_seconds, 900), 60), 1800);
  current_settings public.request_autoreply_settings%rowtype;
  candidate public.request_autoreply_jobs%rowtype;
  claimed public.request_autoreply_jobs%rowtype;
  stale public.request_autoreply_jobs%rowtype;
  request_json jsonb := '{}'::jsonb;
  customer_json jsonb := '{}'::jsonb;
  candidate_json jsonb;
  recipient text;
  resolved_recipient_mode text;
  customer_id_text text;
  source_key text;
  new_claim_token uuid := gen_random_uuid();
begin
  if safe_execution_id is null then
    raise exception 'workflow_execution_id is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('request-autoreply:' || safe_execution_id, 0));

  select existing.* into claimed
  from public.request_autoreply_jobs as existing
  where existing.status = 'processing'
    and existing.last_execution_id = safe_execution_id
    and existing.claim_token is not null
    and existing.lease_until > now()
  order by existing.claimed_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'route', 'stop',
      'reason', 'execution_already_has_active_claim',
      'job_id', claimed.id,
      'automatic_retry_allowed', false
    );
  end if;

  for stale in
    update public.request_autoreply_jobs as expired
    set status = 'delivery_unknown',
        claim_token = null,
        lease_until = null,
        last_error_code = 'stale_processing_lease',
        last_error_message = 'A prior Outlook send attempt lost confirmation; manual review is required.',
        updated_at = now()
    where expired.status = 'processing'
      and expired.lease_until <= now()
    returning expired.*
  loop
    insert into public.request_autoreply_events (
      job_id,
      event_key,
      event_type,
      workflow_execution_id,
      metadata
    ) values (
      stale.id,
      'request-autoreply:' || stale.id::text || ':delivery-unknown:stale-lease',
      'delivery_unknown',
      safe_execution_id,
      jsonb_build_object(
        'reason', 'stale_processing_lease',
        'automatic_retry_allowed', false
      )
    )
    on conflict (event_key) do nothing;
  end loop;

  select * into current_settings
  from public.request_autoreply_settings
  where id = 1;

  if not found or current_settings.mode = 'off' then
    return jsonb_build_object(
      'route', 'stop',
      'reason', 'delivery_disabled',
      'automatic_retry_allowed', false
    );
  end if;

  select queued.* into candidate
  from public.request_autoreply_jobs as queued
  where queued.status = 'queued'
    and queued.due_at <= now()
    and (
      (current_settings.mode = 'canary' and queued.source_kind = 'canary')
      or (current_settings.mode = 'live' and queued.source_kind <> 'canary')
    )
  order by queued.due_at, queued.id
  for update skip locked
  limit 1;

  if not found then
    return jsonb_build_object(
      'route', 'stop',
      'reason', 'no_candidate',
      'mode', current_settings.mode,
      'automatic_retry_allowed', false
    );
  end if;

  if candidate.source_kind = 'canary' then
    request_json := coalesce(candidate.test_payload, '{}'::jsonb);
    customer_json := jsonb_build_object('first_name', 'Test');
    recipient := lower(btrim(coalesce(current_settings.canary_recipient, '')));
    resolved_recipient_mode := 'canary';
    source_key := 'canary';
  else
    select to_jsonb(request_row) into request_json
    from public.master_requests as request_row
    where request_row.id = candidate.request_row_id;

    if not found then
      request_json := '{}'::jsonb;
    end if;

    customer_id_text := request_json ->> 'customer_id';
    if customer_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      select to_jsonb(customer_row) into customer_json
      from public.master_customers as customer_row
      where customer_row.id = customer_id_text::uuid;
    end if;
    customer_json := coalesce(customer_json, '{}'::jsonb);

    recipient := lower(btrim(coalesce(
      nullif(customer_json ->> 'email', ''),
      nullif(request_json ->> 'email', ''),
      ''
    )));
    resolved_recipient_mode := 'live';
    source_key := lower(coalesce(
      nullif(request_json ->> 'form_id', ''),
      nullif(request_json #>> '{attribution_raw,source}', ''),
      candidate.source_kind
    ));
  end if;

  if source_key not in ('landing-page-form', '2418', 'outlook_email', 'canary')
     or recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or (
       resolved_recipient_mode = 'live'
       and (
         recipient ~ '@(neontrip\.de|riesenobjekte\.de)$'
         or recipient ~ '@example\.'
         or recipient ~ '@neontrip\.test$'
       )
     )
     or (resolved_recipient_mode = 'canary' and recipient !~ '@neontrip\.de$') then
    update public.request_autoreply_jobs
    set status = 'blocked',
        block_reason = 'invalid_source_or_recipient',
        last_execution_id = safe_execution_id,
        updated_at = now()
    where id = candidate.id
    returning * into candidate;

    insert into public.request_autoreply_events (
      job_id,
      event_key,
      event_type,
      workflow_execution_id,
      metadata
    ) values (
      candidate.id,
      'request-autoreply:' || candidate.id::text || ':blocked',
      'blocked',
      safe_execution_id,
      jsonb_build_object(
        'reason', 'invalid_source_or_recipient',
        'source_kind', source_key,
        'recipient_mode', resolved_recipient_mode,
        'automatic_send_allowed', false
      )
    )
    on conflict (event_key) do nothing;

    return jsonb_build_object(
      'route', 'stop',
      'reason', 'candidate_blocked_for_review',
      'job_id', candidate.id,
      'automatic_retry_allowed', false
    );
  end if;

  candidate_json := jsonb_build_object(
    'request_id', candidate.request_id,
    'source_kind', source_key,
    'recipient', recipient,
    'recipient_mode', resolved_recipient_mode,
    'customer_first_name', left(coalesce(
      nullif(customer_json ->> 'first_name', ''),
      nullif(request_json ->> 'first_name', ''),
      nullif(request_json ->> 'customer_first_name', ''),
      'Kunde'
    ), 120),
    'customer_name', left(coalesce(
      nullif(customer_json ->> 'name', ''),
      nullif(btrim(concat_ws(' ', customer_json ->> 'first_name', customer_json ->> 'last_name')), ''),
      'Kunde'
    ), 200),
    'company', left(coalesce(
      nullif(customer_json ->> 'company_name', ''),
      nullif(customer_json ->> 'company', ''),
      ''
    ), 200),
    'title', left(coalesce(
      nullif(request_json ->> 'title', ''),
      'Neue Anfrage'
    ), 300),
    'description', left(coalesce(
      nullif(request_json ->> 'description', ''),
      nullif(request_json ->> 'message', ''),
      'Keine zusätzlichen Angaben'
    ), 3000),
    'size', left(coalesce(
      nullif(request_json ->> 'size', ''),
      nullif(request_json ->> 'requested_size', ''),
      ''
    ), 200),
    'color', coalesce(request_json -> 'color', to_jsonb(request_json ->> 'requested_color')),
    'application', left(coalesce(
      nullif(request_json ->> 'application', ''),
      nullif(request_json ->> 'requested_usage', ''),
      nullif(request_json ->> 'usage', ''),
      ''
    ), 200),
    'customer_type', left(coalesce(request_json ->> 'customer_type', ''), 100),
    'country', left(coalesce(
      nullif(request_json ->> 'country', ''),
      nullif(customer_json ->> 'country', ''),
      ''
    ), 100)
  );

  update public.request_autoreply_jobs
  set status = 'processing',
      attempt_count = 1,
      claim_token = new_claim_token,
      claimed_at = now(),
      lease_until = now() + make_interval(secs => safe_lease_seconds),
      last_execution_id = safe_execution_id,
      recipient_mode = resolved_recipient_mode,
      updated_at = now()
  where id = candidate.id
    and status = 'queued'
  returning * into claimed;

  if not found then
    return jsonb_build_object(
      'route', 'stop',
      'reason', 'claim_lost',
      'automatic_retry_allowed', false
    );
  end if;

  insert into public.request_autoreply_events (
    job_id,
    event_key,
    event_type,
    workflow_execution_id,
    metadata
  ) values (
    claimed.id,
    'request-autoreply:' || claimed.id::text || ':claimed:' || claimed.claim_token::text,
    'claimed',
    safe_execution_id,
    jsonb_build_object(
      'source_kind', source_key,
      'recipient_mode', resolved_recipient_mode,
      'lease_seconds', safe_lease_seconds,
      'policy_version', claimed.policy_version,
      'ai_role', 'bounded_copy_proposal',
      'automatic_send_allowed', true,
      'automatic_retry_allowed', false
    )
  );

  return jsonb_build_object(
    'route', 'process',
    'reason', 'claimed',
    'job_id', claimed.id,
    'claim_token', claimed.claim_token,
    'candidate', candidate_json,
    'policy_version', claimed.policy_version,
    'automatic_send_allowed', true,
    'automatic_retry_allowed', false
  );
end;
$$;

create or replace function public.complete_request_autoreply_delivery(
  p_job_id uuid,
  p_claim_token uuid,
  p_workflow_execution_id text,
  p_provider_message_id text,
  p_provider_receipt_source text,
  p_body_source text,
  p_email_subject text,
  p_content_fingerprint text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  safe_execution_id text := left(nullif(btrim(p_workflow_execution_id), ''), 200);
  safe_provider_id text := left(nullif(btrim(p_provider_message_id), ''), 2000);
  safe_receipt_source text := left(nullif(btrim(p_provider_receipt_source), ''), 100);
  safe_body_source text := lower(nullif(btrim(p_body_source), ''));
  safe_subject text := left(nullif(btrim(p_email_subject), ''), 300);
  safe_fingerprint text := left(nullif(btrim(p_content_fingerprint), ''), 200);
  job public.request_autoreply_jobs%rowtype;
begin
  if p_job_id is null or p_claim_token is null or safe_execution_id is null
     or safe_provider_id is null or safe_receipt_source is null
     or safe_subject is null or safe_fingerprint is null then
    raise exception 'Complete auto-reply delivery requires all receipt fields';
  end if;
  if safe_body_source not in ('ai', 'fallback') then
    raise exception 'Unsupported auto-reply body source';
  end if;

  update public.request_autoreply_jobs
  set status = 'sent',
      claim_token = null,
      lease_until = null,
      last_execution_id = safe_execution_id,
      last_finish_token = p_claim_token,
      last_finish_execution_id = safe_execution_id,
      provider_message_id = safe_provider_id,
      provider_receipt_source = safe_receipt_source,
      sent_at = now(),
      body_source = safe_body_source,
      email_subject = safe_subject,
      content_fingerprint = safe_fingerprint,
      updated_at = now()
  where id = p_job_id
    and status = 'processing'
    and claim_token = p_claim_token
    and last_execution_id = safe_execution_id
  returning * into job;

  if not found then
    select existing.* into job
    from public.request_autoreply_jobs as existing
    where existing.id = p_job_id;

    if found and job.status = 'sent'
       and job.last_finish_token = p_claim_token
       and job.last_finish_execution_id = safe_execution_id then
      return jsonb_build_object(
        'ok', true,
        'sent', false,
        'reason', 'already_completed',
        'status', job.status,
        'automatic_retry_allowed', false
      );
    end if;
    raise exception 'Auto-reply completion rejected because the claim is stale or missing';
  end if;

  insert into public.request_autoreply_events (
    job_id,
    event_key,
    event_type,
    workflow_execution_id,
    metadata
  ) values (
    job.id,
    'request-autoreply:' || job.id::text || ':sent',
    'sent',
    safe_execution_id,
    jsonb_build_object(
      'recipient_mode', job.recipient_mode,
      'provider_receipt_source', safe_receipt_source,
      'body_source', safe_body_source,
      'content_fingerprint', safe_fingerprint,
      'automatic_retry_allowed', false
    )
  )
  on conflict (event_key) do nothing;

  return jsonb_build_object(
    'ok', true,
    'sent', true,
    'job_id', job.id,
    'status', job.status,
    'sent_at', job.sent_at,
    'recipient_mode', job.recipient_mode,
    'automatic_retry_allowed', false
  );
end;
$$;

create or replace function public.mark_request_autoreply_delivery_unknown(
  p_job_id uuid,
  p_claim_token uuid,
  p_workflow_execution_id text,
  p_error_code text default 'outlook_send_unknown',
  p_error_message text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  safe_execution_id text := left(nullif(btrim(p_workflow_execution_id), ''), 200);
  safe_error_code text := left(coalesce(nullif(btrim(p_error_code), ''), 'outlook_send_unknown'), 120);
  safe_error_message text := left(coalesce(nullif(btrim(p_error_message), ''), 'Outlook send outcome is ambiguous.'), 1000);
  job public.request_autoreply_jobs%rowtype;
begin
  if p_job_id is null or p_claim_token is null or safe_execution_id is null then
    raise exception 'job_id, claim_token and workflow_execution_id are required';
  end if;

  update public.request_autoreply_jobs
  set status = 'delivery_unknown',
      claim_token = null,
      lease_until = null,
      last_execution_id = safe_execution_id,
      last_finish_token = p_claim_token,
      last_finish_execution_id = safe_execution_id,
      last_error_code = safe_error_code,
      last_error_message = safe_error_message,
      updated_at = now()
  where id = p_job_id
    and status = 'processing'
    and claim_token = p_claim_token
    and last_execution_id = safe_execution_id
  returning * into job;

  if not found then
    select existing.* into job
    from public.request_autoreply_jobs as existing
    where existing.id = p_job_id;

    if found and job.status = 'delivery_unknown'
       and job.last_finish_token = p_claim_token
       and job.last_finish_execution_id = safe_execution_id then
      return jsonb_build_object(
        'ok', true,
        'marked', false,
        'reason', 'already_marked_unknown',
        'status', job.status,
        'automatic_retry_allowed', false
      );
    end if;
    raise exception 'Auto-reply unknown receipt rejected because the claim is stale or missing';
  end if;

  insert into public.request_autoreply_events (
    job_id,
    event_key,
    event_type,
    workflow_execution_id,
    metadata
  ) values (
    job.id,
    'request-autoreply:' || job.id::text || ':delivery-unknown',
    'delivery_unknown',
    safe_execution_id,
    jsonb_build_object(
      'error_code', safe_error_code,
      'recipient_mode', job.recipient_mode,
      'manual_review_required', true,
      'automatic_retry_allowed', false
    )
  )
  on conflict (event_key) do nothing;

  return jsonb_build_object(
    'ok', true,
    'marked', true,
    'job_id', job.id,
    'status', job.status,
    'manual_review_required', true,
    'automatic_retry_allowed', false
  );
end;
$$;

create or replace function public.block_request_autoreply_delivery(
  p_job_id uuid,
  p_claim_token uuid,
  p_workflow_execution_id text,
  p_reason text default 'pre_send_validation_failed'
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  safe_execution_id text := left(nullif(btrim(p_workflow_execution_id), ''), 200);
  safe_reason text := left(coalesce(nullif(btrim(p_reason), ''), 'pre_send_validation_failed'), 200);
  job public.request_autoreply_jobs%rowtype;
begin
  if p_job_id is null or p_claim_token is null or safe_execution_id is null then
    raise exception 'job_id, claim_token and workflow_execution_id are required';
  end if;

  update public.request_autoreply_jobs
  set status = 'blocked',
      claim_token = null,
      lease_until = null,
      last_execution_id = safe_execution_id,
      last_finish_token = p_claim_token,
      last_finish_execution_id = safe_execution_id,
      block_reason = safe_reason,
      last_error_code = safe_reason,
      last_error_message = 'Deterministic pre-send validation blocked customer delivery.',
      updated_at = now()
  where id = p_job_id
    and status = 'processing'
    and claim_token = p_claim_token
    and last_execution_id = safe_execution_id
  returning * into job;

  if not found then
    select existing.* into job
    from public.request_autoreply_jobs as existing
    where existing.id = p_job_id;

    if found and job.status = 'blocked'
       and job.last_finish_token = p_claim_token
       and job.last_finish_execution_id = safe_execution_id then
      return jsonb_build_object(
        'ok', true,
        'blocked', false,
        'reason', 'already_blocked',
        'status', job.status,
        'automatic_retry_allowed', false
      );
    end if;
    raise exception 'Auto-reply block rejected because the claim is stale or missing';
  end if;

  insert into public.request_autoreply_events (
    job_id,
    event_key,
    event_type,
    workflow_execution_id,
    metadata
  ) values (
    job.id,
    'request-autoreply:' || job.id::text || ':blocked:pre-send',
    'blocked',
    safe_execution_id,
    jsonb_build_object(
      'reason', safe_reason,
      'recipient_mode', job.recipient_mode,
      'automatic_send_allowed', false,
      'automatic_retry_allowed', false
    )
  )
  on conflict (event_key) do nothing;

  return jsonb_build_object(
    'ok', true,
    'blocked', true,
    'job_id', job.id,
    'status', job.status,
    'automatic_send_allowed', false,
    'automatic_retry_allowed', false
  );
end;
$$;

revoke all on function public.configure_request_autoreply(text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.enqueue_request_autoreply_canary(text, text)
  from public, anon, authenticated;
revoke all on function public.claim_request_autoreply_candidate(text, integer)
  from public, anon, authenticated;
revoke all on function public.complete_request_autoreply_delivery(uuid, uuid, text, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.mark_request_autoreply_delivery_unknown(uuid, uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.block_request_autoreply_delivery(uuid, uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.configure_request_autoreply(text, text, text, text)
  to service_role;
grant execute on function public.enqueue_request_autoreply_canary(text, text)
  to service_role;
grant execute on function public.claim_request_autoreply_candidate(text, integer)
  to service_role;
grant execute on function public.complete_request_autoreply_delivery(uuid, uuid, text, text, text, text, text, text)
  to service_role;
grant execute on function public.mark_request_autoreply_delivery_unknown(uuid, uuid, text, text, text)
  to service_role;
grant execute on function public.block_request_autoreply_delivery(uuid, uuid, text, text)
  to service_role;
