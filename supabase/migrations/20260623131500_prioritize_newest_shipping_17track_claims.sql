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
    order by coalesce(r.next_attempt_at, p_now), coalesce(s.shipped_at, s.created_at, s.updated_at) desc, s.updated_at desc
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

revoke all on function public.shipping_claim_due_17track_registrations(integer, timestamptz) from public, anon, authenticated;
grant execute on function public.shipping_claim_due_17track_registrations(integer, timestamptz) to service_role;
