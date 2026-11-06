-- One bank receipt, atomically allocated to every referenced invoice.
CREATE OR REPLACE FUNCTION public.billing_collective_payment_ingest(p_payment jsonb, p_allocations jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE
 v_root text:=p_payment->>'id'; v_alias text:=p_payment->>'transactionId';
 v_key text; v_amount bigint; v_booked timestamptz; v_canonical jsonb;
 v_saved jsonb; v_a jsonb; v_case public.billing_cases; v_result jsonb;
 v_payments jsonb:='[]'; v_payment_ids jsonb:='[]'; v_first uuid;
 v_count integer; v_refs text[]; v_names text[];
BEGIN
 IF v_root IS NULL OR v_root !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 OR coalesce(length(v_alias),0)=0 OR p_payment->>'currency' IS DISTINCT FROM 'EUR'
 OR coalesce(p_payment->>'amountCents','') !~ '^[1-9][0-9]*$'
 OR coalesce(length(regexp_replace(lower(p_payment->>'payer'),'[^a-z0-9]','','g')),0)<4
 OR jsonb_typeof(p_allocations) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'COLLECTIVE_INPUT_INVALID'; END IF;
 v_count:=jsonb_array_length(p_allocations);
 IF v_count<2 OR v_count>10 THEN RAISE EXCEPTION 'COLLECTIVE_SIZE_INVALID'; END IF;
 v_amount:=(p_payment->>'amountCents')::bigint; v_booked:=(p_payment->>'bookedAt')::timestamptz;
 IF v_booked IS NULL OR v_booked>now()+interval '5 minutes' THEN RAISE EXCEPTION 'COLLECTIVE_DATE_INVALID'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_allocations) a WHERE coalesce(a->>'amountCents','') !~ '^[1-9][0-9]*$' OR coalesce(a->>'orderId','') !~ '^[0-9]+$')
 OR (SELECT count(DISTINCT a->>'caseId') FROM jsonb_array_elements(p_allocations) a)<>v_count
 OR (SELECT count(DISTINCT a->>'orderId') FROM jsonb_array_elements(p_allocations) a)<>v_count
 OR (SELECT sum((a->>'amountCents')::bigint) FROM jsonb_array_elements(p_allocations) a)<>v_amount
 THEN RAISE EXCEPTION 'COLLECTIVE_TOTAL_INVALID'; END IF;
 SELECT array_agg(DISTINCT '#NEONT'||m[1] ORDER BY '#NEONT'||m[1]) INTO v_refs
 FROM regexp_matches(upper(p_payment->>'reference'),'NEONT([0-9]{4})(?![A-Z0-9])','g') m;
 SELECT array_agg(a->>'orderName' ORDER BY a->>'orderName') INTO v_names FROM jsonb_array_elements(p_allocations) a;
 IF v_refs IS DISTINCT FROM v_names THEN RAISE EXCEPTION 'COLLECTIVE_REFERENCES_INVALID'; END IF;
 v_canonical:=jsonb_build_object('payment',p_payment,'allocations',(SELECT jsonb_agg(a-'lockVersion' ORDER BY a->>'orderId') FROM jsonb_array_elements(p_allocations) a));
 v_key:='qonto-collective:'||v_root;
 PERFORM pg_advisory_xact_lock(hashtextextended(v_key,0));
 SELECT payload INTO v_saved FROM billing_events WHERE idempotency_key=v_key;
 IF FOUND THEN
  IF v_saved->'request' IS DISTINCT FROM v_canonical THEN RAISE EXCEPTION 'COLLECTIVE_REPLAY_CONFLICT'; END IF;
  IF (SELECT count(*) FROM billing_payments p JOIN jsonb_array_elements(p_allocations) a
      ON p.billing_case_id=(a->>'caseId')::uuid AND p.provider='QONTO'
      AND p.provider_transaction_id=v_root||':allocation:'||(a->>'orderId')
      AND p.amount_cents=(a->>'amountCents')::bigint AND p.currency='EUR'
      AND p.booked_at=v_booked AND p.match_status='MATCHED'
      AND p.evidence->>'collectivePaymentId'=v_root
      AND p.evidence->'collectiveRequest'=v_canonical)<>v_count
  THEN RAISE EXCEPTION 'COLLECTIVE_REPLAY_EVIDENCE_INVALID'; END IF;
  RETURN (v_saved->'result')||jsonb_build_object('duplicate',true);
 END IF;
 -- Lock every case in one deterministic order before checking any mutable precondition.
 PERFORM 1 FROM billing_cases WHERE id IN(SELECT (a->>'caseId')::uuid FROM jsonb_array_elements(p_allocations) a) ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM processed_transactions WHERE transaction_id IN(v_root,v_alias))
 OR EXISTS(SELECT 1 FROM billing_payments WHERE upper(provider)='QONTO' AND
   (provider_transaction_id IN(v_root,v_alias) OR provider_transaction_id LIKE v_root||':allocation:%'
    OR evidence->>'collectivePaymentId'=v_root OR evidence->>'qontoTransactionId'=v_root))
 THEN RAISE EXCEPTION 'COLLECTIVE_BANK_ALREADY_USED'; END IF;
 FOR v_a IN SELECT value FROM jsonb_array_elements(p_allocations) ORDER BY value->>'caseId' LOOP
  SELECT * INTO v_case FROM billing_cases WHERE id=(v_a->>'caseId')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'COLLECTIVE_CASE_MISSING'; END IF;
  v_first:=coalesce(v_first,v_case.id);
  IF regexp_replace(v_case.shopify_order_id,'^gid://shopify/Order/','') IS DISTINCT FROM v_a->>'orderId'
   OR v_case.shopify_order_name IS DISTINCT FROM v_a->>'orderName'
   OR v_case.total_gross_cents IS DISTINCT FROM (v_a->>'amountCents')::bigint
   OR v_case.lock_version IS DISTINCT FROM (v_a->>'lockVersion')::integer
   OR v_case.currency<>'EUR' OR v_case.status NOT IN('PAYMENT_PENDING','INVOICED')
   OR v_case.tax_review_status='REVIEW_REQUIRED' OR v_case.paid_at IS NOT NULL
   OR v_case.cancelled_at IS NOT NULL OR v_case.refunded_at IS NOT NULL
   OR v_booked<v_case.created_at
   OR regexp_replace(lower(coalesce(nullif(v_case.customer->>'company',''),v_case.customer->>'name')),'[^a-z0-9]','','g')
      IS DISTINCT FROM regexp_replace(lower(p_payment->>'payer'),'[^a-z0-9]','','g')
   OR EXISTS(SELECT 1 FROM billing_payments WHERE billing_case_id=v_case.id)
  THEN RAISE EXCEPTION 'COLLECTIVE_CASE_CHANGED_OR_UNSAFE'; END IF;
  IF v_case.final_invoice_at IS NULL AND
    (EXISTS(SELECT 1 FROM billing_jobs WHERE billing_case_id=v_case.id AND job_type='CREATE_INVOICE')
     OR NOT EXISTS(SELECT 1 FROM billing_documents WHERE billing_case_id=v_case.id AND document_type='PROFORMA' AND revision=v_case.current_revision AND status IN('SENT','FINALIZED') AND amount_cents=v_case.total_gross_cents))
  THEN RAISE EXCEPTION 'COLLECTIVE_INVOICE_ALREADY_STARTED_OR_PROFORMA_MISSING'; END IF;
  IF v_case.final_invoice_at IS NOT NULL AND EXISTS(SELECT 1 FROM billing_jobs WHERE billing_case_id=v_case.id AND job_type='PROJECT_PAYMENT_EASYBILL')
  THEN RAISE EXCEPTION 'COLLECTIVE_PAYMENT_JOB_ALREADY_EXISTS'; END IF;
 END LOOP;
 FOR v_a IN SELECT value FROM jsonb_array_elements(p_allocations) ORDER BY value->>'caseId' LOOP
  v_result:=billing_payment_ingest(v_a->>'orderId','QONTO',v_root||':allocation:'||(v_a->>'orderId'),
   (v_a->>'amountCents')::bigint,'EUR',v_booked,'qonto:'||v_root||':allocation:'||(v_a->>'orderId'),
   jsonb_build_object('reference',p_payment->>'reference','customerName',p_payment->>'payer',
    'source','NEONTRIP Qonto collective payment','collectivePaymentId',v_root,'qontoTransactionId',v_root,
    'qontoTransactionAlias',v_alias,'bankAmountCents',v_amount,'collectiveRequest',v_canonical));
  IF v_result->>'matchStatus'<>'MATCHED' OR coalesce((v_result->>'duplicate')::boolean,false)
   OR NOT EXISTS(SELECT 1 FROM billing_payments WHERE id=(v_result->>'id')::uuid AND billing_case_id=(v_a->>'caseId')::uuid AND amount_cents=(v_a->>'amountCents')::bigint AND provider_transaction_id=v_root||':allocation:'||(v_a->>'orderId'))
  THEN RAISE EXCEPTION 'COLLECTIVE_ALLOCATION_UNCONFIRMED'; END IF;
  v_payments:=v_payments||jsonb_build_array(v_result||jsonb_build_object('orderId',v_a->>'orderId','amountCents',(v_a->>'amountCents')::bigint));
  v_payment_ids:=v_payment_ids||jsonb_build_array(v_result->>'id');
  UPDATE billing_jobs SET payload=payload||jsonb_build_object('collectivePaymentId',v_root,'collectiveAllocationId',v_root||':allocation:'||(v_a->>'orderId'))
   WHERE idempotency_key='payment:'||(v_result->>'id')||':shopify';
 END LOOP;
 -- Invoices/payment projection wait for both verified Shopify projections.
 UPDATE billing_jobs SET payload=payload||jsonb_build_object('collectivePaymentId',v_root,'collectiveRequiredShopifyPaymentIds',v_payment_ids)
 WHERE billing_case_id IN(SELECT (a->>'caseId')::uuid FROM jsonb_array_elements(p_allocations) a)
 AND job_type IN('CREATE_INVOICE','PROJECT_PAYMENT_EASYBILL') AND status='PENDING';
 v_result:=jsonb_build_object('ok',true,'duplicate',false,'transactionId',v_root,'amountCents',v_amount,'payments',v_payments);
 INSERT INTO billing_events(billing_case_id,idempotency_key,event_type,source,actor,correlation_id,payload)
 VALUES(v_first,v_key,'COLLECTIVE_PAYMENT_INGESTED','QONTO','system',v_root,jsonb_build_object('request',v_canonical,'result',v_result));
 INSERT INTO processed_transactions(transaction_id,neon_number,amount,shopify_marked_paid,easybill_payment_created,skip_reason,processed_at)
 VALUES(v_root,array_to_string(v_names,','),v_amount/100.0,false,false,'collective_billing_registered',now());
 RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.billing_collective_payment_ingest(jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_collective_payment_ingest(jsonb,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.billing_job_claim(p_worker text, p_job_types text[], p_lease_seconds integer DEFAULT 120)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_job public.billing_jobs; v_case public.billing_cases; v_lease text; v_invoice jsonb; v_collective public.billing_payments;
begin
  if length(trim(coalesce(p_worker,'')))<3 then raise exception 'BILLING_WORKER_REQUIRED'; end if;
  if coalesce(array_length(p_job_types,1),0)=0 or not (p_job_types <@ array['CREATE_PROFORMA','CREATE_INVOICE','CREATE_CREDIT','CREATE_CANCELLATION','VOID_PROFORMA','PROJECT_PAYMENT_SHOPIFY','PROJECT_PAYMENT_EASYBILL','SEND_CUSTOMER_DOCUMENT','NOTIFY_CHANGE_REQUEST','VERIFY_VAT','SYNC_SHOPIFY_TAX','RECONCILE']::text[]) then raise exception 'BILLING_JOB_TYPES_INVALID'; end if;
  v_lease := gen_random_uuid()::text;
  select * into v_job from public.billing_jobs
    where job_type=any(p_job_types)
      and not (job_type='RECONCILE' and coalesce(payload->>'scope','')='MANUAL_SHOPIFY_PAID')
      and (status='PENDING' or (status='FAILED' and next_attempt_at<=now()) or (status='PROCESSING' and lease_expires_at<=now()))
      and case when payload ? 'collectiveRequiredShopifyPaymentIds' then
        case when jsonb_typeof(payload->'collectiveRequiredShopifyPaymentIds')='array' then
          jsonb_array_length(payload->'collectiveRequiredShopifyPaymentIds') between 2 and 10
          and (select count(*)=jsonb_array_length(billing_jobs.payload->'collectiveRequiredShopifyPaymentIds')
               and bool_and(bp.shopify_projection_status='DONE' and bp.evidence->>'collectivePaymentId'=billing_jobs.payload->>'collectivePaymentId'
                 and bc.cancelled_at is null and bc.refunded_at is null and bc.tax_review_status<>'REVIEW_REQUIRED'
                 and bc.status in ('INVOICE_PENDING','INVOICED') and bc.total_gross_cents=bp.amount_cents and bc.currency=bp.currency and bc.paid_at is not null)
               from public.billing_payments bp join public.billing_cases bc on bc.id=bp.billing_case_id where bp.id::text in
                 (select jsonb_array_elements_text(billing_jobs.payload->'collectiveRequiredShopifyPaymentIds')))
        else false end
      else true end
    order by created_at asc for update skip locked limit 1;
  if not found then return null; end if;
  update public.billing_jobs set status='PROCESSING',attempt_count=attempt_count+1,lease_token=v_lease,lease_expires_at=now()+make_interval(secs=>greatest(30,least(coalesce(p_lease_seconds,120),600))),last_error=null where id=v_job.id returning * into v_job;
  select * into v_case from public.billing_cases where id=v_job.billing_case_id;
  select to_jsonb(d) into v_invoice from public.billing_documents d where d.billing_case_id=v_case.id and d.document_type='INVOICE' and d.status in ('FINALIZED','SENT') order by d.created_at desc limit 1;
  if v_job.job_type='PROJECT_PAYMENT_EASYBILL' then
    select * into v_collective from billing_payments where billing_case_id=v_case.id
      and match_status='MATCHED' and evidence ? 'collectivePaymentId';
    if found then
      if v_collective.amount_cents<>(v_job.payload->>'amountCents')::bigint then raise exception 'COLLECTIVE_PROJECTION_AMOUNT'; end if;
      v_job.payload:=v_job.payload||jsonb_build_object('collectivePaymentId',v_collective.evidence->>'collectivePaymentId','collectiveAllocationId',v_collective.provider_transaction_id);
    end if;
  end if;
  return jsonb_build_object('job',to_jsonb(v_job),'billingCase',to_jsonb(v_case),'originalInvoice',v_invoice);
end;
$function$
