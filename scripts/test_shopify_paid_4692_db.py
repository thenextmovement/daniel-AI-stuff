#!/usr/bin/env python3
"""Issue #231: isolated real PostgreSQL admission/worker tests; no network."""
import json
import os
import re
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NAME = f"shopify-paid-4692-test-{os.getpid()}"
CASE = "17ebf87b-f7c3-4ba3-9b14-bbf79f7b6588"
JOB = "c4ebb761-c3d9-47d0-afbe-49c4533a007d"
PAYMENT = "055b1062-e9fd-4d2a-9c97-147b3c5e1c54"
EASYBILL_JOB = "66cdafb5-f754-486c-a7de-0119a4c63c06"
MAIL = "89104f0c-670e-42e8-bed0-5e2b6efc29bd"
PROFORMA = "eeeee43c-23c4-4d01-9d93-1de4d980b812"
INVOICE = "b8e78575-a53a-442c-bd2a-57ecba541ca6"
QONTO = "01a17742-cb98-7b8f-af8e-9743ed3ad972"
STAGE = "repair:20261026:billing-source-alignment:" + CASE
EVENT = "repair:20261026:shopify-paid-4692:" + JOB
INCIDENT = '70d7f8ee-c565-4c69-ad52-09f355cdacd2'
FINAL_EVENT = 'repair:20261026:shopify-paid-4692-resolved:' + INCIDENT


def run(args, **kwargs):
    result = subprocess.run(args, text=True, capture_output=True, **kwargs)
    if result.returncode:
        raise RuntimeError(result.stderr or result.stdout)
    return result.stdout.strip()


def raw(sql):
    return run(["docker", "exec", "-i", NAME, "psql", "-XAtq", "-v", "ON_ERROR_STOP=1", "-U", "postgres"], input=sql)


def q(value):
    return "'" + str(value).replace("'", "''") + "'"


def assertion(expression):
    return "do $a$begin if (" + expression + ") is distinct from true then raise exception 'ASSERTION_FAILED';end if;end$a$;"


def seed():
    payload = dict(bookedAt="2026-10-26T08:10:28.51+00:00", paymentId=PAYMENT,
                   reviewHold="VERIFY_SHOPIFY_PAID_NOTIFICATION_EFFECTS", amountCents=116382,
                   skontoCents=0, repairEventKey=STAGE, settlementType="FULL", invoiceGrossCents=116382,
                   customerEmailSuppressed=True, receivedCumulativeCents=116382)
    return f"""
    truncate billing_cases cascade;
    truncate company_brain_operational_incidents cascade;
    insert into billing_cases(id,source_system,source_snapshot_hash,shopify_order_id,shopify_order_name,
      currency,subtotal_net_cents,vat_cents,total_gross_cents,tax_treatment,tax_review_status,
      portal_token_hash,status,paid_at,final_invoice_at)
    values('{CASE}','TEST','synthetic','8513317896459','#NEONT4692','EUR',97800,18582,116382,
      'DE_STANDARD','NOT_REQUIRED','synthetic-4692','INVOICED','2026-10-26T08:10:28.510Z','2026-10-26T11:02:01Z');
    insert into billing_payments(id,billing_case_id,provider,provider_transaction_id,amount_cents,currency,
      booked_at,match_status,easybill_projection_status,shopify_projection_status)
    values('{PAYMENT}','{CASE}','QONTO','{QONTO}',116382,'EUR','2026-10-26T08:10:28.510Z','MATCHED','DONE','PENDING');
    insert into billing_jobs(id,billing_case_id,idempotency_key,job_type,status,payload,created_at,updated_at,last_error)
    values('{JOB}','{CASE}','payment:{PAYMENT}:shopify','PROJECT_PAYMENT_SHOPIFY','BLOCKED',
      {q(json.dumps(payload))}::jsonb,'2026-10-26T11:01:04.877502Z','2026-10-26T11:01:04.877502Z',
      'Repair no-email hold: Shopify paid-trigger subscribers have not been proved mail-free.');
    insert into billing_jobs(id,billing_case_id,idempotency_key,job_type,status,attempt_count,payload)
    values('{EASYBILL_JOB}','{CASE}','billing:{CASE}:project-payment-easybill','PROJECT_PAYMENT_EASYBILL','DONE',1,
      jsonb_build_object('paymentId','{PAYMENT}','documentId','3717331959','amountCents',116382,'providerTransactionId','{QONTO}'));
    insert into billing_jobs(id,billing_case_id,idempotency_key,job_type,status,attempt_count,payload)
    values('517d3604-23a1-4307-890d-2ffee823f73d','{CASE}','billing:{CASE}:invoice','CREATE_INVOICE','DONE',1,
      jsonb_build_object('documentNumber','#NEONT4692','repairEventKey','{STAGE}','customerEmailSuppressed',true));
    insert into billing_jobs(id,billing_case_id,idempotency_key,job_type,status,attempt_count,payload)
    values('6899e768-60a3-4284-a28d-4950f6142a7c','{CASE}','billing:{CASE}:proforma:0','CREATE_PROFORMA','DONE',1,'{{"documentNumber":"PF-NEONT4692"}}');
    insert into billing_jobs(id,billing_case_id,idempotency_key,job_type,status,attempt_count,payload,created_at,updated_at)
    values('{MAIL}','{CASE}','send-customer-document:{PROFORMA}','SEND_CUSTOMER_DOCUMENT','DONE',1,
      jsonb_build_object('documentType','PROFORMA','billingDocumentId','{PROFORMA}','easybillDocumentId','3675733235'),
      '2026-09-11T14:35:59.880343Z','2026-09-11T14:36:53.856259Z');
    insert into billing_documents(id,billing_case_id,document_type,document_number,status,easybill_document_id,
      payload_hash,amount_cents,currency,finalized_at,sent_at)
    values('{PROFORMA}','{CASE}','PROFORMA','PF-NEONT4692','SENT','3675733235','synthetic',116382,'EUR',
      '2026-09-11T14:35:59.880343Z','2026-09-11T14:36:53.856259Z'),
      ('{INVOICE}','{CASE}','INVOICE','#NEONT4692','FINALIZED','3717331959','synthetic',116382,'EUR','2026-10-26T11:02:01Z',null);
    insert into billing_events(billing_case_id,idempotency_key,event_type,source,actor,correlation_id,payload)
    values('{CASE}','job-done:{EASYBILL_JOB}','BILLING_JOB_DONE','N8N','synthetic','{EASYBILL_JOB}',
      jsonb_build_object('projection','PROJECT_PAYMENT_EASYBILL','qontoId','{QONTO}','easybillPaymentId',3225854832));
    insert into company_brain_operational_incidents(id,fingerprint,incident_type,severity,status,title,detail,
      root_cause_code,case_key,source_key,source_ref,metadata,first_seen_at,last_seen_at,updated_at)
    values('{INCIDENT}','qonto-payment-review:{QONTO}','payment_review','warning','open','Synthetic','Synthetic',
      'shopify_rematch_unresolved','qonto:{QONTO}','n8n','qonto:{QONTO}',
      '{{"transaction_id":"{QONTO}","possible_order":"NEONT4692","amount":1163.82,"currency":"EUR"}}',
      '2026-10-26T08:10:30.922903Z','2026-10-26T08:10:30.922903Z','2026-10-26T08:10:30.922903Z'),
      ('11111111-1111-4111-8111-111111111111','unrelated-incident','payment_review','warning','open','Unrelated','Unrelated',
      'shopify_rematch_unresolved','qonto:other','n8n','qonto:other','{{}}',now(),now(),now());
    """


PROOF = dict(shopifyOrderId="8513317896459", shopifyOrderName="#NEONT4692", shopifyAppId="290803777537",
             shopifyFinancialStatus="PENDING", currency="EUR", totalCents=116382, currentTotalCents=116382,
             outstandingCents=116382, shopifyTransactionCount=0, shopifyTransactionsComplete=True,
             shopifyCanMarkAsPaid=True, shopifyCancelled=False, shopifyRefundCount=0, shopifyGiftCardCount=0,
             invoiceId="3717331959", invoiceNumber="#NEONT4692", invoiceType="INVOICE", invoiceDraft=False,
             invoiceCancelled=False, invoiceCurrency="EUR", invoiceAmountCents=116382, invoicePaidCents=116382,
             invoiceReceiptId="3225854832", invoiceReceiptAmountCents=116382, invoiceReceiptQontoId=QONTO,
             invoicePaymentCount=1, invoicePaymentHistoryComplete=True, invoicePostboxNull=True)


def call(patch=None, omit=None, checked="clock_timestamp()"):
    proof = PROOF | (patch or {})
    for key in omit or []:
        proof.pop(key, None)
    return f"select pg_temp.release_shopify_paid_4692(jsonb_build_object('checkedAt',{checked})||{q(json.dumps(proof))}::jsonb);"


def snapshot(exclude_target=False, exclude_payment=False, exclude_events=False):
    parts = []
    for key, table in [('cases', 'billing_cases'), ('jobs', 'billing_jobs'), ('payments', 'billing_payments'),
                       ('docs', 'billing_documents'), ('events', 'billing_events'),
                       ('incidents','company_brain_operational_incidents'),('incidentEvents','company_brain_incident_events')]:
        if exclude_events and key == 'events':
            continue
        where = f" where id<>'{JOB}'" if exclude_target and key == 'jobs' else ''
        if exclude_payment and key == 'payments':
            where = f" where id<>'{PAYMENT}'"
        parts += [q(key), f"(select jsonb_agg(to_jsonb(r) order by id) from {table} r{where})"]
    return "select jsonb_build_object(" + ','.join(parts) + ");"


count = 0
try:
    run(['docker', 'run', '-d', '--pull=never', '--name', NAME, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data',
         '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17-alpine'])
    for _ in range(60):
        if subprocess.run(['docker', 'exec', NAME, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], capture_output=True).returncode == 0:
            break
        time.sleep(.1)
    else:
        raise RuntimeError('database startup')
    raw('create role anon;create role authenticated;create role service_role;create schema extensions;create extension pgcrypto with schema extensions;')
    for path in sorted((ROOT / 'supabase/migrations').glob('*.sql')):
        if ('billing' in path.name or 'sync_vat_decision_to_shopify_before_proforma' in path.name) and '_rollback' not in path.name:
            raw(path.read_text())
    # Load the real table definitions, retaining constraints/FKs; only unrelated
    # domain tables/functions are left out of this disposable database.
    foundation = (ROOT/'supabase/migrations/20260715193000_create_company_brain_foundation.sql').read_text()
    incidents = (ROOT/'supabase/migrations/20260717073542_company_brain_operational_intelligence.sql').read_text()
    for name, source in [('company_source_registry',foundation),('company_entity_registry',foundation),
                         ('company_brain_playbooks',incidents),('company_brain_operational_incidents',incidents),
                         ('company_brain_incident_events',incidents)]:
        raw(re.search(r'create table if not exists public\.'+name+r' \([\s\S]*?\n\);',source).group())
    raw("insert into company_source_registry(source_key,display_name,source_kind,authority,owner_team,description) values('n8n','Synthetic','automation','operational','operations','Synthetic');")
    raw((ROOT / 'tests/fixtures/shopify-paid-4692-worker.sql').read_text())
    if os.getenv('BASELINE') == '1':
        implementation = "create function pg_temp.release_shopify_paid_4692(jsonb) returns jsonb language sql as $$select '{}'::jsonb$$;"
    else:
        implementation = (ROOT / 'ops/repairs/20261026-shopify-paid-4692.sql').read_text()
    if os.getenv('BASELINE_FINALIZER') == '1':
        implementation += "create or replace function pg_temp.finalize_shopify_paid_4692(jsonb) returns jsonb language sql as $$select '{}'::jsonb$$;"

    def check(label, sql):
        global count
        if os.getenv('BASELINE_FINALIZER') == '1' and not label.startswith('finalizer'):
            return
        raw('begin;' + seed() + implementation + sql + 'rollback;')
        count += 1
        print('PASS', label, flush=True)

    def rejects(label, before='', patch=None, omit=None, checked='clock_timestamp()'):
        attempt = call(patch, omit, checked).replace('select pg_temp.', 'perform pg_temp.')
        check(label, before + 'create temp table before_state as ' + snapshot() +
              "do $r$begin begin " + attempt + "raise exception 'UNSAFE_ACCEPTED';exception when others then "
              "if sqlerrm not like 'SHOPIFY_4692_%' then raise;end if;end;end$r$;" +
              'create temp table after_state as ' + snapshot() + assertion('(select * from before_state)=(select * from after_state)'))

    # Removing the exact job update must fail; no mocked database operations.
    check('admission updates only the existing Shopify job and records evidence',
          'create temp table untouched as ' + snapshot(True, False, True) +
          f"create temp table original_job as select to_jsonb(j)-array['status','last_error','updated_at','payload'] as unchanged,payload from billing_jobs j where id='{JOB}';" + call() +
          assertion(f"(select status='PENDING' and attempt_count=0 and next_attempt_at is null and last_error is null and lease_token is null and lease_expires_at is null and payload->>'repairShopifyPaid'='20261026-4692' and not payload?'reviewHold' and (payload->>'repairShopifyPaidExpiresAt')::timestamptz between clock_timestamp()+interval '4 minutes 59 seconds' and clock_timestamp()+interval '5 minutes' from billing_jobs where id='{JOB}')") +
          assertion(f"(select unchanged from original_job)=(select to_jsonb(j)-array['status','last_error','updated_at','payload'] from billing_jobs j where id='{JOB}')") +
          assertion(f"(select payload-array['repairShopifyPaid','repairShopifyPaidCheckedAt','repairShopifyPaidExpiresAt'] from billing_jobs where id='{JOB}')=(select payload-'reviewHold' from original_job)") +
          assertion(f"(select (payload->>'repairShopifyPaidCheckedAt')::timestamptz=(select (payload#>>'{{preflight,checkedAt}}')::timestamptz from billing_events where idempotency_key='{EVENT}') and (payload->>'repairShopifyPaidExpiresAt')::timestamptz=(payload->>'repairShopifyPaidCheckedAt')::timestamptz+interval '5 minutes' from billing_jobs where id='{JOB}')") +
          'create temp table after_untouched as ' + snapshot(True, False, True) + assertion('(select * from untouched)=(select * from after_untouched)') +
          assertion(f"(select count(*)=1 from billing_events where idempotency_key='{EVENT}' and event_type='SHOPIFY_PAID_4692_ADMITTED' and payload->>'jobId'='{JOB}')"))
    check('duplicate admission is a complete no-op', call() + 'create temp table before_state as ' + snapshot() + call() +
          'create temp table after_state as ' + snapshot() + assertion('(select * from before_state)=(select * from after_state)'))
    # Consume the actual JS completion serializer rather than hand-authoring a
    # parallel result schema; this exercises the JS/SQL identity contract.
    worker_context = dict(job=dict(id=JOB,job_type='PROJECT_PAYMENT_SHOPIFY',attempt_count=1,lease_token='synthetic',
        payload=dict(repairShopifyPaid='20261026-4692',repairShopifyPaidCheckedAt='2026-10-26T22:00:00Z',
                     repairShopifyPaidExpiresAt='2026-10-26T22:05:00Z',paymentId=PAYMENT,amountCents=116382,
                     skontoCents=0,settlementType='FULL',customerEmailSuppressed=True)),
        billingCase=dict(id=CASE,shopify_order_id='8513317896459',shopify_order_name='#NEONT4692',status='INVOICED',
                         currency='EUR',total_gross_cents=116382,paid_at='2026-10-26T08:10:28.510Z',tax_review_status='NOT_REQUIRED'),
        originalInvoice=dict(easybill_document_id='3717331959',status='FINALIZED',sent_at=None))
    worker_module=(ROOT/'workflows/billing-v2/shopify-4692-repair/shopify-repair.mjs').as_uri()
    worker_result=json.loads(run(['node','--input-type=module','-e',
        f"import {{completion}} from {json.dumps(worker_module)};console.log(JSON.stringify(completion({json.dumps(worker_context)},"+
        "{repairShopifyPaidVerified:true,shopifyTransactionId:'gid://shopify/OrderTransaction/9990004692',alreadyDone:false}).result));"]))
    completion = ("create temp table claimed as select billing_job_claim('offline-test',array['PROJECT_PAYMENT_SHOPIFY'],180) as c;"
                  f"select billing_job_complete((c->'job'->>'id')::uuid,c->'job'->>'lease_token',true,{q(json.dumps(worker_result))}::jsonb) from claimed;")
    check('real claim/complete sets the existing ledger ShopifyDONE without mail or document mutation',
          'create temp table untouched as ' + snapshot(True, True, True) +
          f"create temp table payment_before as select to_jsonb(p)-array['shopify_projection_status','updated_at'] as state from billing_payments p where id='{PAYMENT}';" + call() + completion +
          assertion(f"(select status='DONE' and attempt_count=1 and lease_token is null and lease_expires_at is null from billing_jobs where id='{JOB}') and (select shopify_projection_status='DONE' and easybill_projection_status='DONE' and match_status='MATCHED' and amount_cents=116382 from billing_payments where id='{PAYMENT}') and (select count(*)=1 from billing_payments) and (select count(*)=5 from billing_jobs)") +
          'create temp table after_untouched as ' + snapshot(True, True, True) + assertion('(select * from untouched)=(select * from after_untouched)') +
          assertion(f"(select state from payment_before)=(select to_jsonb(p)-array['shopify_projection_status','updated_at'] from billing_payments p where id='{PAYMENT}')") +
          'create temp table done_before as ' + snapshot() + call() + 'create temp table done_after as ' + snapshot() + assertion('(select * from done_before)=(select * from done_after)'))
    rejects('attempted job cannot be admitted', f"update billing_jobs set attempt_count=1 where id='{JOB}';")
    rejects('changed original hold cannot be admitted', f"update billing_jobs set payload=jsonb_set(payload,'{{reviewHold}}','\"OTHER\"') where id='{JOB}';")
    rejects('changed job payload fails exact compare-and-swap', f"update billing_jobs set payload=payload||'{{\"unreviewed\":true}}' where id='{JOB}';")
    rejects('active lease cannot be admitted', f"update billing_jobs set lease_token='synthetic-lease' where id='{JOB}';")
    rejects('changed job timestamp cannot be admitted', f"update billing_jobs set updated_at=now() where id='{JOB}';")
    rejects('job identity changed', f"update billing_jobs set idempotency_key='wrong' where id='{JOB}';")
    rejects('job already pending', f"update billing_jobs set status='PENDING' where id='{JOB}';")
    rejects('ledger no longer pending', "update billing_payments set shopify_projection_status='DONE';")
    rejects('ledger easybill not confirmed', "update billing_payments set easybill_projection_status='PENDING';")
    rejects('ledger points at different Qonto payment', "update billing_payments set provider_transaction_id='foreign';")
    rejects('case refunded', "update billing_cases set refunded_at=now();")
    rejects('case order identity changed', "update billing_cases set shopify_order_id='123';")
    rejects('case amount changed', "update billing_cases set subtotal_net_cents=97801,total_gross_cents=116383;")
    rejects('invoice changed', "update billing_documents set amount_cents=116383 where document_type='INVOICE';")
    rejects('invoice sent unexpectedly', "update billing_documents set sent_at=now() where document_type='INVOICE';")
    rejects('proforma identity changed', "update billing_documents set easybill_document_id='foreign' where document_type='PROFORMA';")
    rejects('historical mail requeued', f"update billing_jobs set status='PENDING' where id='{MAIL}';")
    rejects('historical mail missing', f"delete from billing_jobs where id='{MAIL}';")
    rejects('historical mail changed', f"update billing_jobs set payload=payload||'{{\"unexpected\":true}}' where id='{MAIL}';")
    rejects('additional mail job even if blocked', f"insert into billing_jobs(billing_case_id,idempotency_key,job_type,status) values('{CASE}','new-mail','SEND_CUSTOMER_DOCUMENT','BLOCKED');")
    rejects('other case job concurrently processing', f"update billing_jobs set status='PROCESSING' where id='{EASYBILL_JOB}';")
    rejects('completed easybill receipt mismatches', "update billing_events set payload=jsonb_set(payload,'{easybillPaymentId}','123');")
    rejects('stale provider proof', checked="clock_timestamp()-interval '5 minutes 1 second'")
    rejects('null provider checkedAt', patch={'checkedAt':None})
    rejects('malformed provider checkedAt', patch={'checkedAt':'not-a-date'})
    rejects('unrecognized proof fields are not persisted', patch={'unreviewedData':'unexpected'})
    rejects('future provider proof', checked="clock_timestamp()+interval '1 minute'")
    rejects('evidence expiration uses wall clock', before='select pg_sleep(0.2);', checked="now()-interval '4 minutes 59.9 seconds'")
    for key, value in [('shopifyOrderId','123'),('shopifyOrderName','#NEONT9999'),('shopifyAppId','123'),
                       ('shopifyFinancialStatus','PAID'),('currency','USD'),('outstandingCents',100),
                       ('currentTotalCents',100),('shopifyTransactionCount',1),('shopifyTransactionsComplete',False),
                       ('shopifyCanMarkAsPaid',False),('shopifyCancelled',True),('shopifyRefundCount',1),
                       ('shopifyGiftCardCount',1),('invoiceId','123'),('invoicePaidCents',0),
                       ('invoiceReceiptId','123'),('invoiceReceiptQontoId','foreign'),('invoiceReceiptAmountCents',100),
                       ('invoicePaymentCount',2),('invoicePaymentHistoryComplete',False),('invoicePostboxNull',False)]:
        rejects('provider proof rejects ' + key, patch={key:value})
    for key in PROOF:
        rejects('provider proof requires ' + key, omit=[key])
    check('audit failure rolls back admission',
          "create function pg_temp.reject_audit() returns trigger language plpgsql as $f$begin if new.event_type='SHOPIFY_PAID_4692_ADMITTED' then raise exception 'SHOPIFY_4692_INJECTED';end if;return new;end$f$;"
          "create trigger reject_audit before insert on billing_events for each row execute function pg_temp.reject_audit();"
          'create temp table before_state as ' + snapshot() + "do $r$begin begin " + call().replace('select pg_temp.', 'perform pg_temp.') +
          "raise exception 'UNSAFE_ACCEPTED';exception when others then if sqlerrm<>'SHOPIFY_4692_INJECTED' then raise;end if;end;end$r$;"
          'create temp table after_state as ' + snapshot() + assertion('(select * from before_state)=(select * from after_state)'))
    FINAL_PROOF = dict(shopifyOrderId='8513317896459',shopifyOrderName='#NEONT4692',shopifyAppId='290803777537',
                       shopifyFinancialStatus='PAID',currency='EUR',totalCents=116382,currentTotalCents=116382,
                       outstandingCents=0,shopifyTransactionCount=1,shopifyTransactionsComplete=True,
                       shopifyCancelled=False,shopifyRefundCount=0,shopifyGiftCardCount=0,
                       shopifyTransactionId='9990004692',shopifyTransactionKind='SALE',shopifyTransactionStatus='SUCCESS',
                       shopifyTransactionGateway='manual',shopifyTransactionAmountCents=116382,shopifyTransactionCurrency='EUR')
    def final_call(patch=None,checked='clock_timestamp()',transaction_time=None):
        transaction_time = transaction_time or f"date_trunc('second',(select (payload->>'repairShopifyPaidCheckedAt')::timestamptz from billing_jobs where id='{JOB}'))"
        return f"select pg_temp.finalize_shopify_paid_4692(jsonb_build_object('checkedAt',{checked},'shopifyTransactionCreatedAt',{transaction_time})||{q(json.dumps(FINAL_PROOF|(patch or {})))}::jsonb);"
    def final_rejects(label,before='',patch=None,setup=None,checked='clock_timestamp()',transaction_time=None):
        setup = call()+completion if setup is None else setup
        check('finalizer rejects '+label,setup+before+'create temp table before_state as '+snapshot()+
              'do $r$begin begin '+final_call(patch,checked,transaction_time).replace('select pg_temp.','perform pg_temp.')+
              "raise exception 'UNSAFE_ACCEPTED';exception when others then if sqlerrm not like 'SHOPIFY_4692_%' then raise;end if;end;end$r$;"+
              'create temp table after_state as '+snapshot()+assertion('(select * from before_state)=(select * from after_state)'))
    check('finalizer resolves exactly the bound incident after real completion, including same-second provider timestamp',
          call()+completion+'create temp table before_state as '+snapshot()+final_call()+
          assertion(f"(select status='resolved' and resolved_by='ops-repair-231' and resolved_at is not null from company_brain_operational_incidents where id='{INCIDENT}')")+
          assertion(f"(select count(*)=1 from company_brain_incident_events where incident_id='{INCIDENT}' and event_type='resolved' and actor='ops-repair-231')")+
          assertion(f"(select count(*)=1 from billing_events where idempotency_key='{FINAL_EVENT}' and event_type='SHOPIFY_PAID_4692_INCIDENT_RESOLVED')")+
          'create temp table after_state as '+snapshot()+
          assertion("(select (to_jsonb(before_state)->'jsonb_build_object')-array['events','incidents','incidentEvents'] from before_state)=(select (to_jsonb(after_state)->'jsonb_build_object')-array['events','incidents','incidentEvents'] from after_state)")+
          assertion("(select status='open' from company_brain_operational_incidents where id='11111111-1111-4111-8111-111111111111')")+
          'create temp table resolved_before as '+snapshot()+final_call(checked="clock_timestamp()-interval '1 hour'")+
          'create temp table resolved_after as '+snapshot()+assertion('(select * from resolved_before)=(select * from resolved_after)'))
    final_rejects('before admission',setup='')
    final_rejects('before DONE',setup=call())
    final_rejects('ledger not DONE',"update billing_payments set shopify_projection_status='PENDING';")
    final_rejects('job result different payment',f"update billing_events set payload=jsonb_set(payload,'{{paymentId}}','\"foreign\"') where idempotency_key='job-done:{JOB}';")
    final_rejects('job result different order',f"update billing_events set payload=jsonb_set(payload,'{{shopifyOrderId}}','\"123\"') where idempotency_key='job-done:{JOB}';")
    final_rejects('job result different amount',f"update billing_events set payload=jsonb_set(payload,'{{amountCents}}','1') where idempotency_key='job-done:{JOB}';")
    final_rejects('job result missing repair marker',f"update billing_events set payload=payload-'repairShopifyPaid' where idempotency_key='job-done:{JOB}';")
    final_rejects('job result missing transaction',f"update billing_events set payload=payload-'shopifyTransactionId' where idempotency_key='job-done:{JOB}';")
    final_rejects('job result numeric order instead of exact GID',f"update billing_events set payload=jsonb_set(payload,'{{shopifyOrderId}}','\"8513317896459\"') where idempotency_key='job-done:{JOB}';")
    final_rejects('job result numeric transaction instead of exact GID',f"update billing_events set payload=jsonb_set(payload,'{{shopifyTransactionId}}','\"9990004692\"') where idempotency_key='job-done:{JOB}';")
    final_rejects('incident changed timestamp',f"update company_brain_operational_incidents set updated_at=now() where id='{INCIDENT}';")
    final_rejects('incident different root cause',f"update company_brain_operational_incidents set root_cause_code='other' where id='{INCIDENT}';")
    final_rejects('incident different Qonto binding',f"update company_brain_operational_incidents set case_key='qonto:other' where id='{INCIDENT}';")
    final_rejects('different incident identity',f"update company_brain_operational_incidents set id='22222222-2222-4222-8222-222222222222' where id='{INCIDENT}';")
    final_rejects('stale receipt read',checked="clock_timestamp()-interval '6 minutes'")
    final_rejects('future receipt read',checked="clock_timestamp()+interval '1 second'")
    final_rejects('null receipt-read time',patch={'checkedAt':None})
    final_rejects('malformed receipt-read time',patch={'checkedAt':'invalid'})
    final_rejects('malformed receipt-created time',patch={'shopifyTransactionCreatedAt':'invalid'})
    final_rejects('missing result reuse classification',f"update billing_events set payload=payload-'reused' where idempotency_key='job-done:{JOB}';")
    final_rejects('later incident update after resolution',f"update company_brain_operational_incidents set metadata=metadata||'{{\"newEvidence\":true}}' where id='{INCIDENT}';",setup=call()+completion+final_call())
    final_rejects('changed stored result after resolution',f"update billing_events set payload=payload||'{{\"changed\":true}}' where idempotency_key='job-done:{JOB}';",setup=call()+completion+final_call())
    final_rejects('unrelated existing resolution',f"select transition_company_brain_incident('{INCIDENT}','resolved','another-operator','Different investigation completed');")
    final_rejects('receipt predates admission second',transaction_time=f"date_trunc('second',(select (payload->>'repairShopifyPaidCheckedAt')::timestamptz from billing_jobs where id='{JOB}'))-interval '1 second'")
    final_rejects('future receipt',transaction_time="clock_timestamp()+interval '1 second'")
    for key,value in [('shopifyTransactionId','9990001234'),('shopifyTransactionAmountCents',1),('shopifyTransactionGateway','card'),
                      ('shopifyTransactionStatus','FAILURE'),('shopifyTransactionKind','AUTHORIZATION'),('shopifyFinancialStatus','PENDING'),
                      ('shopifyTransactionCount',2),('shopifyTransactionsComplete',False),('shopifyAppId','123')]:
        final_rejects('provider '+key,patch={key:value})
    for key in FINAL_PROOF:
        final_rejects('null provider '+key,patch={key:None})
    final_rejects('audit failure rolls back canonical transition',
                  "create function pg_temp.reject_resolution_audit() returns trigger language plpgsql as $f$begin if new.event_type='SHOPIFY_PAID_4692_INCIDENT_RESOLVED' then raise exception 'SHOPIFY_4692_INJECTED';end if;return new;end$f$;create trigger reject_resolution_audit before insert on billing_events for each row execute function pg_temp.reject_resolution_audit();")
    print(f'PASS: {count} PostgreSQL admission, worker and incident-finalization checks', flush=True)
finally:
    subprocess.run(['docker', 'rm', '-f', NAME], capture_output=True)
