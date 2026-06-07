drop trigger if exists inbound_cleanup_accepted_17track_registration
  on public.inbound_tracking_registrations;

drop function if exists public.inbound_cleanup_accepted_17track_registration_trigger();

with cleanup_rows as (
  select
    id,
    metadata -> 'tracking_error_cleanup_before' as previous_state
  from public.inbound_shipments
  where metadata ->> 'tracking_error_cleared_by' = 'cleanup_inbound_17track_accepted_tracking_errors'
    and metadata ? 'tracking_error_cleanup_before'
)
update public.inbound_shipments s
set risk_level = coalesce(c.previous_state ->> 'risk_level', s.risk_level),
    status_reason = c.previous_state ->> 'status_reason',
    metadata = case
      when c.previous_state ? 'last_tracking_error'
        and c.previous_state -> 'last_tracking_error' <> 'null'::jsonb
      then
        (
          s.metadata
          - 'tracking_error_cleared_at'
          - 'tracking_error_cleared_by'
          - 'tracking_error_cleared_reason'
          - 'tracking_error_cleanup_before'
          - 'tracking_provider'
        ) || jsonb_build_object('last_tracking_error', c.previous_state -> 'last_tracking_error')
      else
        (
          s.metadata
          - 'tracking_error_cleared_at'
          - 'tracking_error_cleared_by'
          - 'tracking_error_cleared_reason'
          - 'tracking_error_cleanup_before'
          - 'tracking_provider'
          - 'last_tracking_error'
        )
      end,
    updated_at = now()
from cleanup_rows c
where s.id = c.id;

update public.inbound_incidents i
set status = 'open',
    resolved_at = null,
    updated_at = now(),
    metadata = i.metadata || jsonb_build_object(
      'rollback_by', '20260607061742_cleanup_inbound_17track_accepted_tracking_errors_rollback'
    )
where i.incident_type = 'tracking_error'
  and i.status = 'resolved'
  and i.metadata ->> 'resolved_by' = 'cleanup_inbound_17track_accepted_tracking_errors';

drop function if exists public.inbound_cleanup_accepted_17track_tracking_error(uuid, integer, timestamptz, text);
