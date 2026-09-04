-- Roll back 20260904110719_offline_deal_revenue_pipeline.sql.
--
-- Apply only after the n8n uploader has been returned to the v1 RPCs. This
-- removes v2 lease/audit state and any adjustment-attempt details recorded in
-- the added columns; it does not delete legacy upload-attempt rows.

do $guard$
begin
  if exists (
    select 1
    from private.google_ads_upload_attempts attempt
    where attempt.operation_type is not null
       or attempt.claim_token is not null
       or attempt.adjustment_state_key is not null
  ) or exists (
    select 1
    from public.google_ads_conversions conversion_row
    where conversion_row.upload_claim_token is not null
       or conversion_row.adjustment_claim_token is not null
       or conversion_row.last_adjusted_state_key is not null
       or conversion_row.deal_financial_checked_at is not null
       or conversion_row.deal_value_source is not null
       or conversion_row.deal_time_source is not null
       or conversion_row.deal_request_resolution_source is not null
  ) then
    raise exception using
      errcode = '55000',
      message = 'Unsafe rollback blocked: v2 claims, receipts or Deal audit state already exist.',
      hint = 'First stop/revert the v2 n8n callers and reconcile/archive provider receipts; then use an explicitly reviewed compensating migration instead of dropping audit state.';
  end if;
end;
$guard$;

drop function if exists public.record_google_ads_deal_adjustment_attempts_v1(jsonb);
drop function if exists public.claim_pending_gads_deal_adjustments_v1(integer, integer, integer);
drop function if exists public.record_google_ads_conversion_claim_attempts_v2(jsonb);
drop function if exists public.claim_pending_gads_conversions_v2(integer, integer);
drop function if exists public.gads_paid_deal_export_candidates_v2(integer, integer);
drop function if exists public.resolve_shopify_order_request_link_v1(
  text,
  text,
  uuid,
  timestamptz,
  text
);
drop function if exists private.gads_deal_financial_state_v1(text, text);
drop function if exists private.gads_valid_click_id_v1(text);

drop index if exists private.google_ads_upload_attempts_adjustment_state_idx;

alter table private.google_ads_upload_attempts
  drop constraint if exists google_ads_upload_attempts_adjustment_shape_check,
  drop constraint if exists google_ads_upload_attempts_conversion_value_check,
  drop constraint if exists google_ads_upload_attempts_operation_type_check,
  drop column if exists adjustment_date_time,
  drop column if exists adjustment_state_key,
  drop column if exists adjustment_value,
  drop column if exists adjustment_type,
  drop column if exists conversion_value,
  drop column if exists claim_token,
  drop column if exists operation_type;

drop index if exists public.google_ads_conversions_adjustment_claim_due_idx;
drop index if exists public.google_ads_conversions_upload_claim_due_idx;

alter table public.google_ads_conversions
  drop constraint if exists google_ads_conversions_deal_request_source_check,
  drop constraint if exists google_ads_conversions_deal_time_source_check,
  drop constraint if exists google_ads_conversions_deal_value_source_check,
  drop constraint if exists google_ads_conversions_adjusted_state_check,
  drop constraint if exists google_ads_conversions_adjustment_claim_check,
  drop constraint if exists google_ads_conversions_upload_claim_pair_check,
  drop column if exists last_adjusted_at,
  drop column if exists last_adjusted_value,
  drop column if exists last_adjusted_state_key,
  drop column if exists adjustment_claim_date_time,
  drop column if exists adjustment_claim_state_key,
  drop column if exists adjustment_claim_expires_at,
  drop column if exists adjustment_claim_token,
  drop column if exists deal_financial_checked_at,
  drop column if exists deal_request_resolution_source,
  drop column if exists deal_time_source,
  drop column if exists deal_value_source,
  drop column if exists upload_claim_expires_at,
  drop column if exists upload_claim_token;
