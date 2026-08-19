begin;

do $$
declare
  v_id uuid;
  v_change uuid;
  v_count integer;
  v_case public.billing_cases;
begin
  perform public.billing_case_ingest(
    jsonb_build_object(
      'source_system','test','shopify_order_id','gid://shopify/Order/5012','shopify_order_name','#NEONT5012',
      'source_offer_id','offer-1','source_acceptance_id','accept-1',
      'customer',jsonb_build_object('email','kunde@example.com','company','Muster GmbH'),'customer_email','kunde@example.com',
      'billing_address',jsonb_build_object('company','Muster GmbH','street','Altweg 1','zip','1010','city','Wien','country','AT'),
      'delivery_address',jsonb_build_object('street','Altweg 1','zip','1010','city','Wien','country','AT'),
      'line_items',jsonb_build_array(jsonb_build_object('title','Test','quantity',1,'unitPriceNet',10)),
      'totals',jsonb_build_object('subtotalNet',10,'vatAmount',0,'totalGross',10,'currency','EUR','originalVatRate',19),
      'currency','EUR','subtotal_net_cents',1000,'vat_cents',0,'total_gross_cents',1000,
      'payment_method','VORKASSE','payment_terms_days',null,'tax_treatment','EU_B2B_REVERSE_CHARGE',
      'tax_review_status','REVIEW_REQUIRED','tax_exempt',true,'vat_id','ATU12345678',
      'vat_validation',jsonb_build_object('checked',true,'valid',true,'identityComparison','MISMATCH','name','Register GmbH'),
      'status','MANUAL_REVIEW'
    ),
    jsonb_build_object('test',true),'hash-5012','event-5012','portal-hash-5012'
  );
  select id into v_id from public.billing_cases where shopify_order_name='#NEONT5012';
  select count(*) into v_count from public.billing_jobs where billing_case_id=v_id;
  if v_count<>2 then raise exception 'expected initial proforma and VAT jobs, got %',v_count; end if;

  perform public.billing_case_apply_action(v_id,'CONFIRM_VAT',jsonb_build_object('taxDecision','NET','note','checked'),'ops@example.com','ops-confirm-5012');
  select * into v_case from public.billing_cases where id=v_id;
  if v_case.tax_review_status<>'VERIFIED' or v_case.current_revision<>1 or v_case.total_gross_cents<>1000 then
    raise exception 'VAT confirmation failed';
  end if;

  select (public.billing_portal_submit_change(
    'portal-hash-5012','portal-change-5012',
    jsonb_build_object('billingAddress',jsonb_build_object('street','Neuweg 2'),'invoiceEmail','neu@example.com'),
    'neu@example.com'
  )->>'id')::uuid into v_change;
  perform public.billing_case_apply_action(v_id,'APPLY_CHANGE_REQUEST',jsonb_build_object('changeRequestId',v_change,'note','approved'),'ops@example.com','ops-apply-change-5012');
  select * into v_case from public.billing_cases where id=v_id;
  if v_case.billing_address->>'street'<>'Neuweg 2' or v_case.customer_email<>'neu@example.com' or v_case.current_revision<>2 then
    raise exception 'change approval failed';
  end if;

  perform public.billing_payment_ingest('gid://shopify/Order/5012','QONTO','txn-5012',1000,'EUR',now(),'payment-5012','{}');
  select count(*) into v_count from public.billing_jobs where billing_case_id=v_id and job_type='CREATE_INVOICE';
  if v_count<>1 then raise exception 'full payment did not queue exactly one invoice'; end if;

  insert into public.billing_documents (billing_case_id,document_type,revision,document_number,status,easybill_document_id,payload_hash,amount_cents,currency,finalized_at)
    values (v_id,'PROFORMA',2,'PF-NEONT5012-2','FINALIZED','9001','test-payload-hash',1000,'EUR',now());
  perform public.billing_shopify_event_ingest('gid://shopify/Order/5012','shopify-cancel-5012','ORDER_CANCELLED',0,0,0,'EUR',now(),'{}');
  select count(*) into v_count from public.billing_jobs where billing_case_id=v_id and job_type='VOID_PROFORMA';
  if v_count<>1 then raise exception 'pre-invoice cancel did not queue exactly one Pro-forma void'; end if;
  select count(*) into v_count from public.billing_jobs where billing_case_id=v_id and job_type='CREATE_CANCELLATION';
  if v_count<>0 then raise exception 'pre-invoice cancel queued an accounting cancellation'; end if;
  perform public.billing_shopify_event_ingest('gid://shopify/Order/5012','shopify-cancel-5012','ORDER_CANCELLED',0,0,0,'EUR',now(),'{}');
  select count(*) into v_count from public.billing_jobs where billing_case_id=v_id and job_type='VOID_PROFORMA';
  if v_count<>1 then raise exception 'duplicate Shopify cancel created a duplicate void'; end if;
end $$;

rollback;
