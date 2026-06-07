create or replace function public.inbound_claim_due_tracking_shipments(p_limit integer default 20, p_now timestamptz default now())
returns table (
  shipment_id uuid,
  shipment_key text,
  carrier text,
  tracking_number text,
  tracking_raw text,
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
    where s.status not in ('delivered', 'closed')
      and s.carrier in ('dhl', 'fedex')
      and (s.next_check_at is null or s.next_check_at <= p_now)
    order by coalesce(s.next_check_at, s.created_at), s.updated_at
    limit greatest(1, least(p_limit, 50))
    for update skip locked
  ), claimed as (
    update public.inbound_shipments s
    set next_check_at = p_now + interval '1 hour',
        updated_at = p_now
    from candidates c
    where s.id = c.id
    returning s.*
  )
  select
    c.id,
    c.shipment_key,
    c.carrier,
    c.tracking_number,
    c.tracking_raw,
    c.trello_card_id,
    c.trello_card_name,
    c.trello_card_url,
    c.status
  from claimed c;
end;
$$;

revoke all on function public.inbound_claim_due_tracking_shipments(integer, timestamptz) from public, anon, authenticated;
grant execute on function public.inbound_claim_due_tracking_shipments(integer, timestamptz) to service_role;

with reopened as (
  update public.inbound_incidents i
  set status = 'open',
      resolved_at = null,
      updated_at = now(),
      metadata = i.metadata || jsonb_build_object(
        'rollback_by', '20260607055214_suppress_direct_inbound_tracking_after_17track_acceptance_rollback'
      )
  where i.incident_type = 'tracking_error'
    and i.status = 'resolved'
    and i.metadata ->> 'resolved_by' = '17track_accepted_direct_tracking_suppression'
  returning i.shipment_id
)
update public.inbound_shipments s
set risk_level = case when s.status in ('delivered', 'closed') then 'closed' else 'high' end,
    status_reason = 'tracking_api_error:direct_tracking_rollback',
    updated_at = now()
where s.id in (select reopened.shipment_id from reopened);
