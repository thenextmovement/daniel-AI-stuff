
\set ON_ERROR_STOP on
begin;
create function pg_temp.assert(ok boolean, label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'ASSERTION: %',label; end if; end $$;
insert into billing_cases(id,source_system,source_snapshot_hash,shopify_order_id,shopify_order_name,currency,subtotal_net_cents,vat_cents,total_gross_cents,tax_treatment,tax_review_status,tax_exempt,vat_id,status,portal_token_hash,billing_address,delivery_address)
values('00000000-0000-4000-8000-000000000001','test','hash','test1','#NEONT999991','EUR',46900,0,46900,'EU_B2B_REVERSE_CHARGE','REVIEW_REQUIRED',true,'ATU69734567','MANUAL_REVIEW','test-hash','{"company":"Kröswang GmbH","street":"Kickendorf 8","zip":"4710","city":"Grieskirchen","country":"AT"}','{"country":"AT"}');
insert into billing_jobs(id,billing_case_id,idempotency_key,job_type,status,lease_token,lease_expires_at)
values('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','test-job','VERIFY_VAT','PROCESSING','test-lease',now()+interval '3 minutes');
insert into billing_incidents(billing_case_id,incident_key,severity,title,summary) values
('00000000-0000-4000-8000-000000000001','vat-review:00000000-0000-4000-8000-000000000001','WARNING','vat','vat'),
('00000000-0000-4000-8000-000000000001','intake-conflict:test','URGENT','other','other');
do $$
declare
 j uuid:='00000000-0000-4000-8000-000000000002'; c uuid:='00000000-0000-4000-8000-000000000001';
 s jsonb; r jsonb; claim jsonb; e jsonb; token text; before_time timestamptz; i int;
begin
 select jsonb_build_object('vatId',vat_id,'billingAddress',billing_address,'deliveryAddress',delivery_address,'revision',current_revision) into s from billing_cases where id=c;
 e:='{"source":"EU_VIES","outcome":"UNAVAILABLE","checked":false,"valid":null,"normalizedVatId":"ATU69734567"}';
 before_time:=clock_timestamp();
 r:=billing_vat_attempt_complete(j,'test-lease',s,e);
 perform pg_temp.assert((r->>'retry')::boolean and not (r->>'shouldAlert')::boolean,'first failure silent retry');
 perform pg_temp.assert((r->>'nextAttemptAt')::timestamptz>=before_time+interval '5 minutes','full five-minute delay');
 perform pg_temp.assert((billing_vat_retry_claim(j,1)->'claimed')='null'::jsonb,'early retry cannot claim');
 perform pg_temp.assert(not (billing_vat_attempt_complete(j,'test-lease',s,e)->>'shouldAlert')::boolean,'duplicate completion never alerts');
 for i in 2..3 loop
  update billing_jobs set next_attempt_at=clock_timestamp()-interval '1 second' where id=j;
  claim:=billing_vat_retry_claim(j,i-1);
  token:=claim#>>'{claimed,job,lease_token}';
  perform pg_temp.assert(token is not null,'retry claimed');
  perform pg_temp.assert((billing_vat_retry_claim(j,i-1)->'claimed')='null'::jsonb,'concurrent retry not claimed');
  r:=billing_vat_attempt_complete(j,token,s,e);
  perform pg_temp.assert((r->>'attempts')::int=i,'attempt counter');
 end loop;
 perform pg_temp.assert((r->>'shouldAlert')::boolean and not (r->>'retry')::boolean,'third failure alerts once');
 perform pg_temp.assert((select status='DONE' from billing_jobs where id=j),'terminal job stops retries');
 perform pg_temp.assert((select tax_review_status='REVIEW_REQUIRED' from billing_cases where id=c),'failed checks do not verify');
 -- Successful authoritative evidence; other incident, financial values and documents untouched.
 update billing_jobs set status='PROCESSING',lease_token='success',lease_expires_at=now()+interval '3 minutes',payload='{}' where id=j;
 e:='{"source":"EU_VIES","outcome":"VERIFIED","checked":true,"valid":true,"normalizedVatId":"ATU69734567","name":"Kröswang Gesellschaft m.b.H.","address":"Kickendorf 8 AT-4710 Grieskirchen","identityComparison":"MATCH","addressComparison":"MATCH"}';
 r:=billing_vat_attempt_complete(j,'success',s,e);
 perform pg_temp.assert(r->>'outcome'='VERIFIED' and not (r->>'shouldAlert')::boolean,'valid evidence silent');
 perform pg_temp.assert((select tax_review_status='VERIFIED' and status='MANUAL_REVIEW' and total_gross_cents=46900 and current_revision=0 and paid_at is null from billing_cases where id=c),'only VAT approval; foreign hold preserved');
 perform pg_temp.assert((select status='OPEN' from billing_incidents where incident_key='intake-conflict:test'),'other incident not resolved');
 perform pg_temp.assert((select status='RESOLVED' from billing_incidents where incident_key='vat-review:'||c::text),'VAT incident resolved');
 perform pg_temp.assert((select count(*)=0 from billing_documents),'no document created');
 perform pg_temp.assert((select count(*)=1 from billing_jobs),'no customer job created');
 -- Stale snapshot cannot approve a changed case.
 update billing_cases set tax_review_status='REVIEW_REQUIRED',billing_address=billing_address||'{"street":"Other 1"}'::jsonb where id=c;
 update billing_jobs set status='PROCESSING',lease_token='stale',lease_expires_at=now()+interval '3 minutes',payload='{}' where id=j;
 r:=billing_vat_attempt_complete(j,'stale',s,e);
 perform pg_temp.assert(r->>'outcome'='STALE','stale evidence rejected');
 perform pg_temp.assert((select tax_review_status='REVIEW_REQUIRED' from billing_cases where id=c),'stale does not verify');
 -- Invalid lease may not write.
 begin
  perform billing_vat_attempt_complete(j,'wrong',s,e);
  raise exception 'wrong lease accepted';
 exception when others then
  if sqlerrm not like '%BILLING_VAT_LEASE_INVALID%' then raise; end if;
 end;
 perform pg_temp.assert(not has_function_privilege('anon','public.billing_vat_attempt_complete(uuid,text,jsonb,jsonb)','EXECUTE'),'anonymous denied');
 perform pg_temp.assert(not has_function_privilege('authenticated','public.billing_vat_retry_claim(uuid,integer)','EXECUTE'),'ordinary users denied');
end $$;
rollback;
