#!/usr/bin/env python3
"""Offline regression for the two reviewed billing repairs; never connects to production."""
import os, subprocess, time, json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
NAME=f"billing-alignment-{os.getpid()}"
A="17ebf87b-f7c3-4ba3-9b14-bbf79f7b6588"
B="4e0eeb3f-7411-4751-a7ad-f68df8dd6ad7"
def run(args, **kw):
    r=subprocess.run(args,text=True,capture_output=True,**kw)
    if r.returncode: raise RuntimeError(r.stderr or r.stdout)
    return r.stdout.strip()
def sql(v):
    return run(["docker","exec","-i",NAME,"psql","-XAtq","-v","ON_ERROR_STOP=1","-U","postgres"],input=v)
def quote(v): return "'"+str(v).replace("'","''")+"'"
SEED="""
truncate billing_cases cascade;
truncate qonto_transactions; truncate processed_transactions;
insert into billing_cases(id,source_system,source_snapshot_hash,shopify_order_id,shopify_order_name,currency,subtotal_net_cents,vat_cents,total_gross_cents,tax_treatment,tax_review_status,tax_exempt,vat_id,portal_token_hash,status,paid_at,current_revision,lock_version,customer,billing_address,delivery_address,customer_email) values
('17ebf87b-f7c3-4ba3-9b14-bbf79f7b6588','TEST','a','8513317896459','#NEONT4692','EUR',97800,18582,116382,'DE_STANDARD','NOT_REQUIRED',false,null,'secret-test-a','PAYMENT_PENDING',null,0,1,'{"company":"Old A","email":"old-a@example.test"}','{"company":"Old A","street":"Old A"}','{"street":"DO NOT CHANGE A"}','old-a@example.test'),
('4e0eeb3f-7411-4751-a7ad-f68df8dd6ad7','TEST','b','8618528702731','#NEONT4796','EUR',147900,0,147900,'EU_B2B_REVERSE_CHARGE','REVIEW_REQUIRED',true,'LU34785745','secret-test-b','MANUAL_REVIEW','2026-10-23T14:11:06Z',0,2,'{"company":"Old B","email":"david@esteichen.eu"}','{"company":"Old B","street":"Old B"}','{"street":"DO NOT CHANGE B"}','david@esteichen.eu'),
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','TEST','unrelated','123','#NEONT9999','EUR',100,0,100,'DE_STANDARD','NOT_REQUIRED',false,null,'secret-other','MANUAL_REVIEW',null,0,0,'{}','{}','{}',null);
insert into billing_payments(id,billing_case_id,provider,provider_transaction_id,amount_cents,currency,booked_at,match_status,shopify_projection_status)
values ('1af5d142-949b-49c4-a2e0-3cbce2fd0b4d','4e0eeb3f-7411-4751-a7ad-f68df8dd6ad7','QONTO','01a16919-e2ff-780e-b230-1496816dc599',147900,'EUR','2026-10-23T14:11:06Z','MATCHED','DONE');
insert into qonto_transactions(raw) values
('{"id":"01a17742-cb98-7b8f-af8e-9743ed3ad972","status":"completed","side":"credit","amount":1163.82,"currency":"EUR","settled_at":"2026-10-26T08:10:28.510Z","reference":"/INV/PF-NEONT4692/11.09.2026/"}'),
('{"id":"01a16919-e2ff-780e-b230-1496816dc599","status":"completed","side":"credit","amount":1479,"currency":"EUR","settled_at":"2026-10-23T14:11:06.498Z","reference":"PF-NEONT4796"}');
"""
def call(case, extra="", proof_patch=None, hash_value=None):
    proof={"checkedAt":"2099-01-01T00:00:00Z","shopifyOrderId":"8513317896459" if case==A else "8618528702731",
           "shopifyFinancialStatus":"PENDING" if case==A else "PAID","shopifyTotalCents":116382 if case==A else 147900,
           "shopifyCancelled":False,"shopifyRefundCount":0,"easybillInvoiceSearchComplete":True,"easybillInvoiceCount":0,
           "proformaId":"3675733235" if case==A else "3714029841","proformaPaidCents":0,
           "viesValid":True,"viesVatId":"LU34785745","viesName":"ALBONDIGAS S.A R.L.","viesAddress":"22, MONTEE DU GRUND\nL-1645 LUXEMBOURG"}
    proof.update(proof_patch or {})
    proof_sql=quote(json.dumps(proof))+"::jsonb"
    if not proof_patch or "checkedAt" not in proof_patch:
        proof_sql="("+proof_sql+" || jsonb_build_object('checkedAt',now()))"
    state=quote(hash_value) if hash_value is not None else "(select encode(extensions.digest((to_jsonb(c)-'portal_token_hash'-'created_at'-'updated_at')::text,'sha256'),'hex') from billing_cases c where id="+quote(case)+")"
    return extra+"select pg_temp.repair_billing_source_alignment("+quote(case)+","+state+","+proof_sql+");"
def check(label, body):
    sql("begin;"+SEED+body+"rollback;")
    print("PASS:",label,flush=True)
def assert_sql(condition, message):
    return "do $$begin if not ("+condition+") then raise exception "+quote(message)+"; end if; end$$;"
def rejects(label, action, error):
    # A subtransaction rolls the attempted repair back on every error.
    wrapped="do $$begin begin "+action+" raise exception 'ACCEPTED_UNSAFE_INPUT'; exception when others then if position("+quote(error)+" in sqlerrm)=0 then raise; end if; end; end$$;"
    check(label,wrapped+assert_sql("(select count(*)=1 from billing_payments) and (select count(*)=0 from billing_jobs) and (select bool_and(current_revision=0) from billing_cases)","unsafe attempt changed state"))
try:
    run(["docker","run","-d","--pull=never","--name",NAME,"--network","none","--tmpfs","/var/lib/postgresql/data","-e","POSTGRES_HOST_AUTH_METHOD=trust","postgres:17-alpine"])
    for _ in range(50):
        if subprocess.run(["docker","exec",NAME,"pg_isready","-h","127.0.0.1","-U","postgres"],capture_output=True).returncode==0: break
        time.sleep(.1)
    else: raise RuntimeError("PostgreSQL startup failed")
    sql("create role anon;create role authenticated;create role service_role;create schema extensions;create extension pgcrypto with schema extensions;grant usage on schema public,extensions to service_role;create table qonto_transactions(raw jsonb);create table processed_transactions(transaction_id text primary key,neon_number text,amount numeric,shopify_marked_paid boolean,easybill_payment_created boolean,skip_reason text,processed_at timestamptz);")
    for f in sorted((ROOT/"supabase/migrations").glob("*.sql")):
        if ("billing" in f.name or "sync_vat_decision_to_shopify_before_proforma" in f.name) and "_rollback" not in f.name: sql(f.read_text())
    implementation=(ROOT/"ops/repairs/20261026-billing-source-alignment.sql").read_text()
    if os.getenv("BASELINE")=="1":
        implementation="create or replace function pg_temp.repair_billing_source_alignment(uuid,text,jsonb) returns jsonb language sql as $$select '{}'::jsonb$$;"
    # Temp functions must be installed in each psql connection.
    original_sql=sql
    def sql(v): return original_sql(implementation+"\n"+v)
    check("4692 correct recipient; one ledger payment; canonical invoice and Shopify jobs",
          call(A)+assert_sql("(select customer_email='aif-invoice@art-invest.de' and billing_address->>'company'='Art-Invest Enterprise Offices GmbH & Co. geschlossene Investment KG' and current_revision=1 and paid_at='2026-10-26T08:10:28.510Z'::timestamptz from billing_cases where id='"+A+"')","4692 source alignment missing")
          +assert_sql("(select count(*)=2 from billing_payments) and (select count(*)=1 from processed_transactions where skip_reason='billing_v2_registered' and shopify_marked_paid=false and easybill_payment_created=false) and (select count(*)=1 from billing_jobs where job_type='CREATE_INVOICE') and (select count(*)=1 from billing_jobs where job_type='PROJECT_PAYMENT_SHOPIFY') and (select count(*)=0 from billing_jobs where job_type='CREATE_PROFORMA')","4692 queue/ledger mismatch"))
    check("4796 keeps original payment; corrected billing only; one invoice; no new proforma",
          call(B)+assert_sql("(select billing_address->>'street'='22 Montée du Grund' and tax_review_status='VERIFIED' and tax_exempt and vat_cents=0 and total_gross_cents=147900 and delivery_address->>'street'='DO NOT CHANGE B' from billing_cases where id='"+B+"')","4796 correction mismatch")
          +assert_sql("(select count(*)=1 from billing_payments) and (select count(*)=1 from billing_jobs) and (select job_type='CREATE_INVOICE' from billing_jobs)","4796 duplicate payment or extra job"))
    check("repeat repair has no financial or revision side effects",
          call(A)+call(A,hash_value="stale-after-first-run")+assert_sql("(select current_revision=1 from billing_cases where id='"+A+"') and (select count(*)=2 from billing_jobs) and (select count(*)=2 from billing_payments)","replay changed effects"))
    check("preserve unrelated case, delivery, original customer fallback and old proforma",
          "create temp table unrelated_before as select to_jsonb(c) as data from billing_cases c where id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';"
          +call(A)+call(B)+assert_sql("(select data=(select to_jsonb(c) from billing_cases c where id='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') from unrelated_before) and (select customer->>'email'='old-a@example.test' and delivery_address->>'street'='DO NOT CHANGE A' from billing_cases where id='"+A+"') and not exists(select 1 from billing_case_versions where snapshot::text like '%secret-%')","unrelated state or credential copied"))
    rejects("stale case refused",call(A,hash_value="bad"),"ALIGNMENT_STALE")
    rejects("stale external reads refused",call(A,proof_patch={"checkedAt":"2026-01-01T00:00:00Z"}),"ALIGNMENT_PREFLIGHT")
    rejects("unknown invoice outcome refused",call(A,proof_patch={"easybillInvoiceSearchComplete":False}),"ALIGNMENT_PREFLIGHT")
    rejects("already existing external invoice refused",call(A,proof_patch={"easybillInvoiceCount":1}),"ALIGNMENT_PREFLIGHT")
    rejects("wrong Shopify immutable ID refused",call(A,proof_patch={"shopifyOrderId":"123"}),"ALIGNMENT_PREFLIGHT")
    rejects("invalid VIES result refused",call(B,proof_patch={"viesValid":False}),"ALIGNMENT_VAT")
    rejects("wrong VIES entity refused",call(B,proof_patch={"viesName":"UNRELATED ENTITY"}),"ALIGNMENT_VAT")
    rejects("finalized invoice lock refused",call(A,extra="update billing_cases set invoice_requested_at=now() where id='"+A+"';"),"ALIGNMENT_CASE_UNSAFE")
    rejects("financial job already processing refused",call(A,extra="insert into billing_jobs(billing_case_id,idempotency_key,job_type,status,payload) values ('"+A+"','test-processing','CREATE_INVOICE','PROCESSING','{}');"),"ALIGNMENT_JOBS_UNSAFE")

    rejects("wrong bank amount refused",call(A,extra="update qonto_transactions set raw=jsonb_set(raw,'{amount}','1') where raw->>'id'='01a17742-cb98-7b8f-af8e-9743ed3ad972';"),"ALIGNMENT_BANK_UNSAFE")
    rejects("missing existing payment cannot be marked paid",call(B,extra="delete from billing_payments;"),"ALIGNMENT_PAYMENT_UNSAFE")
    rejects("wrong VIES address refused",call(B,proof_patch={"viesAddress":"OTHER CITY"}),"ALIGNMENT_VAT")
    check("failure after payment and queue writes rolls all changes back",
      "create function pg_temp.fail_final_audit() returns trigger language plpgsql as $f$begin if new.event_type='BILLING_SOURCE_ALIGNMENT' then raise exception 'INJECTED_AUDIT_FAILURE'; end if; return new; end$f$;"
      +"create trigger reject_final_audit before insert on billing_events for each row execute function pg_temp.fail_final_audit();"
      +"do $test$begin begin "+call(A)+" raise exception 'UNEXPECTED_SUCCESS'; exception when others then if position('INJECTED_AUDIT_FAILURE' in sqlerrm)=0 then raise; end if; end; end$test$;"
      +assert_sql("(select count(*)=1 from billing_payments) and (select count(*)=0 from billing_jobs) and (select current_revision=0 and paid_at is null from billing_cases where id='"+A+"') and (select count(*)=0 from billing_case_versions) and (select count(*)=0 from processed_transactions)","partial repair escaped rollback"))

    print("PASS: offline PostgreSQL repair guards and side-effect checks",flush=True)
finally:
    subprocess.run(["docker","rm","-f",NAME],capture_output=True)
