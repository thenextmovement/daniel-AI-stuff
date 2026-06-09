create table if not exists public.supplier_sales (
  id uuid primary key default gen_random_uuid(),
  sale_key text not null unique,
  source text not null default 'shopify',
  shopify_order_id text,
  shopify_order_name text,
  shopify_order_url text,
  shopify_payment_status text not null default 'unknown',
  payment_decision_status text not null default 'pending',
  payment_due_at timestamptz,
  last_payment_reminder_at timestamptz,
  payment_reminder_count integer not null default 0,
  offer_id text,
  offer_number text,
  document_reference text,
  offer_public_url text,
  final_pdf_url text,
  trello_card_id text,
  request_id text,
  customer_name text,
  customer_email text,
  customer_phone text,
  customer_company text,
  currency text not null default 'EUR',
  subtotal_price numeric(12, 2),
  total_price numeric(12, 2),
  customer_due_date date,
  supplier_due_date date,
  due_date_source text,
  due_date_note text,
  recommended_supplier text not null default 'unknown',
  recommendation_reasons text[] not null default '{}'::text[],
  assigned_supplier text,
  special_supplier_name text,
  assignment_status text not null default 'needs_review',
  assignment_note text,
  assigned_at timestamptz,
  assigned_by text,
  shopify_tag_sync_status text not null default 'not_started',
  shopify_tag_value text,
  shopify_tag_synced_at timestamptz,
  shopify_tag_error text,
  trello_projection_status text not null default 'not_started',
  supplier_trello_card_id text,
  supplier_trello_card_url text,
  trello_projection_error text,
  task_sync_status text not null default 'not_started',
  active_task_id text,
  task_sync_error text,
  product_summary text,
  primary_image_url text,
  raw_shopify jsonb not null default '{}'::jsonb,
  offer_snapshot jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_sales_shopify_payment_status_check check (
    shopify_payment_status in ('unknown', 'pending', 'authorized', 'paid', 'partially_paid', 'partially_refunded', 'refunded', 'voided', 'expired')
  ),
  constraint supplier_sales_payment_decision_status_check check (
    payment_decision_status in ('pending', 'wait_for_payment', 'manual_approved_unpaid', 'paid_confirmed', 'canceled', 'refunded')
  ),
  constraint supplier_sales_supplier_check check (
    recommended_supplier in ('quentin', 'said', 'special', 'manual_review', 'unknown')
      and (assigned_supplier is null or assigned_supplier in ('quentin', 'said', 'special'))
  ),
  constraint supplier_sales_assignment_status_check check (
    assignment_status in ('needs_review', 'payment_open', 'ready_to_assign', 'assigned', 'in_production', 'blocked', 'completed', 'canceled')
  ),
  constraint supplier_sales_sync_status_check check (
    shopify_tag_sync_status in ('not_started', 'pending', 'synced', 'failed', 'skipped')
      and trello_projection_status in ('not_started', 'pending', 'synced', 'failed', 'skipped')
      and task_sync_status in ('not_started', 'pending', 'synced', 'failed', 'skipped')
  ),
  constraint supplier_sales_payment_reminder_count_check check (payment_reminder_count >= 0)
);

create unique index if not exists supplier_sales_shopify_order_id_idx
  on public.supplier_sales (shopify_order_id)
  where shopify_order_id is not null;

create unique index if not exists supplier_sales_offer_id_idx
  on public.supplier_sales (offer_id)
  where offer_id is not null;

create index if not exists supplier_sales_board_idx
  on public.supplier_sales (assignment_status, supplier_due_date, shopify_payment_status, updated_at desc);

create index if not exists supplier_sales_supplier_idx
  on public.supplier_sales (assigned_supplier, recommended_supplier, assignment_status, supplier_due_date);

create index if not exists supplier_sales_customer_idx
  on public.supplier_sales (customer_email, customer_name);

create table if not exists public.supplier_sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.supplier_sales(id) on delete cascade,
  line_item_key text not null,
  title text not null,
  sku text,
  variant_title text,
  quantity integer not null default 1,
  product_type text,
  image_url text,
  requires_quentin boolean not null default false,
  rule_reasons text[] not null default '{}'::text[],
  raw_line_item jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_sale_items_quantity_check check (quantity > 0)
);

create unique index if not exists supplier_sale_items_sale_line_idx
  on public.supplier_sale_items (sale_id, line_item_key);

create index if not exists supplier_sale_items_sale_idx
  on public.supplier_sale_items (sale_id, requires_quentin);

create table if not exists public.supplier_sale_events (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid references public.supplier_sales(id) on delete cascade,
  event_type text not null,
  actor text,
  idempotency_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint supplier_sale_events_type_check check (
    event_type in (
      'sale_upserted',
      'sale_updated',
      'payment_status_changed',
      'payment_reminder_requested',
      'assignment_recommended',
      'assignment_confirmed',
      'assignment_side_effect_synced',
      'assignment_side_effect_failed',
      'status_changed',
      'manual_note'
    )
  )
);

create index if not exists supplier_sale_events_sale_idx
  on public.supplier_sale_events (sale_id, created_at desc);

create table if not exists public.supplier_assignment_attempts (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.supplier_sales(id) on delete cascade,
  attempt_key text not null unique,
  supplier text not null,
  operator_name text,
  requested_delivery_date date not null,
  assignment_note text,
  payment_decision_status text not null,
  status text not null default 'pending',
  shopify_tag_value text,
  trello_card_id text,
  trello_card_url text,
  task_id text,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint supplier_assignment_attempts_supplier_check check (supplier in ('quentin', 'said', 'special')),
  constraint supplier_assignment_attempts_payment_decision_check check (
    payment_decision_status in ('wait_for_payment', 'manual_approved_unpaid', 'paid_confirmed')
  ),
  constraint supplier_assignment_attempts_status_check check (status in ('pending', 'synced', 'partial', 'failed'))
);

create index if not exists supplier_assignment_attempts_sale_idx
  on public.supplier_assignment_attempts (sale_id, created_at desc);

create table if not exists public.supplier_payment_reminders (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.supplier_sales(id) on delete cascade,
  reminder_key text not null unique,
  status text not null default 'pending',
  requested_by text,
  recipient_email text,
  payment_link text,
  provider_message_id text,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint supplier_payment_reminders_status_check check (status in ('pending', 'sent', 'failed', 'skipped'))
);

create index if not exists supplier_payment_reminders_sale_idx
  on public.supplier_payment_reminders (sale_id, created_at desc);

do $$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'update_updated_at_column'
  ) then
    create function public.update_updated_at_column()
    returns trigger
    language plpgsql
    as $trigger$
    begin
      new.updated_at = now();
      return new;
    end;
    $trigger$;
  end if;
end $$;

alter table public.supplier_sales enable row level security;
alter table public.supplier_sale_items enable row level security;
alter table public.supplier_sale_events enable row level security;
alter table public.supplier_assignment_attempts enable row level security;
alter table public.supplier_payment_reminders enable row level security;

drop policy if exists supplier_sales_service_role_all on public.supplier_sales;
create policy supplier_sales_service_role_all
  on public.supplier_sales
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists supplier_sale_items_service_role_all on public.supplier_sale_items;
create policy supplier_sale_items_service_role_all
  on public.supplier_sale_items
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists supplier_sale_events_service_role_all on public.supplier_sale_events;
create policy supplier_sale_events_service_role_all
  on public.supplier_sale_events
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists supplier_assignment_attempts_service_role_all on public.supplier_assignment_attempts;
create policy supplier_assignment_attempts_service_role_all
  on public.supplier_assignment_attempts
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists supplier_payment_reminders_service_role_all on public.supplier_payment_reminders;
create policy supplier_payment_reminders_service_role_all
  on public.supplier_payment_reminders
  for all
  to service_role
  using (true)
  with check (true);

grant select, insert, update, delete on public.supplier_sales to service_role;
grant select, insert, update, delete on public.supplier_sale_items to service_role;
grant select, insert, update, delete on public.supplier_sale_events to service_role;
grant select, insert, update, delete on public.supplier_assignment_attempts to service_role;
grant select, insert, update, delete on public.supplier_payment_reminders to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'supplier_sales_updated_at'
      and tgrelid = 'public.supplier_sales'::regclass
  ) then
    create trigger supplier_sales_updated_at
      before update on public.supplier_sales
      for each row execute function public.update_updated_at_column();
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgname = 'supplier_sale_items_updated_at'
      and tgrelid = 'public.supplier_sale_items'::regclass
  ) then
    create trigger supplier_sale_items_updated_at
      before update on public.supplier_sale_items
      for each row execute function public.update_updated_at_column();
  end if;
end $$;

comment on table public.supplier_sales is
  'Source-of-truth board for NEONTRIP supplier assignment. Shopify, Trello and tasks are projections/side effects.';
