begin;

create table public.dunning_court_events (
  id uuid primary key default gen_random_uuid(),
  order_number text not null,
  event_key text not null unique,
  event_type text not null,
  occurred_on date not null,
  source_reference text,
  actor text,
  note text,
  created_at timestamptz not null default now(),
  constraint dunning_court_events_order_number_check
    check (order_number ~ '^#NEONT[0-9]+$'),
  constraint dunning_court_events_event_key_check
    check (char_length(btrim(event_key)) between 8 and 180),
  constraint dunning_court_events_event_type_check
    check (
      event_type in (
        'application_draft_created',
        'application_submitted',
        'court_order_served',
        'objection_received',
        'enforcement_order_requested',
        'enforcement_order_issued',
        'closed'
      )
    ),
  constraint dunning_court_events_source_reference_check
    check (
      source_reference is null
      or char_length(btrim(source_reference)) between 1 and 240
    ),
  constraint dunning_court_events_actor_check
    check (actor is null or char_length(btrim(actor)) between 1 and 180),
  constraint dunning_court_events_note_check
    check (note is null or char_length(note) <= 2000)
);

create index dunning_court_events_order_date_idx
  on public.dunning_court_events (
    order_number,
    occurred_on desc,
    created_at desc
  );

alter table public.dunning_court_events enable row level security;

create policy dunning_court_events_service_role_select
  on public.dunning_court_events
  for select to service_role
  using (true);

create policy dunning_court_events_service_role_insert
  on public.dunning_court_events
  for insert to service_role
  with check (true);

revoke all on table public.dunning_court_events
  from public, anon, authenticated;
grant select, insert on table public.dunning_court_events
  to service_role;

comment on table public.dunning_court_events is
  'Append-only audit trail for distinct steps of the official court dunning process. Draft creation never means submission or service.';

insert into public.dunning_court_events (
  order_number,
  event_key,
  event_type,
  occurred_on,
  source_reference,
  note
) values (
  '#NEONT2993',
  'ticket-157-neont2993-application-draft-created-2026-08-25',
  'application_draft_created',
  date '2026-08-25',
  'TICKET-157',
  'Amtlicher Barcode-PDF-Entwurf erzeugt; nicht beim Mahngericht eingereicht und nicht zugestellt.'
)
on conflict (event_key) do nothing;

commit;
