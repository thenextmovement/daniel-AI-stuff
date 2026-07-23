create table if not exists public.arrival_label_trello_arrival_settings (
  singleton boolean primary key default true,
  enabled boolean not null default false,
  enabled_after timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint arrival_label_trello_arrival_settings_singleton_check check (singleton)
);

insert into public.arrival_label_trello_arrival_settings (singleton, enabled)
values (true, false)
on conflict (singleton) do nothing;

create table if not exists public.arrival_label_trello_arrival_jobs (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null unique references public.arrival_label_cases(id) on delete cascade,
  idempotency_key text not null unique,
  expected_tracking_number text not null,
  trello_card_id text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  lease_owner text null,
  lease_expires_at timestamptz null,
  moved_card_id text null,
  last_error text null,
  claimed_at timestamptz null,
  dispatching_at timestamptz null,
  moved_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint arrival_label_trello_arrival_jobs_key_check check (
    idempotency_key ~ '^arrival-trello-arrived:[0-9a-f-]{36}$'
  ),
  constraint arrival_label_trello_arrival_jobs_tracking_check check (
    expected_tracking_number ~ '^[0-9]{10,40}$'
  ),
  constraint arrival_label_trello_arrival_jobs_card_check check (
    trello_card_id ~ '^[A-Fa-f0-9]{24}$'
    and (moved_card_id is null or moved_card_id ~ '^[A-Fa-f0-9]{24}$')
  ),
  constraint arrival_label_trello_arrival_jobs_status_check check (
    status in ('pending', 'claimed', 'dispatching', 'moved', 'retryable_error', 'manual_review', 'cancelled')
  ),
  constraint arrival_label_trello_arrival_jobs_attempts_check check (
    attempts >= 0 and max_attempts between 1 and 5
  )
);

create index if not exists arrival_label_trello_arrival_jobs_claim_idx
  on public.arrival_label_trello_arrival_jobs (status, created_at)
  where status in ('pending', 'claimed', 'retryable_error');

create index if not exists arrival_label_trello_arrival_jobs_reconcile_idx
  on public.arrival_label_trello_arrival_jobs (status, updated_at)
  where status in ('dispatching', 'manual_review');

alter table public.arrival_label_trello_arrival_settings enable row level security;
alter table public.arrival_label_trello_arrival_jobs enable row level security;
revoke all on table public.arrival_label_trello_arrival_settings from public, anon, authenticated;
revoke all on table public.arrival_label_trello_arrival_jobs from public, anon, authenticated;
grant select, insert, update on table public.arrival_label_trello_arrival_settings to service_role;
grant select, insert, update on table public.arrival_label_trello_arrival_jobs to service_role;

-- A later "delivered" mail is part of the same shipment case. Preserve every
-- exact Outlook message ID and make the delivered state monotonic across reruns.
create or replace function public.arrival_labels_preserve_case_progress()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  old_rank integer;
  new_rank integer;
begin
  old_rank := case old.delivery_note_status
    when 'not_required' then 0 when 'planned' then 1 when 'qa_approved' then 2
    when 'print_queued' then 3 when 'printed' then 4 when 'manual_review' then 5 else 0 end;
  new_rank := case new.delivery_note_status
    when 'not_required' then 0 when 'planned' then 1 when 'qa_approved' then 2
    when 'print_queued' then 3 when 'printed' then 4 when 'manual_review' then 5 else 0 end;
  if old.delivery_note_required and new.delivery_note_required and old_rank > new_rank then
    new.delivery_note_status := old.delivery_note_status;
  end if;
  select coalesce(array_agg(distinct message_id order by message_id), '{}'::text[])
  into new.outlook_message_ids
  from unnest(coalesce(old.outlook_message_ids, '{}'::text[]) || coalesce(new.outlook_message_ids, '{}'::text[]))
    as messages(message_id)
  where length(message_id) between 1 and 2048
    and message_id !~ '[[:cntrl:]]';
  if old.outlook_delivery_state = 'delivered_today' or new.outlook_delivery_state = 'delivered_today' then
    new.outlook_delivery_state := 'delivered_today';
  end if;
  new.existing_dpd_tracking := coalesce(new.existing_dpd_tracking, old.existing_dpd_tracking);
  new.original_pdf_path := coalesce(new.original_pdf_path, old.original_pdf_path);
  new.annotated_pdf_path := coalesce(new.annotated_pdf_path, old.annotated_pdf_path);
  new.rendered_preview_path := coalesce(new.rendered_preview_path, old.rendered_preview_path);
  if old.status in ('label_created', 'pdf_processed', 'completed')
    and new.status in ('discovered', 'trello_matched', 'shopify_matched', 'validated', 'label_planned', 'existing_label', 'already_fulfilled') then
    new.status := old.status;
  end if;
  return new;
end;
$$;

revoke execute on function public.arrival_labels_preserve_case_progress() from public, anon, authenticated;
grant execute on function public.arrival_labels_preserve_case_progress() to service_role;

create or replace function public.arrival_labels_enqueue_trello_arrival(
  p_case_id uuid,
  p_now timestamptz default now()
)
returns integer
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_inserted integer := 0;
begin
  if not exists (
    select 1
    from public.arrival_label_trello_arrival_settings s
    where s.singleton and s.enabled and p_now >= s.enabled_after
  ) then
    return 0;
  end if;

  with eligible as (
    select c.id, c.run_id, c.incoming_dhl_tracking_number, c.trello_card_id
    from public.arrival_label_cases c
    cross join public.arrival_label_trello_arrival_settings s
    where s.singleton and s.enabled
      and c.id = p_case_id
      and c.updated_at >= s.enabled_after
      and c.outlook_delivery_state = 'delivered_today'
      and c.incoming_dhl_tracking_number ~ '^[0-9]{10,40}$'
      and c.trello_card_id ~ '^[A-Fa-f0-9]{24}$'
      and cardinality(c.outlook_message_ids) > 0
      and exists (
        select 1
        from public.arrival_label_print_jobs p
        where p.case_id = c.id
          and p.document_kind = 'label'
          and p.status = 'printed'
      )
      and exists (
        select 1
        from public.arrival_label_outlook_archive_jobs a
        where a.case_id = c.id
          and a.status = 'archived'
          and a.archived_at >= s.enabled_after
      )
      and not exists (
        select 1
        from unnest(c.outlook_message_ids) as messages(message_id)
        where not exists (
          select 1
          from public.arrival_label_outlook_archive_jobs a
          where a.case_id = c.id
            and a.source_message_id_sha256 = encode(extensions.digest(message_id, 'sha256'), 'hex')
            and a.status = 'archived'
        )
      )
  ), inserted as (
    insert into public.arrival_label_trello_arrival_jobs (
      case_id, idempotency_key, expected_tracking_number, trello_card_id
    )
    select
      e.id,
      'arrival-trello-arrived:' || e.id::text,
      e.incoming_dhl_tracking_number,
      e.trello_card_id
    from eligible e
    on conflict (case_id) do nothing
    returning id, case_id
  ), events as (
    insert into public.arrival_label_events (
      run_id, case_id, event_key, event_type, severity, actor, payload
    )
    select
      c.run_id,
      i.case_id,
      'trello-arrival:' || i.id::text || ':queued',
      'trello_arrival_queued',
      'info',
      'arrival-label-trello-arrival-outbox',
      jsonb_build_object('trelloArrivalJobId', i.id)
    from inserted i
    join public.arrival_label_cases c on c.id = i.case_id
    on conflict (event_key) do nothing
  )
  select count(*) into v_inserted from inserted;

  return v_inserted;
end;
$$;

create or replace function public.arrival_labels_queue_trello_arrival_after_archive()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.status = 'archived' and old.status is distinct from 'archived' then
    begin
      perform public.arrival_labels_enqueue_trello_arrival(new.case_id, now());
    exception when others then
      raise warning 'arrival Trello projection enqueue failed for case %', new.case_id;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists arrival_label_outlook_archives_queue_trello_arrival
  on public.arrival_label_outlook_archive_jobs;
create trigger arrival_label_outlook_archives_queue_trello_arrival
after update of status on public.arrival_label_outlook_archive_jobs
for each row execute function public.arrival_labels_queue_trello_arrival_after_archive();

create or replace function public.arrival_labels_claim_trello_arrival(
  p_worker_id text,
  p_lease_seconds integer default 180,
  p_now timestamptz default now()
)
returns setof public.arrival_label_trello_arrival_jobs
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_job public.arrival_label_trello_arrival_jobs%rowtype;
  v_case_id uuid;
begin
  if coalesce(p_worker_id, '') !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{2,95}$' then
    raise exception 'invalid Trello arrival worker id';
  end if;
  if p_lease_seconds < 60 or p_lease_seconds > 900 then
    raise exception 'Trello arrival lease seconds must be between 60 and 900';
  end if;
  if not exists (
    select 1 from public.arrival_label_trello_arrival_settings s
    where s.singleton and s.enabled and p_now >= s.enabled_after
  ) then
    return;
  end if;

  select * into v_job
  from public.arrival_label_trello_arrival_jobs
  where lease_owner = p_worker_id and status = 'claimed' and lease_expires_at > p_now
  order by claimed_at desc limit 1 for update skip locked;
  if found then return next v_job; return; end if;

  with uncertain as (
    update public.arrival_label_trello_arrival_jobs
    set status = 'manual_review', lease_owner = null, lease_expires_at = null,
        last_error = 'Trello move began but completion is unknown; do not automatically move again.',
        updated_at = p_now
    where status = 'dispatching' and lease_expires_at <= p_now
    returning id, case_id
  )
  insert into public.arrival_label_events (run_id, case_id, event_key, event_type, severity, actor, payload)
  select c.run_id, u.case_id, 'trello-arrival:' || u.id::text || ':uncertain',
         'trello_arrival_uncertain', 'warning', 'arrival-label-trello-arrival-outbox',
         jsonb_build_object('trelloArrivalJobId', u.id, 'automaticRetry', false)
  from uncertain u join public.arrival_label_cases c on c.id = u.case_id
  on conflict (event_key) do nothing;

  with exhausted as (
    update public.arrival_label_trello_arrival_jobs
    set status = 'manual_review', lease_owner = null, lease_expires_at = null,
        last_error = 'Trello arrival projection exhausted safe retries before move dispatch.',
        updated_at = p_now
    where status in ('claimed', 'retryable_error') and attempts >= max_attempts
      and (lease_expires_at is null or lease_expires_at <= p_now)
    returning id, case_id
  )
  insert into public.arrival_label_events (run_id, case_id, event_key, event_type, severity, actor, payload)
  select c.run_id, e.case_id, 'trello-arrival:' || e.id::text || ':retry-exhausted',
         'trello_arrival_retry_exhausted', 'warning', 'arrival-label-trello-arrival-outbox',
         jsonb_build_object('trelloArrivalJobId', e.id)
  from exhausted e join public.arrival_label_cases c on c.id = e.case_id
  on conflict (event_key) do nothing;

  -- Reconciliation is bounded by the activation timestamp in the enqueue function.
  select c.id into v_case_id
  from public.arrival_label_cases c
  cross join public.arrival_label_trello_arrival_settings s
  where s.singleton and s.enabled
    and c.updated_at >= s.enabled_after
    and c.outlook_delivery_state = 'delivered_today'
    and c.trello_card_id ~ '^[A-Fa-f0-9]{24}$'
    and not exists (
      select 1 from public.arrival_label_trello_arrival_jobs j where j.case_id = c.id
    )
  order by c.updated_at asc
  limit 1;
  if v_case_id is not null then
    perform public.arrival_labels_enqueue_trello_arrival(v_case_id, p_now);
  end if;

  select * into v_job
  from public.arrival_label_trello_arrival_jobs
  where status in ('pending', 'claimed', 'retryable_error')
    and attempts < max_attempts
    and (lease_expires_at is null or lease_expires_at <= p_now)
  order by created_at asc limit 1 for update skip locked;
  if not found then return; end if;

  update public.arrival_label_trello_arrival_jobs
  set status = 'claimed', attempts = attempts + 1, lease_owner = p_worker_id,
      lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
      claimed_at = p_now, last_error = null, updated_at = p_now
  where id = v_job.id
  returning * into v_job;

  return next v_job;
end;
$$;

create or replace function public.arrival_labels_update_trello_arrival(
  p_job_id uuid,
  p_worker_id text,
  p_result text,
  p_moved_card_id text default null,
  p_error text default null,
  p_now timestamptz default now()
)
returns setof public.arrival_label_trello_arrival_jobs
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_job public.arrival_label_trello_arrival_jobs%rowtype;
  v_next_status text;
  v_retry_exhausted boolean;
  v_run_id uuid;
begin
  if p_result not in ('dispatching', 'moved', 'retryable_error', 'invalid_target', 'uncertain') then
    raise exception 'invalid Trello arrival result';
  end if;

  select * into v_job
  from public.arrival_label_trello_arrival_jobs
  where id = p_job_id
    and (
      lease_owner = p_worker_id
      or (
        status = 'moved'
        and p_result = 'moved'
        and (
          nullif(btrim(p_moved_card_id), '') is null
          or moved_card_id = nullif(btrim(p_moved_card_id), '')
        )
      )
    )
  for update;
  if not found then raise exception 'Trello arrival job not owned by worker'; end if;

  if p_result = 'moved'
    and coalesce(nullif(btrim(p_moved_card_id), ''), v_job.moved_card_id, '') !~ '^[A-Fa-f0-9]{24}$' then
    raise exception 'moved Trello card id is required';
  end if;
  if p_result = 'dispatching' and v_job.status not in ('claimed', 'dispatching') then
    raise exception 'invalid transition to Trello arrival dispatching';
  elsif p_result = 'moved' and v_job.status not in ('claimed', 'dispatching', 'moved') then
    raise exception 'invalid transition to Trello arrival moved';
  elsif p_result = 'retryable_error' and v_job.status not in ('claimed', 'retryable_error', 'manual_review') then
    raise exception 'Trello arrival retry is safe only before move dispatch';
  elsif p_result = 'invalid_target' and v_job.status not in ('claimed', 'manual_review') then
    raise exception 'invalid Trello target is valid only before move dispatch';
  elsif p_result = 'uncertain' and v_job.status not in ('dispatching', 'manual_review') then
    raise exception 'Trello arrival uncertainty is valid only after move dispatch';
  end if;

  v_retry_exhausted := p_result = 'retryable_error' and v_job.attempts >= v_job.max_attempts;
  if p_result = 'retryable_error' and v_job.status = 'manual_review' and not v_retry_exhausted then
    raise exception 'Trello arrival manual state cannot return to automatic retry';
  end if;
  v_next_status := case
    when p_result in ('invalid_target', 'uncertain') or v_retry_exhausted then 'manual_review'
    else p_result
  end;

  update public.arrival_label_trello_arrival_jobs
  set status = v_next_status,
      moved_card_id = coalesce(nullif(btrim(p_moved_card_id), ''), moved_card_id),
      last_error = nullif(left(coalesce(p_error, ''), 500), ''),
      dispatching_at = case when p_result = 'dispatching' then coalesce(dispatching_at, p_now) else dispatching_at end,
      moved_at = case when p_result = 'moved' then coalesce(moved_at, p_now) else moved_at end,
      lease_expires_at = case
        when p_result in ('moved', 'retryable_error', 'invalid_target', 'uncertain') or v_retry_exhausted then null
        else lease_expires_at
      end,
      lease_owner = case
        when p_result in ('moved', 'retryable_error', 'invalid_target', 'uncertain') or v_retry_exhausted then null
        else lease_owner
      end,
      updated_at = p_now
  where id = p_job_id
  returning * into v_job;

  select run_id into v_run_id from public.arrival_label_cases where id = v_job.case_id;
  insert into public.arrival_label_events (run_id, case_id, event_key, event_type, severity, actor, payload)
  values (
    v_run_id,
    v_job.case_id,
    'trello-arrival:' || v_job.id::text || ':' || p_result,
    'trello_arrival_' || p_result,
    case when p_result in ('retryable_error', 'invalid_target', 'uncertain') then 'warning' else 'info' end,
    'arrival-label-trello-arrival-worker:' || left(p_worker_id, 96),
    jsonb_build_object(
      'trelloArrivalJobId', v_job.id,
      'attempts', v_job.attempts,
      'retryExhausted', v_retry_exhausted,
      'hasMoveReceipt', v_job.moved_card_id is not null
    )
  ) on conflict (event_key) do nothing;

  return next v_job;
end;
$$;

revoke execute on function public.arrival_labels_enqueue_trello_arrival(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.arrival_labels_queue_trello_arrival_after_archive() from public, anon, authenticated;
revoke execute on function public.arrival_labels_claim_trello_arrival(text, integer, timestamptz) from public, anon, authenticated;
revoke execute on function public.arrival_labels_update_trello_arrival(uuid, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.arrival_labels_enqueue_trello_arrival(uuid, timestamptz) to service_role;
grant execute on function public.arrival_labels_queue_trello_arrival_after_archive() to service_role;
grant execute on function public.arrival_labels_claim_trello_arrival(text, integer, timestamptz) to service_role;
grant execute on function public.arrival_labels_update_trello_arrival(uuid, text, text, text, text, timestamptz) to service_role;

comment on table public.arrival_label_trello_arrival_settings is
  'Fail-closed activation boundary for the post-print, post-Outlook-archive Sign Arrived projection.';
comment on table public.arrival_label_trello_arrival_jobs is
  'Idempotent Trello projection outbox. Trello remains a projection; dispatch uncertainty is never auto-retried.';
