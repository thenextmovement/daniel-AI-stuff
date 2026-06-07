create or replace function public.inbound_claim_pending_notifications(p_limit integer default 20, p_now timestamptz default now())
returns table (
  notification_id uuid,
  notification_key text,
  recipient_email text,
  subject text,
  body_html text,
  attempts integer
)
language plpgsql
security invoker
as $$
begin
  return query
  with candidates as (
    select n.id
    from public.inbound_notifications n
    join public.inbound_incidents i on i.id = n.incident_id
    where n.channel = 'outlook_email'
      and i.status in ('open', 'acknowledged')
      and (
        n.status = 'pending'
        or (n.status = 'failed' and n.attempts < 3 and n.updated_at <= p_now - interval '15 minutes')
        or (n.status = 'sending' and n.claimed_at <= p_now - interval '30 minutes')
      )
    order by n.created_at
    limit greatest(1, least(p_limit, 50))
    for update of n skip locked
  ), claimed as (
    update public.inbound_notifications n
    set status = 'sending',
        attempts = n.attempts + 1,
        claimed_at = p_now,
        updated_at = p_now
    from candidates c
    where n.id = c.id
    returning n.*
  )
  select c.id, c.notification_key, c.recipient_email, c.subject, c.body_html, c.attempts
  from claimed c;
end;
$$;

revoke all on function public.inbound_claim_pending_notifications(integer, timestamptz) from public, anon, authenticated;
grant execute on function public.inbound_claim_pending_notifications(integer, timestamptz) to service_role;

update public.inbound_notifications n
set status = 'skipped',
    updated_at = now(),
    metadata = n.metadata || jsonb_build_object(
      'skipped_by', 'resolved_inbound_incident_notification_guard',
      'skipped_reason', 'Incident was resolved before notification was sent'
    )
from public.inbound_incidents i
where i.id = n.incident_id
  and i.status in ('resolved', 'ignored')
  and n.status in ('pending', 'sending', 'failed');
