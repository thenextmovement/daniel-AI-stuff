-- NEONTRIP Google Ads offline-deal revenue pipeline.
--
-- Scope is deliberately narrow:
--   * keep the existing google_ads_conversions ledger and conversion action;
--   * add leases and audit state to that ledger instead of introducing a queue;
--   * keep request-lead and "Offline: Angebot versendet" semantics unchanged;
--   * resolve Shopify orders to requests only from an exact order-carried ID or
--     an unambiguous same-customer history;
--   * source Deal values from canonical net data and idempotent refund events.

alter table public.google_ads_conversions
  add column if not exists upload_claim_token uuid,
  add column if not exists upload_claim_expires_at timestamptz,
  add column if not exists deal_value_source text,
  add column if not exists deal_time_source text,
  add column if not exists deal_request_resolution_source text,
  add column if not exists deal_financial_checked_at timestamptz,
  add column if not exists adjustment_claim_token uuid,
  add column if not exists adjustment_claim_expires_at timestamptz,
  add column if not exists adjustment_claim_state_key text,
  add column if not exists adjustment_claim_date_time timestamptz,
  add column if not exists last_adjusted_state_key text,
  add column if not exists last_adjusted_value numeric(14, 2),
  add column if not exists last_adjusted_at timestamptz;

alter table public.google_ads_conversions
  drop constraint if exists google_ads_conversions_upload_claim_pair_check,
  add constraint google_ads_conversions_upload_claim_pair_check check (
    (upload_claim_token is null and upload_claim_expires_at is null)
    or (upload_claim_token is not null and upload_claim_expires_at is not null)
  ),
  drop constraint if exists google_ads_conversions_adjustment_claim_check,
  add constraint google_ads_conversions_adjustment_claim_check check (
    (
      adjustment_claim_token is null
      and adjustment_claim_expires_at is null
      and adjustment_claim_state_key is null
      and adjustment_claim_date_time is null
    )
    or (
      adjustment_claim_token is not null
      and adjustment_claim_expires_at is not null
      and adjustment_claim_state_key ~ '^[a-f0-9]{64}$'
      and adjustment_claim_date_time is not null
    )
  ),
  drop constraint if exists google_ads_conversions_adjusted_state_check,
  add constraint google_ads_conversions_adjusted_state_check check (
    (last_adjusted_state_key is null and last_adjusted_value is null and last_adjusted_at is null)
    or (
      last_adjusted_state_key ~ '^[a-f0-9]{64}$'
      and last_adjusted_value >= 0
      and last_adjusted_at is not null
    )
  ),
  drop constraint if exists google_ads_conversions_deal_value_source_check,
  add constraint google_ads_conversions_deal_value_source_check check (
    deal_value_source is null
    or deal_value_source in (
      'billing_cases.subtotal_net_cents',
      'supplier_sales.offer_snapshot.totals.subtotalNet'
    )
  ),
  drop constraint if exists google_ads_conversions_deal_time_source_check,
  add constraint google_ads_conversions_deal_time_source_check check (
    deal_time_source is null
    or deal_time_source in (
      'billing_cases.paid_at',
      'supplier_sale_events.first_paid',
      'master_orders.shopify_created_at'
    )
  ),
  drop constraint if exists google_ads_conversions_deal_request_source_check,
  add constraint google_ads_conversions_deal_request_source_check check (
    deal_request_resolution_source is null
    or deal_request_resolution_source in (
      'shopify_note_request_id',
      'supplier_sales.request_id',
      'shopify_note+supplier_sales.request_id',
      'unique_customer_request'
    )
  );

create index if not exists google_ads_conversions_upload_claim_due_idx
  on public.google_ads_conversions (conversion_time, upload_claim_expires_at)
  where uploaded_to_gads = false
    and conversion_name in ('Offline: Angebot versendet', 'Offline: Deal gewonnen');

create index if not exists google_ads_conversions_adjustment_claim_due_idx
  on public.google_ads_conversions (conversion_time, adjustment_claim_expires_at)
  where uploaded_to_gads = true
    and conversion_name = 'Offline: Deal gewonnen';

comment on column public.google_ads_conversions.upload_claim_token is
  'Short-lived owner token for one atomic Google Ads conversion upload claim.';
comment on column public.google_ads_conversions.deal_value_source is
  'Canonical source used for the uploaded Deal net value; refunds are audited separately in billing_events.';
comment on column public.google_ads_conversions.deal_time_source is
  'Evidence source used for the Deal conversion time, in paid-at/event/Shopify fallback order.';
comment on column public.google_ads_conversions.last_adjusted_state_key is
  'SHA-256 deduplication key of the last provider-receipted Deal adjustment state.';

alter table private.google_ads_upload_attempts
  add column if not exists operation_type text,
  add column if not exists claim_token uuid,
  add column if not exists conversion_value numeric(14, 2),
  add column if not exists adjustment_type text,
  add column if not exists adjustment_value numeric(14, 2),
  add column if not exists adjustment_state_key text,
  add column if not exists adjustment_date_time timestamptz;

alter table private.google_ads_upload_attempts
  drop constraint if exists google_ads_upload_attempts_operation_type_check,
  add constraint google_ads_upload_attempts_operation_type_check check (
    operation_type is null
    or operation_type in ('conversion_upload', 'conversion_adjustment')
  ),
  drop constraint if exists google_ads_upload_attempts_conversion_value_check,
  add constraint google_ads_upload_attempts_conversion_value_check check (
    conversion_value is null or conversion_value >= 0
  ),
  drop constraint if exists google_ads_upload_attempts_adjustment_shape_check,
  add constraint google_ads_upload_attempts_adjustment_shape_check check (
    (
      operation_type is distinct from 'conversion_adjustment'
      and adjustment_type is null
      and adjustment_value is null
      and adjustment_state_key is null
      and adjustment_date_time is null
    )
    or (
      operation_type = 'conversion_adjustment'
      and adjustment_type in ('RESTATEMENT', 'RETRACTION')
      and adjustment_value is not null
      and adjustment_value >= 0
      and adjustment_state_key ~ '^[a-f0-9]{64}$'
      and adjustment_date_time is not null
    )
  );

create index if not exists google_ads_upload_attempts_adjustment_state_idx
  on private.google_ads_upload_attempts (
    source_id,
    adjustment_state_key,
    recorded_at desc,
    id desc
  )
  where operation_type = 'conversion_adjustment';

comment on column private.google_ads_upload_attempts.operation_type is
  'Null denotes legacy rows; new rows distinguish conversion uploads from Deal adjustments.';
comment on column private.google_ads_upload_attempts.adjustment_state_key is
  'Target-state key recorded on every adjustment attempt; retries retain the same state key.';

create or replace function private.gads_valid_click_id_v1(p_value text)
returns text
language sql
immutable
strict
security invoker
set search_path = pg_catalog
as $function$
  select case
    when nullif(pg_catalog.btrim(p_value), '') is null then null
    when pg_catalog.lower(pg_catalog.btrim(p_value)) in ('test', 'undefined', 'null') then null
    when pg_catalog.lower(pg_catalog.btrim(p_value)) like 'test%' then null
    when pg_catalog.lower(pg_catalog.btrim(p_value)) like 'diagnostic-%' then null
    when pg_catalog.lower(pg_catalog.btrim(p_value)) like 'codex_%' then null
    when pg_catalog.length(pg_catalog.btrim(p_value)) < 25 then null
    else pg_catalog.btrim(p_value)
  end;
$function$;

revoke all on function private.gads_valid_click_id_v1(text)
from public, anon, authenticated, service_role;

create or replace function public.resolve_shopify_order_request_link_v1(
  p_shopify_order_id text default null,
  p_shopify_order_number text default null,
  p_customer_id uuid default null,
  p_order_time timestamptz default null,
  p_note text default null
)
returns table (
  resolved_request_id uuid,
  resolution_source text,
  resolution_status text
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_note_ids uuid[] := '{}'::uuid[];
  v_supplier_ids uuid[] := '{}'::uuid[];
  v_note_explicit_count integer := 0;
  v_supplier_explicit_count integer := 0;
  v_exact_count integer := 0;
  v_customer_count integer := 0;
begin
  select count(*)
  into v_note_explicit_count
  from pg_catalog.regexp_matches(
    coalesce(p_note, ''),
    '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})',
    'gi'
  );

  select coalesce(array_agg(distinct candidate.id), '{}'::uuid[])
  into v_note_ids
  from (
    select mr.id
    from pg_catalog.regexp_matches(
      coalesce(p_note, ''),
      '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})',
      'gi'
    ) as token(value)
    join public.master_requests mr
      on pg_catalog.lower(mr.request_id) = pg_catalog.lower(token.value[1])
      or pg_catalog.lower(mr.id::text) = pg_catalog.lower(token.value[1])
  ) candidate;

  select count(*)
  into v_supplier_explicit_count
  from public.supplier_sales ss
  where nullif(pg_catalog.btrim(ss.request_id), '') is not null
    and (
      (
        nullif(pg_catalog.btrim(p_shopify_order_id), '') is not null
        and ss.shopify_order_id = p_shopify_order_id
      )
      or (
        nullif(pg_catalog.btrim(p_shopify_order_number), '') is not null
        and pg_catalog.regexp_replace(coalesce(ss.shopify_order_name, ''), '^#', '') =
            pg_catalog.regexp_replace(coalesce(p_shopify_order_number, ''), '^#', '')
      )
    );

  select coalesce(array_agg(distinct candidate.id), '{}'::uuid[])
  into v_supplier_ids
  from (
    select mr.id
    from public.supplier_sales ss
    join public.master_requests mr
      on pg_catalog.lower(pg_catalog.btrim(mr.request_id)) =
         pg_catalog.lower(pg_catalog.btrim(ss.request_id))
      or pg_catalog.lower(mr.id::text) =
         pg_catalog.lower(pg_catalog.btrim(ss.request_id))
    where nullif(pg_catalog.btrim(ss.request_id), '') is not null
      and (
        (
          nullif(pg_catalog.btrim(p_shopify_order_id), '') is not null
          and ss.shopify_order_id = p_shopify_order_id
        )
        or (
          nullif(pg_catalog.btrim(p_shopify_order_number), '') is not null
          and pg_catalog.regexp_replace(
                coalesce(ss.shopify_order_name, ''),
                '^#',
                ''
              ) = pg_catalog.regexp_replace(
                coalesce(p_shopify_order_number, ''),
                '^#',
                ''
              )
        )
      )
  ) candidate;

  select count(distinct candidate_id),
         (array_agg(distinct candidate_id order by candidate_id))[1]
  into v_exact_count, resolved_request_id
  from (
    select pg_catalog.unnest(v_note_ids) as candidate_id
    union all
    select pg_catalog.unnest(v_supplier_ids) as candidate_id
  ) exact_candidates;

  if v_exact_count = 1 then
    resolution_source := case
      when resolved_request_id = any(v_note_ids)
       and resolved_request_id = any(v_supplier_ids)
        then 'shopify_note+supplier_sales.request_id'
      when resolved_request_id = any(v_note_ids)
        then 'shopify_note_request_id'
      else 'supplier_sales.request_id'
    end;
    resolution_status := 'resolved_exact';
    return next;
    return;
  elsif v_exact_count > 1 then
    resolved_request_id := null;
    resolution_source := null;
    resolution_status := 'conflicting_exact_ids';
    return next;
    return;
  end if;

  if v_note_explicit_count > 0 or v_supplier_explicit_count > 0 then
    resolved_request_id := null;
    resolution_source := null;
    resolution_status := 'explicit_id_unresolved';
    return next;
    return;
  end if;

  if p_customer_id is not null and p_order_time is not null then
    select count(*), (array_agg(mr.id order by mr.id))[1]
    into v_customer_count, resolved_request_id
    from public.master_requests mr
    where mr.customer_id = p_customer_id
      and mr.created_at is not null
      and mr.created_at <= p_order_time;

    if v_customer_count = 1 then
      resolution_source := 'unique_customer_request';
      resolution_status := 'resolved_unique_customer';
      return next;
      return;
    elsif v_customer_count > 1 then
      resolved_request_id := null;
      resolution_source := null;
      resolution_status := 'ambiguous_customer_history';
      return next;
      return;
    end if;
  end if;

  resolved_request_id := null;
  resolution_source := null;
  resolution_status := 'unresolved';
  return next;
end;
$function$;

comment on function public.resolve_shopify_order_request_link_v1(text, text, uuid, timestamptz, text)
is 'Fail-closed Shopify-order resolver: one exact note/supplier request ID, otherwise exactly one same-customer request created by order time.';

revoke all on function public.resolve_shopify_order_request_link_v1(text, text, uuid, timestamptz, text)
from public, anon, authenticated;
grant execute on function public.resolve_shopify_order_request_link_v1(text, text, uuid, timestamptz, text)
to service_role;

create or replace function private.gads_deal_financial_state_v1(
  p_shopify_order_id text,
  p_shopify_order_number text
)
returns table (
  master_order_id uuid,
  billing_case_id uuid,
  supplier_sale_id uuid,
  paid_evidence boolean,
  cancelled boolean,
  conversion_time timestamptz,
  time_source text,
  original_net_cents bigint,
  refund_net_cents bigint,
  remaining_net_cents bigint,
  value_source text,
  refund_ledger_valid boolean
)
language sql
stable
security definer
set search_path = ''
as $function$
  with order_row as materialized (
    select mo.*
    from public.master_orders mo
    where (
        nullif(pg_catalog.btrim(p_shopify_order_id), '') is not null
        and mo.shopify_order_id = p_shopify_order_id
      )
      or (
        nullif(pg_catalog.btrim(p_shopify_order_number), '') is not null
        and pg_catalog.regexp_replace(coalesce(mo.shopify_order_number, ''), '^#', '') =
            pg_catalog.regexp_replace(coalesce(p_shopify_order_number, ''), '^#', '')
      )
    order by
      case when mo.shopify_order_id = p_shopify_order_id then 0 else 1 end,
      coalesce(mo.shopify_created_at, mo.created_at) desc nulls last,
      mo.id
    limit 1
  ),
  billing as materialized (
    select bc.*
    from public.billing_cases bc
    where (
        nullif(pg_catalog.btrim(p_shopify_order_id), '') is not null
        and (
          bc.shopify_order_id = p_shopify_order_id
          or bc.shopify_order_id = 'gid://shopify/Order/' || p_shopify_order_id
        )
      )
      or (
        nullif(pg_catalog.btrim(p_shopify_order_number), '') is not null
        and pg_catalog.regexp_replace(coalesce(bc.shopify_order_name, ''), '^#', '') =
            pg_catalog.regexp_replace(coalesce(p_shopify_order_number, ''), '^#', '')
      )
    order by
      case
        when bc.shopify_order_id = p_shopify_order_id
          or bc.shopify_order_id = 'gid://shopify/Order/' || p_shopify_order_id
          then 0
        else 1
      end,
      bc.created_at desc,
      bc.id
    limit 1
  ),
  sale as materialized (
    select
      ss.*,
      pg_catalog.round(
        (ss.offer_snapshot #>> '{totals,subtotalNet}')::numeric * 100,
        0
      )::bigint as snapshot_net_cents
    from public.supplier_sales ss
    where (
        (
          nullif(pg_catalog.btrim(p_shopify_order_id), '') is not null
          and ss.shopify_order_id = p_shopify_order_id
        )
        or (
          nullif(pg_catalog.btrim(p_shopify_order_number), '') is not null
          and pg_catalog.regexp_replace(coalesce(ss.shopify_order_name, ''), '^#', '') =
              pg_catalog.regexp_replace(coalesce(p_shopify_order_number, ''), '^#', '')
        )
      )
      and (ss.offer_snapshot #>> '{totals,subtotalNet}') ~ '^[0-9]+([.][0-9]{1,2})?$'
      and upper(coalesce(nullif(pg_catalog.btrim(ss.currency), ''), 'EUR')) = 'EUR'
    order by
      case when ss.shopify_order_id = p_shopify_order_id then 0 else 1 end,
      ss.updated_at desc,
      ss.id
    limit 1
  ),
  refunds as materialized (
    select
      count(*) filter (
        where be.event_type = 'REFUND_CREATED'
      ) as refund_event_count,
      count(*) filter (
        where be.event_type = 'REFUND_CREATED'
          and coalesce(be.payload ->> 'netCents', '') !~ '^[0-9]+$'
      ) as invalid_refund_event_count,
      coalesce(sum(
        (be.payload ->> 'netCents')::bigint
      ) filter (
        where be.event_type = 'REFUND_CREATED'
          and coalesce(be.payload ->> 'netCents', '') ~ '^[0-9]+$'
      ), 0)::bigint as refund_net_cents
    from billing bc
    left join public.billing_events be
      on be.billing_case_id = bc.id
     and be.event_type = 'REFUND_CREATED'
  ),
  first_paid_event as materialized (
    select min(sse.created_at) as paid_at
    from sale ss
    join public.supplier_sale_events sse
      on sse.sale_id = ss.id
    where sse.event_type in ('sale_upserted', 'sale_updated')
      and pg_catalog.lower(coalesce(sse.payload ->> 'payment_status', '')) = 'paid'
  ),
  state as (
    select
      mo.id as master_order_id,
      bc.id as billing_case_id,
      ss.id as supplier_sale_id,
      (
        bc.paid_at is not null
        or fpe.paid_at is not null
        or pg_catalog.lower(coalesce(mo.status, '')) in ('paid', 'partially_refunded', 'refunded')
      ) as paid_evidence,
      (
        mo.cancelled_at is not null
        or pg_catalog.lower(coalesce(mo.status, '')) in (
          'cancelled', 'canceled', 'voided', 'refunded'
        )
        or bc.cancelled_at is not null
        or bc.status in ('CANCELLED', 'REFUNDED')
      ) as cancelled,
      coalesce(bc.paid_at, fpe.paid_at, mo.shopify_created_at) as conversion_time,
      case
        when bc.paid_at is not null then 'billing_cases.paid_at'
        when fpe.paid_at is not null then 'supplier_sale_events.first_paid'
        when mo.shopify_created_at is not null then 'master_orders.shopify_created_at'
        else null
      end as time_source,
      case
        when coalesce(r.refund_net_cents, 0) > 0
          and coalesce(r.invalid_refund_event_count, 0) = 0
          and ss.snapshot_net_cents >= coalesce(r.refund_net_cents, 0)
          then ss.snapshot_net_cents
        when coalesce(r.refund_net_cents, 0) = 0
          and upper(coalesce(nullif(pg_catalog.btrim(bc.currency), ''), '')) = 'EUR'
          and bc.subtotal_net_cents >= 0
          then bc.subtotal_net_cents
        when coalesce(r.refund_net_cents, 0) = 0
          and ss.snapshot_net_cents >= 0
          then ss.snapshot_net_cents
        else null
      end::bigint as original_net_cents,
      coalesce(r.refund_net_cents, 0)::bigint as refund_net_cents,
      case
        -- Live billing rows are not consistent about whether subtotal_net_cents
        -- is original or remaining after a refund. Once a refund exists, use
        -- the validated immutable supplier snapshot as the original and apply
        -- each unique REFUND_CREATED.netCents exactly once. Without that
        -- snapshot the value is intentionally unresolved (fail closed).
        when coalesce(r.refund_net_cents, 0) > 0
          and coalesce(r.invalid_refund_event_count, 0) = 0
          and ss.snapshot_net_cents >= coalesce(r.refund_net_cents, 0)
          then ss.snapshot_net_cents - coalesce(r.refund_net_cents, 0)
        when coalesce(r.refund_net_cents, 0) = 0
          and upper(coalesce(nullif(pg_catalog.btrim(bc.currency), ''), '')) = 'EUR'
          and bc.subtotal_net_cents >= 0
          and coalesce(r.invalid_refund_event_count, 0) = 0
          then bc.subtotal_net_cents
        when coalesce(r.refund_net_cents, 0) = 0
          and ss.snapshot_net_cents >= 0
          and coalesce(r.invalid_refund_event_count, 0) = 0
          then ss.snapshot_net_cents
        else null
      end::bigint as remaining_net_cents,
      case
        when coalesce(r.refund_net_cents, 0) > 0
          and coalesce(r.invalid_refund_event_count, 0) = 0
          and ss.snapshot_net_cents >= coalesce(r.refund_net_cents, 0)
          then 'supplier_sales.offer_snapshot.totals.subtotalNet'
        when coalesce(r.refund_net_cents, 0) = 0
          and upper(coalesce(nullif(pg_catalog.btrim(bc.currency), ''), '')) = 'EUR'
          and bc.subtotal_net_cents >= 0
          then 'billing_cases.subtotal_net_cents'
        when coalesce(r.refund_net_cents, 0) = 0
          and ss.snapshot_net_cents >= 0
          then 'supplier_sales.offer_snapshot.totals.subtotalNet'
        else null
      end as value_source,
      coalesce(r.invalid_refund_event_count, 0) = 0 as refund_ledger_valid
    from order_row mo
    left join billing bc on true
    left join sale ss on true
    left join refunds r on true
    left join first_paid_event fpe on true
  )
  select
    state.master_order_id,
    state.billing_case_id,
    state.supplier_sale_id,
    state.paid_evidence,
    state.cancelled,
    state.conversion_time,
    state.time_source,
    state.original_net_cents,
    state.refund_net_cents,
    state.remaining_net_cents,
    state.value_source,
    state.refund_ledger_valid
  from state;
$function$;

revoke all on function private.gads_deal_financial_state_v1(text, text)
from public, anon, authenticated, service_role;

create or replace function public.gads_paid_deal_export_candidates_v2(
  p_lookback_days integer default 90,
  p_limit integer default 100
)
returns table (
  shopify_order_number text,
  shopify_created_at timestamptz,
  request_id uuid,
  email text,
  first_name text,
  last_name text,
  phone text,
  conversion_value numeric,
  conversion_time timestamptz,
  value_source text,
  time_source text,
  request_resolution_source text,
  billing_case_id uuid,
  supplier_sale_id uuid,
  refund_net_cents bigint,
  gclid text,
  gbraid text,
  wbraid text,
  hashed_email text,
  consent_ad_user_data text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    mo.shopify_order_number,
    mo.shopify_created_at,
    resolved.resolved_request_id,
    pg_catalog.lower(pg_catalog.btrim(mc.email)) as email,
    pg_catalog.lower(pg_catalog.btrim(coalesce(mc.first_name, ''))) as first_name,
    pg_catalog.lower(pg_catalog.btrim(coalesce(mc.last_name, ''))) as last_name,
    pg_catalog.btrim(coalesce(mc.phone, '')) as phone,
    pg_catalog.round(financial.remaining_net_cents::numeric / 100.0, 2) as conversion_value,
    financial.conversion_time,
    financial.value_source,
    financial.time_source,
    resolved.resolution_source,
    financial.billing_case_id,
    financial.supplier_sale_id,
    financial.refund_net_cents,
    private.gads_valid_click_id_v1(mr.gclid) as gclid,
    private.gads_valid_click_id_v1(mr.gbraid) as gbraid,
    private.gads_valid_click_id_v1(mr.wbraid) as wbraid,
    case
      when mr.consent_ad_user_data = 'granted'
       and customer_match_v2.normalize_buyer_email(request_customer.email) is not null
        then pg_catalog.encode(
          extensions.digest(
            customer_match_v2.normalize_buyer_email(request_customer.email),
            'sha256'
          ),
          'hex'
        )
      else null
    end as hashed_email,
    mr.consent_ad_user_data
  from public.master_orders mo
  join public.master_customers mc
    on mc.id = mo.customer_id
  cross join lateral public.resolve_shopify_order_request_link_v1(
    mo.shopify_order_id,
    mo.shopify_order_number,
    mo.customer_id,
    coalesce(mo.shopify_created_at, mo.created_at),
    mo.note
  ) resolved
  join public.master_requests mr
    on mr.id = resolved.resolved_request_id
  left join public.master_customers request_customer
    on request_customer.id = mr.customer_id
  cross join lateral private.gads_deal_financial_state_v1(
    mo.shopify_order_id,
    mo.shopify_order_number
  ) financial
  where financial.paid_evidence
    and not financial.cancelled
    and financial.refund_ledger_valid
    and financial.remaining_net_cents > 0
    and financial.conversion_time is not null
    and financial.conversion_time >= current_timestamp - pg_catalog.make_interval(
      days => least(90, greatest(1, coalesce(p_lookback_days, 90)))
    )
    and nullif(pg_catalog.btrim(mo.shopify_order_number), '') is not null
    and nullif(pg_catalog.btrim(mc.email), '') is not null
    and (
      private.gads_valid_click_id_v1(mr.gclid) is not null
      or private.gads_valid_click_id_v1(mr.gbraid) is not null
      or private.gads_valid_click_id_v1(mr.wbraid) is not null
      or (
        mr.consent_ad_user_data = 'granted'
        and customer_match_v2.normalize_buyer_email(request_customer.email) is not null
      )
    )
    and not exists (
      select 1
      from public.google_ads_conversions gac
      where pg_catalog.regexp_replace(coalesce(gac.shopify_order_number, ''), '^#', '') =
            pg_catalog.regexp_replace(coalesce(mo.shopify_order_number, ''), '^#', '')
    )
  order by financial.conversion_time asc, mo.shopify_order_number
  limit least(500, greatest(1, coalesce(p_limit, 100)));
$function$;

comment on function public.gads_paid_deal_export_candidates_v2(integer, integer)
is 'Uploadable paid Deals only: fail-closed request resolution, canonical EUR net, cumulative idempotent refunds and consent-gated server-side email hashing.';

revoke all on function public.gads_paid_deal_export_candidates_v2(integer, integer)
from public, anon, authenticated;
grant execute on function public.gads_paid_deal_export_candidates_v2(integer, integer)
to service_role;

create or replace function public.claim_pending_gads_conversions_v2(
  p_limit integer default 200,
  p_lease_seconds integer default 900
)
returns table (
  conversion_id uuid,
  claim_token uuid,
  gclid text,
  gbraid text,
  wbraid text,
  hashed_email text,
  consent_ad_user_data text,
  consent_ad_personalization text,
  conversion_name text,
  conversion_value numeric,
  conversion_time timestamptz,
  order_id text,
  value_source text,
  time_source text,
  request_resolution_source text,
  refund_net_cents bigint
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_limit integer := least(2000, greatest(1, coalesce(p_limit, 200)));
  v_lease_seconds integer := least(3600, greatest(60, coalesce(p_lease_seconds, 900)));
  v_now timestamptz := current_timestamp;
  v_claim_token uuid;
  v_row record;
begin
  for v_row in
    select
      gc.id,
      gc.conversion_name,
      case
        when gc.conversion_name = 'Offline: Deal gewonnen'
          then private.gads_valid_click_id_v1(deal_request.gclid)
        else offer_identity.gclid
      end as resolved_gclid,
      case
        when gc.conversion_name = 'Offline: Deal gewonnen'
          then private.gads_valid_click_id_v1(deal_request.gbraid)
        else null
      end as resolved_gbraid,
      case
        when gc.conversion_name = 'Offline: Deal gewonnen'
          then private.gads_valid_click_id_v1(deal_request.wbraid)
        else null
      end as resolved_wbraid,
      case
        when gc.conversion_name = 'Offline: Deal gewonnen'
         and deal_request.consent_ad_user_data = 'granted'
         and customer_match_v2.normalize_buyer_email(deal_customer.email) is not null
          then pg_catalog.encode(
            extensions.digest(
              customer_match_v2.normalize_buyer_email(deal_customer.email),
              'sha256'
            ),
            'hex'
          )
        else null
      end as resolved_hashed_email,
      case
        when gc.conversion_name = 'Offline: Deal gewonnen'
          then deal_request.consent_ad_user_data
        else null
      end as resolved_consent_ad_user_data,
      case
        when gc.conversion_name = 'Offline: Deal gewonnen'
          then deal_request.consent_ad_personalization
        else null
      end as resolved_consent_ad_personalization,
      case
        when gc.conversion_name = 'Offline: Deal gewonnen'
          then pg_catalog.round(financial.remaining_net_cents::numeric / 100.0, 2)
        else gc.conversion_value
      end as resolved_conversion_value,
      case
        when gc.conversion_name = 'Offline: Deal gewonnen'
          then financial.conversion_time
        else coalesce(gc.conversion_time, gc.exported_at)
      end as resolved_conversion_time,
      case
        when gc.conversion_name = 'Offline: Deal gewonnen'
          then financial.value_source
        else null
      end as resolved_value_source,
      case
        when gc.conversion_name = 'Offline: Deal gewonnen'
          then financial.time_source
        else null
      end as resolved_time_source,
      case
        when gc.conversion_name = 'Offline: Deal gewonnen'
          then deal_link.resolution_source
        else null
      end as resolved_request_source,
      case
        when gc.conversion_name = 'Offline: Deal gewonnen'
          then deal_link.resolved_request_id
        else gc.request_id
      end as resolved_request_id,
      case
        when gc.conversion_name = 'Offline: Deal gewonnen'
          then financial.refund_net_cents
        else 0::bigint
      end as refund_net_cents
    from public.google_ads_conversions gc
    left join lateral (
      select mo.*
      from public.master_orders mo
      where (
          nullif(pg_catalog.btrim(gc.shopify_order_number), '') is not null
          and pg_catalog.regexp_replace(coalesce(mo.shopify_order_number, ''), '^#', '') =
              pg_catalog.regexp_replace(coalesce(gc.shopify_order_number, ''), '^#', '')
        )
      order by coalesce(mo.shopify_created_at, mo.created_at) desc nulls last, mo.id
      limit 1
    ) order_row on true
    left join lateral public.resolve_shopify_order_request_link_v1(
      order_row.shopify_order_id,
      order_row.shopify_order_number,
      order_row.customer_id,
      coalesce(order_row.shopify_created_at, order_row.created_at),
      order_row.note
    ) deal_link
      on gc.conversion_name = 'Offline: Deal gewonnen'
    left join public.master_requests deal_request
      on deal_request.id = deal_link.resolved_request_id
    left join public.master_customers deal_customer
      on deal_customer.id = deal_request.customer_id
    left join lateral private.gads_deal_financial_state_v1(
      order_row.shopify_order_id,
      order_row.shopify_order_number
    ) financial
      on gc.conversion_name = 'Offline: Deal gewonnen'
    left join public.master_requests direct_request
      on direct_request.id = gc.request_id
    left join public.master_requests order_request
      on order_request.id = order_row.request_id
    left join lateral (
      select coalesce(
        private.gads_valid_click_id_v1(gc.gclid),
        private.gads_valid_click_id_v1(direct_request.gclid),
        private.gads_valid_click_id_v1(order_request.gclid)
      ) as gclid
    ) offer_identity on true
    where gc.uploaded_to_gads = false
      and gc.conversion_name in (
        'Offline: Angebot versendet',
        'Offline: Deal gewonnen'
      )
      and (
        gc.upload_claim_token is null
        or gc.upload_claim_expires_at <= v_now
      )
      and (
        (
          gc.conversion_name = 'Offline: Angebot versendet'
          and offer_identity.gclid is not null
          and coalesce(gc.conversion_time, gc.exported_at) is not null
        )
        or (
          gc.conversion_name = 'Offline: Deal gewonnen'
          and deal_link.resolved_request_id is not null
          and financial.paid_evidence
          and not financial.cancelled
          and financial.refund_ledger_valid
          and financial.remaining_net_cents > 0
          and financial.conversion_time is not null
          and (
            private.gads_valid_click_id_v1(deal_request.gclid) is not null
            or private.gads_valid_click_id_v1(deal_request.gbraid) is not null
            or private.gads_valid_click_id_v1(deal_request.wbraid) is not null
            or (
              deal_request.consent_ad_user_data = 'granted'
              and customer_match_v2.normalize_buyer_email(deal_customer.email) is not null
            )
          )
        )
      )
      and not exists (
        select 1
        from private.google_ads_upload_attempts attempt
        where attempt.source_type = 'conversion'
          and attempt.source_id = gc.id
          and coalesce(attempt.operation_type, 'conversion_upload') = 'conversion_upload'
          and (
            (
              attempt.status in ('success', 'duplicate')
              and attempt.job_id is not null
            )
            or (
              attempt.status = 'permanent_failure'
              and not (
                gc.conversion_name = 'Offline: Deal gewonnen'
                and attempt.error_code = 'LOCAL_NO_CLICK_ID'
                and (
                  private.gads_valid_click_id_v1(deal_request.gclid) is not null
                  or private.gads_valid_click_id_v1(deal_request.gbraid) is not null
                  or private.gads_valid_click_id_v1(deal_request.wbraid) is not null
                  or (
                    deal_request.consent_ad_user_data = 'granted'
                    and customer_match_v2.normalize_buyer_email(deal_customer.email) is not null
                  )
                )
              )
            )
            or (
              attempt.status in ('retryable', 'request_failure')
              and coalesce(
                attempt.retry_after,
                attempt.recorded_at + interval '1 hour'
              ) > v_now
            )
          )
      )
    order by
      case
        when gc.conversion_name = 'Offline: Deal gewonnen'
          then financial.conversion_time
        else coalesce(gc.conversion_time, gc.exported_at)
      end asc,
      gc.id
    limit v_limit
    for update of gc skip locked
  loop
    v_claim_token := extensions.gen_random_uuid();

    update public.google_ads_conversions as claimed
    set
      upload_claim_token = v_claim_token,
      upload_claim_expires_at = v_now + pg_catalog.make_interval(secs => v_lease_seconds),
      conversion_value = case
        when v_row.conversion_name = 'Offline: Deal gewonnen'
          then v_row.resolved_conversion_value
        else claimed.conversion_value
      end,
      conversion_time = case
        when v_row.conversion_name = 'Offline: Deal gewonnen'
          then v_row.resolved_conversion_time
        else claimed.conversion_time
      end,
      request_id = case
        when v_row.conversion_name = 'Offline: Deal gewonnen'
          then v_row.resolved_request_id
        else claimed.request_id
      end,
      deal_value_source = case
        when v_row.conversion_name = 'Offline: Deal gewonnen'
          then v_row.resolved_value_source
        else claimed.deal_value_source
      end,
      deal_time_source = case
        when v_row.conversion_name = 'Offline: Deal gewonnen'
          then v_row.resolved_time_source
        else claimed.deal_time_source
      end,
      deal_request_resolution_source = case
        when v_row.conversion_name = 'Offline: Deal gewonnen'
          then v_row.resolved_request_source
        else claimed.deal_request_resolution_source
      end,
      deal_financial_checked_at = case
        when v_row.conversion_name = 'Offline: Deal gewonnen'
          then v_now
        else claimed.deal_financial_checked_at
      end
    where claimed.id = v_row.id;

    conversion_id := v_row.id;
    claim_token := v_claim_token;
    gclid := v_row.resolved_gclid;
    gbraid := v_row.resolved_gbraid;
    wbraid := v_row.resolved_wbraid;
    hashed_email := v_row.resolved_hashed_email;
    consent_ad_user_data := v_row.resolved_consent_ad_user_data;
    consent_ad_personalization := v_row.resolved_consent_ad_personalization;
    conversion_name := v_row.conversion_name;
    conversion_value := v_row.resolved_conversion_value;
    conversion_time := v_row.resolved_conversion_time;
    order_id := v_row.id::text;
    value_source := v_row.resolved_value_source;
    time_source := v_row.resolved_time_source;
    request_resolution_source := v_row.resolved_request_source;
    refund_net_cents := v_row.refund_net_cents;
    return next;
  end loop;
end;
$function$;

comment on function public.claim_pending_gads_conversions_v2(integer, integer)
is 'Atomic leased conversion claim. Offer conversions retain GCLID-only semantics; Deal conversions refresh canonical net/time and add braids plus consent-gated hashed email.';

revoke all on function public.claim_pending_gads_conversions_v2(integer, integer)
from public, anon, authenticated;
grant execute on function public.claim_pending_gads_conversions_v2(integer, integer)
to service_role;

create or replace function public.record_google_ads_conversion_claim_attempts_v2(
  p_attempts jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_item jsonb;
  v_existing private.google_ads_upload_attempts%rowtype;
  v_conversion public.google_ads_conversions%rowtype;
  v_attempt_key text;
  v_source_id uuid;
  v_claim_token uuid;
  v_status text;
  v_attempt_number integer;
  v_attempted_at timestamptz;
  v_payload_conversion_time timestamptz;
  v_payload_conversion_value numeric;
  v_conversion_action text;
  v_order_id text;
  v_job_id bigint;
  v_payload_index integer;
  v_recorded integer := 0;
  v_marked_uploaded integer := 0;
  v_row_count integer;
begin
  if jsonb_typeof(p_attempts) <> 'array' then
    raise exception 'p_attempts must be a JSON array';
  end if;

  if jsonb_array_length(p_attempts) > 2000 then
    raise exception 'p_attempts exceeds the 2000 row limit';
  end if;

  for v_item in select value from jsonb_array_elements(p_attempts)
  loop
    v_attempt_key := nullif(pg_catalog.btrim(v_item ->> 'attemptKey'), '');
    v_status := nullif(pg_catalog.btrim(v_item ->> 'status'), '');

    if v_attempt_key is null or pg_catalog.length(v_attempt_key) not between 8 and 240 then
      raise exception 'invalid attemptKey';
    end if;

    if v_status not in (
      'success',
      'duplicate',
      'retryable',
      'permanent_failure',
      'request_failure'
    ) then
      raise exception 'invalid status for attempt %', v_attempt_key;
    end if;

    begin
      v_source_id := (v_item ->> 'sourceId')::uuid;
      v_claim_token := (v_item ->> 'claimToken')::uuid;
      v_attempted_at := coalesce(
        nullif(v_item ->> 'attemptedAt', '')::timestamptz,
        current_timestamp
      );
      v_payload_conversion_time := (v_item ->> 'conversionTime')::timestamptz;
      v_payload_conversion_value := (v_item ->> 'conversionValue')::numeric;
      v_payload_index := (v_item ->> 'payloadIndex')::integer;
      v_job_id := nullif(v_item ->> 'jobId', '')::bigint;
    exception when others then
      raise exception 'invalid sourceId, claimToken, conversion payload, payloadIndex or jobId for attempt %',
        v_attempt_key;
    end;

    if v_payload_index not between 0 and 1999 then
      raise exception 'invalid payloadIndex for attempt %', v_attempt_key;
    end if;

    v_conversion_action := nullif(pg_catalog.btrim(v_item ->> 'conversionAction'), '');
    v_order_id := nullif(pg_catalog.btrim(v_item ->> 'orderId'), '');

    if v_conversion_action is null then
      raise exception 'missing conversionAction for attempt %', v_attempt_key;
    end if;

    if v_order_id is distinct from v_source_id::text then
      raise exception 'orderId must equal the stable conversion ledger id for attempt %',
        v_attempt_key;
    end if;

    if v_status in ('success', 'duplicate') and v_job_id is null then
      raise exception 'provider success/duplicate requires jobId for attempt %', v_attempt_key;
    end if;

    select *
    into v_existing
    from private.google_ads_upload_attempts attempt
    where attempt.attempt_key = v_attempt_key;

    if found then
      if v_existing.source_type <> 'conversion'
        or v_existing.source_id <> v_source_id
        or v_existing.operation_type is distinct from 'conversion_upload'
        or v_existing.claim_token is distinct from v_claim_token
        or v_existing.conversion_time is distinct from v_payload_conversion_time
        or v_existing.conversion_value is distinct from
           pg_catalog.round(v_payload_conversion_value, 2) then
        raise exception 'attemptKey already belongs to another claim';
      end if;
    else
      select *
      into v_conversion
      from public.google_ads_conversions conversion_row
      where conversion_row.id = v_source_id
      for update;

      if not found then
        raise exception 'unknown conversion source for attempt %', v_attempt_key;
      end if;

      if v_conversion.conversion_name not in (
        'Offline: Angebot versendet',
        'Offline: Deal gewonnen'
      ) then
        raise exception 'unsupported conversion_name for attempt %', v_attempt_key;
      end if;

      if v_conversion.upload_claim_token is distinct from v_claim_token then
        raise exception 'claimToken does not own conversion %', v_source_id;
      end if;

      if nullif(pg_catalog.btrim(v_item ->> 'conversionName'), '')
         is distinct from v_conversion.conversion_name then
        raise exception 'conversionName mismatch for attempt %', v_attempt_key;
      end if;

      if v_payload_conversion_time is distinct from
         coalesce(v_conversion.conversion_time, v_conversion.exported_at) then
        raise exception 'conversionTime mismatch for attempt %', v_attempt_key;
      end if;

      if v_payload_conversion_value is null
        or v_payload_conversion_value < 0
        or pg_catalog.round(v_payload_conversion_value, 2) is distinct from
           pg_catalog.round(coalesce(v_conversion.conversion_value, 0), 2) then
        raise exception 'conversionValue mismatch for attempt %', v_attempt_key;
      end if;

      select coalesce(max(attempt.attempt_number), 0) + 1
      into v_attempt_number
      from private.google_ads_upload_attempts attempt
      where attempt.source_type = 'conversion'
        and attempt.source_id = v_source_id;

      insert into private.google_ads_upload_attempts (
        attempt_key,
        attempt_number,
        source_type,
        source_id,
        conversion_action,
        conversion_name,
        conversion_time,
        order_id,
        payload_index,
        job_id,
        status,
        error_code,
        error_message,
        retry_after,
        attempted_at,
        operation_type,
        claim_token,
        conversion_value
      ) values (
        v_attempt_key,
        v_attempt_number,
        'conversion',
        v_source_id,
        v_conversion_action,
        v_conversion.conversion_name,
        v_payload_conversion_time,
        v_order_id,
        v_payload_index,
        v_job_id,
        v_status,
        pg_catalog.left(nullif(pg_catalog.btrim(v_item ->> 'errorCode'), ''), 160),
        pg_catalog.left(
          nullif(
            pg_catalog.regexp_replace(
              pg_catalog.btrim(v_item ->> 'errorMessage'),
              '[A-Za-z0-9_-]{24,}',
              '[redacted-id]',
              'g'
            ),
            ''
          ),
          1000
        ),
        nullif(v_item ->> 'retryAfter', '')::timestamptz,
        v_attempted_at,
        'conversion_upload',
        v_claim_token,
        pg_catalog.round(v_payload_conversion_value, 2)
      )
      on conflict (attempt_key) do nothing;

      get diagnostics v_row_count = row_count;
      v_recorded := v_recorded + v_row_count;

      select *
      into v_existing
      from private.google_ads_upload_attempts attempt
      where attempt.attempt_key = v_attempt_key;

      if v_existing.source_type <> 'conversion'
        or v_existing.source_id <> v_source_id
        or v_existing.operation_type is distinct from 'conversion_upload'
        or v_existing.claim_token is distinct from v_claim_token
        or v_existing.conversion_time is distinct from v_payload_conversion_time
        or v_existing.conversion_value is distinct from
           pg_catalog.round(v_payload_conversion_value, 2) then
        raise exception 'attemptKey race belongs to another claim';
      end if;
    end if;

    if v_existing.status in ('success', 'duplicate')
      and v_existing.job_id is not null then
      update public.google_ads_conversions conversion_row
      set
        uploaded_to_gads = true,
        conversion_value = v_existing.conversion_value,
        conversion_time = v_existing.conversion_time,
        upload_claim_token = null,
        upload_claim_expires_at = null
      where conversion_row.id = v_source_id
        and (
          conversion_row.upload_claim_token = v_claim_token
          or conversion_row.uploaded_to_gads = false
        );
      get diagnostics v_row_count = row_count;
      v_marked_uploaded := v_marked_uploaded + v_row_count;
    else
      update public.google_ads_conversions conversion_row
      set
        upload_claim_token = null,
        upload_claim_expires_at = null
      where conversion_row.id = v_source_id
        and conversion_row.upload_claim_token = v_claim_token;
    end if;
  end loop;

  return jsonb_build_object(
    'received', jsonb_array_length(p_attempts),
    'recorded', v_recorded,
    'marked_uploaded', v_marked_uploaded
  );
end;
$function$;

comment on function public.record_google_ads_conversion_claim_attempts_v2(jsonb)
is 'Idempotently records provider receipts for leased conversion claims, preserves stable orderId and releases Offer/Deal leases.';

revoke all on function public.record_google_ads_conversion_claim_attempts_v2(jsonb)
from public, anon, authenticated;
grant execute on function public.record_google_ads_conversion_claim_attempts_v2(jsonb)
to service_role;

create or replace function public.claim_pending_gads_deal_adjustments_v1(
  p_limit integer default 100,
  p_lease_seconds integer default 900,
  p_lookback_days integer default 90
)
returns table (
  conversion_id uuid,
  claim_token uuid,
  adjustment_state_key text,
  adjustment_type text,
  adjusted_value numeric,
  currency_code text,
  adjustment_date_time timestamptz,
  conversion_name text,
  conversion_time timestamptz,
  order_id text,
  value_source text,
  refund_net_cents bigint
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_limit integer := least(500, greatest(1, coalesce(p_limit, 100)));
  v_lease_seconds integer := least(3600, greatest(60, coalesce(p_lease_seconds, 900)));
  v_lookback_days integer := least(90, greatest(1, coalesce(p_lookback_days, 90)));
  v_now timestamptz := current_timestamp;
  v_claim_token uuid;
  v_row record;
begin
  for v_row in
    select
      gc.id,
      gc.conversion_name,
      coalesce(gc.conversion_time, gc.exported_at) as original_conversion_time,
      target.adjustment_type,
      target.adjusted_value,
      state.adjustment_state_key,
      coalesce(
        case
          when gc.adjustment_claim_state_key = state.adjustment_state_key
            then gc.adjustment_claim_date_time
          else null
        end,
        prior_attempt.first_adjustment_date_time,
        v_now
      ) as stable_adjustment_date_time,
      financial.value_source,
      financial.refund_net_cents
    from public.google_ads_conversions gc
    left join lateral (
      select mo.*
      from public.master_orders mo
      where nullif(pg_catalog.btrim(gc.shopify_order_number), '') is not null
        and pg_catalog.regexp_replace(coalesce(mo.shopify_order_number, ''), '^#', '') =
            pg_catalog.regexp_replace(coalesce(gc.shopify_order_number, ''), '^#', '')
      order by coalesce(mo.shopify_created_at, mo.created_at) desc nulls last, mo.id
      limit 1
    ) order_row on true
    left join lateral private.gads_deal_financial_state_v1(
      order_row.shopify_order_id,
      order_row.shopify_order_number
    ) financial on true
    left join lateral (
      select
        case
          when financial.cancelled or financial.remaining_net_cents = 0
            then 'RETRACTION'
          when financial.remaining_net_cents > 0
            then 'RESTATEMENT'
          else null
        end as adjustment_type,
        case
          when financial.cancelled or financial.remaining_net_cents = 0
            then 0::numeric
          when financial.remaining_net_cents > 0
            then pg_catalog.round(financial.remaining_net_cents::numeric / 100.0, 2)
          else null
        end as adjusted_value
    ) target on true
    left join lateral (
      select pg_catalog.encode(
        extensions.digest(
          gc.id::text || '|' || target.adjustment_type || '|' ||
          target.adjusted_value::numeric(14, 2)::text,
          'sha256'
        ),
        'hex'
      ) as adjustment_state_key
      where target.adjustment_type is not null
        and target.adjusted_value is not null
    ) state on true
    left join lateral (
      select min(adjustment_attempt.adjustment_date_time) as first_adjustment_date_time
      from private.google_ads_upload_attempts adjustment_attempt
      where adjustment_attempt.source_type = 'conversion'
        and adjustment_attempt.source_id = gc.id
        and adjustment_attempt.operation_type = 'conversion_adjustment'
        and adjustment_attempt.adjustment_state_key = state.adjustment_state_key
        and adjustment_attempt.adjustment_date_time is not null
    ) prior_attempt on true
    where gc.uploaded_to_gads = true
      and gc.conversion_name = 'Offline: Deal gewonnen'
      and coalesce(gc.conversion_time, gc.exported_at) is not null
      and coalesce(gc.conversion_time, gc.exported_at) >=
          v_now - pg_catalog.make_interval(days => v_lookback_days)
      and (
        gc.adjustment_claim_token is null
        or gc.adjustment_claim_expires_at <= v_now
      )
      and exists (
        select 1
        from private.google_ads_upload_attempts upload_receipt
        where upload_receipt.source_type = 'conversion'
          and upload_receipt.source_id = gc.id
          and coalesce(upload_receipt.operation_type, 'conversion_upload') = 'conversion_upload'
          and upload_receipt.status in ('success', 'duplicate')
          and upload_receipt.job_id is not null
          and upload_receipt.order_id = gc.id::text
      )
      and target.adjustment_type is not null
      and state.adjustment_state_key is not null
      and (
        financial.cancelled
        or (
          financial.refund_ledger_valid
          and financial.remaining_net_cents is not null
        )
      )
      and pg_catalog.round(
            coalesce(gc.last_adjusted_value, gc.conversion_value, 0),
            2
          ) is distinct from pg_catalog.round(target.adjusted_value, 2)
      and gc.last_adjusted_state_key is distinct from state.adjustment_state_key
      and not exists (
        select 1
        from private.google_ads_upload_attempts adjustment_attempt
        where adjustment_attempt.source_type = 'conversion'
          and adjustment_attempt.source_id = gc.id
          and adjustment_attempt.operation_type = 'conversion_adjustment'
          and adjustment_attempt.adjustment_state_key = state.adjustment_state_key
          and (
            adjustment_attempt.status in ('success', 'duplicate', 'permanent_failure')
            or (
              adjustment_attempt.status in ('retryable', 'request_failure')
              and coalesce(
                adjustment_attempt.retry_after,
                adjustment_attempt.recorded_at + interval '1 hour'
              ) > v_now
            )
          )
      )
    order by coalesce(gc.conversion_time, gc.exported_at) asc, gc.id
    limit v_limit
    for update of gc skip locked
  loop
    v_claim_token := extensions.gen_random_uuid();

    update public.google_ads_conversions as claimed
    set
      adjustment_claim_token = v_claim_token,
      adjustment_claim_expires_at = v_now + pg_catalog.make_interval(secs => v_lease_seconds),
      adjustment_claim_state_key = v_row.adjustment_state_key,
      adjustment_claim_date_time = v_row.stable_adjustment_date_time,
      deal_financial_checked_at = v_now
    where claimed.id = v_row.id;

    conversion_id := v_row.id;
    claim_token := v_claim_token;
    adjustment_state_key := v_row.adjustment_state_key;
    adjustment_type := v_row.adjustment_type;
    adjusted_value := v_row.adjusted_value;
    currency_code := 'EUR';
    adjustment_date_time := v_row.stable_adjustment_date_time;
    conversion_name := v_row.conversion_name;
    conversion_time := v_row.original_conversion_time;
    order_id := v_row.id::text;
    value_source := v_row.value_source;
    refund_net_cents := v_row.refund_net_cents;
    return next;
  end loop;
end;
$function$;

comment on function public.claim_pending_gads_deal_adjustments_v1(integer, integer, integer)
is 'Leases only provider-receipted Deal rows; emits cumulative-net RESTATEMENT or cancel/zero RETRACTION with a stable target-state key.';

revoke all on function public.claim_pending_gads_deal_adjustments_v1(integer, integer, integer)
from public, anon, authenticated;
grant execute on function public.claim_pending_gads_deal_adjustments_v1(integer, integer, integer)
to service_role;

create or replace function public.record_google_ads_deal_adjustment_attempts_v1(
  p_attempts jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_item jsonb;
  v_existing private.google_ads_upload_attempts%rowtype;
  v_conversion public.google_ads_conversions%rowtype;
  v_attempt_key text;
  v_source_id uuid;
  v_claim_token uuid;
  v_state_key text;
  v_expected_state_key text;
  v_adjustment_type text;
  v_adjusted_value numeric(14, 2);
  v_status text;
  v_attempt_number integer;
  v_attempted_at timestamptz;
  v_adjustment_date_time timestamptz;
  v_conversion_action text;
  v_order_id text;
  v_job_id bigint;
  v_payload_index integer;
  v_recorded integer := 0;
  v_marked_adjusted integer := 0;
  v_row_count integer;
begin
  if jsonb_typeof(p_attempts) <> 'array' then
    raise exception 'p_attempts must be a JSON array';
  end if;

  if jsonb_array_length(p_attempts) > 2000 then
    raise exception 'p_attempts exceeds the 2000 row limit';
  end if;

  for v_item in select value from jsonb_array_elements(p_attempts)
  loop
    v_attempt_key := nullif(pg_catalog.btrim(v_item ->> 'attemptKey'), '');
    v_status := nullif(pg_catalog.btrim(v_item ->> 'status'), '');
    v_state_key := nullif(pg_catalog.btrim(v_item ->> 'adjustmentStateKey'), '');
    v_adjustment_type := pg_catalog.upper(
      coalesce(nullif(pg_catalog.btrim(v_item ->> 'adjustmentType'), ''), '')
    );

    if v_attempt_key is null or pg_catalog.length(v_attempt_key) not between 8 and 240 then
      raise exception 'invalid attemptKey';
    end if;

    if v_status not in (
      'success',
      'duplicate',
      'retryable',
      'permanent_failure',
      'request_failure'
    ) then
      raise exception 'invalid status for attempt %', v_attempt_key;
    end if;

    if v_adjustment_type not in ('RESTATEMENT', 'RETRACTION') then
      raise exception 'invalid adjustmentType for attempt %', v_attempt_key;
    end if;

    if v_state_key is null or v_state_key !~ '^[a-f0-9]{64}$' then
      raise exception 'invalid adjustmentStateKey for attempt %', v_attempt_key;
    end if;

    begin
      v_source_id := (v_item ->> 'sourceId')::uuid;
      v_claim_token := (v_item ->> 'claimToken')::uuid;
      v_adjusted_value := pg_catalog.round(
        (v_item ->> 'adjustedValue')::numeric,
        2
      )::numeric(14, 2);
      v_attempted_at := coalesce(
        nullif(v_item ->> 'attemptedAt', '')::timestamptz,
        current_timestamp
      );
      v_adjustment_date_time := coalesce(
        nullif(v_item ->> 'adjustmentDateTime', '')::timestamptz,
        v_attempted_at
      );
      v_payload_index := (v_item ->> 'payloadIndex')::integer;
      v_job_id := nullif(v_item ->> 'jobId', '')::bigint;
    exception when others then
      raise exception 'invalid adjustment claim payload for attempt %', v_attempt_key;
    end;

    if v_adjusted_value < 0
      or (v_adjustment_type = 'RETRACTION' and v_adjusted_value <> 0)
      or (v_adjustment_type = 'RESTATEMENT' and v_adjusted_value <= 0) then
      raise exception 'adjustedValue does not match adjustmentType for attempt %',
        v_attempt_key;
    end if;

    if v_payload_index not between 0 and 1999 then
      raise exception 'invalid payloadIndex for attempt %', v_attempt_key;
    end if;

    v_conversion_action := nullif(pg_catalog.btrim(v_item ->> 'conversionAction'), '');
    v_order_id := nullif(pg_catalog.btrim(v_item ->> 'orderId'), '');

    if v_conversion_action is null then
      raise exception 'missing conversionAction for attempt %', v_attempt_key;
    end if;

    if v_order_id is distinct from v_source_id::text then
      raise exception 'orderId must equal the stable conversion ledger id for attempt %',
        v_attempt_key;
    end if;

    if v_status in ('success', 'duplicate') and v_job_id is null then
      raise exception 'provider success/duplicate requires jobId for attempt %', v_attempt_key;
    end if;

    v_expected_state_key := pg_catalog.encode(
      extensions.digest(
        v_source_id::text || '|' || v_adjustment_type || '|' ||
        v_adjusted_value::numeric(14, 2)::text,
        'sha256'
      ),
      'hex'
    );

    if v_state_key <> v_expected_state_key then
      raise exception 'adjustmentStateKey does not match target state for attempt %',
        v_attempt_key;
    end if;

    select *
    into v_existing
    from private.google_ads_upload_attempts attempt
    where attempt.attempt_key = v_attempt_key;

    if found then
      if v_existing.source_type <> 'conversion'
        or v_existing.source_id <> v_source_id
        or v_existing.operation_type is distinct from 'conversion_adjustment'
        or v_existing.claim_token is distinct from v_claim_token
        or v_existing.adjustment_state_key is distinct from v_state_key
        or v_existing.adjustment_date_time is distinct from v_adjustment_date_time then
        raise exception 'attemptKey already belongs to another adjustment claim';
      end if;
    else
      select *
      into v_conversion
      from public.google_ads_conversions conversion_row
      where conversion_row.id = v_source_id
      for update;

      if not found then
        raise exception 'unknown conversion source for attempt %', v_attempt_key;
      end if;

      if v_conversion.conversion_name <> 'Offline: Deal gewonnen' then
        raise exception 'adjustments are restricted to Offline: Deal gewonnen';
      end if;

      if v_conversion.adjustment_claim_token is distinct from v_claim_token
        or v_conversion.adjustment_claim_state_key is distinct from v_state_key
        or v_conversion.adjustment_claim_date_time is distinct from v_adjustment_date_time then
        raise exception 'claimToken does not own adjustment state for conversion %',
          v_source_id;
      end if;

      if nullif(pg_catalog.btrim(v_item ->> 'conversionName'), '')
         is distinct from v_conversion.conversion_name then
        raise exception 'conversionName mismatch for attempt %', v_attempt_key;
      end if;

      select coalesce(max(attempt.attempt_number), 0) + 1
      into v_attempt_number
      from private.google_ads_upload_attempts attempt
      where attempt.source_type = 'conversion'
        and attempt.source_id = v_source_id;

      insert into private.google_ads_upload_attempts (
        attempt_key,
        attempt_number,
        source_type,
        source_id,
        conversion_action,
        conversion_name,
        conversion_time,
        order_id,
        payload_index,
        job_id,
        status,
        error_code,
        error_message,
        retry_after,
        attempted_at,
        operation_type,
        claim_token,
        adjustment_type,
        adjustment_value,
        adjustment_state_key,
        adjustment_date_time
      ) values (
        v_attempt_key,
        v_attempt_number,
        'conversion',
        v_source_id,
        v_conversion_action,
        v_conversion.conversion_name,
        coalesce(v_conversion.conversion_time, v_conversion.exported_at),
        v_order_id,
        v_payload_index,
        v_job_id,
        v_status,
        pg_catalog.left(nullif(pg_catalog.btrim(v_item ->> 'errorCode'), ''), 160),
        pg_catalog.left(
          nullif(
            pg_catalog.regexp_replace(
              pg_catalog.btrim(v_item ->> 'errorMessage'),
              '[A-Za-z0-9_-]{24,}',
              '[redacted-id]',
              'g'
            ),
            ''
          ),
          1000
        ),
        nullif(v_item ->> 'retryAfter', '')::timestamptz,
        v_attempted_at,
        'conversion_adjustment',
        v_claim_token,
        v_adjustment_type,
        v_adjusted_value,
        v_state_key,
        v_adjustment_date_time
      )
      on conflict (attempt_key) do nothing;

      get diagnostics v_row_count = row_count;
      v_recorded := v_recorded + v_row_count;

      select *
      into v_existing
      from private.google_ads_upload_attempts attempt
      where attempt.attempt_key = v_attempt_key;

      if v_existing.source_type <> 'conversion'
        or v_existing.source_id <> v_source_id
        or v_existing.operation_type is distinct from 'conversion_adjustment'
        or v_existing.claim_token is distinct from v_claim_token
        or v_existing.adjustment_state_key is distinct from v_state_key
        or v_existing.adjustment_date_time is distinct from v_adjustment_date_time then
        raise exception 'attemptKey race belongs to another adjustment claim';
      end if;
    end if;

    if v_existing.status in ('success', 'duplicate')
      and v_existing.job_id is not null then
      update public.google_ads_conversions conversion_row
      set
        last_adjusted_state_key = v_existing.adjustment_state_key,
        last_adjusted_value = v_existing.adjustment_value,
        last_adjusted_at = v_existing.adjustment_date_time,
        adjustment_claim_token = null,
        adjustment_claim_expires_at = null,
        adjustment_claim_state_key = null,
        adjustment_claim_date_time = null
      where conversion_row.id = v_source_id
        and conversion_row.adjustment_claim_token = v_claim_token;
      get diagnostics v_row_count = row_count;
      v_marked_adjusted := v_marked_adjusted + v_row_count;
    else
      update public.google_ads_conversions conversion_row
      set
        adjustment_claim_token = null,
        adjustment_claim_expires_at = null,
        adjustment_claim_state_key = null,
        adjustment_claim_date_time = null
      where conversion_row.id = v_source_id
        and conversion_row.adjustment_claim_token = v_claim_token;
    end if;
  end loop;

  return jsonb_build_object(
    'received', jsonb_array_length(p_attempts),
    'recorded', v_recorded,
    'marked_adjusted', v_marked_adjusted
  );
end;
$function$;

comment on function public.record_google_ads_deal_adjustment_attempts_v1(jsonb)
is 'Idempotently records provider-receipted Deal RESTATEMENT/RETRACTION attempts, validates target-state hash and releases the adjustment lease.';

revoke all on function public.record_google_ads_deal_adjustment_attempts_v1(jsonb)
from public, anon, authenticated;
grant execute on function public.record_google_ads_deal_adjustment_attempts_v1(jsonb)
to service_role;
