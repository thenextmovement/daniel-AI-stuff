begin;
do $$ begin
 if to_regprocedure('public.billing_ops_request_invoice(uuid,integer,timestamp with time zone,text,text,text)') is null then
  raise exception 'Ops invoice conversion is not implemented';
 end if;
 if has_function_privilege('anon','public.billing_ops_request_invoice(uuid,integer,timestamp with time zone,text,text,text)','EXECUTE')
 or has_function_privilege('authenticated','public.billing_ops_request_invoice(uuid,integer,timestamp with time zone,text,text,text)','EXECUTE')
 or not has_function_privilege('service_role','public.billing_ops_request_invoice(uuid,integer,timestamp with time zone,text,text,text)','EXECUTE') then
  raise exception 'Unsafe invoice conversion permissions';
 end if;
end $$;
create function pg_temp.fixture(n integer) returns uuid language plpgsql as $$
declare c uuid;
begin
  insert into billing_cases(source_system,source_snapshot_hash,shopify_order_id,shopify_order_name,
    customer_email,billing_address,delivery_address,line_items,totals,currency,
    subtotal_net_cents,vat_cents,total_gross_cents,payment_method,tax_treatment,tax_review_status,
    status,portal_token_hash)
  values('test','test-'||n,n::text,'#NEONT'||n,'accounts@example.com',
    '{"company":"Testkommune","street":"Testweg 1","zip":"10115","city":"Berlin","country":"DE","invoiceEmail":"accounts@example.com"}',
    '{"street":"Testweg 1","zip":"10115","city":"Berlin","country":"DE"}',
    '[{"title":"Testschild","quantity":1,"unitPriceNet":100,"unitPriceGross":119,"lineGross":119}]',
    '{"subtotalNet":100,"vatAmount":19,"totalGross":119,"currency":"EUR"}','EUR',
    10000,1900,11900,'VORKASSE','DE_STANDARD','NOT_REQUIRED','PAYMENT_PENDING','test-token-'||n)
    returning id into c;
  insert into billing_jobs(billing_case_id,idempotency_key,job_type,status,payload)
    values(c,'initial-'||n,'CREATE_PROFORMA','DONE',
      jsonb_build_object('revision',0,'documentNumber','PF-NEONT'||n,'portalUrl','https://rechnung.neontrip.de/'||repeat('a',43)));
  insert into billing_documents(billing_case_id,document_type,revision,document_number,status,easybill_document_id,payload_hash,amount_cents,currency)
    values(c,'PROFORMA',0,'PF-NEONT'||n,'SENT','test-proforma-'||n,'test',11900,'EUR');
  return c;
end $$;

create function pg_temp.reject(sql text, expected text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if sqlerrm=expected then return; end if;
    raise exception 'Expected %, got %',expected,sqlerrm;
  end;
  raise exception 'Expected rejection: %',expected;
end $$;

create function pg_temp.request(n integer, revision integer default 0) returns jsonb language plpgsql as $$
declare c billing_cases;
begin
 select * into c from billing_cases where shopify_order_id=n::text;
 return billing_ops_request_invoice(c.id,revision,c.updated_at,'hermes-klara@neontrip','outlook:synthetic-request','invoice-test-'||n);
end $$;
do $$
declare c uuid; before_row jsonb; after_row jsonb; r jsonb; original billing_cases;
begin
 c:=pg_temp.fixture(99001);
 select * into original from billing_cases where id=c;
 select to_jsonb(b) into before_row from billing_cases b where id=c;
 perform pg_temp.reject('select pg_temp.request(99001,1)','BILLING_INVOICE_STALE');
 perform pg_temp.reject(format('select billing_ops_request_invoice(%L,0,%L,%L,%L,%L)',c,original.updated_at-interval '1 second','tester','outlook:test','test-key-1'),'BILLING_INVOICE_STALE');
 perform pg_temp.reject(format('select billing_ops_request_invoice(%L,0,%L,%L,%L,%L)',c,original.updated_at,'','outlook:test','test-key-1'),'BILLING_ACTOR_REQUIRED');
 perform pg_temp.reject(format('select billing_ops_request_invoice(%L,0,%L,%L,%L,%L)',c,original.updated_at,'tester','','test-key-1'),'BILLING_INVOICE_CUSTOMER_REQUEST_REQUIRED');
 r:=pg_temp.request(99001);
 if r->>'status'<>'INVOICE_PENDING' or r->>'duplicate'<>'false' then raise exception 'Invoice not queued'; end if;
 select to_jsonb(b) into after_row from billing_cases b where id=c;
 if (before_row-array['invoice_requested_at','status','lock_version','updated_at']) is distinct from
    (after_row-array['invoice_requested_at','status','lock_version','updated_at']) then raise exception 'Conversion changed financial/customer data'; end if;
 r:=pg_temp.request(99001);
 if r->>'duplicate'<>'true' then raise exception 'Replay not idempotent'; end if;
 if (select count(*) from billing_jobs where billing_case_id=c and job_type='CREATE_INVOICE')<>1 then raise exception 'Duplicate invoice job'; end if;
 if (select count(*) from billing_events where billing_case_id=c and event_type='OPS_CUSTOMER_INVOICE_REQUESTED'
   and actor='hermes-klara@neontrip' and payload->>'customerRequestRef'='outlook:synthetic-request')<>1 then raise exception 'Missing own actor/request audit'; end if;
 perform pg_temp.reject(format('update billing_cases set billing_address=%L where id=%L','{"city":"Hamburg"}',c),'BILLING_PORTAL_READ_ONLY');
 update billing_cases set final_invoice_at=now(),status='INVOICED' where id=c;
 r:=pg_temp.request(99001);
 if r->>'duplicate'<>'true' then raise exception 'Finalized replay not idempotent'; end if;
 c:=pg_temp.fixture(99002);
 insert into billing_change_requests(billing_case_id,idempotency_key,source,requested_changes) values(c,'pending-ops-change','OPS','{}');
 perform pg_temp.reject('select pg_temp.request(99002)','BILLING_INVOICE_CHANGES_PENDING');
 c:=pg_temp.fixture(99003); update billing_cases set tax_review_status='REVIEW_REQUIRED' where id=c;
 perform pg_temp.reject('select pg_temp.request(99003)','BILLING_VAT_REVIEW_REQUIRED');
 c:=pg_temp.fixture(99004); update billing_cases set cancelled_at=now() where id=c;
 perform pg_temp.reject('select pg_temp.request(99004)','BILLING_INVOICE_NOT_READY');
 c:=pg_temp.fixture(99005); delete from billing_documents where billing_case_id=c;
 perform pg_temp.reject('select pg_temp.request(99005)','BILLING_INVOICE_PROFORMA_NOT_READY');
 c:=pg_temp.fixture(99006);
 insert into billing_jobs(billing_case_id,idempotency_key,job_type) values(c,'pending-ops-job','VERIFY_VAT');
 perform pg_temp.reject('select pg_temp.request(99006)','BILLING_INVOICE_JOBS_PENDING');
 c:=pg_temp.fixture(99007); update billing_cases set final_invoice_at=now() where id=c;
 perform pg_temp.reject('select pg_temp.request(99007)','BILLING_PORTAL_READ_ONLY');
end $$;
rollback;
