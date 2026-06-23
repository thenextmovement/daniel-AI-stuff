create or replace function public.shipping_normalize_status(p_carrier text, p_status_code text, p_status_text text)
returns text
language sql
immutable
as $$
  with input as (
    select lower(concat_ws(' ', p_carrier, p_status_code, p_status_text)) as text
  )
  select case
    when btrim(text) = '' then 'carrier_not_found'
    when text ~ 'attempted[_\s-]*delivery' then 'delivery_failed'
    when text ~ 'ready[_\s-]*for[_\s-]*pickup' then 'pickup_available'
    when text ~ 'out[_\s-]*for[_\s-]*delivery' then 'out_for_delivery'
    when text ~ 'carrier[_\s-]*picked[_\s-]*up|picked\s*up|accepted|received\s+by\s+carrier|in[_\s-]*transit' then 'in_transit'
    when text ~ 'label[_\s-]*(printed|purchased|created|generated)|confirmed|pre[-\s]*advice|shipment information received' then 'label_created'
    when text ~ '\bfailure\b' then 'delivery_failed'
    when text ~ 'not\s*found|unknown shipment|keine sendung|nicht gefunden|no tracking' then 'carrier_not_found'
    when text ~ 'failed|nicht zugestellt|zustellung fehlgeschlagen|empfaenger nicht|empfänger nicht|annahme verweigert|address problem|adressproblem' then 'delivery_failed'
    when text ~ 'returned|retoure abgeschlossen|ruecksendung zugestellt|rücksendung zugestellt|returned to sender' then 'returned'
    when text ~ 'return to sender|returning|retoure|ruecksendung|rücksendung|zurueck an absender|zurück an absender' then 'returning'
    when text ~ 'delivered|zugestellt|erfolgreich zugestellt' then 'delivered'
    when text ~ 'pickup|paketshop|parcelshop|filiale|packstation|abhol' then 'pickup_available'
    when text ~ 'out for delivery|in zustellung|zustellung heute|wird heute zugestellt' then 'out_for_delivery'
    when text ~ 'label|announced|angekuendigt|angekündigt|daten.*uebermittelt|daten.*übermittelt|sendungsdaten|pre[-\s]*advice|shipment information received' then 'label_created'
    when text ~ 'delay|delayed|verspaetet|verspätet|transit|unterwegs|sort|depot|hub|transport|scan|processed|verarbeitet' then 'in_transit'
    else 'carrier_not_found'
  end
  from input;
$$;

revoke all on function public.shipping_normalize_status(text, text, text) from public, anon, authenticated;
grant execute on function public.shipping_normalize_status(text, text, text) to service_role;

update public.shipping_tracking_events
set normalized_status = 'carrier_not_found',
    mapping_version = 'carrier_status_mapping_v2_20260611'
where mapping_version = 'carrier_status_mapping_v3_20260623_shopify_success';

with latest_success as (
  select distinct on (shipment_id)
    shipment_id
  from public.shipping_tracking_events
  where carrier_status_code = 'SUCCESS'
    and lower(coalesce(carrier_status_text, '')) = 'fulfilled'
  order by shipment_id, event_time desc, created_at desc
)
update public.shipping_shipments s
set status = 'carrier_not_found',
    risk_level = public.shipping_risk_level('carrier_not_found'),
    updated_at = now()
from latest_success e
where s.id = e.shipment_id
  and s.status = 'label_created';
