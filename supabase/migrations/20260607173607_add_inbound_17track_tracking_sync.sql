create or replace function public.inbound_claim_due_17track_tracking_shipments(
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
    from public.inbound_shipments s
    join public.inbound_tracking_registrations r
      on r.shipment_id = s.id
     and r.provider = '17track'
     and r.status = 'accepted'
    where s.status not in ('delivered', 'closed')
      and s.carrier in ('dhl', 'fedex')
      and nullif(s.tracking_number, '') is not null
      and (s.next_check_at is null or s.next_check_at <= p_now)
    order by coalesce(s.next_check_at, r.first_registered_at, s.created_at), s.updated_at
    limit greatest(1, least(p_limit, 50))
    for update of s skip locked
  ), claimed as (
    update public.inbound_shipments s
    set next_check_at = p_now + interval '1 hour',
        updated_at = p_now
    from candidates c
    where s.id = c.id
    returning s.*
  )
  select
    s.id,
    s.shipment_key,
    s.carrier,
    s.tracking_number,
    r.provider_carrier_id,
    r.provider_tag,
    s.trello_card_id,
    s.trello_card_name,
    s.trello_card_url,
    s.status
  from claimed s
  join public.inbound_tracking_registrations r
    on r.shipment_id = s.id
   and r.provider = '17track'
   and r.status = 'accepted';
end;
$$;

revoke all on function public.inbound_claim_due_17track_tracking_shipments(integer, timestamptz) from public, anon, authenticated;
grant execute on function public.inbound_claim_due_17track_tracking_shipments(integer, timestamptz) to service_role;
