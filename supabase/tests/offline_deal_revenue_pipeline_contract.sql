-- Catalog-only contract checks for 20260904110719_offline_deal_revenue_pipeline.
-- Safe to run after the migration: no business rows are inserted or changed.

begin;

do $contract$
declare
  v_definition text;
  v_result_type text;
begin
  if to_regprocedure(
    'public.resolve_shopify_order_request_link_v1(text,text,uuid,timestamp with time zone,text)'
  ) is null then
    raise exception 'missing request resolver RPC';
  end if;

  if to_regprocedure(
    'public.gads_paid_deal_export_candidates_v2(integer,integer)'
  ) is null then
    raise exception 'missing paid Deal candidate RPC';
  end if;

  if to_regprocedure(
    'public.claim_pending_gads_conversions_v2(integer,integer)'
  ) is null then
    raise exception 'missing conversion claim RPC';
  end if;

  if to_regprocedure(
    'public.record_google_ads_conversion_claim_attempts_v2(jsonb)'
  ) is null then
    raise exception 'missing conversion receipt RPC';
  end if;

  if to_regprocedure(
    'public.claim_pending_gads_deal_adjustments_v1(integer,integer,integer)'
  ) is null then
    raise exception 'missing Deal adjustment claim RPC';
  end if;

  if to_regprocedure(
    'public.record_google_ads_deal_adjustment_attempts_v1(jsonb)'
  ) is null then
    raise exception 'missing Deal adjustment receipt RPC';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'google_ads_conversions'
      and column_name = 'upload_claim_token'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'google_ads_conversions'
      and column_name = 'adjustment_claim_date_time'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'google_ads_upload_attempts'
      and column_name = 'adjustment_state_key'
  ) then
    raise exception 'missing lease or adjustment audit columns';
  end if;

  if has_function_privilege(
    'anon',
    'public.claim_pending_gads_conversions_v2(integer,integer)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.claim_pending_gads_conversions_v2(integer,integer)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.claim_pending_gads_conversions_v2(integer,integer)',
    'EXECUTE'
  ) then
    raise exception 'conversion claim RPC ACL mismatch';
  end if;

  select pg_get_functiondef(
    'public.resolve_shopify_order_request_link_v1(text,text,uuid,timestamp with time zone,text)'::regprocedure
  ) into v_definition;
  if position('explicit_id_unresolved' in v_definition) = 0
    or position('conflicting_exact_ids' in v_definition) = 0
    or position('ambiguous_customer_history' in v_definition) = 0 then
    raise exception 'resolver is missing fail-closed explicit/conflict/ambiguity branches';
  end if;

  select pg_get_functiondef(
    'public.claim_pending_gads_conversions_v2(integer,integer)'::regprocedure
  ) into v_definition;
  if position('FOR UPDATE OF GC SKIP LOCKED' in upper(v_definition)) = 0
    or position('Offline: Angebot versendet' in v_definition) = 0
    or position('Offline: Deal gewonnen' in v_definition) = 0
    or position('consent_ad_personalization' in v_definition) = 0 then
    raise exception 'conversion claim lost atomicity, Offer branch, Deal branch or consent output';
  end if;

  select pg_get_functiondef(
    'private.gads_deal_financial_state_v1(text,text)'::regprocedure
  ) into v_definition;
  if position('BC.STATUS = ''CANCELLED''' in upper(v_definition)) = 0
    or position('BC.STATUS IN (''CANCELLED'', ''REFUNDED'')' in upper(v_definition)) > 0 then
    raise exception 'partial refunds would be misclassified as full cancellation';
  end if;

  select pg_get_function_result(
    'public.claim_pending_gads_conversions_v2(integer,integer)'::regprocedure
  ) into v_result_type;
  if position('consent_ad_personalization text' in v_result_type) = 0 then
    raise exception 'conversion claim result omits consent_ad_personalization';
  end if;

  select pg_get_functiondef(
    'public.claim_pending_gads_deal_adjustments_v1(integer,integer,integer)'::regprocedure
  ) into v_definition;
  if position('UPLOAD_RECEIPT.JOB_ID IS NOT NULL' in upper(v_definition)) = 0
    or position('upload_receipt.order_id = gc.id::text' in v_definition) = 0
    or position('adjustment_claim_date_time' in v_definition) = 0 then
    raise exception 'adjustment claim lacks provider receipt, stable orderId or stable adjustment time';
  end if;

  -- Existing v1 request-lead/offer RPCs must remain present; v2 is additive.
  if to_regprocedure('public.record_google_ads_upload_attempts(jsonb)') is null
    or to_regprocedure('public.get_pending_gads_request_leads(integer)') is null
    or to_regprocedure('public.gads_paid_deal_export_candidates(integer,integer)') is null then
    raise exception 'legacy request-lead/offer contracts were removed';
  end if;
end;
$contract$;

rollback;
