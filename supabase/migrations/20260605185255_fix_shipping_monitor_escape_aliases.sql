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
  ),
  safe_issues as (
    select
      replace(replace(replace(replace(coalesce(src.status, '-'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') as status_html,
      replace(replace(replace(replace(coalesce(src.kind, '-'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') as kind_html,
      replace(replace(replace(replace(coalesce(src.recipient_email, '-'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') as recipient_email_html,
      replace(replace(replace(replace(coalesce(src.attempts::text, '-'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') as attempts_html,
      replace(replace(replace(replace(coalesce(src.shopify_order_number, '-'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') as shopify_order_number_html,
      replace(replace(replace(replace(coalesce(upper(src.carrier), '-'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') as carrier_html,
      replace(replace(replace(replace(coalesce(src.tracking_number, '-'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') as tracking_number_html,
      replace(replace(replace(replace(coalesce(src.updated_at::text, '-'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') as updated_at_html,
      replace(replace(replace(replace(coalesce(left(src.last_error, 160), '-'), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;') as last_error_html
    from issues src
  )
  select
    '<p><strong>Shipping Notification Monitor</strong></p>' ||
    '<p>Es gibt ' || v_issue_count::text || ' haengende oder fehlgeschlagene Shipping-Benachrichtigung(en). Bitte im Shipping Board und in n8n pruefen.</p>' ||
    '<table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;font-size:13px;">' ||
    '<tr><th>Status</th><th>Typ</th><th>Empfaenger</th><th>Versuche</th><th>Order</th><th>Carrier</th><th>Tracking</th><th>Updated</th><th>Fehler</th></tr>' ||
    string_agg(
      '<tr>' ||
      '<td>' || issue.status_html || '</td>' ||
      '<td>' || issue.kind_html || '</td>' ||
      '<td>' || issue.recipient_email_html || '</td>' ||
      '<td>' || issue.attempts_html || '</td>' ||
      '<td>' || issue.shopify_order_number_html || '</td>' ||
      '<td>' || issue.carrier_html || '</td>' ||
      '<td>' || issue.tracking_number_html || '</td>' ||
      '<td>' || issue.updated_at_html || '</td>' ||
      '<td>' || issue.last_error_html || '</td>' ||
      '</tr>',
      ''
    ) ||
    '</table>' ||
    '<p><a href="https://ops.neontrip.de/ops/customer-records/shipping">Shipping Board oeffnen</a></p>'
  into v_body_html
  from safe_issues issue;

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
