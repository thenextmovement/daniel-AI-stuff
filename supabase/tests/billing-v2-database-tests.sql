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
      'project_number','PROJ-ALT-5012',
      'billing_address',jsonb_build_object('company','Muster GmbH','street','Altweg 1','zip','1010','city','Wien','country','AT','invoiceEmail','kunde@example.com','projectNumber','PROJ-ALT-5012'),
      'delivery_address',jsonb_build_object('street','Altweg 1','zip','1010','city','Wien','country','AT'),
      'line_items',jsonb_build_array(jsonb_build_object('title','Test','quantity',1,'unitPriceNet',10)),
      'totals',jsonb_build_object('subtotalNet',10,'vatAmount',0,'totalGross',10,'currency','EUR','originalVatRate',19),
      'currency','EUR','subtotal_net_cents',1000,'vat_cents',0,'total_gross_cents',1000,
      'payment_method','VORKASSE','payment_terms_days',null,'tax_treatment','EU_B2B_REVERSE_CHARGE',
      'tax_review_status','REVIEW_REQUIRED','tax_exempt',true,'vat_id','ATU12345678',
      'vat_validation',jsonb_build_object('checked',true,'valid',true,'identityComparison','MISMATCH','name','Register GmbH'),
      'status','MANUAL_REVIEW'
    ),
    jsonb_build_object('test',true,'invoiceEmail','kunde@example.com','projectNumber','PROJ-ALT-5012'),'hash-5012','event-5012','portal-hash-5012'
  );
  select id into v_id from public.billing_cases where shopify_order_name='#NEONT5012';
  select * into v_case from public.billing_cases where id=v_id;
  if v_case.customer_email<>'kunde@example.com' or v_case.project_number<>'PROJ-ALT-5012'
    or v_case.billing_address->>'invoiceEmail'<>'kunde@example.com' or v_case.billing_address->>'projectNumber'<>'PROJ-ALT-5012' then
    raise exception 'invoice destination or project number was not ingested';
  end if;
  select count(*) into v_count from public.billing_jobs where billing_case_id=v_id;
  if v_count<>2 then raise exception 'expected initial proforma and VAT jobs, got %',v_count; end if;

  perform public.billing_case_apply_action(v_id,'CONFIRM_VAT',jsonb_build_object('taxDecision','NET','note','checked'),'ops@example.com','ops-confirm-5012');
  select * into v_case from public.billing_cases where id=v_id;
  if v_case.tax_review_status<>'VERIFIED' or v_case.current_revision<>1 or v_case.total_gross_cents<>1000 then
    raise exception 'VAT confirmation failed';
  end if;

  select (public.billing_portal_submit_change(
    'portal-hash-5012','portal-change-5012',
    jsonb_build_object('billingAddress',jsonb_build_object('street','Neuweg 2'),'invoiceEmail','neu@example.com','projectNumber','PROJ-NEU-5012'),
    'neu@example.com'
  )->>'id')::uuid into v_change;
  perform public.billing_case_apply_action(v_id,'APPLY_CHANGE_REQUEST',jsonb_build_object('changeRequestId',v_change,'note','approved'),'ops@example.com','ops-apply-change-5012');
  select * into v_case from public.billing_cases where id=v_id;
  if v_case.billing_address->>'street'<>'Neuweg 2' or v_case.customer_email<>'neu@example.com'
    or v_case.project_number<>'PROJ-NEU-5012' or v_case.billing_address->>'invoiceEmail'<>'neu@example.com'
    or v_case.billing_address->>'projectNumber'<>'PROJ-NEU-5012' or v_case.current_revision<>2 then
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
  if v_count<>0 then raise exception 'pre-invoice cancel queued cancellation before invoice completion'; end if;
  select count(*) into v_count from public.billing_jobs where billing_case_id=v_id and job_type='CREATE_INVOICE';
  if v_count<>1 then raise exception 'pre-invoice cancel did not preserve exactly one invoice job'; end if;
  select * into v_case from public.billing_cases where id=v_id;
  if v_case.status<>'CANCELLATION_PENDING' then raise exception 'cancel sequence was closed before accounting documents completed'; end if;

  insert into public.billing_documents (billing_case_id,document_type,revision,document_number,status,easybill_document_id,payload_hash,amount_cents,currency,finalized_at)
    values (v_id,'INVOICE',0,'#NEONT5012','FINALIZED','invoice-5012','invoice-payload-hash',1000,'EUR',now());
  update public.billing_cases set final_invoice_at=now(),status='INVOICED' where id=v_id;
  select count(*) into v_count from public.billing_jobs where billing_case_id=v_id and job_type='CREATE_CANCELLATION';
  if v_count<>1 then raise exception 'invoice completion did not queue exactly one linked cancellation'; end if;
  select * into v_case from public.billing_cases where id=v_id;
  if v_case.status<>'CANCELLATION_PENDING' then raise exception 'invoice completion did not keep cancellation pending'; end if;

  insert into public.billing_documents (billing_case_id,document_type,revision,document_number,status,easybill_document_id,payload_hash,amount_cents,currency,finalized_at)
    values (v_id,'CANCELLATION',0,'ST-NEONT5012','FINALIZED','storno-5012','storno-payload-hash',1000,'EUR',now());
  select * into v_case from public.billing_cases where id=v_id;
  if v_case.status<>'CANCELLED' then raise exception 'case was not closed after finalized cancellation'; end if;

  perform public.billing_shopify_event_ingest('gid://shopify/Order/5012','shopify-cancel-5012','ORDER_CANCELLED',0,0,0,'EUR',now(),'{}');
  select count(*) into v_count from public.billing_jobs where billing_case_id=v_id and job_type='VOID_PROFORMA';
  if v_count<>1 then raise exception 'duplicate Shopify cancel created a duplicate void'; end if;
  select count(*) into v_count from public.billing_jobs where billing_case_id=v_id and job_type='CREATE_INVOICE';
  if v_count<>1 then raise exception 'duplicate Shopify cancel created a duplicate invoice'; end if;
  select count(*) into v_count from public.billing_jobs where billing_case_id=v_id and job_type='CREATE_CANCELLATION';
  if v_count<>1 then raise exception 'duplicate Shopify cancel created a duplicate cancellation'; end if;

  perform public.billing_case_ingest(
    jsonb_build_object(
      'source_system','test','shopify_order_id','gid://shopify/Order/5013','shopify_order_name','#NEONT5013',
      'customer',jsonb_build_object('email','kunde@example.com'),'customer_email','kunde@example.com',
      'billing_address',jsonb_build_object('country','DE'),'delivery_address',jsonb_build_object('country','DE'),
      'line_items',jsonb_build_array(jsonb_build_object('title','Test','quantity',1,'unitPriceNet',10)),
      'totals',jsonb_build_object('subtotalNet',10,'vatAmount',1.9,'totalGross',11.9,'currency','EUR'),
      'currency','EUR','subtotal_net_cents',1000,'vat_cents',190,'total_gross_cents',1190,
      'payment_method','VORKASSE','payment_terms_days',null,'tax_treatment','DE_STANDARD',
      'tax_review_status','NOT_REQUIRED','tax_exempt',false,'status','PROFORMA_PENDING'
    ),'{}','hash-5013','event-5013','portal-hash-5013'
  );
  select id into v_id from public.billing_cases where shopify_order_name='#NEONT5013';
  insert into public.billing_documents (billing_case_id,document_type,revision,document_number,status,easybill_document_id,payload_hash,amount_cents,currency,finalized_at)
    values (v_id,'INVOICE',0,'#NEONT5013','FINALIZED','invoice-5013','invoice-payload-5013',1190,'EUR',now());
  update public.billing_cases set final_invoice_at=now(),status='INVOICED' where id=v_id;
  perform public.billing_shopify_event_ingest('gid://shopify/Order/5013','shopify-cancel-5013','ORDER_CANCELLED',0,0,0,'EUR',now(),'{}');
  select count(*) into v_count from public.billing_jobs where billing_case_id=v_id and job_type='CREATE_INVOICE';
  if v_count<>0 then raise exception 'already invoiced cancel created a second invoice'; end if;
  select count(*) into v_count from public.billing_jobs where billing_case_id=v_id and job_type='CREATE_CANCELLATION';
  if v_count<>1 then raise exception 'already invoiced cancel did not queue exactly one cancellation'; end if;

  perform public.billing_case_ingest(
    jsonb_build_object(
      'source_system','test','shopify_order_id','gid://shopify/Order/5014','shopify_order_name','#NEONT5014',
      'customer',jsonb_build_object('email','kunde@example.com'),'customer_email','kunde@example.com',
      'billing_address',jsonb_build_object('country','AT'),'delivery_address',jsonb_build_object('country','AT'),
      'line_items',jsonb_build_array(jsonb_build_object('title','Test','quantity',1,'unitPriceNet',10)),
      'totals',jsonb_build_object('subtotalNet',10,'vatAmount',0,'totalGross',10,'currency','EUR'),
      'currency','EUR','subtotal_net_cents',1000,'vat_cents',0,'total_gross_cents',1000,
      'payment_method','VORKASSE','payment_terms_days',null,'tax_treatment','EU_B2B_REVERSE_CHARGE',
      'tax_review_status','REVIEW_REQUIRED','tax_exempt',true,'vat_id','ATU12345678','status','MANUAL_REVIEW'
    ),'{}','hash-5014','event-5014','portal-hash-5014'
  );
  select id into v_id from public.billing_cases where shopify_order_name='#NEONT5014';
  perform public.billing_shopify_event_ingest('gid://shopify/Order/5014','shopify-cancel-5014','ORDER_CANCELLED',0,0,0,'EUR',now(),'{}');
  select * into v_case from public.billing_cases where id=v_id;
  if v_case.status<>'SYNC_BLOCKED' then raise exception 'unresolved VAT cancel did not block'; end if;
  select count(*) into v_count from public.billing_jobs where billing_case_id=v_id and job_type='CREATE_INVOICE';
  if v_count<>0 then raise exception 'unresolved VAT cancel queued a final invoice'; end if;
  select count(*) into v_count from public.billing_incidents where billing_case_id=v_id and incident_key='cancel-tax-review:shopify-cancel-5014' and severity='URGENT';
  if v_count<>1 then raise exception 'unresolved VAT cancel did not create one urgent incident'; end if;
end $$;

rollback;
