-- Canonical, fail-closed delivery ledger for the EU supplier quotation loop.
-- Trello remains a projection; it is never consulted to decide whether mail is sent.

create table if not exists public.supplier_quote_request_deliveries (
  id uuid primary key default gen_random_uuid(),
  card_id text not null,
  recipient text not null,
  status text not null default 'processing'
    check (status in ('processing', 'sent', 'delivery_unknown')),
  attempt_count integer not null default 1 check (attempt_count > 0),
  claim_token uuid,
  claimed_at timestamptz not null default now(),
  lease_until timestamptz,
  sent_at timestamptz,
  last_execution_id text,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_quote_request_deliveries_identity_key
    unique (card_id, recipient),
  constraint supplier_quote_request_deliveries_recipient_normalized
    check (recipient = lower(btrim(recipient))),
  constraint supplier_quote_request_deliveries_state_shape
    check (
      (status = 'processing' and claim_token is not null and lease_until is not null and sent_at is null)
      or (status = 'sent' and claim_token is null and lease_until is null and sent_at is not null)
      or (status = 'delivery_unknown' and claim_token is null and lease_until is null and sent_at is null)
    )
);

create index if not exists supplier_quote_request_deliveries_status_idx
  on public.supplier_quote_request_deliveries (status, updated_at desc);

create table if not exists public.supplier_quote_request_delivery_events (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null
    references public.supplier_quote_request_deliveries(id) on delete restrict,
  event_key text not null unique,
  event_type text not null
    check (event_type in ('claimed', 'sent', 'delivery_unknown')),
  workflow_execution_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists supplier_quote_request_delivery_events_delivery_idx
  on public.supplier_quote_request_delivery_events (delivery_id, created_at desc);

alter table public.supplier_quote_request_deliveries enable row level security;
alter table public.supplier_quote_request_delivery_events enable row level security;

revoke all on table public.supplier_quote_request_deliveries
  from public, anon, authenticated;
revoke all on table public.supplier_quote_request_delivery_events
  from public, anon, authenticated;
grant select, insert, update on table public.supplier_quote_request_deliveries
  to service_role;
grant select, insert on table public.supplier_quote_request_delivery_events
  to service_role;

create or replace function public.claim_supplier_quote_request_delivery(
  p_card_id text,
  p_recipient text,
  p_workflow_execution_id text,
  p_lease_seconds integer default 900
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  safe_card_id text := nullif(btrim(p_card_id), '');
  safe_recipient text := lower(nullif(btrim(p_recipient), ''));
  safe_execution_id text := left(nullif(btrim(p_workflow_execution_id), ''), 200);
  safe_lease_seconds integer := least(greatest(coalesce(p_lease_seconds, 900), 60), 3600);
  new_claim_token uuid := gen_random_uuid();
  delivery public.supplier_quote_request_deliveries%rowtype;
  inserted boolean := false;
begin
  if safe_card_id is null or safe_recipient is null or safe_execution_id is null then
    raise exception 'card_id, recipient and workflow_execution_id are required';
  end if;
  if length(safe_card_id) > 200 or length(safe_recipient) > 320 then
    raise exception 'Supplier delivery identity exceeds safe length';
  end if;
  if safe_recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Supplier recipient is invalid';
  end if;

  insert into public.supplier_quote_request_deliveries (
    card_id,
    recipient,
    status,
    attempt_count,
    claim_token,
    claimed_at,
    lease_until,
    last_execution_id
  ) values (
    safe_card_id,
    safe_recipient,
    'processing',
    1,
    new_claim_token,
    now(),
    now() + make_interval(secs => safe_lease_seconds),
    safe_execution_id
  )
  on conflict (card_id, recipient) do nothing
  returning * into delivery;

  inserted := found;

  if inserted then
    insert into public.supplier_quote_request_delivery_events (
      delivery_id,
      event_key,
      event_type,
      workflow_execution_id,
      metadata
    ) values (
      delivery.id,
      'supplier-quote-delivery:' || delivery.id::text || ':claimed:1',
      'claimed',
      safe_execution_id,
      jsonb_build_object('attempt_count', 1, 'lease_seconds', safe_lease_seconds)
    );

    return jsonb_build_object(
      'route', 'send',
      'claimed', true,
      'reason', 'new',
      'delivery_id', delivery.id,
      'card_id', delivery.card_id,
      'recipient', delivery.recipient,
      'claim_token', delivery.claim_token,
      'status', delivery.status,
      'automatic_retry_allowed', false
    );
  end if;

  select existing.*
    into delivery
  from public.supplier_quote_request_deliveries as existing
  where existing.card_id = safe_card_id
    and existing.recipient = safe_recipient
  for update;

  if delivery.status = 'sent' then
    return jsonb_build_object(
      'route', 'continue',
      'claimed', false,
      'reason', 'already_sent',
      'delivery_id', delivery.id,
      'card_id', delivery.card_id,
      'recipient', delivery.recipient,
      'status', delivery.status,
      'automatic_retry_allowed', false
    );
  end if;

  if delivery.status = 'delivery_unknown' then
    return jsonb_build_object(
      'route', 'stop',
      'claimed', false,
      'reason', 'manual_review_required',
      'delivery_id', delivery.id,
      'card_id', delivery.card_id,
      'recipient', delivery.recipient,
      'status', delivery.status,
      'automatic_retry_allowed', false
    );
  end if;

  if delivery.lease_until > now() then
    return jsonb_build_object(
      'route', 'stop',
      'claimed', false,
      'reason', 'active_lease',
      'delivery_id', delivery.id,
      'card_id', delivery.card_id,
      'recipient', delivery.recipient,
      'status', delivery.status,
      'automatic_retry_allowed', false
    );
  end if;

  update public.supplier_quote_request_deliveries
    set status = 'delivery_unknown',
        claim_token = null,
        lease_until = null,
        last_execution_id = safe_execution_id,
        last_error_code = 'stale_processing_lease',
        last_error_message = 'A prior send attempt lost its delivery confirmation; manual review is required.',
        updated_at = now()
  where id = delivery.id
  returning * into delivery;

  insert into public.supplier_quote_request_delivery_events (
    delivery_id,
    event_key,
    event_type,
    workflow_execution_id,
    metadata
  ) values (
    delivery.id,
    'supplier-quote-delivery:' || delivery.id::text || ':delivery-unknown:stale-lease',
    'delivery_unknown',
    safe_execution_id,
    jsonb_build_object('reason', 'stale_processing_lease')
  )
  on conflict (event_key) do nothing;

  return jsonb_build_object(
    'route', 'stop',
    'claimed', false,
    'reason', 'stale_lease_delivery_unknown',
    'delivery_id', delivery.id,
    'card_id', delivery.card_id,
    'recipient', delivery.recipient,
    'status', delivery.status,
    'automatic_retry_allowed', false
  );
end;
$$;

create or replace function public.complete_supplier_quote_request_delivery(
  p_card_id text,
  p_recipient text,
  p_claim_token uuid,
  p_workflow_execution_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  safe_card_id text := nullif(btrim(p_card_id), '');
  safe_recipient text := lower(nullif(btrim(p_recipient), ''));
  safe_execution_id text := left(nullif(btrim(p_workflow_execution_id), ''), 200);
  delivery public.supplier_quote_request_deliveries%rowtype;
begin
  if safe_card_id is null or safe_recipient is null or p_claim_token is null or safe_execution_id is null then
    raise exception 'card_id, recipient, claim_token and workflow_execution_id are required';
  end if;

  update public.supplier_quote_request_deliveries
    set status = 'sent',
        claim_token = null,
        lease_until = null,
        sent_at = now(),
        last_execution_id = safe_execution_id,
        last_error_code = null,
        last_error_message = null,
        updated_at = now()
  where card_id = safe_card_id
    and recipient = safe_recipient
    and status = 'processing'
    and claim_token = p_claim_token
  returning * into delivery;

  if not found then
    select existing.*
      into delivery
    from public.supplier_quote_request_deliveries as existing
    where existing.card_id = safe_card_id
      and existing.recipient = safe_recipient;

    if delivery.status = 'sent' and delivery.last_execution_id = safe_execution_id then
      return jsonb_build_object(
        'completed', false,
        'reason', 'already_completed',
        'delivery_id', delivery.id,
        'status', delivery.status
      );
    end if;

    raise exception 'Supplier delivery completion rejected because the claim is stale or missing';
  end if;

  insert into public.supplier_quote_request_delivery_events (
    delivery_id,
    event_key,
    event_type,
    workflow_execution_id,
    metadata
  ) values (
    delivery.id,
    'supplier-quote-delivery:' || delivery.id::text || ':sent',
    'sent',
    safe_execution_id,
    jsonb_build_object('confirmation', 'outlook_sendmail_returned_success')
  )
  on conflict (event_key) do nothing;

  return jsonb_build_object(
    'completed', true,
    'reason', 'sent',
    'delivery_id', delivery.id,
    'card_id', delivery.card_id,
    'recipient', delivery.recipient,
    'status', delivery.status,
    'sent_at', delivery.sent_at
  );
end;
$$;

create or replace function public.mark_supplier_quote_request_delivery_unknown(
  p_card_id text,
  p_recipient text,
  p_claim_token uuid,
  p_workflow_execution_id text,
  p_error_code text default 'outlook_send_failed'
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  safe_card_id text := nullif(btrim(p_card_id), '');
  safe_recipient text := lower(nullif(btrim(p_recipient), ''));
  safe_execution_id text := left(nullif(btrim(p_workflow_execution_id), ''), 200);
  safe_error_code text := left(coalesce(nullif(btrim(p_error_code), ''), 'outlook_send_failed'), 100);
  delivery public.supplier_quote_request_deliveries%rowtype;
begin
  if safe_card_id is null or safe_recipient is null or p_claim_token is null or safe_execution_id is null then
    raise exception 'card_id, recipient, claim_token and workflow_execution_id are required';
  end if;

  update public.supplier_quote_request_deliveries
    set status = 'delivery_unknown',
        claim_token = null,
        lease_until = null,
        last_execution_id = safe_execution_id,
        last_error_code = safe_error_code,
        last_error_message = 'Outlook send did not return a reliable success confirmation; manual review is required.',
        updated_at = now()
  where card_id = safe_card_id
    and recipient = safe_recipient
    and status = 'processing'
    and claim_token = p_claim_token
  returning * into delivery;

  if not found then
    select existing.*
      into delivery
    from public.supplier_quote_request_deliveries as existing
    where existing.card_id = safe_card_id
      and existing.recipient = safe_recipient;

    if delivery.status = 'delivery_unknown' and delivery.last_execution_id = safe_execution_id then
      return jsonb_build_object(
        'marked_unknown', false,
        'reason', 'already_marked_unknown',
        'delivery_id', delivery.id,
        'status', delivery.status,
        'automatic_retry_allowed', false
      );
    end if;

    raise exception 'Supplier delivery failure update rejected because the claim is stale or missing';
  end if;

  insert into public.supplier_quote_request_delivery_events (
    delivery_id,
    event_key,
    event_type,
    workflow_execution_id,
    metadata
  ) values (
    delivery.id,
    'supplier-quote-delivery:' || delivery.id::text || ':delivery-unknown',
    'delivery_unknown',
    safe_execution_id,
    jsonb_build_object('error_code', safe_error_code)
  )
  on conflict (event_key) do nothing;

  return jsonb_build_object(
    'marked_unknown', true,
    'reason', 'delivery_unknown',
    'delivery_id', delivery.id,
    'card_id', delivery.card_id,
    'recipient', delivery.recipient,
    'status', delivery.status,
    'automatic_retry_allowed', false,
    'manual_review_required', true
  );
end;
$$;

revoke all on function public.claim_supplier_quote_request_delivery(text, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.complete_supplier_quote_request_delivery(text, text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.mark_supplier_quote_request_delivery_unknown(text, text, uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.claim_supplier_quote_request_delivery(text, text, text, integer)
  to service_role;
grant execute on function public.complete_supplier_quote_request_delivery(text, text, uuid, text)
  to service_role;
grant execute on function public.mark_supplier_quote_request_delivery_unknown(text, text, uuid, text, text)
  to service_role;

comment on table public.supplier_quote_request_deliveries is
  'Canonical per-card, per-recipient delivery ledger for EU supplier quotation requests. delivery_unknown is fail-closed and requires manual review.';
comment on table public.supplier_quote_request_delivery_events is
  'Append-only state transition audit for supplier quotation delivery claims.';
