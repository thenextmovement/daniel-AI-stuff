#!/usr/bin/env python3
"""Disposable PostgreSQL only: no network, production credentials or writes."""
import json, os, subprocess, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
NAME=f"full-qonto-test-{os.getpid()}"
def run(args, **kw):
 r=subprocess.run(args,text=True,capture_output=True,**kw)
 if r.returncode: raise RuntimeError(r.stderr or r.stdout)
 return r.stdout.strip()
def raw(sql):return run(['docker','exec','-i',NAME,'psql','-XAtq','-v','ON_ERROR_STOP=1','-U','postgres'],input=sql)
def q(v):return "'"+str(v).replace("'","''")+"'"
def assertion(expr):return "do $a$begin if ("+expr+") is distinct from true then raise exception 'ASSERTION_FAILED';end if;end$a$;"
CASES=[('17ebf87b-f7c3-4ba3-9b14-bbf79f7b6588','66cdafb5-f754-486c-a7de-0119a4c63c06','055b1062-e9fd-4d2a-9c97-147b3c5e1c54','01a17742-cb98-7b8f-af8e-9743ed3ad972','3717331959','3675733235','8513317896459','#NEONT4692',116382,'2026-10-26T08:10:28.510Z','PENDING'),('4e0eeb3f-7411-4751-a7ad-f68df8dd6ad7','79b533c8-5f40-4b32-8375-5e2ea836ae74','1af5d142-949b-49c4-a2e0-3cbce2fd0b4d','01a16919-e2ff-780e-b230-1496816dc599','3717333369','3714029841','8618528702731','#NEONT4796',147900,'2026-10-23T14:11:06Z','PAID')]
def seed():
 s='truncate billing_cases cascade;truncate qonto_transactions;'
 for c,j,p,b,d,pf,o,n,a,t,financial in CASES:
  stage='repair:20261026:billing-source-alignment:'+c
  payload=json.dumps(dict(reviewHold='VERIFY_EXTERNAL_PAYMENT_HISTORY_BEFORE_ANY_POST',repairEventKey=stage,providerTransactionId=b,amountCents=a,customerEmailSuppressed=True))
  s+=f"insert into billing_cases(id,source_system,source_snapshot_hash,shopify_order_id,shopify_order_name,currency,subtotal_net_cents,vat_cents,total_gross_cents,tax_treatment,tax_review_status,portal_token_hash,status,paid_at,final_invoice_at) values({q(c)},'TEST','test',{q(o)},{q(n)},'EUR',{a},0,{a},'DE_STANDARD','NOT_REQUIRED',{q('test-'+c)},'INVOICED',{q(t)},now());"
  s+=f"insert into billing_payments(id,billing_case_id,provider,provider_transaction_id,amount_cents,currency,booked_at,match_status,shopify_projection_status) values({q(p)},{q(c)},'QONTO',{q(b)},{a},'EUR',{q(t)},'MATCHED',{q('PENDING' if financial=='PENDING' else 'DONE')});"
  s+=f"insert into billing_events(billing_case_id,idempotency_key,event_type,source,actor,correlation_id) values({q(c)},{q(stage)},'BILLING_SOURCE_ALIGNMENT','TEST','test','test');"
  s+=f"insert into billing_jobs(id,billing_case_id,idempotency_key,job_type,status,payload) values({q(j)},{q(c)},{q('billing:'+c+':project-payment-easybill')},'PROJECT_PAYMENT_EASYBILL','BLOCKED',{q(payload)}::jsonb);"
  s+=f"insert into billing_jobs(billing_case_id,idempotency_key,job_type,status,payload) values({q(c)},{q('billing:'+c+':invoice')},'CREATE_INVOICE','DONE',jsonb_build_object('repairEventKey',{q(stage)},'documentNumber',{q(n)},'customerEmailSuppressed',true));"
  s+=f"insert into billing_documents(billing_case_id,document_type,document_number,status,easybill_document_id,payload_hash,amount_cents,currency,finalized_at) values({q(c)},'INVOICE',{q(n)},'FINALIZED',{q(d)},'test',{a},'EUR',now());"
  bank=dict(id=b,status='completed',side='credit',amount=a/100,currency='EUR',settled_at=t,reference='PF-'+n[1:])
  s+=f"insert into qonto_transactions(raw) values({q(json.dumps(bank))}::jsonb);"
 s+="insert into billing_jobs(id,billing_case_id,idempotency_key,job_type,status,payload) values('c4ebb761-c3d9-47d0-afbe-49c4533a007d','17ebf87b-f7c3-4ba3-9b14-bbf79f7b6588','shopify-hold','PROJECT_PAYMENT_SHOPIFY','BLOCKED','{\"reviewHold\":\"VERIFY_SHOPIFY_PAID_NOTIFICATION_EFFECTS\"}');"
 return s
def call(index=0,patch=None):
 c,j,p,b,d,pf,o,n,a,t,financial=CASES[index]
 proof=dict(shopifyOrderId=o,shopifyFinancialStatus=financial,totalCents=a,shopifyCancelled=False,shopifyRefundCount=0,invoiceId=d,proformaId=pf,invoicePaidCents=0,proformaPaidCents=0,paymentHistoriesCompleteAndEmpty=True,noActiveEasybillWebhooks=True,invoicePostboxNull=True)
 proof.update(patch or {})
 return f"select pg_temp.release_full_qonto_payment({q(c)},jsonb_build_object('checkedAt',now())||{q(json.dumps(proof))}::jsonb);"
def snapshot():return "select jsonb_build_object('cases',(select jsonb_agg(to_jsonb(c) order by id) from billing_cases c),'jobs',(select jsonb_agg(to_jsonb(j) order by id) from billing_jobs j),'payments',(select jsonb_agg(to_jsonb(p) order by id) from billing_payments p),'docs',(select jsonb_agg(to_jsonb(d) order by id) from billing_documents d),'events',(select jsonb_agg(to_jsonb(e) order by id) from billing_events e));"
count=0
try:
 run(['docker','run','-d','--pull=never','--name',NAME,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-alpine'])
 for _ in range(60):
  if subprocess.run(['docker','exec',NAME,'pg_isready','-h','127.0.0.1','-U','postgres'],capture_output=True).returncode==0:break
  time.sleep(.1)
 else:raise RuntimeError('database startup')
 raw('create role anon;create role authenticated;create role service_role;create schema extensions;create extension pgcrypto with schema extensions;grant usage on schema public,extensions to service_role;create table qonto_transactions(raw jsonb);')
 for f in sorted((ROOT/'supabase/migrations').glob('*.sql')):
  if ('billing' in f.name or 'sync_vat_decision_to_shopify_before_proforma' in f.name) and '_rollback' not in f.name:raw(f.read_text())
 if os.getenv('LIVE_FUNCTIONS'):raw(Path(os.environ['LIVE_FUNCTIONS']).read_text())
 impl=(ROOT/'ops/repairs/20261026-full-qonto-payments.sql').read_text()
 if os.getenv('BASELINE')=='1':impl="create function pg_temp.release_full_qonto_payment(uuid,jsonb) returns jsonb language sql as $$select '{}'::jsonb$$;"
 def check(label,sql):
  global count
  raw('begin;'+seed()+impl+sql+'rollback;');count+=1;print('PASS',label,flush=True)
 def rejects(label,pre='',patch=None,index=0):
  action=call(index,patch)
  # Capture after deliberately corrupting the fixture: the attempted release must
  # leave that entire state intact, not merely leave the main job blocked.
  state="create temp table before_state as "+snapshot()
  wrapped="do $r$begin begin "+action+"raise exception 'UNSAFE_ACCEPTED';exception when others then if sqlerrm not like 'FULL_QONTO_%' then raise;end if;end;end$r$;"
  after="create temp table after_state as "+snapshot()
  check(label,pre+state+wrapped+after+assertion('(select * from before_state)=(select * from after_state)'))
 for i in (0,1):
  c,j,*_=CASES[i]
  preserved="create temp table untouched as select jsonb_build_object('c',(select jsonb_agg(to_jsonb(c) order by id) from billing_cases c),'p',(select jsonb_agg(to_jsonb(p) order by id) from billing_payments p),'j',(select jsonb_agg(to_jsonb(j) order by id) from billing_jobs j where id<>"+q(j)+")) as state;"
  check('admission changes exactly one easybill job '+str(i),preserved+call(i)+assertion(f"(select status='PENDING' and attempt_count=0 and payload->>'repairFullPayment'='20261026-full-qonto-no-email' from billing_jobs where id={q(j)})")+assertion("(select state from untouched)=jsonb_build_object('c',(select jsonb_agg(to_jsonb(c) order by id) from billing_cases c),'p',(select jsonb_agg(to_jsonb(p) order by id) from billing_payments p),'j',(select jsonb_agg(to_jsonb(j) order by id) from billing_jobs j where id<>"+q(j)+"))"))
  check('repeat admission no-op '+str(i),call(i)+"create temp table before_state as "+snapshot()+call(i)+"create temp table after_state as "+snapshot()+assertion('(select * from before_state)=(select * from after_state)'))
  check('real claim/complete projects existing payment without mail '+str(i),call(i)+"create temp table claimed as select billing_job_claim('offline-test',array['PROJECT_PAYMENT_EASYBILL'],180) as c;"+"select billing_job_complete((c->'job'->>'id')::uuid,c->'job'->>'lease_token',true,'{\"easybillPaymentId\":123,\"worker\":\"offline-test\"}') from claimed;"+assertion(f"(select status='DONE' and attempt_count=1 from billing_jobs where id={q(j)}) and (select easybill_projection_status='DONE' from billing_payments where billing_case_id={q(c)}) and not exists(select 1 from billing_jobs where job_type='SEND_CUSTOMER_DOCUMENT') and (select count(*)=2 from billing_payments) and (select status='BLOCKED' and attempt_count=0 from billing_jobs where id='c4ebb761-c3d9-47d0-afbe-49c4533a007d')"))
 rejects('stale external evidence',patch={'checkedAt':'2020-01-01T00:00:00Z'})
 # Transaction-start now() would wrongly accept this after the delay.
 delayed=call().replace("jsonb_build_object('checkedAt',now())","jsonb_build_object('checkedAt',now()-interval '4 minutes 59.9 seconds')")
 check('wall clock rejects evidence that expires during transaction',"select pg_sleep(0.2);do $r$begin begin "+delayed+"raise exception 'UNSAFE_ACCEPTED';exception when others then if sqlerrm not like 'FULL_QONTO_%' then raise;end if;end;end$r$;"+assertion("not exists(select 1 from billing_jobs where job_type='PROJECT_PAYMENT_EASYBILL' and status<>'BLOCKED')"))
 rejects('incomplete provider history',patch={'paymentHistoriesCompleteAndEmpty':False})
 rejects('active webhook',patch={'noActiveEasybillWebhooks':False})
 rejects('foreign Shopify ID',patch={'shopifyOrderId':'123'})
 rejects('refund',patch={'shopifyRefundCount':1})
 rejects('unknown bank amount',"update qonto_transactions set raw=raw-'amount';")
 rejects('invoice already sent',"update billing_documents set sent_at=now();")
 rejects('missing suppression',"update billing_jobs set payload=payload-'customerEmailSuppressed' where job_type='CREATE_INVOICE';")
 rejects('attempted job',"update billing_jobs set attempt_count=1 where job_type='PROJECT_PAYMENT_EASYBILL';")
 rejects('active lease',"update billing_jobs set lease_token='test' where job_type='PROJECT_PAYMENT_EASYBILL';")
 rejects('other payment projection in flight',"update billing_jobs set status='PROCESSING' where job_type='CREATE_INVOICE';")
 rejects('Shopify hold lost',"update billing_jobs set status='PENDING' where job_type='PROJECT_PAYMENT_SHOPIFY';")
 rejects('case refunded',"update billing_cases set refunded_at=now();")
 rejects('ledger wrong identity',"update billing_payments set provider_transaction_id='other-'||id;")
 # A failure inserting the audit must roll back the job release too.
 check('audit failure rolls back admission',"create function pg_temp.reject_audit() returns trigger language plpgsql as $f$begin if new.event_type='FULL_QONTO_PROJECTION_ADMITTED' then raise exception 'FULL_QONTO_INJECTED';end if;return new;end$f$;create trigger reject_audit before insert on billing_events for each row execute function pg_temp.reject_audit();create temp table before_state as "+snapshot()+"do $r$begin begin "+call()+"raise exception 'UNSAFE_ACCEPTED';exception when others then if sqlerrm<>'FULL_QONTO_INJECTED' then raise;end if;end;end$r$;create temp table after_state as "+snapshot()+assertion('(select * from before_state)=(select * from after_state)'))
 print(f'PASS: {count} PostgreSQL payment-admission and real worker checks',flush=True)
finally:subprocess.run(['docker','rm','-f',NAME],capture_output=True)
