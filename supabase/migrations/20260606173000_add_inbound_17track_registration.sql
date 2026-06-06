create table if not exists public.inbound_tracking_registrations (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.inbound_shipments(id) on delete cascade,
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
  constraint inbound_tracking_registrations_provider_check check (provider in ('17track')),
  constraint inbound_tracking_registrations_carrier_check check (carrier in ('dhl', 'fedex', 'other', 'unknown')),
  constraint inbound_tracking_registrations_status_check check (status in ('pending', 'registering', 'accepted', 'rejected', 'failed')),
  constraint inbound_tracking_registrations_shipment_provider_unique unique (shipment_id, provider)
);

create index if not exists inbound_tracking_registrations_status_idx
  on public.inbound_tracking_registrations(provider, status, next_attempt_at, updated_at desc);

create index if not exists inbound_tracking_registrations_tracking_idx
  on public.inbound_tracking_registrations(provider, carrier, tracking_number);

alter table public.inbound_tracking_registrations enable row level security;

create policy "inbound_tracking_registrations_service_role_all"
  on public.inbound_tracking_registrations
  for all
  to service_role
  using (true)
  with check (true);

create or replace function public.inbound_claim_due_17track_registrations(p_limit integer default 20, p_now timestamptz default now())
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
    from public.inbound_shipments s
    left join public.inbound_tracking_registrations r
      on r.shipment_id = s.id
     and r.provider = '17track'
    where s.status not in ('delivered', 'closed')
      and s.carrier in ('dhl', 'fedex')
      and (
        r.id is null
        or r.status in ('pending', 'failed', 'rejected')
        or (r.status = 'registering' and coalesce(r.last_attempt_at, r.updated_at) <= p_now - interval '30 minutes')
      )
      and coalesce(r.next_attempt_at, p_now) <= p_now
    order by coalesce(r.next_attempt_at, s.created_at), s.updated_at
    limit greatest(1, least(p_limit, 50))
    for update of s skip locked
  ), claimed as (
    insert into public.inbound_tracking_registrations as target (
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
      s.tracking_number,
      s.id::text,
      'registering',
      1,
      p_now,
      p_now + interval '30 minutes',
      p_now
    from candidates c
    join public.inbound_shipments s on s.id = c.id
    on conflict on constraint inbound_tracking_registrations_shipment_provider_unique do update
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
    s.tracking_number,
    s.trello_card_name,
    s.trello_card_url,
    c.attempts
  from claimed c
  join public.inbound_shipments s on s.id = c.shipment_id;
end;
$$;

create or replace function public.inbound_record_17track_registration(p_payload jsonb, p_now timestamptz default now())
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_shipment_id uuid := nullif(p_payload ->> 'shipmentId', '')::uuid;
  v_carrier text := public.inbound_normalize_carrier(p_payload ->> 'carrier');
  v_tracking_number text := upper(regexp_replace(coalesce(p_payload ->> 'trackingNumber', ''), '[^A-Z0-9]', '', 'g'));
  v_status text := coalesce(nullif(p_payload ->> 'status', ''), 'failed');
  v_provider_carrier_id integer := nullif(p_payload ->> 'providerCarrierId', '')::integer;
  v_error text := nullif(p_payload ->> 'error', '');
  v_raw_response jsonb := coalesce(p_payload -> 'rawResponse', '{}'::jsonb);
  v_registration_id uuid;
begin
  if v_shipment_id is null then
    select id into v_shipment_id
    from public.inbound_shipments
    where carrier = v_carrier and tracking_number = v_tracking_number
    limit 1;
  end if;

  if v_shipment_id is null then
    raise exception 'inbound shipment not found' using errcode = '22023';
  end if;

  if v_status not in ('accepted', 'rejected', 'failed') then
    v_status := 'failed';
  end if;

  insert into public.inbound_tracking_registrations as target (
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
  on conflict on constraint inbound_tracking_registrations_shipment_provider_unique do update
    set carrier = excluded.carrier,
        tracking_number = excluded.tracking_number,
        provider_carrier_id = coalesce(excluded.provider_carrier_id, target.provider_carrier_id),
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

  update public.inbound_shipments
  set metadata = metadata || jsonb_build_object(
        '17track_registration_status', v_status,
        '17track_provider_carrier_id', v_provider_carrier_id
      ),
      updated_at = p_now
  where id = v_shipment_id;

  if v_status in ('failed', 'rejected') then
    perform public.inbound_record_tracking_error(jsonb_build_object(
      'shipmentId', v_shipment_id,
      'carrier', v_carrier,
      'trackingNumber', v_tracking_number,
      'trackingError', jsonb_build_object(
        'provider', '17track',
        'title', '17TRACK registration failed',
        'detail', coalesce(v_error, '17TRACK Registrierung fehlgeschlagen.'),
        'node', '17TRACK registration'
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

revoke all on table public.inbound_tracking_registrations from public, anon, authenticated;
revoke all on function public.inbound_claim_due_17track_registrations(integer, timestamptz) from public, anon, authenticated;
revoke all on function public.inbound_record_17track_registration(jsonb, timestamptz) from public, anon, authenticated;

grant all on table public.inbound_tracking_registrations to service_role;
grant execute on function public.inbound_claim_due_17track_registrations(integer, timestamptz) to service_role;
grant execute on function public.inbound_record_17track_registration(jsonb, timestamptz) to service_role;
