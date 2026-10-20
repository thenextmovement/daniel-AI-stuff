-- Disposable local PostgreSQL only. No provider calls, workers or production fixtures.
BEGIN;
DO $test$
DECLARE
  c uuid; j uuid; picked jsonb; packet jsonb; result jsonb; invalid jsonb;
  state public.billing_jobs; i integer; before_effects jsonb; after_effects jsonb;
  request jsonb:='{"scope":"MANUAL_SHOPIFY_PAID","operation":"claim","worker":"isolated-test","executionId":"42","jobTypes":["RECONCILE"],"leaseSeconds":120,"candidates":[]}';
BEGIN
  insert into billing_cases(source_system,source_snapshot_hash,shopify_order_id,shopify_order_name,currency,subtotal_net_cents,vat_cents,total_gross_cents,tax_treatment,tax_review_status,status,portal_token_hash,paid_at)
    values('test','snapshot','900001','#NEONT900001','EUR',840,160,1000,'DE_STANDARD','NOT_REQUIRED','INVOICED','isolated-token',now()) returning id into c;
  insert into billing_documents(billing_case_id,document_type,document_number,status,easybill_document_id,payload_hash,amount_cents,currency,sent_at)
    values(c,'INVOICE','#NEONT900001','SENT','123','snapshot',1000,'EUR',now());
  insert into billing_payments(billing_case_id,provider,provider_transaction_id,amount_cents,currency,booked_at,match_status,shopify_projection_status,easybill_projection_status)
    values(c,'QONTO','isolated-paid',1000,'EUR',now(),'MATCHED','DONE','DONE');
  insert into billing_jobs(billing_case_id,idempotency_key,job_type,status)
    values(c,'isolated-sent','SEND_CUSTOMER_DOCUMENT','DONE');
  select jsonb_build_object('case',(select to_jsonb(x) from billing_cases x where id=c),
    'documents',(select jsonb_agg(to_jsonb(x) order by id) from billing_documents x where billing_case_id=c),
    'payments',(select jsonb_agg(to_jsonb(x) order by id) from billing_payments x where billing_case_id=c),
    'jobs',(select jsonb_agg(to_jsonb(x) order by id) from billing_jobs x where billing_case_id=c)) into before_effects;
  picked:=billing_manual_paid_claim(request||jsonb_build_object('candidates',jsonb_build_array(jsonb_build_object(
    'origin','handoff','shopifyOrderId','900001','shopifyOrderName','#NEONT900001','amountCents',1000,'currency','EUR'))));
  j:=(picked#>>'{claimed,job,id}')::uuid;
  assert j is not null,'fixture must claim existing canonical path';
  packet:=(picked#>'{claimed,claimContext}')||jsonb_build_object('scope','MANUAL_SHOPIFY_PAID',
    'outcome','READ_RETRY_REQUIRED','reasonCode','SHOPIFY_READ_RATE_LIMIT',
    'proof',jsonb_build_object('stage','READ_SHOPIFY_TRANSACTIONS','requestMethod','GET','httpStatus',429,
      'shopifyOrderId','900001','sideEffectsStarted',false,'retryAfterSeconds',300));
  -- Invalid or write-side evidence must never become retryable.
  for invalid in select value from jsonb_array_elements(jsonb_build_array(
    packet||jsonb_build_object('proof',(packet->'proof')||'{"requestMethod":"POST"}'),
    packet||jsonb_build_object('proof',(packet->'proof')||'{"stage":"REGISTER_PAYMENT"}'),
    packet||jsonb_build_object('proof',(packet->'proof')||'{"httpStatus":500}'),
    packet||jsonb_build_object('proof',(packet->'proof')||'{"sideEffectsStarted":true}'),
    packet||jsonb_build_object('proof',(packet->'proof')||'{"shopifyOrderId":"900002"}'),
    packet||jsonb_build_object('proof',(packet->'proof')||'{"retryAfterSeconds":299}'),
    packet||jsonb_build_object('proof',(packet->'proof')||'{"retryAfterSeconds":901}'),
    packet||jsonb_build_object('proof',(packet->'proof')||'{"retryAfterSeconds":300.5}'),
    packet||jsonb_build_object('proof',(packet->'proof')-'retryAfterSeconds'))) loop
    begin
      perform billing_manual_paid_complete(j,picked#>>'{claimed,job,lease_token}',invalid);
      raise exception 'expected proof rejection';
    exception when others then
      if SQLERRM<>'MANUAL_PAID_READ_RETRY_PROOF_INVALID' then raise; end if;
    end;
  end loop;
  -- Actual claim/complete cycle: three bounded retries, fourth rejection blocks.
  for i in 1..4 loop
    result:=billing_manual_paid_complete(j,picked#>>'{claimed,job,lease_token}',packet);
    select * into state from billing_jobs where id=j;
    assert state.lease_token is null and state.lease_expires_at is null,'lease must be released';
    assert (state.payload#>>'{lastCheck,readRetryCount}')::integer=i,'consecutive retry count';
    if i<4 then
      assert state.status='PENDING' and state.next_attempt_at>=clock_timestamp()+interval '299 seconds','backoff must persist';
      assert (billing_manual_paid_claim(request)->'claimed')='null'::jsonb,'not due must not run';
      begin
        perform billing_manual_paid_complete(j,picked#>>'{claimed,job,lease_token}',packet);
        raise exception 'expected replay rejection';
      exception when others then
        if SQLERRM<>'BILLING_JOB_LEASE_INVALID' then raise; end if;
      end;
      update billing_jobs set next_attempt_at=clock_timestamp()-interval '1 second' where id=j;
      picked:=billing_manual_paid_claim(request);
      assert picked#>>'{claimed,job,id}'=j::text,'reuse same job, do not create another';
      packet:=packet||(picked#>'{claimed,claimContext}');
    else
      assert state.status='BLOCKED' and state.next_attempt_at is null,'bounded retry exhaustion must block';
    end if;
  end loop;
  -- Local-only reset to exercise a later successful read and unchanged failure boundaries.
  update billing_jobs set status='PENDING',next_attempt_at=clock_timestamp()-interval '1 second' where id=j;
  picked:=billing_manual_paid_claim(request);
  packet:=packet||(picked#>'{claimed,claimContext}')||jsonb_build_object('outcome','EXACT_INVOICE_PAID',
    'proof',jsonb_build_object('easybillDocumentId','123','easybillNumber','#NEONT900001','invoiceAmountCents',1000,
      'paidCents',1000,'expectedAmountCents',1000,'currency','EUR'));
  result:=billing_manual_paid_complete(j,picked#>>'{claimed,job,lease_token}',packet);
  assert result->>'status'='DONE','fully paid invoice finishes without another payment';
  assert not (select payload->'lastCheck' ? 'readRetryCount' from billing_jobs where id=j),'normal completion payload stays unchanged';
  for invalid in select value from jsonb_array_elements('["OUTCOME_UNKNOWN","EXECUTION_FAILED"]') loop
    update billing_jobs set status='PENDING',next_attempt_at=clock_timestamp()-interval '1 second' where id=j;
    picked:=billing_manual_paid_claim(request);
    result:=billing_manual_paid_complete(j,picked#>>'{claimed,job,lease_token}',
      (packet-'proof')||(picked#>'{claimed,claimContext}')||jsonb_build_object('outcome',invalid));
    assert result->>'status'='BLOCKED','unknown effects must remain blocked';
  end loop;
  -- A fresh observation still advances ordinary pending work immediately.
  update billing_jobs set status='PENDING',next_attempt_at=clock_timestamp()+interval '10 minutes' where id=j;
  picked:=billing_manual_paid_claim(request||jsonb_build_object('candidates',jsonb_build_array(jsonb_build_object(
    'origin','handoff','shopifyOrderId','900001','shopifyOrderName','#NEONT900001','amountCents',1000,'currency','EUR',
    'sourceRevision',jsonb_build_object('updatedAt','2026-10-20T10:00:00Z')))));
  assert picked#>>'{claimed,job,id}'=j::text,'ordinary input change keeps existing immediate recheck';
  packet:=(picked#>'{claimed,claimContext}')||jsonb_build_object('scope','MANUAL_SHOPIFY_PAID',
    'outcome','READ_RETRY_REQUIRED','reasonCode','SHOPIFY_READ_RATE_LIMIT',
    'proof',jsonb_build_object('stage','READ_SHOPIFY_TRANSACTIONS','requestMethod','GET','httpStatus',429,
      'shopifyOrderId','900001','sideEffectsStarted',false,'retryAfterSeconds',600));
  result:=billing_manual_paid_complete(j,picked#>>'{claimed,job,lease_token}',packet);
  select * into state from billing_jobs where id=j;
  -- The same intake must respect an active provider backoff even if input changes.
  picked:=billing_manual_paid_claim(request||jsonb_build_object('candidates',jsonb_build_array(jsonb_build_object(
    'origin','handoff','shopifyOrderId','900001','shopifyOrderName','#NEONT900001','amountCents',1000,'currency','EUR',
    'sourceRevision',jsonb_build_object('updatedAt','2026-10-20T10:01:00Z')))));
  assert picked->'claimed'='null'::jsonb,'changed input cannot bypass provider backoff';
  assert (select next_attempt_at=state.next_attempt_at and status='PENDING'
    and (payload#>>'{input,generation}')::integer=(state.payload#>>'{input,generation}')::integer+1
    from billing_jobs where id=j),'retain newer input and exact backoff together';
  select jsonb_build_object('case',(select to_jsonb(x) from billing_cases x where id=c),
    'documents',(select jsonb_agg(to_jsonb(x) order by id) from billing_documents x where billing_case_id=c),
    'payments',(select jsonb_agg(to_jsonb(x) order by id) from billing_payments x where billing_case_id=c),
    'jobs',(select jsonb_agg(to_jsonb(x) order by id) from billing_jobs x where billing_case_id=c and id<>j)) into after_effects;
  assert before_effects=after_effects,'payment, invoice and customer-send records must remain byte-equivalent';
  assert (select count(*) from billing_jobs where billing_case_id=c)=2,'no payment or mail jobs created';
END;
$test$;
ROLLBACK;
