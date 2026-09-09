begin;

alter table public.dunning_status
  add column if not exists pause_mode text,
  add column if not exists pause_until timestamptz,
  add column if not exists pause_reason text,
  add column if not exists paused_at timestamptz,
  add column if not exists paused_by text,
  add column if not exists pause_version bigint not null default 0;

alter table public.dunning_status
  drop constraint if exists dunning_status_pause_mode_check,
  add constraint dunning_status_pause_mode_check
    check (pause_mode is null or pause_mode in ('manual', 'until_date')),
  drop constraint if exists dunning_status_pause_until_check,
  add constraint dunning_status_pause_until_check
    check (
      (pause_mode = 'until_date' and pause_until is not null)
      or (pause_mode is distinct from 'until_date' and pause_until is null)
    ),
  drop constraint if exists dunning_status_pause_reason_check,
  add constraint dunning_status_pause_reason_check
    check (
      pause_reason is null
      or char_length(btrim(pause_reason)) between 3 and 500
    ),
  drop constraint if exists dunning_status_paused_by_check,
  add constraint dunning_status_paused_by_check
    check (
      paused_by is null
      or char_length(btrim(paused_by)) between 3 and 180
    ),
  drop constraint if exists dunning_status_pause_version_check,
  add constraint dunning_status_pause_version_check
    check (pause_version >= 0),
  drop constraint if exists dunning_status_pause_shape_check,
  add constraint dunning_status_pause_shape_check
    check (
      (
        paused = false
        and pause_mode is null
        and pause_until is null
        and pause_reason is null
        and paused_at is null
        and paused_by is null
      )
      or (
        paused = true
        and (
          (
            pause_mode is null
            and pause_until is null
          )
          or (
            pause_mode in ('manual', 'until_date')
            and pause_reason is not null
            and paused_at is not null
            and paused_by is not null
          )
        )
      )
    );

create table public.dunning_pause_events (
  id uuid primary key default gen_random_uuid(),
  shopify_order_number text not null,
  action text not null,
  actor text not null,
  reason text not null,
  pause_mode text,
  pause_until timestamptz,
  previous_paused boolean not null,
  new_paused boolean not null,
  previous_pause_version bigint not null,
  new_pause_version bigint not null,
  previous_note text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  constraint dunning_pause_events_order_check
    check (shopify_order_number ~ '^#NEONT[0-9]{1,12}$'),
  constraint dunning_pause_events_action_check
    check (action in ('pause', 'resume', 'auto_resume')),
  constraint dunning_pause_events_actor_check
    check (char_length(btrim(actor)) between 3 and 180),
  constraint dunning_pause_events_reason_check
    check (char_length(btrim(reason)) between 3 and 500),
  constraint dunning_pause_events_mode_check
    check (pause_mode is null or pause_mode in ('manual', 'until_date')),
  constraint dunning_pause_events_until_check
    check (
      (action = 'pause' and pause_mode = 'until_date' and pause_until is not null)
      or (action = 'pause' and pause_mode = 'manual' and pause_until is null)
      or (action in ('resume', 'auto_resume') and pause_mode is null and pause_until is null)
    ),
  constraint dunning_pause_events_version_check
    check (
      previous_pause_version >= 0
      and new_pause_version = previous_pause_version + 1
    ),
  constraint dunning_pause_events_note_check
    check (previous_note is null or char_length(previous_note) <= 2000),
  constraint dunning_pause_events_idempotency_check
    check (
      idempotency_key ~ '^(ops-dunning-pause|n8n-dunning-resume):[A-Za-z0-9:_-]{16,200}$'
    )
);

create index dunning_pause_events_order_created_idx
  on public.dunning_pause_events (shopify_order_number, created_at desc);

alter table public.dunning_pause_events enable row level security;

create policy dunning_pause_events_service_role_select
  on public.dunning_pause_events
  for select to service_role
  using (true);

create policy dunning_pause_events_service_role_insert
  on public.dunning_pause_events
  for insert to service_role
  with check (true);

revoke all on table public.dunning_pause_events
  from public, anon, authenticated;
grant select, insert on table public.dunning_pause_events
  to service_role;

comment on table public.dunning_pause_events is
  'Append-only audit trail for manual and due-date dunning pauses. Resuming never sends customer email directly.';

create function public.apply_dunning_pause_action(
  p_shopify_order_number text,
  p_action text,
  p_actor text,
  p_reason text,
  p_pause_mode text,
  p_pause_until timestamptz,
  p_expected_pause_version bigint,
  p_expected_updated_at timestamptz,
  p_shopify_order_id text,
  p_current_stage integer,
  p_last_sent_at timestamptz,
  p_idempotency_key text
)
returns table (
  applied boolean,
  event_id uuid,
  result_paused boolean,
  result_pause_mode text,
  result_pause_until timestamptz,
  result_pause_reason text,
  result_paused_at timestamptz,
  result_paused_by text,
  result_pause_version bigint,
  result_updated_at timestamptz
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_order text := upper(btrim(coalesce(p_shopify_order_number, '')));
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_actor text := btrim(coalesce(p_actor, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_mode text := nullif(lower(btrim(coalesce(p_pause_mode, ''))), '');
  v_status public.dunning_status%rowtype;
  v_event_id uuid;
  v_existing_event public.dunning_pause_events%rowtype;
  v_exists boolean := false;
  v_previous_paused boolean := false;
  v_previous_version bigint := 0;
  v_previous_note text;
begin
  if v_order !~ '^#NEONT[0-9]{1,12}$'
     or v_action not in ('pause', 'resume', 'auto_resume')
     or char_length(v_actor) not between 3 and 180
     or char_length(v_reason) not between 3 and 500
     or p_expected_pause_version is null
     or p_expected_pause_version < 0
     or p_current_stage is null
     or (p_shopify_order_id is not null and p_shopify_order_id !~ '^[0-9]+$')
     or p_current_stage not between 0 and 7
     or p_idempotency_key !~ '^(ops-dunning-pause|n8n-dunning-resume):[A-Za-z0-9:_-]{16,200}$' then
    raise exception 'DUNNING_PAUSE_INVALID' using errcode = '22023';
  end if;

  if v_action = 'pause' and (
    v_mode not in ('manual', 'until_date')
    or (v_mode = 'manual' and p_pause_until is not null)
    or (v_mode = 'until_date' and (p_pause_until is null or p_pause_until <= now()))
  ) then
    raise exception 'DUNNING_PAUSE_INVALID' using errcode = '22023';
  end if;

  if v_action in ('resume', 'auto_resume') and (
    v_mode is not null or p_pause_until is not null
  ) then
    raise exception 'DUNNING_PAUSE_INVALID' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 271));
  perform pg_advisory_xact_lock(hashtextextended(v_order, 271));

  select existing.*
    into v_existing_event
  from public.dunning_pause_events as existing
  where existing.idempotency_key = p_idempotency_key;

  if found then
    if v_existing_event.shopify_order_number is distinct from v_order
       or v_existing_event.action is distinct from v_action
       or v_existing_event.actor is distinct from v_actor
       or v_existing_event.reason is distinct from v_reason
       or v_existing_event.pause_mode is distinct from (
         case when v_action = 'pause' then v_mode else null end
       )
       or v_existing_event.pause_until is distinct from (
         case when v_action = 'pause' then p_pause_until else null end
       ) then
      raise exception 'DUNNING_PAUSE_INVALID' using errcode = '22023';
    end if;
    v_event_id := v_existing_event.id;
    select current_status.*
      into v_status
    from public.dunning_status as current_status
    where current_status.shopify_order_number = v_order;
    if not found then
      raise exception 'DUNNING_PAUSE_STATE_MISSING' using errcode = '55000';
    end if;
    return query select
      false,
      v_event_id,
      v_status.paused,
      v_status.pause_mode,
      v_status.pause_until,
      v_status.pause_reason,
      v_status.paused_at,
      v_status.paused_by,
      v_status.pause_version,
      v_status.updated_at;
    return;
  end if;

  select current_status.*
    into v_status
  from public.dunning_status as current_status
  where current_status.shopify_order_number = v_order
  for update;
  v_exists := found;
  v_previous_paused := coalesce(v_status.paused, false);
  v_previous_version := coalesce(v_status.pause_version, 0);
  v_previous_note := v_status.note;

  if p_expected_pause_version is distinct from v_previous_version
     or p_expected_updated_at is distinct from v_status.updated_at then
    raise exception 'DUNNING_PAUSE_STALE' using errcode = '40001';
  end if;

  if v_action = 'pause'
     and p_shopify_order_id is not null
     and exists (
       select 1
       from public.email_locks as active_lock
       where active_lock.request_id like
         'e936881a-fe32-4d94-aa1d-eaffcf4a75be:T099:PAYMENT_COLLECTION:'
         || p_shopify_order_id || ':%'
         and active_lock.status = 'processing'
     ) then
    raise exception 'DUNNING_PAUSE_SEND_IN_PROGRESS' using errcode = '55000';
  end if;

  if v_action = 'pause' then
    if v_previous_paused then
      raise exception 'DUNNING_PAUSE_STATE_CHANGED' using errcode = '40001';
    end if;
    if v_exists then
      update public.dunning_status as target
      set paused = true,
          note = v_reason,
          pause_mode = v_mode,
          pause_until = p_pause_until,
          pause_reason = v_reason,
          paused_at = now(),
          paused_by = v_actor,
          pause_version = v_previous_version + 1,
          updated_by = v_actor,
          updated_at = now()
      where target.shopify_order_number = v_order
      returning target.* into v_status;
    else
      insert into public.dunning_status (
        shopify_order_number,
        mahnstufe,
        last_sent_at,
        paused,
        note,
        pause_mode,
        pause_until,
        pause_reason,
        paused_at,
        paused_by,
        pause_version,
        updated_by,
        updated_at
      ) values (
        v_order,
        p_current_stage,
        p_last_sent_at,
        true,
        v_reason,
        v_mode,
        p_pause_until,
        v_reason,
        now(),
        v_actor,
        1,
        v_actor,
        now()
      )
      returning * into v_status;
    end if;
  else
    if not v_exists then
      raise exception 'DUNNING_PAUSE_STATE_MISSING' using errcode = 'P0002';
    end if;
    if not v_previous_paused then
      raise exception 'DUNNING_PAUSE_STATE_CHANGED' using errcode = '40001';
    end if;
    if v_action = 'auto_resume' and (
      v_status.pause_mode is distinct from 'until_date'
      or v_status.pause_until is null
      or v_status.pause_until > now()
    ) then
      raise exception 'DUNNING_PAUSE_NOT_DUE' using errcode = '55000';
    end if;
    update public.dunning_status as target
    set paused = false,
        note = v_reason,
        pause_mode = null,
        pause_until = null,
        pause_reason = null,
        paused_at = null,
        paused_by = null,
        pause_version = v_previous_version + 1,
        updated_by = v_actor,
        updated_at = now()
    where target.shopify_order_number = v_order
    returning target.* into v_status;
  end if;

  insert into public.dunning_pause_events (
    shopify_order_number,
    action,
    actor,
    reason,
    pause_mode,
    pause_until,
    previous_paused,
    new_paused,
    previous_pause_version,
    new_pause_version,
    previous_note,
    idempotency_key
  ) values (
    v_order,
    v_action,
    v_actor,
    v_reason,
    case when v_action = 'pause' then v_mode else null end,
    case when v_action = 'pause' then p_pause_until else null end,
    v_previous_paused,
    v_status.paused,
    v_previous_version,
    v_status.pause_version,
    v_previous_note,
    p_idempotency_key
  )
  returning id into v_event_id;

  return query select
    true,
    v_event_id,
    v_status.paused,
    v_status.pause_mode,
    v_status.pause_until,
    v_status.pause_reason,
    v_status.paused_at,
    v_status.paused_by,
    v_status.pause_version,
    v_status.updated_at;
end;
$function$;

revoke all on function public.apply_dunning_pause_action(
  text, text, text, text, text, timestamptz, bigint, timestamptz,
  text, integer, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.apply_dunning_pause_action(
  text, text, text, text, text, timestamptz, bigint, timestamptz,
  text, integer, timestamptz, text
) to service_role;

comment on function public.apply_dunning_pause_action(
  text, text, text, text, text, timestamptz, bigint, timestamptz,
  text, integer, timestamptz, text
) is 'Atomically pauses or reopens one dunning case with optimistic concurrency and an idempotent append-only audit event. It never sends customer email.';

create function public.claim_dunning_email_if_unpaused(
  p_shopify_order_number text,
  p_lock_key text
)
returns setof public.email_locks
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_order text := upper(btrim(coalesce(p_shopify_order_number, '')));
  v_lock_key text := btrim(coalesce(p_lock_key, ''));
  v_lock public.email_locks%rowtype;
  v_paused boolean := false;
begin
  if v_order !~ '^#NEONT[0-9]{1,12}$'
     or v_lock_key !~ '^e936881a-fe32-4d94-aa1d-eaffcf4a75be:T099:PAYMENT_COLLECTION:[0-9]+(?::C-[A-Za-z0-9-]+)?:S[1-6]$' then
    raise exception 'DUNNING_CLAIM_INVALID' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_order, 271));

  select coalesce(status.paused, false)
    into v_paused
  from public.dunning_status as status
  where status.shopify_order_number = v_order
  for update;

  if coalesce(v_paused, false) then
    raise exception 'DUNNING_PAUSE_ACTIVE' using errcode = '55000';
  end if;

  insert into public.email_locks as target (
    request_id,
    locked_at,
    status,
    attempt_count,
    lease_until,
    next_retry_at,
    last_error,
    draft_id,
    message_id,
    internet_message_id,
    conversation_id,
    updated_at
  ) values (
    v_lock_key,
    timestamptz '2100-01-01T00:00:00.000Z',
    'processing',
    1,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    now()
  )
  returning target.* into v_lock;

  return next v_lock;
end;
$function$;

revoke all on function public.claim_dunning_email_if_unpaused(text, text)
  from public, anon, authenticated;
grant execute on function public.claim_dunning_email_if_unpaused(text, text)
  to service_role;

comment on function public.claim_dunning_email_if_unpaused(text, text) is
  'Claims one TICKET-099 customer email only while the matching dunning case is unpaused, using the same per-case transaction lock as pause actions.';

commit;
