create or replace function public.inbound_cleanup_accepted_17track_tracking_error(
  p_shipment_id uuid,
  p_provider_carrier_id integer default null,
  p_now timestamptz default now(),
  p_cleanup_reason text default '17TRACK registration accepted'
)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_resolved_count integer := 0;
  v_cleaned_count integer := 0;
begin
  update public.inbound_incidents i
  set status = 'resolved',
      resolved_at = coalesce(i.resolved_at, p_now),
      updated_at = p_now,
      metadata = i.metadata || jsonb_build_object(
        'resolved_by', 'cleanup_inbound_17track_accepted_tracking_errors',
        'resolved_reason', p_cleanup_reason
      )
  where i.shipment_id = p_shipment_id
    and i.incident_type = 'tracking_error'
    and i.status in ('open', 'acknowledged')
    and (
      i.incident_key like 'inbound:' || p_shipment_id::text || ':tracking_error:%'
      or lower(i.title) like '%17track%'
      or lower(coalesce(i.metadata #>> '{tracking_error,provider}', '')) in ('17track', 'dhl', 'fedex')
    );

  get diagnostics v_resolved_count = row_count;

  update public.inbound_shipments s
  set risk_level = case
        when s.status in ('delivered', 'closed') then 'closed'
        else public.inbound_risk_level(s.status)
      end,
      status_reason = 'tracking_registered:17track',
      metadata = jsonb_strip_nulls(
        (s.metadata - 'last_tracking_error') ||
        jsonb_build_object(
          '17track_registration_status', 'accepted',
          '17track_provider_carrier_id', p_provider_carrier_id,
          'tracking_provider', '17track',
          'tracking_error_cleared_at', p_now,
          'tracking_error_cleared_by', 'cleanup_inbound_17track_accepted_tracking_errors',
          'tracking_error_cleared_reason', p_cleanup_reason,
          'tracking_error_cleanup_before', jsonb_build_object(
            'risk_level', s.risk_level,
            'status_reason', s.status_reason,
            'last_tracking_error', s.metadata -> 'last_tracking_error'
          )
        )
      ),
      updated_at = p_now
  where s.id = p_shipment_id
    and (
      s.status_reason like 'tracking_api_error:%'
      or s.metadata ? 'last_tracking_error'
    )
    and not exists (
      select 1
      from public.inbound_incidents active_incident
      where active_incident.shipment_id = s.id
        and active_incident.status in ('open', 'acknowledged')
    );

  get diagnostics v_cleaned_count = row_count;

  return jsonb_build_object(
    'shipment_id', p_shipment_id,
    'resolved_incidents', v_resolved_count,
    'cleaned_shipments', v_cleaned_count
  );
end;
$$;

create or replace function public.inbound_cleanup_accepted_17track_registration_trigger()
returns trigger
language plpgsql
security invoker
as $$
begin
  if new.provider = '17track'
    and new.status = 'accepted'
  then
    if tg_op = 'INSERT' then
      perform public.inbound_cleanup_accepted_17track_tracking_error(
        new.shipment_id,
        new.provider_carrier_id,
        coalesce(new.updated_at, now()),
        '17TRACK registration accepted'
      );
    elsif old.status is distinct from new.status then
      perform public.inbound_cleanup_accepted_17track_tracking_error(
        new.shipment_id,
        new.provider_carrier_id,
        coalesce(new.updated_at, now()),
        '17TRACK registration accepted'
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists inbound_cleanup_accepted_17track_registration
  on public.inbound_tracking_registrations;

create trigger inbound_cleanup_accepted_17track_registration
after insert or update of status
on public.inbound_tracking_registrations
for each row
execute function public.inbound_cleanup_accepted_17track_registration_trigger();

with accepted_registrations as (
  select distinct on (r.shipment_id)
    r.shipment_id,
    r.provider_carrier_id
  from public.inbound_tracking_registrations r
  join public.inbound_shipments s on s.id = r.shipment_id
  where r.provider = '17track'
    and r.status = 'accepted'
    and s.status not in ('delivered', 'closed')
    and (
      s.status_reason like 'tracking_api_error:%'
      or s.metadata ? 'last_tracking_error'
    )
  order by r.shipment_id, r.updated_at desc
)
select public.inbound_cleanup_accepted_17track_tracking_error(
  shipment_id,
  provider_carrier_id,
  now(),
  'existing accepted 17TRACK registration cleanup'
)
from accepted_registrations;

revoke all on function public.inbound_cleanup_accepted_17track_tracking_error(uuid, integer, timestamptz, text) from public, anon, authenticated;
revoke all on function public.inbound_cleanup_accepted_17track_registration_trigger() from public, anon, authenticated;
grant execute on function public.inbound_cleanup_accepted_17track_tracking_error(uuid, integer, timestamptz, text) to service_role;
