-- Roll back only the executable Claim contract.
-- Historical provider receipts and business rows are never rewritten by the forward migration.

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
