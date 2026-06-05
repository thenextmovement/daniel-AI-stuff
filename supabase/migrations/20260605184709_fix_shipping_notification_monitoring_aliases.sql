create or replace function public.shipping_claim_notification_monitor_alert(p_now timestamptz default now())
returns table (
  alert_key text,
  recipient_email text,
  subject text,
  body_html text,
  issue_count integer
)
language plpgsql
security invoker
as $$
declare
  v_alert_key text := 'shipping_notification_monitor:' || to_char(p_now at time zone 'utc', 'YYYYMMDDHH24');
  v_issue_count integer := 0;
  v_body_html text;
begin
  select count(*)::integer
  into v_issue_count
  from public.shipping_notifications n
  where n.channel = 'outlook_email'
    and (
      (n.status = 'sending' and coalesce(n.claimed_at, n.updated_at) <= p_now - interval '45 minutes')
      or (n.status = 'pending' and n.updated_at <= p_now - interval '2 hours')
      or (n.status = 'failed' and n.attempts >= 3)
    );

  if v_issue_count = 0 then
    return;
  end if;

  insert into public.shipping_audit_log (
    action,
    status,
    idempotency_key,
    actor,
    metadata,
    created_at
  )
  values (
    'shipping_notification_monitor_alert',
    'success',
    v_alert_key,
    jsonb_build_object('system', 'shipping-agent'),
    jsonb_build_object('issue_count', v_issue_count),
    p_now
  )
  on conflict (idempotency_key) do nothing;

  if not found then
    return;
  end if;

  with issues as (
    select
      n.status,
      n.kind,
      n.recipient_type,
      n.recipient_email,
      n.attempts,
      n.notification_key,
      n.updated_at,
      n.claimed_at,
      n.last_error,
      s.shopify_order_number,
      s.carrier,
      s.tracking_number,
      s.request_id
    from public.shipping_notifications n
    left join public.shipping_shipments s on s.id = n.shipment_id
    where n.channel = 'outlook_email'
      and (
        (n.status = 'sending' and coalesce(n.claimed_at, n.updated_at) <= p_now - interval '45 minutes')
        or (n.status = 'pending' and n.updated_at <= p_now - interval '2 hours')
        or (n.status = 'failed' and n.attempts >= 3)
      )
    order by
      case n.status when 'failed' then 1 when 'sending' then 2 else 3 end,
      n.updated_at asc
    limit 20
  )
  select
    '<p><strong>Shipping Notification Monitor</strong></p>' ||
    '<p>Es gibt ' || v_issue_count::text || ' haengende oder fehlgeschlagene Shipping-Benachrichtigung(en). Bitte im Shipping Board und in n8n pruefen.</p>' ||
    '<table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:13px;">' ||
    '<tr><th>Status</th><th>Typ</th><th>Empfaenger</th><th>Versuche</th><th>Order</th><th>Carrier</th><th>Tracking</th><th>Updated</th><th>Fehler</th></tr>' ||
    string_agg(
      '<tr>' ||
      '<td>' || coalesce(issue.status, '-') || '</td>' ||
      '<td>' || coalesce(issue.kind, '-') || '</td>' ||
      '<td>' || coalesce(issue.recipient_email, '-') || '</td>' ||
      '<td>' || coalesce(issue.attempts::text, '-') || '</td>' ||
      '<td>' || coalesce(issue.shopify_order_number, '-') || '</td>' ||
      '<td>' || coalesce(upper(issue.carrier), '-') || '</td>' ||
      '<td>' || coalesce(issue.tracking_number, '-') || '</td>' ||
      '<td>' || coalesce(issue.updated_at::text, '-') || '</td>' ||
      '<td>' || coalesce(left(issue.last_error, 160), '-') || '</td>' ||
      '</tr>',
      ''
    ) ||
    '</table>' ||
    '<p><a href="https://ops.neontrip.de/ops/customer-records/shipping">Shipping Board oeffnen</a></p>'
  into v_body_html
  from issues issue;

  return query
  select
    v_alert_key,
    'info@neontrip.de',
    'Shipping Monitor: Benachrichtigungen haengen oder sind fehlgeschlagen',
    v_body_html,
    v_issue_count;
end;
$$;

revoke all on function public.shipping_claim_notification_monitor_alert(timestamptz) from public, anon, authenticated;
grant execute on function public.shipping_claim_notification_monitor_alert(timestamptz) to service_role;
