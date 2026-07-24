-- Durable Quote Ready mockup queue. Trello remains a projection only.
create table if not exists public.quote_ready_mockup_orders (
  id uuid primary key default gen_random_uuid(),
  order_key text not null unique,
  trello_card_id text not null,
  source_revision text not null,
  product_type text not null,
  expected_count integer not null,
  status text not null default 'queued',
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  lease_owner text null,
  lease_expires_at timestamptz null,
  next_attempt_at timestamptz not null default now(),
  completed_count integer not null default 0,
  failed_count integer not null default 0,
  last_error_code text null,
  last_error_message text null,
  processing_projected_at timestamptz null,
  terminal_projected_at timestamptz null,
  upload_label_projected_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz null,
  finished_at timestamptz null,
  constraint quote_ready_mockup_orders_expected_count_check check (expected_count between 1 and 20),
  constraint quote_ready_mockup_orders_attempts_check check (attempt_count between 0 and max_attempts and max_attempts between 1 and 5),
  constraint quote_ready_mockup_orders_status_check check (status in ('queued','leased','processing','retry_wait','completed','failed_terminal','cancelled','manual_review')),
  constraint quote_ready_mockup_orders_lease_check check (
    (status in ('leased','processing') and lease_owner is not null and lease_expires_at is not null)
    or (status not in ('leased','processing') and lease_owner is null and lease_expires_at is null)
  ),
  constraint quote_ready_mockup_orders_count_check check (
    completed_count >= 0 and failed_count >= 0 and completed_count + failed_count <= expected_count
  ),
  constraint quote_ready_mockup_orders_card_revision_key unique (trello_card_id, source_revision)
);

create table if not exists public.quote_ready_mockup_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.quote_ready_mockup_orders(id) on delete cascade,
  slot_number integer not null,
  slot_key text not null,
  view_name text not null default 'primary',
  status text not null default 'pending',
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  next_attempt_at timestamptz not null default now(),
  provider_request_id text null,
  output_hash text null,
  asset_id uuid null references public.design_assets(id) on delete set null,
  trello_attachment_id text null,
  last_error_code text null,
  last_error_message text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz null,
  finished_at timestamptz null,
  constraint quote_ready_mockup_items_slot_check check (slot_number between 1 and 20),
  constraint quote_ready_mockup_items_attempts_check check (attempt_count between 0 and max_attempts and max_attempts between 1 and 5),
  constraint quote_ready_mockup_items_status_check check (status in ('pending','generating','generated','uploading','completed','retry_wait','failed_terminal','cancelled')),
  constraint quote_ready_mockup_items_order_slot_key unique (order_id, slot_number),
  constraint quote_ready_mockup_items_slot_key_unique unique (slot_key)
);

create table if not exists public.quote_ready_mockup_events (
  id bigint generated always as identity primary key,
  event_key text not null unique,
  order_id uuid not null references public.quote_ready_mockup_orders(id) on delete cascade,
  item_id uuid null references public.quote_ready_mockup_items(id) on delete cascade,
  correlation_id text not null,
  workflow_execution_id text null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists quote_ready_mockup_active_orders_idx
  on public.quote_ready_mockup_orders (lease_expires_at) where status in ('leased','processing');
create index if not exists quote_ready_mockup_orders_claim_idx
  on public.quote_ready_mockup_orders (status, next_attempt_at, created_at);
create index if not exists quote_ready_mockup_items_claim_idx
  on public.quote_ready_mockup_items (order_id, status, next_attempt_at, slot_number);

create or replace function public.enqueue_quote_ready_mockup_order(
  p_order_key text,
  p_trello_card_id text,
  p_source_revision text,
  p_product_type text,
  p_expected_count integer,
  p_correlation_id text,
  p_metadata jsonb default '{}'::jsonb
) returns public.quote_ready_mockup_orders
language plpgsql security definer set search_path = public as $$
declare result public.quote_ready_mockup_orders;
declare normalized_product text := lower(regexp_replace(translate(trim(coalesce(p_product_type,'')), 'äöüÄÖÜß', 'aouAOUs'), '[^a-zA-Z0-9]+', '_', 'g'));
declare safe_count integer := p_expected_count;
begin
  if trim(coalesce(p_order_key,'')) = '' or trim(coalesce(p_trello_card_id,'')) = '' or trim(coalesce(p_source_revision,'')) = '' then
    raise exception 'mockup order identity is required';
  end if;
  if normalized_product in ('table_stand','tablestand','table_stands','tischaufsteller','tischgerat','tischgeraet') then
    safe_count := 1;
  end if;
  if safe_count is null or safe_count < 1 or safe_count > 20 then raise exception 'expected mockup count must be between 1 and 20'; end if;

  insert into public.quote_ready_mockup_orders(order_key, trello_card_id, source_revision, product_type, expected_count, metadata)
  values (trim(p_order_key), trim(p_trello_card_id), trim(p_source_revision), normalized_product, safe_count, coalesce(p_metadata,'{}'::jsonb))
  on conflict (trello_card_id, source_revision) do update set updated_at = now()
  returning * into result;

  insert into public.quote_ready_mockup_items(order_id, slot_number, slot_key, view_name)
  select result.id, slot, result.order_key || ':slot:' || slot::text, case when slot = 1 then 'primary' else 'variant_' || slot::text end
  from generate_series(1, result.expected_count) slot
  on conflict (order_id, slot_number) do nothing;

  insert into public.quote_ready_mockup_events(event_key, order_id, correlation_id, event_type, payload)
  values (result.order_key || ':enqueued', result.id, trim(p_correlation_id), 'order_enqueued', jsonb_build_object('expected_count',result.expected_count,'product_type',result.product_type))
  on conflict (event_key) do nothing;
  return result;
end $$;

create or replace function public.claim_next_quote_ready_mockup_order(
  p_worker_id text,
  p_execution_id text,
  p_lease_seconds integer default 900
) returns public.quote_ready_mockup_orders
language plpgsql security definer set search_path = public as $$
declare result public.quote_ready_mockup_orders;
declare safe_lease integer := least(greatest(coalesce(p_lease_seconds,900),120),1800);
begin
  if trim(coalesce(p_worker_id,'')) = '' then raise exception 'worker id is required'; end if;

  -- Serialize the short claim transaction so concurrent scheduler executions
  -- cannot both observe an open capacity slot. Generation itself stays parallel.
  perform pg_advisory_xact_lock(hashtext('quote_ready_mockup_order_claim'));

  update public.quote_ready_mockup_orders set
    status = case when attempt_count >= max_attempts then 'failed_terminal' else 'retry_wait' end,
    lease_owner = null, lease_expires_at = null,
    next_attempt_at = case when attempt_count >= max_attempts then next_attempt_at else now() + interval '10 minutes' end,
    finished_at = case when attempt_count >= max_attempts then now() else null end,
    last_error_code = 'stale_order_lease', updated_at = now()
  where status in ('leased','processing') and lease_expires_at <= now();

  if (select count(*) from public.quote_ready_mockup_orders
      where status in ('leased','processing') and lease_expires_at > now()) >= 2 then
    return null;
  end if;

  select * into result from public.quote_ready_mockup_orders
  where status in ('queued','retry_wait') and next_attempt_at <= now() and attempt_count < max_attempts
  order by created_at, id for update skip locked limit 1;
  if result.id is null then return null; end if;

  update public.quote_ready_mockup_orders set status='leased', attempt_count=attempt_count+1,
    lease_owner=trim(p_worker_id), lease_expires_at=now()+make_interval(secs=>safe_lease),
    started_at=coalesce(started_at,now()), updated_at=now()
  where id=result.id returning * into result;

  insert into public.quote_ready_mockup_events(event_key,order_id,correlation_id,workflow_execution_id,event_type,payload)
  values (result.order_key || ':claim:' || result.attempt_count::text,result.id,result.order_key,nullif(trim(p_execution_id),''),'order_claimed',jsonb_build_object('worker_id',p_worker_id,'lease_seconds',safe_lease));
  return result;
end $$;

create or replace function public.claim_quote_ready_mockup_items(
  p_order_id uuid,
  p_worker_id text,
  p_limit integer default 2
) returns setof public.quote_ready_mockup_items
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.quote_ready_mockup_orders where id=p_order_id and status in ('leased','processing') and lease_owner=p_worker_id and lease_expires_at>now()) then
    raise exception 'active order lease required';
  end if;
  update public.quote_ready_mockup_orders set status='processing',updated_at=now() where id=p_order_id;
  return query
  with candidates as (
    select id from public.quote_ready_mockup_items
    where order_id=p_order_id and status in ('pending','retry_wait') and next_attempt_at<=now() and attempt_count<max_attempts
    order by slot_number for update skip locked limit least(greatest(coalesce(p_limit,2),1),2)
  ) update public.quote_ready_mockup_items item set status='generating',attempt_count=item.attempt_count+1,
      started_at=coalesce(item.started_at,now()),updated_at=now(),last_error_code=null,last_error_message=null
    from candidates where item.id=candidates.id returning item.*;
end $$;

create or replace function public.finish_quote_ready_mockup_item(
  p_item_id uuid,
  p_worker_id text,
  p_result text,
  p_trello_attachment_id text default null,
  p_asset_id uuid default null,
  p_output_hash text default null,
  p_error_code text default null,
  p_error_message text default null
) returns public.quote_ready_mockup_items
language plpgsql security definer set search_path = public as $$
declare item public.quote_ready_mockup_items;
begin
  select i.* into item from public.quote_ready_mockup_items i join public.quote_ready_mockup_orders o on o.id=i.order_id
  where i.id=p_item_id and o.lease_owner=p_worker_id and o.lease_expires_at>now() for update of i;
  if item.id is null then raise exception 'active order lease required'; end if;
  if p_result='completed' and trim(coalesce(p_trello_attachment_id,''))='' then raise exception 'completed item requires Trello attachment id'; end if;
  update public.quote_ready_mockup_items set
    status=case when p_result='completed' then 'completed' when attempt_count>=max_attempts then 'failed_terminal' else 'retry_wait' end,
    trello_attachment_id=case when p_result='completed' then trim(p_trello_attachment_id) else trello_attachment_id end,
    asset_id=coalesce(p_asset_id,asset_id), output_hash=coalesce(nullif(trim(p_output_hash),''),output_hash),
    last_error_code=case when p_result='completed' then null else coalesce(nullif(trim(p_error_code),''),'generation_failed') end,
    last_error_message=case when p_result='completed' then null else left(p_error_message,2000) end,
    next_attempt_at=case when p_result='completed' or attempt_count>=max_attempts then next_attempt_at else now()+make_interval(mins=>least(30,power(2,attempt_count)::integer*2)) end,
    finished_at=case when p_result='completed' or attempt_count>=max_attempts then now() else null end,updated_at=now()
  where id=p_item_id returning * into item;
  return item;
end $$;

create or replace function public.finalize_quote_ready_mockup_order(p_order_id uuid,p_worker_id text)
returns public.quote_ready_mockup_orders language plpgsql security definer set search_path=public as $$
declare result public.quote_ready_mockup_orders; declare completed integer; declare terminal integer; declare open_items integer;
begin
  select count(*) filter(where status='completed'),count(*) filter(where status='failed_terminal'),count(*) filter(where status not in ('completed','failed_terminal','cancelled'))
  into completed,terminal,open_items from public.quote_ready_mockup_items where order_id=p_order_id;
  update public.quote_ready_mockup_orders set completed_count=completed,failed_count=terminal,
    status=case when completed=expected_count then 'completed' when open_items=0 then 'failed_terminal' else 'processing' end,
    lease_owner=case when completed=expected_count or open_items=0 then null else lease_owner end,
    lease_expires_at=case when completed=expected_count or open_items=0 then null else lease_expires_at end,
    finished_at=case when completed=expected_count or open_items=0 then now() else null end,updated_at=now()
  where id=p_order_id and lease_owner=p_worker_id and lease_expires_at>now() returning * into result;
  if result.id is null then raise exception 'active order lease required'; end if;
  return result;
end $$;

alter table public.quote_ready_mockup_orders enable row level security;
alter table public.quote_ready_mockup_items enable row level security;
alter table public.quote_ready_mockup_events enable row level security;
revoke all on public.quote_ready_mockup_orders,public.quote_ready_mockup_items,public.quote_ready_mockup_events from public,anon,authenticated,service_role;
grant select,insert,update on public.quote_ready_mockup_orders,public.quote_ready_mockup_items to service_role;
grant select,insert on public.quote_ready_mockup_events to service_role;
grant usage,select on sequence public.quote_ready_mockup_events_id_seq to service_role;
revoke all on function public.enqueue_quote_ready_mockup_order(text,text,text,text,integer,text,jsonb) from public,anon,authenticated;
revoke all on function public.claim_next_quote_ready_mockup_order(text,text,integer) from public,anon,authenticated;
revoke all on function public.claim_quote_ready_mockup_items(uuid,text,integer) from public,anon,authenticated;
revoke all on function public.finish_quote_ready_mockup_item(uuid,text,text,text,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.finalize_quote_ready_mockup_order(uuid,text) from public,anon,authenticated;
grant execute on function public.enqueue_quote_ready_mockup_order(text,text,text,text,integer,text,jsonb) to service_role;
grant execute on function public.claim_next_quote_ready_mockup_order(text,text,integer) to service_role;
grant execute on function public.claim_quote_ready_mockup_items(uuid,text,integer) to service_role;
grant execute on function public.finish_quote_ready_mockup_item(uuid,text,text,text,uuid,text,text,text) to service_role;
grant execute on function public.finalize_quote_ready_mockup_order(uuid,text) to service_role;
