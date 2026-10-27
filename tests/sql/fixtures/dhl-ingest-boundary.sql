-- Isolated boundary fixture; the carrier event evaluator is outside this identity test.
create role anon;
create role authenticated;
create role service_role;
create table public.inbound_shipments (
 id uuid primary key default gen_random_uuid(), shipment_key text, source text, carrier text,
 tracking_number text, tracking_raw text, trello_card_id text, trello_card_name text,
 trello_card_url text, trello_list_id text, trello_list_name text, status_reason text,
 last_checked_at timestamptz, updated_at timestamptz, metadata jsonb not null default '{}',
 unique(carrier,tracking_number)
);
create table public.inbound_incidents (
 shipment_id uuid, incident_type text, status text, resolved_at timestamptz, updated_at timestamptz,
 metadata jsonb, last_detected_at timestamptz
);
create function public.inbound_record_carrier_response(p jsonb) returns jsonb language sql as $$
 update public.inbound_shipments set last_checked_at=now() where id=(p->>'shipmentId')::uuid returning jsonb_build_object('shipment_id',id)
$$;
