alter table public.ops_offer_events
  drop constraint if exists ops_offer_events_event_type_check;

alter table public.ops_offer_events
  add constraint ops_offer_events_event_type_check
  check (
    event_type in (
      'offer_sent',
      'offer_updated',
      'offer_viewed',
      'offer_accept_started',
      'offer_accepted',
      'offer_pdf_downloaded'
    )
  );

create or replace function public.ops_record_offer_lifecycle_event(
  p_request_id text default null,
  p_trello_card_id text default null,
  p_offer_id text default null,
  p_offer_number text default null,
  p_document_reference text default null,
  p_public_url text default null,
  p_event_type text default null,
  p_recipient_email text default null,
  p_event_at timestamptz default now(),
  p_source text default 'neontrip_offers_tracking',
  p_source_event_id text default null,
  p_idempotency_key text default null,
  p_actor text default 'system',
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
  v_event_type text := nullif(trim(coalesce(p_event_type, '')), '');
  v_idempotency_key text := nullif(trim(coalesce(p_idempotency_key, '')), '');
  v_event_id uuid;
  v_closed_task_count integer := 0;
  v_prioritized_task_count integer := 0;
begin
  if v_offer_id is null then
    raise exception 'offer_id_required';
  end if;

  if v_event_type not in (
    'offer_viewed',
    'offer_accept_started',
    'offer_accepted',
    'offer_pdf_downloaded',
    'offer_updated'
  ) then
    raise exception 'unsupported_offer_lifecycle_event: %', coalesce(v_event_type, '<null>');
  end if;

  if v_request_id is null then
    select request_id, coalesce(v_trello_card_id, trello_card_id)
      into v_request_id, v_trello_card_id
    from public.ops_offer_events
    where offer_id = v_offer_id
    order by event_at desc
    limit 1;
  end if;

  if v_request_id is null and v_trello_card_id is not null then
    select request_id
      into v_request_id
    from public.master_requests
    where trello_card_id = v_trello_card_id
    order by updated_at desc nulls last
    limit 1;
  end if;

  if v_request_id is null then
    raise exception 'request_id_required';
  end if;

  if v_idempotency_key is null then
    v_idempotency_key := 'offer-lifecycle:' || v_event_type || ':' || v_request_id || ':' || v_offer_id;
  end if;

  perform pg_advisory_xact_lock(hashtext('ops_offer_lifecycle:' || v_request_id || ':' || v_offer_id));

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
    payload,
    updated_at
  )
  values (
    v_request_id,
    v_trello_card_id,
    v_offer_id,
    nullif(trim(coalesce(p_offer_number, '')), ''),
    nullif(trim(coalesce(p_document_reference, '')), ''),
    nullif(trim(coalesce(p_public_url, '')), ''),
    v_event_type,
    nullif(trim(coalesce(p_recipient_email, '')), ''),
    coalesce(p_event_at, now()),
    coalesce(nullif(trim(coalesce(p_source, '')), ''), 'neontrip_offers_tracking'),
    nullif(trim(coalesce(p_source_event_id, '')), ''),
    v_idempotency_key,
    coalesce(p_payload, '{}'::jsonb),
    now()
  )
  on conflict (idempotency_key) do update
    set event_at = least(public.ops_offer_events.event_at, excluded.event_at),
        payload = public.ops_offer_events.payload || excluded.payload,
        source_event_id = coalesce(public.ops_offer_events.source_event_id, excluded.source_event_id),
        updated_at = now()
  returning id into v_event_id;

  if v_event_type in ('offer_viewed', 'offer_accept_started', 'offer_pdf_downloaded') then
    update public.sales_tasks
      set priority_tier = case
            when priority_tier = 'vip' then 'vip'
            else 'important'
          end,
          detail = case
            when v_event_type = 'offer_viewed' then 'Kunde hat das Angebot geöffnet.'
            when v_event_type = 'offer_accept_started' then 'Kunde hat die Freigabe gestartet.'
            else 'Kunde hat das Angebots-PDF heruntergeladen.'
          end,
          updated_at = now(),
          payload = payload || jsonb_build_object(
            'offer_lifecycle_event_id', v_event_id,
            'offer_lifecycle_event_type', v_event_type,
            'priority_reason', case
              when v_event_type = 'offer_viewed' then 'offer_viewed'
              when v_event_type = 'offer_accept_started' then 'offer_accept_started'
              else 'offer_pdf_downloaded'
            end
          )
    where request_id = v_request_id
      and status in ('open', 'waiting', 'blocked')
      and task_type in (
        'call_quote_sent',
        'call_reminder_1',
        'call_reminder_2',
        'call_reminder_3',
        'callback_scheduled',
        'waiting_customer_response'
      );

    get diagnostics v_prioritized_task_count = row_count;

    update public.sales_call_cadence_state
      set priority_tier = case
            when priority_tier = 'vip' then 'vip'
            else 'important'
          end,
          priority_reason = case
            when v_event_type = 'offer_viewed' then 'Angebot wurde angesehen.'
            when v_event_type = 'offer_accept_started' then 'Kunde hat die Freigabe gestartet.'
            else 'Angebots-PDF wurde heruntergeladen.'
          end,
          purchase_signal = case
            when v_event_type = 'offer_accept_started' then true
            else purchase_signal
          end,
          updated_at = now()
    where request_id = v_request_id
      and not cadence_finished
      and current_stage not in ('finished', 'data_issue');
  end if;

  if v_event_type = 'offer_accepted' then
    update public.sales_tasks
      set status = 'done',
          completed_at = coalesce(completed_at, now()),
          updated_at = now(),
          payload = payload || jsonb_build_object(
            'closed_reason', 'offer_accepted',
            'closed_source_ref', v_event_id,
            'offer_id', v_offer_id
          )
    where request_id = v_request_id
      and status in ('open', 'waiting', 'blocked')
      and task_type in (
        'call_new_inquiry',
        'call_quote_sent',
        'call_reminder_1',
        'call_reminder_2',
        'call_reminder_3',
        'callback_scheduled',
        'waiting_customer_response'
      );

    get diagnostics v_closed_task_count = row_count;

    update public.sales_call_cadence_state
      set current_stage = 'finished',
          next_call_due_at = null,
          cadence_finished = true,
          blocked = false,
          blocking_reason = null,
          pending_callback_at = null,
          next_call_action = 'finished',
          queue_bucket = 'finished',
          priority_tier = case
            when priority_tier = 'vip' then 'vip'
            else 'important'
          end,
          priority_reason = 'Angebot wurde angenommen.',
          purchase_signal = true,
          updated_at = now()
    where request_id = v_request_id;

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
      'customer_case_outcome',
      'success',
      jsonb_build_object(
        'request_id', v_request_id,
        'summary', 'Angebot wurde angenommen; offene Sales-Call-Aufgaben wurden geschlossen.',
        'outcome', 'offer_accepted',
        'offer_event_id', v_event_id,
        'offer_id', v_offer_id,
        'offer_number', p_offer_number,
        'document_reference', p_document_reference,
        'public_url', p_public_url,
        'trello_card_id', v_trello_card_id,
        'actor', p_actor,
        'actor_label', p_actor,
        'source', p_source,
        'closed_sales_tasks', v_closed_task_count
      ),
      now()
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'request_id', v_request_id,
    'offer_event_id', v_event_id,
    'event_type', v_event_type,
    'closed_sales_tasks', v_closed_task_count,
    'prioritized_sales_tasks', v_prioritized_task_count
  );
end;
$$;

revoke all on function public.ops_record_offer_lifecycle_event(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  text,
  text,
  text,
  text,
  jsonb
) from public, anon, authenticated;

grant execute on function public.ops_record_offer_lifecycle_event(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  text,
  text,
  text,
  text,
  jsonb
) to service_role;

comment on function public.ops_record_offer_lifecycle_event is
  'Records NEONTRIP offer lifecycle tracking events for Ops. It is idempotent; accepted offers close only Sales call tasks, not internal team tasks.';
