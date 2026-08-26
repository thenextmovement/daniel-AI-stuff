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

create table public.dunning_court_profiles (
  order_number text primary key,
  debtor_type text not null default 'company',
  legal_name text not null,
  legal_form text not null,
  street text not null,
  postal_code text not null,
  city text not null,
  country_code text not null default 'DE',
  representatives jsonb not null default '[]'::jsonb,
  register_court text,
  register_type text,
  register_number text,
  source_url text not null,
  source_checked_at timestamptz not null,
  communication_checked_at timestamptz not null,
  verified_at timestamptz not null,
  verified_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dunning_court_profiles_order_number_check
    check (order_number ~ '^#NEONT[0-9]+$'),
  constraint dunning_court_profiles_debtor_type_check
    check (debtor_type = 'company'),
  constraint dunning_court_profiles_legal_name_check
    check (char_length(btrim(legal_name)) between 1 and 140),
  constraint dunning_court_profiles_legal_form_check
    check (char_length(btrim(legal_form)) between 1 and 60),
  constraint dunning_court_profiles_street_check
    check (char_length(btrim(street)) between 1 and 140),
  constraint dunning_court_profiles_postal_code_check
    check (postal_code ~ '^[0-9]{5}$'),
  constraint dunning_court_profiles_city_check
    check (char_length(btrim(city)) between 1 and 100),
  constraint dunning_court_profiles_country_check
    check (country_code = 'DE'),
  constraint dunning_court_profiles_representatives_check
    check (
      jsonb_typeof(representatives) = 'array'
      and jsonb_array_length(representatives) between 1 and 6
    ),
  constraint dunning_court_profiles_register_court_check
    check (register_court is null or char_length(btrim(register_court)) between 1 and 120),
  constraint dunning_court_profiles_register_type_check
    check (register_type is null or register_type in ('HRB', 'HRA', 'GnR', 'PR', 'VR')),
  constraint dunning_court_profiles_register_number_check
    check (register_number is null or char_length(btrim(register_number)) between 1 and 40),
  constraint dunning_court_profiles_source_url_check
    check (source_url ~ '^https://'),
  constraint dunning_court_profiles_verified_by_check
    check (char_length(btrim(verified_by)) between 3 and 180)
);

create index dunning_court_profiles_verified_idx
  on public.dunning_court_profiles (verified_at desc);

alter table public.dunning_court_profiles enable row level security;

create policy dunning_court_profiles_service_role_all
  on public.dunning_court_profiles
  for all to service_role
  using (true)
  with check (true);

revoke all on table public.dunning_court_profiles
  from public, anon, authenticated;
grant select, insert, update on table public.dunning_court_profiles
  to service_role;

comment on table public.dunning_court_profiles is
  'Operator-verified legal service data for official court dunning drafts. Shopify addresses alone are not authoritative.';

create table public.dunning_court_draft_jobs (
  id uuid primary key default gen_random_uuid(),
  order_number text not null,
  idempotency_key text not null unique,
  snapshot_hash text not null,
  status text not null default 'pending',
  case_snapshot jsonb not null,
  requested_by text not null,
  pdf_filename text,
  pdf_sha256 text,
  pdf_bytes integer,
  overview_sha256 text,
  graph_draft_id text,
  internal_recipient text,
  last_error_code text,
  created_at timestamptz not null default now(),
  processing_at timestamptz,
  email_dispatching_at timestamptz,
  email_sent_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint dunning_court_draft_jobs_order_number_check
    check (order_number ~ '^#NEONT[0-9]+$'),
  constraint dunning_court_draft_jobs_idempotency_check
    check (idempotency_key ~ '^ops-court:[A-Za-z0-9:_-]{16,180}$'),
  constraint dunning_court_draft_jobs_snapshot_hash_check
    check (snapshot_hash ~ '^[a-f0-9]{64}$'),
  constraint dunning_court_draft_jobs_status_check
    check (status in ('pending', 'processing', 'pdf_created', 'email_dispatching', 'email_sent', 'retryable_error', 'manual_review', 'cancelled')),
  constraint dunning_court_draft_jobs_requested_by_check
    check (char_length(btrim(requested_by)) between 3 and 180),
  constraint dunning_court_draft_jobs_pdf_filename_check
    check (pdf_filename is null or pdf_filename ~ '^NEONT[0-9]+_Barcode-Mahnantrag_[0-9]{4}-[0-9]{2}-[0-9]{2}[.]pdf$'),
  constraint dunning_court_draft_jobs_pdf_sha256_check
    check (pdf_sha256 is null or pdf_sha256 ~ '^[a-f0-9]{64}$'),
  constraint dunning_court_draft_jobs_pdf_bytes_check
    check (pdf_bytes is null or pdf_bytes between 1000 and 3000000),
  constraint dunning_court_draft_jobs_overview_sha256_check
    check (overview_sha256 is null or overview_sha256 ~ '^[a-f0-9]{64}$'),
  constraint dunning_court_draft_jobs_internal_recipient_check
    check (
      internal_recipient is null
      or internal_recipient ~* '^[A-Z0-9._%+-]+@(neontrip[.]de|daranova[.]de)$'
    ),
  constraint dunning_court_draft_jobs_error_check
    check (last_error_code is null or last_error_code ~ '^[A-Z0-9_]{3,80}$')
);

create index dunning_court_draft_jobs_order_date_idx
  on public.dunning_court_draft_jobs (order_number, created_at desc);

create unique index dunning_court_draft_jobs_active_order_idx
  on public.dunning_court_draft_jobs (order_number)
  where status in ('pending', 'processing', 'pdf_created', 'email_dispatching', 'email_sent');

alter table public.dunning_court_draft_jobs enable row level security;

create policy dunning_court_draft_jobs_service_role_all
  on public.dunning_court_draft_jobs
  for all to service_role
  using (true)
  with check (true);

revoke all on table public.dunning_court_draft_jobs
  from public, anon, authenticated;
grant select, insert, update on table public.dunning_court_draft_jobs
  to service_role;

comment on table public.dunning_court_draft_jobs is
  'Idempotent official Barcode-PDF preparation jobs. Email dispatch uncertainty is routed to manual review and never blindly retried.';

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
