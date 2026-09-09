-- NEONTRIP manual-paid state only (2A). No freshness skip or automatic replay.

CREATE OR REPLACE FUNCTION public.billing_job_claim(p_worker text, p_job_types text[], p_lease_seconds integer DEFAULT 120)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_job public.billing_jobs; v_case public.billing_cases; v_lease text; v_invoice jsonb;
begin
  if length(trim(coalesce(p_worker,'')))<3 then raise exception 'BILLING_WORKER_REQUIRED'; end if;
  if coalesce(array_length(p_job_types,1),0)=0 or not (p_job_types <@ array['CREATE_PROFORMA','CREATE_INVOICE','CREATE_CREDIT','CREATE_CANCELLATION','VOID_PROFORMA','PROJECT_PAYMENT_SHOPIFY','PROJECT_PAYMENT_EASYBILL','SEND_CUSTOMER_DOCUMENT','NOTIFY_CHANGE_REQUEST','VERIFY_VAT','SYNC_SHOPIFY_TAX','RECONCILE']::text[]) then raise exception 'BILLING_JOB_TYPES_INVALID'; end if;
  v_lease := gen_random_uuid()::text;
  select * into v_job from public.billing_jobs
    where job_type=any(p_job_types)
      and not (job_type='RECONCILE' and coalesce(payload->>'scope','')='MANUAL_SHOPIFY_PAID')
      and (status='PENDING' or (status='FAILED' and next_attempt_at<=now()) or (status='PROCESSING' and lease_expires_at<=now()))
    order by created_at asc for update skip locked limit 1;
  if not found then return null; end if;
  update public.billing_jobs set status='PROCESSING',attempt_count=attempt_count+1,lease_token=v_lease,lease_expires_at=now()+make_interval(secs=>greatest(30,least(coalesce(p_lease_seconds,120),600))),last_error=null where id=v_job.id returning * into v_job;
  select * into v_case from public.billing_cases where id=v_job.billing_case_id;
  select to_jsonb(d) into v_invoice from public.billing_documents d where d.billing_case_id=v_case.id and d.document_type='INVOICE' and d.status in ('FINALIZED','SENT') order by d.created_at desc limit 1;
  return jsonb_build_object('job',to_jsonb(v_job),'billingCase',to_jsonb(v_case),'originalInvoice',v_invoice);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.billing_job_complete(p_job_id uuid, p_lease_token text, p_success boolean, p_result jsonb DEFAULT '{}'::jsonb, p_error text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare v_job public.billing_jobs; v_case public.billing_cases; v_type text; v_revision integer; v_number text; v_easybill_id text; v_retry timestamptz;
begin
  select * into v_job from public.billing_jobs where id=p_job_id and status='PROCESSING' and lease_token=p_lease_token and lease_expires_at>now() for update;
  if not found then raise exception 'BILLING_JOB_LEASE_INVALID'; end if;
  if v_job.job_type='RECONCILE' and v_job.payload->>'scope'='MANUAL_SHOPIFY_PAID' then
    raise exception 'BILLING_JOB_SCOPE_REQUIRED';
  end if;
  select * into v_case from public.billing_cases where id=v_job.billing_case_id for update;
  if p_success then
    update public.billing_jobs set status='DONE',lease_token=null,lease_expires_at=null,next_attempt_at=null,last_error=null where id=v_job.id returning * into v_job;
    if v_job.job_type in ('CREATE_PROFORMA','CREATE_INVOICE','CREATE_CREDIT','CREATE_CANCELLATION') then
      v_type := case v_job.job_type when 'CREATE_PROFORMA' then 'PROFORMA' when 'CREATE_INVOICE' then 'INVOICE' when 'CREATE_CREDIT' then 'CREDIT' else 'CANCELLATION' end;
      v_revision := case when v_type='INVOICE' then 0 else coalesce((v_job.payload->>'revision')::integer,0) end;
      v_number := coalesce(nullif(p_result->>'documentNumber',''),v_job.payload->>'documentNumber');
      v_easybill_id := nullif(p_result->>'easybillDocumentId','');
      if v_number is null or v_easybill_id is null then raise exception 'BILLING_DOCUMENT_RESULT_INVALID'; end if;
      insert into public.billing_documents (billing_case_id,document_type,revision,document_number,status,easybill_document_id,payload_hash,amount_cents,currency,finalized_at,sent_at)
        values (v_case.id,v_type,v_revision,v_number,case when coalesce((p_result->>'sent')::boolean,false) then 'SENT' else 'FINALIZED' end,v_easybill_id,coalesce(nullif(p_result->>'payloadHash',''),encode(extensions.digest(v_job.payload::text,'sha256'),'hex')),case when v_type='CREDIT' then (v_job.payload->>'amountCents')::bigint when v_type='CANCELLATION' then coalesce((v_job.payload->>'invoiceAmountCents')::bigint,v_case.total_gross_cents) else v_case.total_gross_cents end,v_case.currency,now(),case when coalesce((p_result->>'sent')::boolean,false) then now() else null end)
        on conflict (billing_case_id,document_type,revision) do update set status=excluded.status,easybill_document_id=excluded.easybill_document_id,finalized_at=excluded.finalized_at,sent_at=excluded.sent_at,updated_at=now();
      if v_type='INVOICE' then
        update public.billing_cases set status='INVOICED',final_invoice_at=coalesce(final_invoice_at,now()),lock_version=lock_version+1 where id=v_case.id returning * into v_case;
        if v_case.paid_at is not null then
          insert into public.billing_jobs (billing_case_id,idempotency_key,job_type,payload)
            values (v_case.id,'billing:'||v_case.id::text||':project-payment-easybill','PROJECT_PAYMENT_EASYBILL',jsonb_build_object('documentId',v_easybill_id,'amountCents',v_case.total_gross_cents,'paidAt',v_case.paid_at))
            on conflict (idempotency_key) do nothing;
        end if;
      elsif v_type='PROFORMA' then
        update public.billing_cases set status=case when tax_review_status='REVIEW_REQUIRED' then 'MANUAL_REVIEW' else 'PAYMENT_PENDING' end,lock_version=lock_version+1 where id=v_case.id returning * into v_case;
      end if;
    elsif v_job.job_type='VOID_PROFORMA' then
      update public.billing_documents set status='SUPERSEDED',updated_at=now()
        where billing_case_id=v_case.id and easybill_document_id=coalesce(nullif(p_result->>'easybillDocumentId',''),v_job.payload->>'easybillDocumentId');
    elsif v_job.job_type='PROJECT_PAYMENT_SHOPIFY' then
      update public.billing_payments set shopify_projection_status='DONE' where id=(v_job.payload->>'paymentId')::uuid;
    elsif v_job.job_type='PROJECT_PAYMENT_EASYBILL' then
      update public.billing_payments set easybill_projection_status='DONE' where billing_case_id=v_case.id and match_status='MATCHED';
    end if;
    insert into public.billing_events (billing_case_id,idempotency_key,event_type,source,actor,correlation_id,payload)
      values (v_case.id,'job-done:'||v_job.id::text,'BILLING_JOB_DONE','N8N',coalesce(p_result->>'worker','billing-worker'),v_job.id::text,coalesce(p_result,'{}'::jsonb)) on conflict (idempotency_key) do nothing;
  else
    v_retry := case v_job.attempt_count when 1 then now()+interval '1 minute' when 2 then now()+interval '5 minutes' when 3 then now()+interval '15 minutes' else null end;
    update public.billing_jobs set status=case when v_retry is null then 'BLOCKED' else 'FAILED' end,next_attempt_at=v_retry,lease_token=null,lease_expires_at=null,last_error=left(coalesce(p_error,'Unbekannter Adapterfehler'),2000) where id=v_job.id returning * into v_job;
    if v_job.job_type='PROJECT_PAYMENT_SHOPIFY' then update public.billing_payments set shopify_projection_status='FAILED' where id=(v_job.payload->>'paymentId')::uuid; end if;
    if v_job.job_type='PROJECT_PAYMENT_EASYBILL' then update public.billing_payments set easybill_projection_status='FAILED' where billing_case_id=v_case.id and match_status='MATCHED'; end if;
    if v_retry is null then
      if v_job.job_type='NOTIFY_CHANGE_REQUEST' then
        insert into public.billing_incidents (billing_case_id,incident_key,severity,title,summary,details)
          values (
            v_case.id,
            'change-request-notification-blocked:'||v_job.id::text,
            'URGENT',
            'Rechnungsänderung wartet ohne interne Benachrichtigung',
            'Die Kundenanfrage ist sicher gespeichert, aber die interne Prüf-E-Mail konnte nach vier Versuchen nicht versendet werden.',
            jsonb_build_object('jobId',v_job.id,'jobType',v_job.job_type,'error',p_error,'shopifyOrderName',v_case.shopify_order_name,'changeRequestId',v_job.payload->>'changeRequestId')
          ) on conflict (incident_key) do nothing;
      else
        update public.billing_cases set status='SYNC_BLOCKED',lock_version=lock_version+1 where id=v_case.id returning * into v_case;
        insert into public.billing_incidents (billing_case_id,incident_key,severity,title,summary,details)
          values (v_case.id,'job-blocked:'||v_job.id::text,'URGENT','Fehler Rechnung Shopify/Easybill','Ein Billing-Job ist nach vier Versuchen blockiert. Keine weiteren automatischen Finanzaktionen werden ausgeführt.',jsonb_build_object('jobId',v_job.id,'jobType',v_job.job_type,'error',p_error,'shopifyOrderName',v_case.shopify_order_name)) on conflict (incident_key) do nothing;
      end if;
    end if;
  end if;
  return jsonb_build_object('jobId',v_job.id,'status',v_job.status,'billingCaseId',v_case.id,'billingCaseStatus',v_case.status,'nextAttemptAt',v_job.next_attempt_at);
end;
$function$
;

-- Both new functions execute only with the existing service-role table permissions.
create function public.billing_manual_paid_claim(p_request jsonb)
returns jsonb language plpgsql security invoker set search_path=public,extensions as $$
declare
  v_now timestamptz := clock_timestamp();
  v_candidate jsonb; v_observation jsonb; v_alert jsonb; v_alerts jsonb;
  v_intake jsonb := '[]'; v_legacy jsonb := null; v_claimed jsonb := null;
  v_case public.billing_cases; v_job public.billing_jobs; v_due public.billing_jobs;
  v_invoice jsonb; v_binding jsonb; v_hash text; v_key text; v_order text; v_name text;
  v_result text; v_count integer; v_generation integer; v_changed boolean;
  v_first timestamptz; v_next timestamptz; v_locked timestamptz; v_marked timestamptz;
  v_lease integer; v_exec text; v_operation text; v_cases uuid[];
begin
  if jsonb_typeof(p_request) is distinct from 'object' or p_request->>'scope' is distinct from 'MANUAL_SHOPIFY_PAID'
    or p_request->>'operation' not in ('admit','claim') or p_request->>'operation' is null
    or length(coalesce(p_request->>'worker','')) not between 3 and 120
    or coalesce(p_request->>'executionId','') !~ '^[0-9]{1,30}$'
    or p_request->'jobTypes' is distinct from '["RECONCILE"]'::jsonb
    or jsonb_typeof(p_request->'candidates') is distinct from 'array' then
    raise exception 'MANUAL_PAID_REQUEST_INVALID';
  end if;
  if jsonb_array_length(p_request->'candidates')>201 then raise exception 'MANUAL_PAID_CANDIDATE_LIMIT'; end if;
  if coalesce(p_request->>'leaseSeconds','120') !~ '^[0-9]{2,3}$' then raise exception 'MANUAL_PAID_LEASE_INVALID'; end if;
  v_lease := coalesce(p_request->>'leaseSeconds','120')::integer;
  if v_lease not between 30 and 600 then raise exception 'MANUAL_PAID_LEASE_INVALID'; end if;
  v_exec := p_request->>'executionId'; v_operation := p_request->>'operation';
  if (select count(*) from jsonb_array_elements(p_request->'candidates') c where c->>'origin'='handoff')>1
    or (select count(*) from jsonb_array_elements(p_request->'candidates') c where c->>'origin'='legacy_due')>200 then
    raise exception 'MANUAL_PAID_CANDIDATE_LIMIT';
  end if;
  if exists(select 1 from jsonb_array_elements(p_request->'candidates') c group by c->>'origin',c->>'shopifyOrderId' having count(*)>1) then
    raise exception 'MANUAL_PAID_DUPLICATE_CANDIDATE';
  end if;
  -- Same order is locked in the same order across admissions. Handoff wins over its legacy observation.
  for v_candidate in select value from jsonb_array_elements(p_request->'candidates')
    order by value->>'shopifyOrderId',case when value->>'origin'='legacy_due' then 0 else 1 end loop
    v_order := v_candidate->>'shopifyOrderId'; v_name := v_candidate->>'shopifyOrderName';
    if jsonb_typeof(v_candidate) is distinct from 'object' or coalesce(v_order,'') !~ '^[0-9]{1,30}$'
      or coalesce(v_name,'') !~ '^#NEONT[0-9]+$'
      or coalesce(v_candidate->>'origin','') not in ('handoff','legacy_due') then
      raise exception 'MANUAL_PAID_CANDIDATE_INVALID';
    end if;
    if v_candidate ? 'amountCents' and v_candidate->'amountCents'<>'null'::jsonb and
      (jsonb_typeof(v_candidate->'amountCents')<>'number' or v_candidate->>'amountCents' !~ '^[0-9]{1,15}$') then
      raise exception 'MANUAL_PAID_AMOUNT_INVALID';
    end if;
    if v_candidate ? 'currency' and v_candidate->'currency'<>'null'::jsonb and v_candidate->>'currency'<>'EUR' then
      raise exception 'MANUAL_PAID_CURRENCY_INVALID';
    end if;
    v_first:=v_now; v_next:=v_now; v_locked:=v_now;
    if v_candidate->>'origin'='legacy_due' then
      if coalesce(v_candidate->>'firstSeenAt','') !~ '^\d{4}-\d\d-\d\dT.*(Z|[+-]\d\d:\d\d)$'
        or coalesce(v_candidate->>'nextAttemptAt','') !~ '^\d{4}-\d\d-\d\dT.*(Z|[+-]\d\d:\d\d)$'
        or coalesce(v_candidate->>'lockedUntil','') !~ '^[0-9]{1,16}$' then
        raise exception 'MANUAL_PAID_LEGACY_TIME_INVALID';
      end if;
      v_first:=(v_candidate->>'firstSeenAt')::timestamptz;
      v_next:=(v_candidate->>'nextAttemptAt')::timestamptz;
      v_locked:=to_timestamp((v_candidate->>'lockedUntil')::numeric/1000);
    end if;
    if v_candidate ? 'legacyAlerts' and jsonb_typeof(v_candidate->'legacyAlerts')<>'array' then raise exception 'MANUAL_PAID_ALERT_INVALID'; end if;
    if jsonb_array_length(coalesce(v_candidate->'legacyAlerts','[]'))>200 then raise exception 'MANUAL_PAID_ALERT_LIMIT'; end if;
    v_alerts:='{}';
    for v_alert in select value from jsonb_array_elements(coalesce(v_candidate->'legacyAlerts','[]')) loop
      if left(coalesce(v_alert->>'key',''),length(v_order)+1)<>v_order||'|'
        or length(coalesce(v_alert->>'key',''))<=length(v_order)+1
        or length(v_alert->>'key')>160 or substring(v_alert->>'key' from length(v_order)+2) !~ '^[A-Za-z0-9_-]+$'
        or coalesce(v_alert->>'markedAt','') !~ '^\d{4}-\d\d-\d\dT.*(Z|[+-]\d\d:\d\d)$' then raise exception 'MANUAL_PAID_ALERT_INVALID'; end if;
      v_marked:=(v_alert->>'markedAt')::timestamptz;
      if v_marked>v_now then raise exception 'MANUAL_PAID_ALERT_TIME_INVALID'; end if;
      v_alerts:=v_alerts||jsonb_build_object(v_alert->>'key',jsonb_build_object('markedAt',v_marked,'source','LEGACY_DEDUPE_MEMORY'));
    end loop;
    select array_agg(id) into v_cases from public.billing_cases
      where shopify_order_id in (v_order,'gid://shopify/Order/'||v_order);
    v_count:=coalesce(cardinality(v_cases),0);
    if v_count=0 then
      v_intake:=v_intake||jsonb_build_array(jsonb_build_object('origin',v_candidate->>'origin','shopifyOrderId',v_order,'result','UNMAPPED'));
      if (v_candidate->>'origin'='legacy_due' or not exists(select 1 from jsonb_array_elements(p_request->'candidates') c
          where c->>'origin'='legacy_due' and c->>'shopifyOrderId'=v_order)) and v_next<=v_now and v_locked<=v_now
        and (v_legacy is null or (v_next,v_first,v_order)<((v_legacy->>'nextAttemptAt')::timestamptz,(v_legacy->>'firstSeenAt')::timestamptz,v_legacy->>'shopifyOrderId')) then
        v_legacy:=(v_candidate-'legacyAlerts')||jsonb_build_object('firstSeenAt',v_first,'nextAttemptAt',v_next,
          'lockedUntil',coalesce(v_candidate->'lockedUntil','0'::jsonb));
      end if;
      continue;
    end if;
    if v_count<>1 then
      v_intake:=v_intake||jsonb_build_array(jsonb_build_object('origin',v_candidate->>'origin','shopifyOrderId',v_order,'result','IDENTITY_MISMATCH'));
      continue;
    end if;
    select * into v_case from public.billing_cases where id=v_cases[1];
    if v_case.shopify_order_name<>v_name then
      v_intake:=v_intake||jsonb_build_array(jsonb_build_object('origin',v_candidate->>'origin','shopifyOrderId',v_order,'result','IDENTITY_MISMATCH'));
      continue;
    end if;
    v_observation:=jsonb_build_object('shopifyOrderId',v_order,'shopifyOrderName',v_name,
      'amountCents',v_candidate->'amountCents','currency',v_candidate->'currency','sourceRevision',v_candidate->'sourceRevision');
    v_hash:=encode(extensions.digest(v_observation::text,'sha256'),'hex');
    v_key:='billing:'||v_case.id::text||':reconcile:manual-shopify-paid:v1';
    insert into public.billing_jobs(billing_case_id,idempotency_key,job_type,payload,next_attempt_at)
      values(v_case.id,v_key,'RECONCILE',jsonb_build_object('scope','MANUAL_SHOPIFY_PAID','contractVersion',1,
        'firstSeenAt',v_first,'input',jsonb_build_object('generation',1,'fingerprint',v_hash,'observation',v_observation),
        'manualPaidAlerts',v_alerts),greatest(v_next,v_locked)) on conflict(idempotency_key) do nothing;
    select * into v_job from public.billing_jobs where idempotency_key=v_key for update;
    if v_job.job_type<>'RECONCILE' or v_job.billing_case_id<>v_case.id or v_job.payload->>'scope' is distinct from 'MANUAL_SHOPIFY_PAID' then
      raise exception 'MANUAL_PAID_JOB_IDENTITY_INVALID';
    end if;
    -- Existing proof always wins over imported dedupe memory.
    v_alerts:=v_alerts||coalesce(v_job.payload->'manualPaidAlerts','{}');
    if v_alerts is distinct from coalesce(v_job.payload->'manualPaidAlerts','{}') then
      update public.billing_jobs set payload=jsonb_set(payload,'{manualPaidAlerts}',v_alerts) where id=v_job.id returning * into v_job;
    end if;
    v_changed:=v_job.payload#>>'{input,fingerprint}' is distinct from v_hash;
    v_generation:=coalesce((v_job.payload#>>'{input,generation}')::integer,1);
    -- A stale legacy snapshot cannot replace an already admitted handoff or reopen DONE.
    if v_changed and v_candidate->>'origin'='handoff' and v_job.status<>'BLOCKED' then
      update public.billing_jobs set payload=jsonb_set(payload,'{input}',jsonb_build_object('generation',v_generation+1,'fingerprint',v_hash,'observation',v_observation)),
        next_attempt_at=case when status='PENDING' then least(coalesce(next_attempt_at,v_now),v_now) else next_attempt_at end
        where id=v_job.id returning * into v_job;
    end if;
    if v_job.status='DONE' and v_candidate->>'origin'='handoff' then
      update public.billing_jobs set status='PENDING',next_attempt_at=v_now where id=v_job.id returning * into v_job;
    end if;
    v_result:=case when v_job.status='BLOCKED' then 'BLOCKED' when v_job.status='PROCESSING' then 'BUSY'
      when v_job.status='PENDING' and v_job.next_attempt_at<=v_now then 'ACCEPTED'
      when v_job.status='PENDING' then 'NOT_DUE' else 'UNCHANGED' end;
    v_intake:=v_intake||jsonb_build_array(jsonb_build_object('origin',v_candidate->>'origin','shopifyOrderId',v_order,
      'result',v_result,'billingCaseId',v_case.id,'jobId',v_job.id,'nextAttemptAt',v_job.next_attempt_at));
  end loop;
  if v_operation='admit' then
    return jsonb_build_object('ok',true,'scope','MANUAL_SHOPIFY_PAID','intake',v_intake,'claimed',null,'legacySelected',null);
  end if;
  v_now:=clock_timestamp();
  -- Expiry never authorizes another attempt after a possibly effective request.
  with expired as (
    select id from public.billing_jobs where job_type='RECONCILE' and payload->>'scope'='MANUAL_SHOPIFY_PAID'
      and status='PROCESSING' and lease_expires_at<=v_now order by lease_expires_at,id for update skip locked limit 201
  ) update public.billing_jobs j set status='BLOCKED',next_attempt_at=null,last_error='LEASE_EXPIRED_REVIEW_REQUIRED'
    from expired e where j.id=e.id;
  select * into v_due from public.billing_jobs where job_type='RECONCILE' and payload->>'scope'='MANUAL_SHOPIFY_PAID'
    and status='PENDING' and next_attempt_at<=v_now
    order by next_attempt_at,coalesce((payload->>'firstSeenAt')::timestamptz,created_at),id for update skip locked limit 1;
  if v_legacy is not null and (v_due.id is null or
    ((v_legacy->>'nextAttemptAt')::timestamptz,(v_legacy->>'firstSeenAt')::timestamptz,v_legacy->>'shopifyOrderId')<
    (v_due.next_attempt_at,coalesce((v_due.payload->>'firstSeenAt')::timestamptz,v_due.created_at),v_due.payload#>>'{input,observation,shopifyOrderId}')) then
    return jsonb_build_object('ok',true,'scope','MANUAL_SHOPIFY_PAID','intake',v_intake,'claimed',null,'legacySelected',v_legacy);
  end if;
  if v_due.id is not null then
    select * into v_case from public.billing_cases where id=v_due.billing_case_id;
    select to_jsonb(d) into v_invoice from public.billing_documents d where d.billing_case_id=v_case.id
      and d.document_type='INVOICE' and d.status in ('FINALIZED','SENT') order by created_at desc,id limit 1;
    v_binding:=jsonb_build_object('caseId',v_case.id,'orderId',v_case.shopify_order_id,'orderName',v_case.shopify_order_name,
      'snapshotHash',v_case.source_snapshot_hash,'revision',v_case.current_revision,'amountCents',v_case.total_gross_cents,'currency',v_case.currency,
      'invoiceId',v_invoice->'id','invoiceRevision',v_invoice->'revision','easybillDocumentId',v_invoice->'easybill_document_id');
    update public.billing_jobs set status='PROCESSING',attempt_count=attempt_count+1,lease_token=gen_random_uuid()::text,
      lease_expires_at=v_now+make_interval(secs=>v_lease),last_error=null,
      payload=jsonb_set(payload,'{claim}',jsonb_build_object('executionId',v_exec,'inputGeneration',payload#>'{input,generation}',
        'inputFingerprint',payload#>'{input,fingerprint}','bindingFingerprint',encode(extensions.digest(v_binding::text,'sha256'),'hex'),'startedAt',v_now))
      where id=v_due.id returning * into v_job;
    v_claimed:=jsonb_build_object('job',to_jsonb(v_job),'billingCase',to_jsonb(v_case),'originalInvoice',v_invoice,'claimContext',v_job.payload->'claim');
  end if;
  return jsonb_build_object('ok',true,'scope','MANUAL_SHOPIFY_PAID','intake',v_intake,'claimed',v_claimed,'legacySelected',null);
end;
$$;

create function public.billing_manual_paid_complete(p_job_id uuid,p_lease_token text,p_result jsonb)
returns jsonb language plpgsql security invoker set search_path=public,extensions as $$
declare
  v_job public.billing_jobs; v_case public.billing_cases; v_invoice jsonb; v_binding jsonb;
  v_now timestamptz:=clock_timestamp(); v_outcome text; v_status text; v_due timestamptz;
  v_alert jsonb; v_key text; v_payload jsonb; v_superseded boolean; v_disposition text:='RECORDED';
begin
  if jsonb_typeof(p_result) is distinct from 'object' or p_result->>'scope' is distinct from 'MANUAL_SHOPIFY_PAID' then raise exception 'MANUAL_PAID_COMPLETION_INVALID'; end if;
  select * into v_job from public.billing_jobs where id=p_job_id for update;
  if not found or v_job.job_type<>'RECONCILE' or v_job.payload->>'scope' is distinct from 'MANUAL_SHOPIFY_PAID' then raise exception 'BILLING_JOB_SCOPE_REQUIRED'; end if;
  v_now:=clock_timestamp();
  if v_job.status<>'PROCESSING' or p_lease_token is null or v_job.lease_token is distinct from p_lease_token
    or v_job.lease_expires_at is null or v_job.lease_expires_at<=v_now
    or v_job.payload#>>'{claim,executionId}' is distinct from p_result->>'executionId'
    or v_job.payload#>'{claim,inputGeneration}' is distinct from p_result->'inputGeneration'
    or v_job.payload#>>'{claim,inputFingerprint}' is distinct from p_result->>'inputFingerprint'
    or v_job.payload#>>'{claim,bindingFingerprint}' is distinct from p_result->>'bindingFingerprint' then raise exception 'BILLING_JOB_LEASE_INVALID'; end if;
  select * into v_case from public.billing_cases where id=v_job.billing_case_id for share;
  select to_jsonb(d) into v_invoice from public.billing_documents d where d.billing_case_id=v_case.id
    and d.document_type='INVOICE' and d.status in ('FINALIZED','SENT') order by created_at desc,id limit 1;
  v_binding:=jsonb_build_object('caseId',v_case.id,'orderId',v_case.shopify_order_id,'orderName',v_case.shopify_order_name,
    'snapshotHash',v_case.source_snapshot_hash,'revision',v_case.current_revision,'amountCents',v_case.total_gross_cents,'currency',v_case.currency,
    'invoiceId',v_invoice->'id','invoiceRevision',v_invoice->'revision','easybillDocumentId',v_invoice->'easybill_document_id');
  v_now:=clock_timestamp();
  if v_job.lease_expires_at<=v_now then raise exception 'BILLING_JOB_LEASE_INVALID'; end if;
  v_superseded:=v_job.payload#>'{input,generation}' is distinct from v_job.payload#>'{claim,inputGeneration}'
    or encode(extensions.digest(v_binding::text,'sha256'),'hex') is distinct from p_result->>'bindingFingerprint';
  v_outcome:=p_result->>'outcome';
  if coalesce(v_outcome,'') not in ('EXACT_INVOICE_PAID','NOT_MANUAL_PAID','EASYBILL_PROJECTION_VERIFIED','BILLING_PAYMENTS_REGISTERED','REVIEW_REQUIRED','OUTCOME_UNKNOWN','EXECUTION_FAILED') then raise exception 'MANUAL_PAID_OUTCOME_INVALID'; end if;
  v_payload:=v_job.payload;
  v_alert:=nullif(p_result->'alert','null');
  if v_alert is not null then
    v_key:=v_alert->>'key';
    if v_outcome not in ('REVIEW_REQUIRED','OUTCOME_UNKNOWN') or jsonb_typeof(v_alert)<>'object'
      or left(coalesce(v_key,''),length(v_job.payload#>>'{input,observation,shopifyOrderId}')+1)<>(v_job.payload#>>'{input,observation,shopifyOrderId}')||'|'
      or coalesce(v_key,'') !~ '^[0-9]{1,30}[|][A-Za-z0-9_-]+$' or length(v_key)>160
      or coalesce(v_alert->>'status','') not in ('ALREADY_MARKED','GATE_SUPPRESSED','SEND_ACCEPTED','SENT_CONFIRMED','UNKNOWN') then raise exception 'MANUAL_PAID_ALERT_INVALID'; end if;
    if v_alert->>'status'='UNKNOWN' then v_outcome:='OUTCOME_UNKNOWN';
    elsif v_alert->>'status'='SEND_ACCEPTED' then
      if v_alert#>'{proof,accepted}' is distinct from 'true'::jsonb then raise exception 'MANUAL_PAID_ALERT_PROOF_REQUIRED'; end if;
      v_payload:=jsonb_set(v_payload,'{manualPaidAlerts}',coalesce(v_payload->'manualPaidAlerts','{}')||jsonb_build_object(v_key,
        jsonb_build_object('acceptedAt',v_now,'source','API_ACCEPTANCE')));
    elsif v_alert->>'status'='SENT_CONFIRMED' then
      if length(coalesce(v_alert->>'providerMessageId','')) not between 1 and 1000 then raise exception 'MANUAL_PAID_ALERT_PROOF_REQUIRED'; end if;
      v_payload:=jsonb_set(v_payload,'{manualPaidAlerts}',coalesce(v_payload->'manualPaidAlerts','{}')||jsonb_build_object(v_key,
        jsonb_build_object('providerMessageId',v_alert->>'providerMessageId','confirmedAt',v_now,'source','PROVIDER_RESPONSE')));
    elsif v_alert->>'status'='ALREADY_MARKED' and not coalesce(v_payload->'manualPaidAlerts','{}') ? v_key then raise exception 'MANUAL_PAID_ALERT_MARKER_MISSING'; end if;
  end if;
  if v_outcome='REVIEW_REQUIRED' and v_alert is null then raise exception 'MANUAL_PAID_ALERT_DISPOSITION_REQUIRED'; end if;
  if v_outcome='EXACT_INVOICE_PAID' then
    if jsonb_typeof(p_result->'proof') is distinct from 'object'
      or coalesce(p_result#>>'{proof,easybillDocumentId}','') !~ '^[0-9]+$'
      or coalesce(p_result#>>'{proof,invoiceAmountCents}','') !~ '^[1-9][0-9]{0,14}$'
      or p_result#>>'{proof,invoiceAmountCents}' is distinct from p_result#>>'{proof,paidCents}'
      or p_result#>>'{proof,invoiceAmountCents}' is distinct from p_result#>>'{proof,expectedAmountCents}'
      or p_result#>>'{proof,currency}' is distinct from 'EUR'
      or coalesce(p_result#>>'{proof,easybillNumber}','') !~ '^#NEONT[0-9]+$' then raise exception 'MANUAL_PAID_INVOICE_PROOF_INVALID'; end if;
    if not v_superseded and (p_result#>>'{proof,easybillNumber}' is distinct from v_case.shopify_order_name
      or (p_result#>>'{proof,invoiceAmountCents}')::bigint<>v_case.total_gross_cents
      or p_result#>>'{proof,currency}' is distinct from v_case.currency
      or (v_invoice is not null and p_result#>>'{proof,easybillDocumentId}' is distinct from v_invoice->>'easybill_document_id')) then
      raise exception 'MANUAL_PAID_CANONICAL_PROOF_MISMATCH';
    end if;
  end if;
  if v_outcome in ('OUTCOME_UNKNOWN','EXECUTION_FAILED') then v_status:='BLOCKED'; v_due:=null; v_disposition:='BLOCKED';
  elsif v_superseded then v_status:='PENDING'; v_due:=v_now; v_disposition:='INPUT_CHANGED_RECHECK';
  elsif v_outcome in ('EXACT_INVOICE_PAID','NOT_MANUAL_PAID') then v_status:='DONE'; v_due:=null;
  else v_status:='PENDING'; v_due:=v_now+case v_outcome when 'EASYBILL_PROJECTION_VERIFIED' then interval '5 minutes'
    when 'BILLING_PAYMENTS_REGISTERED' then interval '15 minutes' else interval '60 minutes' end; end if;
  v_payload:=jsonb_set(v_payload,'{lastCheck}',jsonb_build_object('outcome',v_outcome,'inputFingerprint',p_result->>'inputFingerprint',
    'bindingFingerprint',p_result->>'bindingFingerprint','readWindowStartedAt',v_job.payload#>'{claim,startedAt}',
    'recordedAt',v_now,'validUntil',null,'proof',p_result->'proof','reasonCode',left(p_result->>'reasonCode',200),
    'alert',v_alert,'executionId',p_result->>'executionId'));
  update public.billing_jobs set status=v_status,next_attempt_at=v_due,lease_token=null,lease_expires_at=null,payload=v_payload,
    last_error=case when v_status='BLOCKED' then v_outcome||':'||left(coalesce(p_result->>'reasonCode','UNSPECIFIED'),200) else null end where id=v_job.id;
  return jsonb_build_object('jobId',v_job.id,'status',v_status,'billingCaseId',v_case.id,'nextAttemptAt',v_due,'outcome',v_outcome,'disposition',v_disposition);
end;
$$;

revoke all on function public.billing_manual_paid_claim(jsonb) from public,anon,authenticated;
grant execute on function public.billing_manual_paid_claim(jsonb) to service_role;
revoke all on function public.billing_manual_paid_complete(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.billing_manual_paid_complete(uuid,text,jsonb) to service_role;
