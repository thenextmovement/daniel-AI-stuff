create extension if not exists pgcrypto;

create table if not exists public.arrival_label_outlook_archive_settings (
  singleton boolean primary key default true,
  enabled boolean not null default false,
  enabled_after timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint arrival_label_outlook_archive_settings_singleton_check check (singleton)
);

insert into public.arrival_label_outlook_archive_settings (singleton, enabled)
values (true, false)
on conflict (singleton) do nothing;

create table if not exists public.arrival_label_outlook_archive_jobs (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.arrival_label_cases(id) on delete cascade,
  print_job_id uuid not null references public.arrival_label_print_jobs(id) on delete cascade,
  idempotency_key text not null unique,
  source_message_id text not null,
  source_message_id_sha256 text generated always as (encode(digest(source_message_id, 'sha256'), 'hex')) stored,
  expected_tracking_number text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  lease_owner text null,
  lease_expires_at timestamptz null,
  moved_message_id text null,
  last_error text null,
  claimed_at timestamptz null,
  dispatching_at timestamptz null,
  archived_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint arrival_label_outlook_archive_jobs_key_check check (idempotency_key ~ '^arrival-outlook-archive:[0-9a-f]{64}$'),
  constraint arrival_label_outlook_archive_jobs_source_id_check check (
    length(source_message_id) between 1 and 2048 and source_message_id !~ '[[:cntrl:]]'
  ),
  constraint arrival_label_outlook_archive_jobs_source_hash_check check (source_message_id_sha256 ~ '^[0-9a-f]{64}$'),
  constraint arrival_label_outlook_archive_jobs_tracking_check check (expected_tracking_number ~ '^[0-9]{10,40}$'),
  constraint arrival_label_outlook_archive_jobs_moved_id_check check (
    moved_message_id is null or (length(moved_message_id) between 1 and 2048 and moved_message_id !~ '[[:cntrl:]]')
  ),
  constraint arrival_label_outlook_archive_jobs_status_check check (
    status in ('pending', 'claimed', 'dispatching', 'archived', 'retryable_error', 'manual_review', 'cancelled')
  ),
  constraint arrival_label_outlook_archive_jobs_attempts_check check (attempts >= 0 and max_attempts between 1 and 5),
  constraint arrival_label_outlook_archive_jobs_message_unique unique (case_id, source_message_id_sha256)
);

create index if not exists arrival_label_outlook_archive_jobs_claim_idx
  on public.arrival_label_outlook_archive_jobs (status, created_at)
  where status in ('pending', 'claimed', 'retryable_error');

create index if not exists arrival_label_outlook_archive_jobs_reconcile_idx
  on public.arrival_label_outlook_archive_jobs (status, updated_at)
  where status in ('dispatching', 'manual_review');

alter table public.arrival_label_outlook_archive_settings enable row level security;
alter table public.arrival_label_outlook_archive_jobs enable row level security;
revoke all on table public.arrival_label_outlook_archive_settings from anon, authenticated;
revoke all on table public.arrival_label_outlook_archive_jobs from anon, authenticated;
grant select, insert, update on table public.arrival_label_outlook_archive_settings to service_role;
grant select, insert, update on table public.arrival_label_outlook_archive_jobs to service_role;

create or replace function public.arrival_labels_enqueue_outlook_archives_for_print(
  p_print_job_id uuid,
  p_now timestamptz default now()
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_inserted integer := 0;
begin
  if not exists (
    select 1
    from public.arrival_label_outlook_archive_settings s
    where s.singleton and s.enabled and p_now >= s.enabled_after
  ) then
    return 0;
  end if;

  with eligible as (
    select
      c.id as case_id,
      c.run_id,
      j.id as print_job_id,
      c.incoming_dhl_tracking_number as tracking_number,
      message_id
    from public.arrival_label_print_jobs j
    join public.arrival_label_cases c on c.id = j.case_id
    cross join lateral unnest(c.outlook_message_ids) as messages(message_id)
    where j.id = p_print_job_id
      and j.document_kind = 'label'
      and j.status = 'printed'
      and j.printed_at >= (
        select s.enabled_after
        from public.arrival_label_outlook_archive_settings s
        where s.singleton and s.enabled
      )
      and length(message_id) between 1 and 2048
      and message_id !~ '[[:cntrl:]]'
      and c.incoming_dhl_tracking_number ~ '^[0-9]{10,40}$'
  ), inserted as (
    insert into public.arrival_label_outlook_archive_jobs (
      case_id,
      print_job_id,
      idempotency_key,
      source_message_id,
      expected_tracking_number
    )
    select
      e.case_id,
      e.print_job_id,
      'arrival-outlook-archive:' || encode(digest(e.case_id::text || E'\n' || e.message_id, 'sha256'), 'hex'),
      e.message_id,
      e.tracking_number
    from eligible e
    on conflict (idempotency_key) do nothing
    returning id, case_id
  ), events as (
    insert into public.arrival_label_events (
      run_id, case_id, event_key, event_type, severity, actor, payload
    )
    select
      c.run_id,
      i.case_id,
      'outlook-archive:' || i.id::text || ':queued',
      'outlook_archive_queued',
      'info',
      'arrival-label-outlook-archive-outbox',
      jsonb_build_object('archiveJobId', i.id, 'printJobId', p_print_job_id)
    from inserted i
    join public.arrival_label_cases c on c.id = i.case_id
    on conflict (event_key) do nothing
  )
  select count(*) into v_inserted from inserted;

  return v_inserted;
end;
$$;

create or replace function public.arrival_labels_queue_outlook_archives_after_print()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.document_kind = 'label'
    and new.status = 'printed'
    and old.status is distinct from 'printed' then
    begin
      perform public.arrival_labels_enqueue_outlook_archives_for_print(new.id, now());
    exception when others then
      raise warning 'arrival Outlook archive enqueue failed for print job %', new.id;
    end;
  end if;
  return new;
end;
$$;

create trigger arrival_label_print_jobs_queue_outlook_archives
after update of status on public.arrival_label_print_jobs
for each row execute function public.arrival_labels_queue_outlook_archives_after_print();

create or replace function public.arrival_labels_claim_outlook_archive(
  p_worker_id text,
  p_lease_seconds integer default 180,
  p_now timestamptz default now()
)
returns setof public.arrival_label_outlook_archive_jobs
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_job public.arrival_label_outlook_archive_jobs%rowtype;
  v_print_job_id uuid;
begin
  if coalesce(p_worker_id, '') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,95}$' then
    raise exception 'invalid Outlook archive worker id';
  end if;
  if p_lease_seconds < 60 or p_lease_seconds > 900 then
    raise exception 'Outlook archive lease seconds must be between 60 and 900';
  end if;
  if not exists (
    select 1 from public.arrival_label_outlook_archive_settings s
    where s.singleton and s.enabled and p_now >= s.enabled_after
  ) then
    return;
  end if;

  select * into v_job
  from public.arrival_label_outlook_archive_jobs
  where lease_owner = p_worker_id and status = 'claimed' and lease_expires_at > p_now
  order by claimed_at desc limit 1 for update skip locked;
  if found then return next v_job; return; end if;

  with uncertain as (
    update public.arrival_label_outlook_archive_jobs
    set status = 'manual_review', lease_owner = null, lease_expires_at = null,
        last_error = 'Outlook move began but completion is unknown; do not automatically move again.', updated_at = p_now
    where status = 'dispatching' and lease_expires_at <= p_now
    returning id, case_id
  )
  insert into public.arrival_label_events (run_id, case_id, event_key, event_type, severity, actor, payload)
  select c.run_id, u.case_id, 'outlook-archive:' || u.id::text || ':uncertain', 'outlook_archive_uncertain', 'warning',
         'arrival-label-outlook-archive-outbox', jsonb_build_object('archiveJobId', u.id, 'automaticRetry', false)
  from uncertain u join public.arrival_label_cases c on c.id = u.case_id
  on conflict (event_key) do nothing;

  with exhausted as (
    update public.arrival_label_outlook_archive_jobs
    set status = 'manual_review', lease_owner = null, lease_expires_at = null,
        last_error = 'Outlook archive exhausted safe retries before move dispatch.', updated_at = p_now
    where status in ('claimed', 'retryable_error') and attempts >= max_attempts
      and (lease_expires_at is null or lease_expires_at <= p_now)
    returning id, case_id
  )
  insert into public.arrival_label_events (run_id, case_id, event_key, event_type, severity, actor, payload)
  select c.run_id, e.case_id, 'outlook-archive:' || e.id::text || ':retry_exhausted',
         'outlook_archive_retry_exhausted', 'warning', 'arrival-label-outlook-archive-outbox',
         jsonb_build_object('archiveJobId', e.id)
  from exhausted e join public.arrival_label_cases c on c.id = e.case_id
  on conflict (event_key) do nothing;

  -- Reconciliation is a recovery path for a swallowed trigger error, bounded to
  -- labels printed after the explicit activation timestamp. Historical mail is excluded.
  select j.id into v_print_job_id
  from public.arrival_label_print_jobs j
  cross join public.arrival_label_outlook_archive_settings s
  where s.singleton and s.enabled
    and j.document_kind = 'label'
    and j.status = 'printed'
    and j.printed_at >= s.enabled_after
    and exists (
      select 1
      from public.arrival_label_cases c
      cross join lateral unnest(c.outlook_message_ids) as messages(message_id)
      where c.id = j.case_id
        and length(message_id) between 1 and 2048
        and message_id !~ '[[:cntrl:]]'
        and not exists (
          select 1 from public.arrival_label_outlook_archive_jobs a
          where a.case_id = c.id
            and a.source_message_id_sha256 = encode(digest(message_id, 'sha256'), 'hex')
        )
    )
  order by j.printed_at asc
  limit 1;
  if v_print_job_id is not null then
    perform public.arrival_labels_enqueue_outlook_archives_for_print(v_print_job_id, p_now);
  end if;

  select * into v_job
  from public.arrival_label_outlook_archive_jobs
  where status in ('pending', 'claimed', 'retryable_error') and attempts < max_attempts
    and (lease_expires_at is null or lease_expires_at <= p_now)
  order by created_at asc limit 1 for update skip locked;
  if not found then return; end if;

  update public.arrival_label_outlook_archive_jobs
  set status = 'claimed', attempts = attempts + 1, lease_owner = p_worker_id,
      lease_expires_at = p_now + make_interval(secs => p_lease_seconds), claimed_at = p_now,
      last_error = null, updated_at = p_now
  where id = v_job.id
  returning * into v_job;

  return next v_job;
end;
$$;

create or replace function public.arrival_labels_update_outlook_archive(
  p_archive_job_id uuid,
  p_worker_id text,
  p_result text,
  p_moved_message_id text default null,
  p_error text default null,
  p_now timestamptz default now()
)
returns setof public.arrival_label_outlook_archive_jobs
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_job public.arrival_label_outlook_archive_jobs%rowtype;
  v_next_status text;
  v_retry_exhausted boolean;
  v_run_id uuid;
begin
  if p_result not in ('dispatching', 'archived', 'retryable_error', 'invalid_target', 'uncertain') then
    raise exception 'invalid Outlook archive result';
  end if;

  select * into v_job
  from public.arrival_label_outlook_archive_jobs
  where id = p_archive_job_id
    and (
      lease_owner = p_worker_id
      or (
        status = 'archived'
        and p_result = 'archived'
        and (
          nullif(btrim(p_moved_message_id), '') is null
          or moved_message_id = nullif(btrim(p_moved_message_id), '')
        )
      )
    )
  for update;
  if not found then raise exception 'Outlook archive job not owned by worker'; end if;

  if p_result = 'archived'
    and coalesce(nullif(btrim(p_moved_message_id), ''), v_job.moved_message_id, '') !~ '^[^[:cntrl:]]{1,2048}$' then
    raise exception 'moved Outlook message id is required';
  end if;
  if p_result = 'dispatching' and v_job.status not in ('claimed', 'dispatching') then
    raise exception 'invalid transition to Outlook archive dispatching';
  elsif p_result = 'archived' and v_job.status not in ('dispatching', 'archived') then
    raise exception 'invalid transition to Outlook archived';
  elsif p_result = 'retryable_error' and v_job.status not in ('claimed', 'retryable_error', 'manual_review') then
    raise exception 'Outlook archive retry is safe only before move dispatch';
  elsif p_result = 'invalid_target' and v_job.status not in ('claimed', 'manual_review') then
    raise exception 'invalid Outlook target is valid only before move dispatch';
  elsif p_result = 'uncertain' and v_job.status not in ('dispatching', 'manual_review') then
    raise exception 'Outlook archive uncertainty is valid only after move dispatch';
  end if;

  v_retry_exhausted := p_result = 'retryable_error' and v_job.attempts >= v_job.max_attempts;
  if p_result = 'retryable_error' and v_job.status = 'manual_review' and not v_retry_exhausted then
    raise exception 'Outlook archive manual state cannot return to automatic retry';
  end if;
  v_next_status := case
    when p_result in ('invalid_target', 'uncertain') or v_retry_exhausted then 'manual_review'
    else p_result
  end;

  update public.arrival_label_outlook_archive_jobs
  set status = v_next_status,
      moved_message_id = coalesce(nullif(btrim(p_moved_message_id), ''), moved_message_id),
      last_error = nullif(left(coalesce(p_error, ''), 500), ''),
      dispatching_at = case when p_result = 'dispatching' then coalesce(dispatching_at, p_now) else dispatching_at end,
      archived_at = case when p_result = 'archived' then coalesce(archived_at, p_now) else archived_at end,
      lease_expires_at = case
        when p_result in ('archived', 'retryable_error', 'invalid_target', 'uncertain') or v_retry_exhausted then null
        else lease_expires_at
      end,
      lease_owner = case
        when p_result in ('archived', 'retryable_error', 'invalid_target', 'uncertain') or v_retry_exhausted then null
        else lease_owner
      end,
      updated_at = p_now
  where id = p_archive_job_id
  returning * into v_job;

  select run_id into v_run_id from public.arrival_label_cases where id = v_job.case_id;
  insert into public.arrival_label_events (run_id, case_id, event_key, event_type, severity, actor, payload)
  values (
    v_run_id,
    v_job.case_id,
    'outlook-archive:' || v_job.id::text || ':' || p_result,
    'outlook_archive_' || p_result,
    case when p_result in ('retryable_error', 'invalid_target', 'uncertain') then 'warning' else 'info' end,
    'arrival-label-outlook-archive-worker:' || left(p_worker_id, 96),
    jsonb_build_object(
      'archiveJobId', v_job.id,
      'printJobId', v_job.print_job_id,
      'attempts', v_job.attempts,
      'retryExhausted', v_retry_exhausted,
      'hasMoveReceipt', v_job.moved_message_id is not null
    )
  ) on conflict (event_key) do nothing;

  return next v_job;
end;
$$;

revoke execute on function public.arrival_labels_enqueue_outlook_archives_for_print(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.arrival_labels_queue_outlook_archives_after_print() from public, anon, authenticated;
revoke execute on function public.arrival_labels_claim_outlook_archive(text, integer, timestamptz) from public, anon, authenticated;
revoke execute on function public.arrival_labels_update_outlook_archive(uuid, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.arrival_labels_enqueue_outlook_archives_for_print(uuid, timestamptz) to service_role;
grant execute on function public.arrival_labels_queue_outlook_archives_after_print() to service_role;
grant execute on function public.arrival_labels_claim_outlook_archive(text, integer, timestamptz) to service_role;
grant execute on function public.arrival_labels_update_outlook_archive(uuid, text, text, text, text, timestamptz) to service_role;

comment on table public.arrival_label_outlook_archive_settings is
  'Fail-closed activation boundary for archiving exact DHL Outlook messages after a confirmed label print.';
comment on table public.arrival_label_outlook_archive_jobs is
  'Idempotent Outlook move outbox. Only exact DHL messages tied to a confirmed shipping-label print are eligible; dispatch uncertainty is never auto-retried.';
