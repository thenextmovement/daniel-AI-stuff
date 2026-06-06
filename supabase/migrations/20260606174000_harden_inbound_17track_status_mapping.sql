create or replace function public.inbound_normalize_status(p_carrier text, p_status_code text, p_status_text text)
returns text
language plpgsql
immutable
as $$
declare
  v_code text := upper(btrim(coalesce(p_status_code, '')));
  v_text text := lower(coalesce(p_carrier, '') || ' ' || coalesce(p_status_code, '') || ' ' || coalesce(p_status_text, ''));
begin
  if v_code in ('DL') or v_text ~ 'delivered|zugestellt|delivery complete' then
    return 'delivered';
  end if;
  if v_code in ('OD') or v_text ~ 'out for delivery|outfordelivery|with courier|in zustellung|wird zugestellt' then
    return 'out_for_delivery';
  end if;
  if v_code in ('CD') or v_text ~ 'clearance delay|additional information required|customs.*required|clearance.*required|zoll.*information|zoll.*erforder' then
    return 'clearance_action_required';
  end if;
  if v_code in ('CP') or v_text ~ 'clearance event|clearance in progress|customs clearance|processed for clearance|zoll|verzoll' then
    return 'clearance_in_progress';
  end if;
  if v_code in ('DE', 'DD', 'SE') or v_text ~ 'exception|expired|delay|delayed|on hold|shipment is on hold|problem|failed' then
    return 'exception';
  end if;
  if v_code in ('OC') or v_text ~ 'shipment information sent|inforeceived|info received|label created|label generated|sendungsdaten|daten.*uebermittelt|daten.*übermittelt' then
    return 'label_created';
  end if;
  if v_code in ('PU', 'IP') or v_text ~ 'picked up|in fedex possession|accepted|received by carrier|shipment picked up|abgeholt|uebernommen|übernommen' then
    return 'tendered';
  end if;
  if v_code in ('IT', 'DP', 'AF', 'AR', 'TR', 'CC', 'PM') or v_text ~ 'in transit|intransit|on the way|arrived|departed|facility|hub|sort|transport|unterwegs|processed' then
    return 'in_transit';
  end if;
  if v_text ~ 'not found|notfound|no tracking|unknown shipment|keine sendung|nicht gefunden' then
    return 'carrier_not_found';
  end if;
  return 'in_transit';
end;
$$;

revoke all on function public.inbound_normalize_status(text, text, text) from public, anon, authenticated;
grant execute on function public.inbound_normalize_status(text, text, text) to service_role;
