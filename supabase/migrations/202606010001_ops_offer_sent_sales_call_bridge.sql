create table if not exists public.ops_offer_events (
  id uuid primary key default gen_random_uuid(),
  request_id text not null,
  trello_card_id text,
  offer_id text not null,
  offer_number text,
  document_reference text,
  public_url text,
  event_type text not null,
  recipient_email text,
  event_at timestamptz not null default now(),
  source text not null default 'neontrip_offers',
  source_event_id text,
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ops_offer_events_event_type_check check (
    event_type in ('offer_sent', 'offer_updated', 'offer_viewed', 'offer_accepted')
  )
);

create unique index if not exists ops_offer_events_idempotency_key_idx
  on public.ops_offer_events (idempotency_key);

create index if not exists ops_offer_events_request_event_idx
  on public.ops_offer_events (request_id, event_type, event_at desc);

create index if not exists ops_offer_events_offer_idx
  on public.ops_offer_events (offer_id, event_at desc);

comment on table public.ops_offer_events is
  'Operational bridge events from neontrip-offers into the Supabase ops/call source of truth.';

create or replace function public.ops_offer_call_due_at(p_sent_at timestamptz)
returns timestamptz
language plpgsql
immutable
as $$
begin
  return coalesce(p_sent_at, now()) + interval '30 minutes';
end;
$$;

create or replace function public.ops_offer_reminder_due_at(p_sent_at timestamptz)
returns timestamptz
language plpgsql
immutable
as $$
declare
  v_due timestamptz := coalesce(p_sent_at, now()) + interval '3 days';
begin
  while extract(isodow from v_due) in (6, 7) loop
    v_due := v_due + interval '1 day';
  end loop;
  return date_trunc('day', v_due) + interval '9 hours 30 minutes';
end;
$$;

create or replace function public.ops_record_offer_sent(
  p_request_id text default null,
  p_trello_card_id text default null,
  p_offer_id text default null,
  p_offer_number text default null,
  p_document_reference text default null,
  p_public_url text default null,
  p_recipient_email text default null,
  p_sent_at timestamptz default now(),
  p_source text default 'neontrip_offers',
  p_source_event_id text default null,
  p_idempotency_key text default null,
  p_actor text default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id text := nullif(trim(coalesce(p_request_id, '')), '');
  v_trello_card_id text := nullif(trim(coalesce(p_trello_card_id, '')), '');
  v_offer_id text := nullif(trim(coalesce(p_offer_id, '')), '');
  v_sent_at timestamptz := coalesce(p_sent_at, now());
  v_call_due_at timestamptz := public.ops_offer_call_due_at(coalesce(p_sent_at, now()));
  v_reminder_due_at timestamptz := public.ops_offer_reminder_due_at(coalesce(p_sent_at, now()));
  v_idempotency_key text;
  v_event_id uuid;
  v_task_id uuid;
  v_closed_inquiry_count integer := 0;
begin
  if v_request_id is null and v_trello_card_id is not null then
    select mr.request_id
      into v_request_id
    from public.master_requests mr
    where mr.trello_card_id = v_trello_card_id
    order by mr.updated_at desc nulls last, mr.created_at desc nulls last
    limit 1;
  end if;

  if v_request_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_request_id');
  end if;

  if v_offer_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_offer_id', 'request_id', v_request_id);
  end if;

  v_idempotency_key := nullif(trim(coalesce(p_idempotency_key, '')), '');
  if v_idempotency_key is null then
    v_idempotency_key := 'offer-sent:' || v_request_id || ':' || v_offer_id || ':' || coalesce(p_source_event_id, 'sent');
  end if;

  perform pg_advisory_xact_lock(hashtext('ops_offer_sent:' || v_request_id));

  insert into public.ops_offer_events (
    request_id,
    trello_card_id,
    offer_id,
    offer_number,
    document_reference,
    public_url,
    event_type,
    recipient_email,
    event_at,
    source,
    source_event_id,
    idempotency_key,
    payload
  )
  values (
    v_request_id,
    v_trello_card_id,
    v_offer_id,
    nullif(trim(coalesce(p_offer_number, '')), ''),
    nullif(trim(coalesce(p_document_reference, '')), ''),
    nullif(trim(coalesce(p_public_url, '')), ''),
    'offer_sent',
    nullif(trim(coalesce(p_recipient_email, '')), ''),
    v_sent_at,
    nullif(trim(coalesce(p_source, '')), ''),
    nullif(trim(coalesce(p_source_event_id, '')), ''),
    v_idempotency_key,
    coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (idempotency_key) do update
    set updated_at = now(),
        payload = public.ops_offer_events.payload || excluded.payload
  returning id into v_event_id;

  update public.sales_tasks
    set status = 'done',
        completed_at = now(),
        updated_at = now(),
        payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object(
          'closed_reason', 'superseded_by_offer_sent',
          'closed_source_ref', v_event_id
        )
  where request_id = v_request_id
    and task_type = 'call_new_inquiry'
    and status in ('open', 'waiting', 'blocked');

  get diagnostics v_closed_inquiry_count = row_count;

  insert into public.sales_tasks (
    request_id,
    task_type,
    status,
    title,
    detail,
    due_at,
    priority_tier,
    source,
    source_ref,
    idempotency_key,
    payload,
    updated_at
  )
  values (
    v_request_id,
    'call_quote_sent',
    case when v_call_due_at > now() then 'waiting' else 'open' end,
    'Angebot telefonisch nachfassen',
    'Neues NEONTRIP-Angebot wurde versendet.',
    v_call_due_at,
    'standard',
    'manual',
    v_event_id::text,
    'offer-sent-call:' || v_request_id || ':' || v_offer_id,
    jsonb_build_object(
      'offer_event_id', v_event_id,
      'offer_id', v_offer_id,
      'offer_number', p_offer_number,
      'document_reference', p_document_reference,
      'public_url', p_public_url,
      'recipient_email', p_recipient_email,
      'source', p_source
    ),
    now()
  )
  on conflict (idempotency_key) do update
    set status = case when excluded.due_at > now() then 'waiting' else 'open' end,
        due_at = least(coalesce(public.sales_tasks.due_at, excluded.due_at), excluded.due_at),
        updated_at = now(),
        payload = public.sales_tasks.payload || excluded.payload
  returning id into v_task_id;

  insert into public.sales_call_cadence_state (
    request_id,
    current_stage,
    next_call_due_at,
    call_1_due_at,
    call_2_due_at,
    call_3_due_at,
    standard_call_count,
    retry_count,
    cadence_finished,
    blocked,
    blocking_reason,
    next_call_action,
    queue_bucket,
    priority_tier,
    priority_reason,
    vip_manual,
    purchase_signal,
    updated_at
  )
  values (
    v_request_id,
    'quote_call',
    v_call_due_at,
    null,
    v_call_due_at,
    v_reminder_due_at,
    0,
    0,
    false,
    false,
    null,
    'call_stage_2',
    case when v_call_due_at <= now() then 'due_today' else 'due_today' end,
    'standard',
    'Angebot wurde versendet.',
    false,
    false,
    now()
  )
  on conflict (request_id) do update
    set current_stage = case
          when public.sales_call_cadence_state.cadence_finished
            or public.sales_call_cadence_state.current_stage in ('callback', 'manual_followup', 'offer_adjustment', 'data_issue', 'finished')
            or public.sales_call_cadence_state.current_stage in ('quote_call', 'no_response_call')
          then public.sales_call_cadence_state.current_stage
          else 'quote_call'
        end,
        next_call_due_at = case
          when public.sales_call_cadence_state.cadence_finished
            or public.sales_call_cadence_state.current_stage in ('callback', 'manual_followup', 'offer_adjustment', 'data_issue', 'finished')
          then public.sales_call_cadence_state.next_call_due_at
          else v_call_due_at
        end,
        call_2_due_at = coalesce(public.sales_call_cadence_state.call_2_due_at, v_call_due_at),
        call_3_due_at = coalesce(public.sales_call_cadence_state.call_3_due_at, v_reminder_due_at),
        blocked = case
          when public.sales_call_cadence_state.cadence_finished
            or public.sales_call_cadence_state.current_stage in ('callback', 'manual_followup', 'offer_adjustment', 'data_issue', 'finished')
          then public.sales_call_cadence_state.blocked
          else false
        end,
        blocking_reason = case
          when public.sales_call_cadence_state.cadence_finished
            or public.sales_call_cadence_state.current_stage in ('callback', 'manual_followup', 'offer_adjustment', 'data_issue', 'finished')
          then public.sales_call_cadence_state.blocking_reason
          else null
        end,
        next_call_action = case
          when public.sales_call_cadence_state.cadence_finished
            or public.sales_call_cadence_state.current_stage in ('callback', 'manual_followup', 'offer_adjustment', 'data_issue', 'finished')
          then public.sales_call_cadence_state.next_call_action
          else 'call_stage_2'
        end,
        queue_bucket = case
          when public.sales_call_cadence_state.cadence_finished
            or public.sales_call_cadence_state.current_stage in ('callback', 'manual_followup', 'offer_adjustment', 'data_issue', 'finished')
          then public.sales_call_cadence_state.queue_bucket
          else 'due_today'
        end,
        priority_reason = coalesce(public.sales_call_cadence_state.priority_reason, 'Angebot wurde versendet.'),
        updated_at = now();

  insert into public.workflow_audit_log (
    document_id,
    workflow_name,
    action,
    status,
    metadata,
    created_at
  )
  values (
    v_request_id,
    'neontrip_offers_ops_bridge',
    'customer_email_sent',
    'success',
    jsonb_build_object(
      'request_id', v_request_id,
      'summary', 'Aktualisiertes Angebot wurde per E-Mail versendet.',
      'subtype', 'quote_update',
      'direction', 'outbound',
      'offer_event_id', v_event_id,
      'offer_id', v_offer_id,
      'offer_number', p_offer_number,
      'document_reference', p_document_reference,
      'public_url', p_public_url,
      'trello_card_id', v_trello_card_id,
      'customer_email', p_recipient_email,
      'recipient_email', p_recipient_email,
      'subject', coalesce(p_payload->>'subject', 'Ihr aktualisiertes NEONTRIP Angebot'),
      'actor', p_actor,
      'actor_label', p_actor,
      'source', p_source,
      'closed_inquiry_tasks', v_closed_inquiry_count,
      'sales_task_id', v_task_id
    ),
    now()
  );

  return jsonb_build_object(
    'ok', true,
    'request_id', v_request_id,
    'offer_event_id', v_event_id,
    'sales_task_id', v_task_id,
    'closed_inquiry_tasks', v_closed_inquiry_count,
    'next_call_due_at', v_call_due_at
  );
end;
$$;

comment on function public.ops_record_offer_sent is
  'Records a successful customer offer send and starts the quote-call cadence without using Trello as source of truth.';
