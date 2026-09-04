-- Catalog-only contract checks for the additive Deal-adjustment audit repair.
-- Historical provider receipts are deliberately not rewritten by this repair.

begin;

do $contract$
declare
  v_definition text;
  v_result_type text;
  v_cases_ok boolean;
begin
  select pg_get_functiondef(
    'public.claim_pending_gads_deal_adjustments_v1(integer,integer,integer)'::regprocedure
  ) into v_definition;

  select pg_get_function_result(
    'public.claim_pending_gads_deal_adjustments_v1(integer,integer,integer)'::regprocedure
  ) into v_result_type;

  if v_result_type is distinct from
    'TABLE(conversion_id uuid, claim_token uuid, adjustment_state_key text, adjustment_type text, adjusted_value numeric, currency_code text, adjustment_date_time timestamp with time zone, conversion_name text, conversion_time timestamp with time zone, order_id text, value_source text, refund_net_cents bigint)' then
    raise exception 'adjustment claim RPC result contract changed';
  end if;

  if position('FOR UPDATE OF GC SKIP LOCKED' in upper(v_definition)) = 0 then
    raise exception 'adjustment claim lost atomic row leasing';
  end if;

  if position('LEGACY_ATTEMPT.OPERATION_TYPE IS NULL' in upper(v_definition)) = 0
    or position(
      'LEGACY_ATTEMPT.CONVERSION_NAME = ''OFFLINE: DEAL GEWONNEN'''
      in upper(v_definition)
    ) = 0
    or position('LEGACY_ATTEMPT.JOB_ID IS NOT NULL' in upper(v_definition)) = 0
    or position('LEGACY_ATTEMPT.ORDER_ID = GC.ID::TEXT' in upper(v_definition)) = 0
    or position('MANUAL-RESTATEMENT:' in upper(v_definition)) = 0
    or position('LEGACY_RECEIPT.ADJUSTED_VALUE' in upper(v_definition)) = 0
    or position(
      'ORIGINAL_UPLOAD.CONVERSION_ACTION = LEGACY_ATTEMPT.CONVERSION_ACTION'
      in upper(v_definition)
    ) = 0
    or position(
      'ORIGINAL_UPLOAD.ATTEMPT_KEY !~ ''^MANUAL-RESTATEMENT:'''
      in upper(v_definition)
    ) = 0 then
    raise exception 'adjustment claim no longer recognizes strict legacy RESTATEMENT receipts';
  end if;

  if position(
    'COALESCE(LEGACY_ATTEMPT.ATTEMPTED_AT, LEGACY_ATTEMPT.RECORDED_AT) DESC NULLS LAST'
    in upper(v_definition)
  ) = 0 then
    raise exception 'adjustment claim does not select the latest legacy provider state';
  end if;

  if position('DEAL_VALUE_SOURCE = COALESCE(V_ROW.VALUE_SOURCE' in upper(v_definition)) = 0
    or position('DEAL_TIME_SOURCE = COALESCE(V_ROW.TIME_SOURCE' in upper(v_definition)) = 0
    or position(
      'DEAL_REQUEST_RESOLUTION_SOURCE = COALESCE' in upper(v_definition)
    ) = 0 then
    raise exception 'adjustment claim no longer persists canonical audit sources';
  end if;

  if has_function_privilege(
    'anon',
    'public.claim_pending_gads_deal_adjustments_v1(integer,integer,integer)',
    'EXECUTE'
  ) or has_function_privilege(
    'authenticated',
    'public.claim_pending_gads_deal_adjustments_v1(integer,integer,integer)',
    'EXECUTE'
  ) or not has_function_privilege(
    'service_role',
    'public.claim_pending_gads_deal_adjustments_v1(integer,integer,integer)',
    'EXECUTE'
  ) then
    raise exception 'adjustment claim RPC ACL mismatch';
  end if;

  with legacy_cases(
    label,
    source_id,
    order_id,
    job_id,
    status,
    conversion_name,
    attempt_key,
    has_matching_original_upload,
    target_value,
    expected_match
  ) as (
    values
      (
        'valid',
        '11111111-1111-4111-8111-111111111111'::uuid,
        '11111111-1111-4111-8111-111111111111',
        1::bigint,
        'success',
        'Offline: Deal gewonnen',
        'manual-restatement:20260820:11111111-1111-4111-8111-111111111111:42400',
        true,
        424.00::numeric,
        true
      ),
      (
        'wrong order',
        '11111111-1111-4111-8111-111111111111'::uuid,
        '22222222-2222-4222-8222-222222222222',
        1::bigint,
        'success',
        'Offline: Deal gewonnen',
        'manual-restatement:20260820:11111111-1111-4111-8111-111111111111:42400',
        true,
        424.00::numeric,
        false
      ),
      (
        'missing job',
        '11111111-1111-4111-8111-111111111111'::uuid,
        '11111111-1111-4111-8111-111111111111',
        null::bigint,
        'success',
        'Offline: Deal gewonnen',
        'manual-restatement:20260820:11111111-1111-4111-8111-111111111111:42400',
        true,
        424.00::numeric,
        false
      ),
      (
        'failure status',
        '11111111-1111-4111-8111-111111111111'::uuid,
        '11111111-1111-4111-8111-111111111111',
        1::bigint,
        'permanent_failure',
        'Offline: Deal gewonnen',
        'manual-restatement:20260820:11111111-1111-4111-8111-111111111111:42400',
        true,
        424.00::numeric,
        false
      ),
      (
        'wrong conversion name',
        '11111111-1111-4111-8111-111111111111'::uuid,
        '11111111-1111-4111-8111-111111111111',
        1::bigint,
        'success',
        'Offline: Angebot versendet',
        'manual-restatement:20260820:11111111-1111-4111-8111-111111111111:42400',
        true,
        424.00::numeric,
        false
      ),
      (
        'different cents',
        '11111111-1111-4111-8111-111111111111'::uuid,
        '11111111-1111-4111-8111-111111111111',
        1::bigint,
        'success',
        'Offline: Deal gewonnen',
        'manual-restatement:20260820:11111111-1111-4111-8111-111111111111:42500',
        true,
        424.00::numeric,
        false
      ),
      (
        'no matching original upload',
        '11111111-1111-4111-8111-111111111111'::uuid,
        '11111111-1111-4111-8111-111111111111',
        1::bigint,
        'success',
        'Offline: Deal gewonnen',
        'manual-restatement:20260820:11111111-1111-4111-8111-111111111111:42400',
        false,
        424.00::numeric,
        false
      )
  )
  select bool_and(
    (
      order_id = source_id::text
      and job_id is not null
      and status in ('success', 'duplicate')
      and conversion_name = 'Offline: Deal gewonnen'
      and has_matching_original_upload
      and case
        when attempt_key ~ (
          '^manual-restatement:[0-9]{8}:' || source_id::text || ':[0-9]+$'
        ) then pg_catalog.round(
          pg_catalog.substring(attempt_key, ':([0-9]+)$')::numeric / 100.0,
          2
        )
        else null
      end = pg_catalog.round(target_value, 2)
    ) = expected_match
  )
  into v_cases_ok
  from legacy_cases;

  if not coalesce(v_cases_ok, false) then
    raise exception 'legacy receipt positive/negative contract cases failed';
  end if;
end;
$contract$;

rollback;
