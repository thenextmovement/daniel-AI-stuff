-- NEONTRIP only. Reuse existing audit storage; never mutate or retry customer notifications.
create or replace function public.shipping_claim_notification_monitor_alert(p_now timestamptz default now())
returns table(alert_key text, recipient_email text, subject text, body_html text, issue_count integer)
language plpgsql security invoker
set search_path = public
as $$
declare
  v_previous jsonb := '{}'::jsonb;
  v_current jsonb := '{}'::jsonb;
  v_due jsonb := '[]'::jsonb;
  v_item record;
  v_fingerprint text;
  v_before jsonb;
  v_last_claim timestamptz;
  v_key text;
  v_html text := '';
  v_class text;
  v_count integer := 0;
  v_review_count integer := 0;
begin
  if p_now is null then raise exception 'monitor timestamp required'; end if;
  -- Serialize overlapping schedule/API calls before reading the existing audit state.
  perform pg_advisory_xact_lock(hashtextextended('shipping_notification_monitor:v2', 0));
  select coalesce(a.metadata->'issues', '{}'::jsonb) into v_previous
    from public.shipping_audit_log a
    where a.idempotency_key = 'shipping_notification_monitor:state:v2';
  v_previous := coalesce(v_previous, '{}'::jsonb);

  for v_item in
    select n.id, n.status, n.kind, n.attempts, n.last_error, n.updated_at,
      s.shopify_order_number,
      ((n.status = 'sending' and coalesce(n.claimed_at, n.updated_at) <= p_now - interval '45 minutes')
        or (n.status = 'pending' and n.updated_at <= p_now - interval '2 hours')
        or (n.status = 'failed' and n.attempts >= 3)) as eligible,
      (n.kind = 'customer_installation_documents' and n.status = 'pending' and n.attempts = 0
        and nullif(n.metadata->>'review_reason', '') is not null) as needs_review
    from public.shipping_notifications n
    join public.shipping_shipments s on s.id = n.shipment_id
    left join public.shipping_incidents i on i.id = n.incident_id
    where n.channel = 'outlook_email'
      and n.status in ('pending','sending','failed')
      -- Only obsolete, NEVER attempted incident notices may disappear. Uncertain sends
      -- and missing installation documents remain actionable even after parcel delivery.
      and not (n.status = 'pending' and n.attempts = 0 and n.kind <> 'customer_installation_documents'
        and ((i.id is not null and i.status in ('resolved','ignored'))
          or (n.kind = 'customer_pickup_available' and s.status in ('delivered','returned','closed'))))
    order by case n.status when 'failed' then 1 when 'sending' then 2 else 3 end, n.updated_at, n.id
  loop
    v_before := v_previous->v_item.id::text;
    -- A refreshed poll timestamp is not recovery. Retain the previous claim while
    -- this still-open record temporarily falls below the age/attempt threshold.
    if not v_item.eligible then
      if v_before is not null then
        v_current := v_current || jsonb_build_object(v_item.id::text, v_before);
      end if;
      continue;
    end if;
    v_class := case when v_item.needs_review then 'Manuelle Freigabe erforderlich'
      when v_item.status = 'sending' then 'Versandergebnis unklar'
      when v_item.status = 'failed' then 'Versand fehlgeschlagen'
      else 'Verarbeitung ausstehend' end;
    -- Poll timestamps and retry counters do not define a new problem.
    v_fingerprint := md5(jsonb_build_array(v_item.status, v_item.kind, v_class, coalesce(v_item.last_error,''))::text);
    v_last_claim := (v_before->>'last_claim_at')::timestamptz;
    if (v_before is null or v_before->>'fingerprint' is distinct from v_fingerprint
        or v_last_claim is null or v_last_claim <= p_now - interval '24 hours')
        and v_count < 20 then
      v_count := v_count + 1;
      if v_item.needs_review then v_review_count := v_review_count + 1; end if;
      v_last_claim := p_now;
      v_due := v_due || jsonb_build_array(jsonb_build_object('id',v_item.id,'fingerprint',v_fingerprint));
      -- Escape all variable content before embedding in the internal digest.
      v_html := v_html || '<tr><td>' ||
        replace(replace(replace(replace(coalesce(v_item.shopify_order_number,'-'),'&','&amp;'),'<','&lt;'),'>','&gt;'),'"','&quot;') ||
        '</td><td>' || v_class || '</td><td>' ||
        replace(replace(replace(replace(v_item.kind,'&','&amp;'),'<','&lt;'),'>','&gt;'),'"','&quot;') ||
        '</td><td>' || v_item.attempts::text || '</td><td>' ||
        replace(replace(replace(replace(left(coalesce(v_item.last_error,'-'),300),'&','&amp;'),'<','&lt;'),'>','&gt;'),'"','&quot;') || '</td></tr>';
      v_current := v_current || jsonb_build_object(v_item.id::text,
        jsonb_build_object('fingerprint',v_fingerprint,'last_claim_at',v_last_claim));
    else
      -- Preserve the previous fingerprint for deferred rows so the next poll still emits them.
      v_current := v_current || jsonb_build_object(v_item.id::text, coalesce(v_before,'{}'::jsonb));
    end if;
  end loop;

  insert into public.shipping_audit_log(action,status,idempotency_key,actor,metadata,created_at)
    values ('shipping_notification_monitor_observed','success','shipping_notification_monitor:state:v2',
      '{"system":"shipping-agent"}',jsonb_build_object('issues',v_current,'observed_at',p_now),p_now)
    on conflict (idempotency_key) do update set metadata=excluded.metadata;
  if v_count = 0 then return; end if;

  v_key := 'shipping_notification_monitor:v2:' || md5(p_now::text || v_due::text);
  insert into public.shipping_audit_log(action,status,idempotency_key,actor,metadata,created_at)
    values ('shipping_notification_monitor_claim','success',v_key,'{"system":"shipping-agent"}',
      jsonb_build_object('issue_count',v_count,'issues',v_due,'delivery_confirmed',false,
        'meaning','claim_only_not_outlook_delivery'),p_now);
  return query select v_key,'info@neontrip.de'::text,
    case when v_count = v_review_count then 'Shipping Monitor: manuelle Freigabe erforderlich'
      else 'Shipping Monitor: offene Versandvorgaenge pruefen' end,
    '<p><strong>Shipping Monitor</strong></p><p>' || v_count::text ||
      ' neue, geaenderte oder seit 24 Stunden unveraenderte Prueffaelle. ' ||
      'Eine manuelle Freigabe ist kein fehlgeschlagener Sendeversuch. ' ||
      'Unklare Sendungen vor jeder Wiederholung abgleichen.</p>' ||
      '<table cellpadding="6" cellspacing="0" border="1"><tr><th>Auftrag</th><th>Pruefgrund</th><th>Typ</th><th>Sendeversuche</th><th>Details</th></tr>' ||
      v_html || '</table><p><a href="https://ops.neontrip.de/ops/customer-records/shipping">Shipping Board oeffnen</a></p>',
    v_count;
end;
$$;
revoke all on function public.shipping_claim_notification_monitor_alert(timestamptz) from public, anon, authenticated;
grant execute on function public.shipping_claim_notification_monitor_alert(timestamptz) to service_role;
