-- NEONTRIP: defer only a proven pre-effect Shopify GET 429; preserve all other completion guards.
DO $patch$
DECLARE
  source text:=pg_get_functiondef('public.billing_manual_paid_complete(uuid,text,jsonb)'::regprocedure);
  claim_source text:=pg_get_functiondef('public.billing_manual_paid_claim(jsonb)'::regprocedure);
BEGIN
  IF md5(source)<>'967b9517d1c915de075ef9d368a926a1' THEN RAISE EXCEPTION 'MANUAL_PAID_COMPLETION_SOURCE_DRIFT'; END IF;
  IF md5(claim_source)<>'ddf416837e85e2e8434bdd12a9714dfc' THEN RAISE EXCEPTION 'MANUAL_PAID_CLAIM_SOURCE_DRIFT'; END IF;
  source:=replace(source,$old$  v_source jsonb; v_source_time timestamptz; v_valid_until timestamptz:=null;$old$,$new$  v_source jsonb; v_source_time timestamptz; v_valid_until timestamptz:=null;
  v_read_retry_count integer:=0;$new$);
  source:=replace(source,$old$'REVIEW_REQUIRED','OUTCOME_UNKNOWN','EXECUTION_FAILED') then raise exception 'MANUAL_PAID_OUTCOME_INVALID'$old$,$new$'REVIEW_REQUIRED','OUTCOME_UNKNOWN','EXECUTION_FAILED','READ_RETRY_REQUIRED') then raise exception 'MANUAL_PAID_OUTCOME_INVALID'$new$);
  source:=replace(source,$old$  v_payload:=v_job.payload;$old$,$new$  if v_outcome='READ_RETRY_REQUIRED' then
    if jsonb_typeof(p_result->'proof') is distinct from 'object'
      or p_result#>>'{proof,stage}' is distinct from 'READ_SHOPIFY_TRANSACTIONS'
      or p_result#>>'{proof,requestMethod}' is distinct from 'GET'
      or p_result#>'{proof,httpStatus}' is distinct from '429'::jsonb
      or p_result#>'{proof,sideEffectsStarted}' is distinct from 'false'::jsonb
      or p_result#>>'{proof,shopifyOrderId}' is distinct from v_job.payload#>>'{input,observation,shopifyOrderId}'
      or coalesce(p_result#>>'{proof,shopifyOrderId}','') !~ '^[0-9]{1,30}$'
      or jsonb_typeof(p_result#>'{proof,retryAfterSeconds}') is distinct from 'number'
      or coalesce(p_result#>>'{proof,retryAfterSeconds}','') !~ '^[3-9][0-9]{2}$'
      or p_result->>'reasonCode' is distinct from 'SHOPIFY_READ_RATE_LIMIT'
      then raise exception 'MANUAL_PAID_READ_RETRY_PROOF_INVALID'; end if;
    if (p_result#>>'{proof,retryAfterSeconds}')::integer>900 then raise exception 'MANUAL_PAID_READ_RETRY_PROOF_INVALID'; end if;
    if v_job.payload#>>'{lastCheck,outcome}'='READ_RETRY_REQUIRED'
      and v_job.payload#>>'{lastCheck,inputFingerprint}'=p_result->>'inputFingerprint' then
      if coalesce(v_job.payload#>>'{lastCheck,readRetryCount}','') !~ '^[1-4]$' then
        raise exception 'MANUAL_PAID_READ_RETRY_PROOF_INVALID'; end if;
      v_read_retry_count:=(v_job.payload#>>'{lastCheck,readRetryCount}')::integer;
    end if;
    v_read_retry_count:=v_read_retry_count+1;
  end if;
  v_payload:=v_job.payload;$new$);
  source:=replace(source,$old$  elsif v_superseded then v_status:='PENDING'; v_due:=v_now; v_disposition:='INPUT_CHANGED_RECHECK';$old$,$new$  elsif v_outcome='READ_RETRY_REQUIRED' then
    if v_read_retry_count>3 then v_status:='BLOCKED'; v_due:=null; v_disposition:='BLOCKED';
    else v_status:='PENDING'; v_due:=v_now+make_interval(secs=>(p_result#>>'{proof,retryAfterSeconds}')::integer); end if;
  elsif v_superseded then v_status:='PENDING'; v_due:=v_now; v_disposition:='INPUT_CHANGED_RECHECK';$new$);
  source:=replace(source,$old$    'alert',v_alert,'executionId',p_result->>'executionId'));$old$,$new$    'alert',v_alert,'executionId',p_result->>'executionId') ||
    case when v_outcome='READ_RETRY_REQUIRED' then jsonb_build_object('readRetryCount',v_read_retry_count) else '{}'::jsonb end);$new$);
  EXECUTE source;
  -- A new observation must not shorten a provider-requested backoff.
  claim_source:=replace(claim_source,$old$        next_attempt_at=case when status='PENDING' then least(coalesce(next_attempt_at,v_now),v_now) else next_attempt_at end$old$,$new$        next_attempt_at=case
          when status='PENDING' and payload#>>'{lastCheck,outcome}'='READ_RETRY_REQUIRED' and next_attempt_at>v_now then next_attempt_at
          when status='PENDING' then least(coalesce(next_attempt_at,v_now),v_now) else next_attempt_at end$new$);
  EXECUTE claim_source;
END;
$patch$;
