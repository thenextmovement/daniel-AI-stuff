alter table public.shipping_incidents drop constraint if exists shipping_incidents_type_check;

alter table public.shipping_incidents
  add constraint shipping_incidents_type_check check (
    incident_type in (
      'tracking_missing',
      'label_created_no_scan',
      'carrier_not_found',
      'stale_in_transit',
      'delivery_failed',
      'pickup_available',
      'return_to_sender',
      'returned',
      'lost_or_stale',
      'tracking_error'
    )
  );

create table if not exists public.shipping_tracking_registrations (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipping_shipments(id) on delete cascade,
  provider text not null,
  registration_key text not null unique,
  carrier text not null,
  tracking_number text not null,
  provider_carrier_id integer null,
  provider_tag text null,
  status text not null default 'pending',
  attempts integer not null default 0,
  first_registered_at timestamptz null,
  last_attempt_at timestamptz null,
  next_attempt_at timestamptz null,
  last_error text null,
  raw_response jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shipping_tracking_registrations_provider_check check (provider in ('17track')),
  constraint shipping_tracking_registrations_carrier_check check (carrier in ('dpd', 'dhl', 'other', 'unknown')),
  constraint shipping_tracking_registrations_status_check check (status in ('pending', 'registering', 'accepted', 'rejected', 'failed')),
  constraint shipping_tracking_registrations_shipment_provider_unique unique (shipment_id, provider)
);

create index if not exists shipping_tracking_registrations_status_idx
  on public.shipping_tracking_registrations(provider, status, next_attempt_at, updated_at desc);

create index if not exists shipping_tracking_registrations_tracking_idx
  on public.shipping_tracking_registrations(provider, carrier, tracking_number);

create index if not exists shipping_tracking_registrations_shipment_idx
  on public.shipping_tracking_registrations(shipment_id);

alter table public.shipping_tracking_registrations enable row level security;

create policy "shipping_tracking_registrations_service_role_all"
  on public.shipping_tracking_registrations
  for all
  to service_role
  using (true)
  with check (true);

create or replace function public.shipping_record_tracking_error(p_payload jsonb, p_now timestamptz default now())
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_shipment_id uuid := nullif(p_payload ->> 'shipmentId', '')::uuid;
  v_carrier text := public.shipping_normalize_carrier(p_payload ->> 'carrier');
  v_tracking_number text := upper(regexp_replace(coalesce(p_payload ->> 'trackingNumber', ''), '[^A-Z0-9]', '', 'g'));
  v_tracking_error jsonb := coalesce(p_payload -> 'trackingError', '{}'::jsonb);
  v_raw_response jsonb := coalesce(p_payload -> 'rawResponse', '{}'::jsonb);
  v_detail text := nullif(v_tracking_error ->> 'detail', '');
  v_title text := coalesce(nullif(v_tracking_error ->> 'title', ''), 'Tracking API Fehler');
  v_provider text := coalesce(nullif(v_tracking_error ->> 'provider', ''), 'unknown');
  v_severity text := case
    when coalesce(v_detail, '') ~* '(401|403|unauthorized|forbidden)' then 'urgent'
    else 'high'
  end;
  v_shipment public.shipping_shipments%rowtype;
begin
  if v_shipment_id is null then
    select *
    into v_shipment
    from public.shipping_shipments
    where carrier = v_carrier
      and upper(regexp_replace(tracking_number, '[^A-Z0-9]', '', 'g')) = v_tracking_number
    limit 1;
  else
    select *
    into v_shipment
    from public.shipping_shipments
    where id = v_shipment_id;
  end if;

  if v_shipment.id is null then
    raise exception 'shipping shipment not found' using errcode = '22023';
  end if;

  update public.shipping_shipments
  set risk_level = case when risk_level = 'closed' then risk_level else v_severity end,
      status_reason = 'tracking_api_error:' || v_provider,
      last_carrier_sync_at = p_now,
      next_check_at = p_now + interval '30 minutes',
      updated_at = p_now
  where id = v_shipment.id;

  insert into public.shipping_incidents (
    shipment_id,
    request_id,
    incident_key,
    incident_type,
    severity,
    status,
    title,
    description,
    last_detected_at,
    rule_version,
    metadata,
    updated_at
  )
  values (
    v_shipment.id,
    v_shipment.request_id,
    v_shipment.id::text || ':tracking_error:17track',
    'tracking_error',
    v_severity,
    'open',
    'Tracking API Fehler: 17TRACK konnte nicht abgefragt werden',
    coalesce(v_detail, v_title),
    p_now,
    'shipping_tracking_error_v1_20260623',
    jsonb_build_object(
      'provider', v_provider,
      'carrier', v_carrier,
      'tracking_number', v_tracking_number,
      'tracking_error', v_tracking_error,
      'raw_response', v_raw_response
    ),
    p_now
  )
  on conflict (incident_key) do update
    set severity = excluded.severity,
        status = case when public.shipping_incidents.status = 'ignored' then public.shipping_incidents.status else excluded.status end,
        title = excluded.title,
        description = excluded.description,
        last_detected_at = excluded.last_detected_at,
        metadata = excluded.metadata,
        updated_at = excluded.updated_at;

  return jsonb_build_object(
    'shipment_id', v_shipment.id,
    'incident_id', (
      select id
      from public.shipping_incidents
      where incident_key = v_shipment.id::text || ':tracking_error:17track'
      limit 1
    ),
    'status', 'recorded',
    'severity', v_severity
  );
end;
$$;

create or replace function public.shipping_claim_due_17track_registrations(p_limit integer default 20, p_now timestamptz default now())
returns table (
  shipment_id uuid,
  registration_id uuid,
  carrier text,
  tracking_number text,
  trello_card_name text,
  trello_card_url text,
  attempts integer
)
language plpgsql
security invoker
as $$
begin
  return query
  with candidates as (
    select s.id
    from public.shipping_shipments s
    left join public.shipping_tracking_registrations r
      on r.shipment_id = s.id
     and r.provider = '17track'
    where s.status not in ('delivered', 'returned', 'closed')
      and s.carrier in ('dpd', 'dhl')
      and nullif(s.tracking_number, '') is not null
      and public.shipping_is_recent_shipment(s.shipped_at, s.last_event_at, s.created_at, s.updated_at, p_now)
      and (
        r.id is null
        or r.status in ('pending', 'failed', 'rejected')
        or (r.status = 'registering' and coalesce(r.last_attempt_at, r.updated_at) <= p_now - interval '30 minutes')
      )
      and coalesce(r.next_attempt_at, p_now) <= p_now
    order by coalesce(r.next_attempt_at, s.shipped_at, s.created_at), s.updated_at
    limit greatest(1, least(p_limit, 50))
    for update of s skip locked
  ), claimed as (
    insert into public.shipping_tracking_registrations as target (
      shipment_id,
      provider,
      registration_key,
      carrier,
      tracking_number,
      provider_tag,
      status,
      attempts,
      last_attempt_at,
      next_attempt_at,
      updated_at
    )
    select
      s.id,
      '17track',
      '17track:' || s.id::text,
      s.carrier,
      upper(regexp_replace(s.tracking_number, '[^A-Z0-9]', '', 'g')),
      s.id::text,
      'registering',
      1,
      p_now,
      p_now + interval '30 minutes',
      p_now
    from candidates c
    join public.shipping_shipments s on s.id = c.id
    on conflict on constraint shipping_tracking_registrations_shipment_provider_unique do update
      set status = 'registering',
          carrier = excluded.carrier,
          tracking_number = excluded.tracking_number,
          provider_tag = excluded.provider_tag,
          attempts = target.attempts + 1,
          last_attempt_at = p_now,
          next_attempt_at = p_now + interval '30 minutes',
          updated_at = p_now
    returning target.*
  )
  select
    s.id,
    c.id,
    s.carrier,
    c.tracking_number,
    coalesce(s.shopify_order_number, s.request_id, s.customer_name),
    s.tracking_url,
    c.attempts
  from claimed c
  join public.shipping_shipments s on s.id = c.shipment_id;
end;
$$;

create or replace function public.shipping_record_17track_registration(p_payload jsonb, p_now timestamptz default now())
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_shipment_id uuid := nullif(p_payload ->> 'shipmentId', '')::uuid;
  v_carrier text := public.shipping_normalize_carrier(p_payload ->> 'carrier');
  v_tracking_number text := upper(regexp_replace(coalesce(p_payload ->> 'trackingNumber', ''), '[^A-Z0-9]', '', 'g'));
  v_status text := coalesce(nullif(p_payload ->> 'status', ''), 'failed');
  v_provider_carrier_id integer := nullif(p_payload ->> 'providerCarrierId', '')::integer;
  v_error text := nullif(p_payload ->> 'error', '');
  v_raw_response jsonb := coalesce(p_payload -> 'rawResponse', '{}'::jsonb);
  v_registration_id uuid;
begin
  if v_shipment_id is null then
    select id into v_shipment_id
    from public.shipping_shipments
    where carrier = v_carrier
      and upper(regexp_replace(tracking_number, '[^A-Z0-9]', '', 'g')) = v_tracking_number
    limit 1;
  end if;

  if v_shipment_id is null then
    raise exception 'shipping shipment not found' using errcode = '22023';
  end if;

  if v_status not in ('accepted', 'rejected', 'failed') then
    v_status := 'failed';
  end if;

  insert into public.shipping_tracking_registrations as target (
    shipment_id,
    provider,
    registration_key,
    carrier,
    tracking_number,
    provider_carrier_id,
    provider_tag,
    status,
    attempts,
    first_registered_at,
    last_attempt_at,
    next_attempt_at,
    last_error,
    raw_response,
    updated_at
  )
  values (
    v_shipment_id,
    '17track',
    '17track:' || v_shipment_id::text,
    v_carrier,
    v_tracking_number,
    v_provider_carrier_id,
    v_shipment_id::text,
    v_status,
    1,
    case when v_status = 'accepted' then p_now else null end,
    p_now,
    case when v_status = 'accepted' then null else p_now + interval '1 hour' end,
    v_error,
    v_raw_response,
    p_now
  )
  on conflict on constraint shipping_tracking_registrations_shipment_provider_unique do update
    set carrier = excluded.carrier,
        tracking_number = excluded.tracking_number,
        provider_carrier_id = excluded.provider_carrier_id,
        provider_tag = excluded.provider_tag,
        status = excluded.status,
        first_registered_at = case
          when excluded.status = 'accepted' then coalesce(target.first_registered_at, p_now)
          else target.first_registered_at
        end,
        last_attempt_at = p_now,
        next_attempt_at = excluded.next_attempt_at,
        last_error = excluded.last_error,
        raw_response = excluded.raw_response,
        updated_at = p_now
  returning target.id into v_registration_id;

  update public.shipping_shipments
  set last_carrier_sync_at = p_now,
      next_check_at = case when v_status = 'accepted' then p_now else p_now + interval '1 hour' end,
      updated_at = p_now
  where id = v_shipment_id;

  if v_status in ('failed', 'rejected') then
    perform public.shipping_record_tracking_error(jsonb_build_object(
      'shipmentId', v_shipment_id,
      'carrier', v_carrier,
      'trackingNumber', v_tracking_number,
      'trackingError', jsonb_build_object(
        'provider', '17track',
        'title', '17TRACK registration failed',
        'detail', coalesce(v_error, '17TRACK Registrierung fehlgeschlagen.'),
        'node', '17TRACK outbound registration'
      ),
      'rawResponse', v_raw_response
    ), p_now);
  end if;

  return jsonb_build_object(
    'shipment_id', v_shipment_id,
    'registration_id', v_registration_id,
    'provider', '17track',
    'status', v_status
  );
end;
$$;

create or replace function public.shipping_claim_due_17track_tracking_shipments(
  p_limit integer default 20,
  p_now timestamptz default now()
)
returns table (
  shipment_id uuid,
  shipment_key text,
  carrier text,
  tracking_number text,
  provider_carrier_id integer,
  provider_tag text,
  trello_card_id text,
  trello_card_name text,
  trello_card_url text,
  status text
)
language plpgsql
security invoker
as $$
begin
  return query
  with candidates as (
    select s.id
    from public.shipping_shipments s
    join public.shipping_tracking_registrations r
      on r.shipment_id = s.id
     and r.provider = '17track'
     and r.status = 'accepted'
    where s.status not in ('delivered', 'returned', 'closed')
      and s.carrier in ('dpd', 'dhl')
      and nullif(s.tracking_number, '') is not null
      and public.shipping_is_recent_shipment(s.shipped_at, s.last_event_at, s.created_at, s.updated_at, p_now)
      and (s.next_check_at is null or s.next_check_at <= p_now)
    order by coalesce(s.next_check_at, r.first_registered_at, s.shipped_at, s.created_at), s.updated_at
    limit greatest(1, least(p_limit, 50))
    for update of s skip locked
  ), claimed as (
    update public.shipping_shipments s
    set next_check_at = p_now + interval '1 hour',
        last_carrier_sync_at = p_now,
        updated_at = p_now
    from candidates c
    where s.id = c.id
    returning s.*
  )
  select
    s.id,
    s.shipment_key,
    s.carrier,
    upper(regexp_replace(s.tracking_number, '[^A-Z0-9]', '', 'g')),
    r.provider_carrier_id,
    r.provider_tag,
    null::text,
    coalesce(s.shopify_order_number, s.request_id, s.customer_name),
    s.tracking_url,
    s.status
  from claimed s
  join public.shipping_tracking_registrations r
    on r.shipment_id = s.id
   and r.provider = '17track'
   and r.status = 'accepted';
end;
$$;

revoke all on table public.shipping_tracking_registrations from public, anon, authenticated;
revoke all on function public.shipping_record_tracking_error(jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.shipping_claim_due_17track_registrations(integer, timestamptz) from public, anon, authenticated;
revoke all on function public.shipping_record_17track_registration(jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.shipping_claim_due_17track_tracking_shipments(integer, timestamptz) from public, anon, authenticated;

grant all on table public.shipping_tracking_registrations to service_role;
grant execute on function public.shipping_record_tracking_error(jsonb, timestamptz) to service_role;
grant execute on function public.shipping_claim_due_17track_registrations(integer, timestamptz) to service_role;
grant execute on function public.shipping_record_17track_registration(jsonb, timestamptz) to service_role;
grant execute on function public.shipping_claim_due_17track_tracking_shipments(integer, timestamptz) to service_role;
