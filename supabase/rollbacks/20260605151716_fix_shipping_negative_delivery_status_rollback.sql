create or replace function public.shipping_normalize_status(p_carrier text, p_status_code text, p_status_text text)
returns text
language sql
immutable
as $$
  with input as (
    select lower(concat_ws(' ', p_carrier, p_status_code, p_status_text)) as text
  )
  select case
    when text ~ 'attempted[_\s-]*delivery' then 'delivery_failed'
    when text ~ 'ready[_\s-]*for[_\s-]*pickup' then 'pickup_available'
    when text ~ 'out[_\s-]*for[_\s-]*delivery' then 'out_for_delivery'
    when text ~ 'carrier[_\s-]*picked[_\s-]*up|in[_\s-]*transit' then 'in_transit'
    when text ~ 'label[_\s-]*(printed|purchased)|confirmed' then 'label_created'
    when text ~ '\bfailure\b' then 'delivery_failed'
    when text ~ 'not\s*found|unknown shipment|keine sendung|nicht gefunden|no tracking' then 'carrier_not_found'
    when text ~ 'returned|retoure abgeschlossen|ruecksendung zugestellt|rücksendung zugestellt|returned to sender' then 'returned'
    when text ~ 'return to sender|returning|retoure|ruecksendung|rücksendung|zurueck an absender|zurück an absender' then 'returning'
    when text ~ 'delivered|zugestellt|erfolgreich zugestellt' then 'delivered'
    when text ~ 'failed|nicht zugestellt|zustellung fehlgeschlagen|empfaenger nicht|empfänger nicht|annahme verweigert|address problem|adressproblem' then 'delivery_failed'
    when text ~ 'pickup|paketshop|parcelshop|filiale|packstation|abhol' then 'pickup_available'
    when text ~ 'out for delivery|in zustellung|zustellung heute|wird heute zugestellt' then 'out_for_delivery'
    when text ~ 'label|announced|angekuendigt|angekündigt|daten.*uebermittelt|daten.*übermittelt|sendungsdaten' then 'label_created'
    when text ~ 'delay|delayed|verspaetet|verspätet|transit|unterwegs|sort|depot|hub|transport|scan|processed|verarbeitet' then 'in_transit'
    else 'in_transit'
  end
  from input;
$$;

comment on function public.shipping_normalize_status(text, text, text)
is 'Rollback for 20260605151716: restores carrier_status_mapping_v1 status order. Existing v2 event rows are intentionally not mutated by rollback.';

revoke all on function public.shipping_normalize_status(text, text, text) from public, anon, authenticated;
grant execute on function public.shipping_normalize_status(text, text, text) to service_role;
