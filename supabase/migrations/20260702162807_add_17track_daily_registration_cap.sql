create or replace function public.seventeen_track_daily_registration_count(p_now timestamptz default now())
returns integer
language sql
security invoker
stable
as $$
  with bounds as (
    select
      ((p_now at time zone 'Europe/Berlin')::date::timestamp at time zone 'Europe/Berlin') as day_start,
      (((p_now at time zone 'Europe/Berlin')::date + 1)::timestamp at time zone 'Europe/Berlin') as day_end
  )
  select count(*)::integer
  from (
    select r.id
    from public.inbound_tracking_registrations r, bounds b
    where r.provider = '17track'
      and r.last_attempt_at >= b.day_start
      and r.last_attempt_at < b.day_end
    union all
    select r.id
    from public.shipping_tracking_registrations r, bounds b
    where r.provider = '17track'
      and r.last_attempt_at >= b.day_start
      and r.last_attempt_at < b.day_end
  ) registrations;
$$;

create or replace function public.seventeen_track_daily_registration_capacity(
  p_daily_limit integer default 100,
  p_now timestamptz default now()
)
returns integer
language sql
security invoker
stable
as $$
  select greatest(0, greatest(0, p_daily_limit) - public.seventeen_track_daily_registration_count(p_now));
$$;

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
declare
  v_claim_limit integer;
begin
  perform pg_advisory_xact_lock(170017, 1);
  v_claim_limit := least(
    greatest(1, least(p_limit, 50)),
    public.seventeen_track_daily_registration_capacity(100, p_now)
  );

  if v_claim_limit <= 0 then
    return;
  end if;

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
    limit v_claim_limit
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
declare
  v_claim_limit integer;
begin
  perform pg_advisory_xact_lock(170017, 1);
  v_claim_limit := least(
    greatest(1, least(p_limit, 50)),
    public.seventeen_track_daily_registration_capacity(100, p_now)
  );

  if v_claim_limit <= 0 then
    return;
  end if;

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
    order by coalesce(r.next_attempt_at, p_now), coalesce(s.shipped_at, s.created_at, s.updated_at) desc, s.updated_at desc
    limit v_claim_limit
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

revoke all on function public.seventeen_track_daily_registration_count(timestamptz) from public, anon, authenticated;
revoke all on function public.seventeen_track_daily_registration_capacity(integer, timestamptz) from public, anon, authenticated;
revoke all on function public.inbound_claim_due_17track_registrations(integer, timestamptz) from public, anon, authenticated;
revoke all on function public.shipping_claim_due_17track_registrations(integer, timestamptz) from public, anon, authenticated;

grant execute on function public.seventeen_track_daily_registration_count(timestamptz) to service_role;
grant execute on function public.seventeen_track_daily_registration_capacity(integer, timestamptz) to service_role;
grant execute on function public.inbound_claim_due_17track_registrations(integer, timestamptz) to service_role;
grant execute on function public.shipping_claim_due_17track_registrations(integer, timestamptz) to service_role;
