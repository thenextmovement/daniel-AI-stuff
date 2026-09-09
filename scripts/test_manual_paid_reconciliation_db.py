#!/usr/bin/env python3
"""Real, disposable PostgreSQL contract checks; no ports, network, providers or live DB."""
import concurrent.futures
import json
import os
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
CONTAINER = f"neontrip-manual-paid-contract-{os.getpid()}"
MIGRATION = ROOT / 'supabase/migrations/20260909163454_manual_paid_reconciliation_state.sql'


def run(args, **kwargs):
    return subprocess.run(args, text=True, capture_output=True, check=True, **kwargs)


def sql(statement):
    try:
        return run(['docker', 'exec', '-i', CONTAINER, 'psql', '-XAtq', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres'], input=statement).stdout.strip()
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(exc.stderr.strip()) from exc


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def call(name, *args):
    encoded = [literal(json.dumps(a)) + '::jsonb' if isinstance(a, dict) else literal(a) for a in args]
    result = sql(f"select public.{name}({','.join(encoded)});")
    return json.loads(result) if result else None


def candidate(i, origin='handoff', **extra):
    row = dict(origin=origin, shopifyOrderId=str(i), shopifyOrderName=f'#NEONT{i}', amountCents=1000, currency='EUR')
    if origin == 'legacy_due':
        row.update(firstSeenAt='2026-01-01T00:00:00Z', nextAttemptAt='2026-01-01T00:00:00Z', lockedUntil=0)
    return row | extra


def claim(rows=(), operation='claim', execution='100'):
    return call('billing_manual_paid_claim', dict(scope='MANUAL_SHOPIFY_PAID', operation=operation,
        worker='manual-paid-test', executionId=execution, jobTypes=['RECONCILE'], leaseSeconds=120, candidates=list(rows)))


def complete(result, outcome='EXACT_INVOICE_PAID', **extra):
    selected = result['claimed']
    context = selected['claimContext']
    body = dict(scope='MANUAL_SHOPIFY_PAID', **{k: context[k] for k in ['executionId', 'inputGeneration', 'inputFingerprint', 'bindingFingerprint']}, outcome=outcome)
    if outcome == 'EXACT_INVOICE_PAID':
        body['proof'] = dict(easybillDocumentId=(selected.get('originalInvoice') or {}).get('easybill_document_id', '123456'), easybillNumber=selected['billingCase']['shopify_order_name'], invoiceAmountCents=1000, paidCents=1000, expectedAmountCents=1000, currency='EUR')
    body.update(extra)
    return call('billing_manual_paid_complete', selected['job']['id'], selected['job']['lease_token'], body)


def expect_error(fragment, callback):
    try:
        callback()
    except RuntimeError as error:
        assert fragment in str(error), str(error)
    else:
        raise AssertionError('Expected ' + fragment)


def reset():
    sql('delete from public.billing_jobs;')


def check(name, callback):
    reset()
    callback()
    assert sql('select count(*) from public.billing_payments;') == '0'
    assert sql('select count(*) from public.billing_events;') == '0'
    assert sql("select count(*) from public.billing_cases where status<>'INVOICED';") == '0'
    print('PASS', name, flush=True)


def admission():
    result = claim([candidate(8000)], 'admit')
    assert result['claimed'] is None and result['legacySelected'] is None
    assert sql('select count(*) from public.billing_jobs where lease_token is not null;') == '0'
    assert result['intake'][0]['result'] == 'ACCEPTED'
    unknown = claim([candidate(9000)], 'admit')
    assert unknown['intake'][0]['result'] == 'UNMAPPED'
    assert sql('select count(*) from public.billing_jobs;') == '1'


def duplicate():
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda i: claim([candidate(8000)], execution=str(100+i)), range(6)))
    claimed = [r for r in results if r['claimed']]
    assert len(claimed) == 1
    assert sql('select count(*) from public.billing_jobs;') == '1'
    complete(claimed[0])
    assert claim()['claimed'] is None
    assert claim([candidate(8000, 'legacy_due')])['claimed'] is None
    assert claim([candidate(8000)])['claimed'] is not None  # 2A intentionally has no freshness skip.


def parallel_cases():
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(lambda i: claim([candidate(8000+i)], execution=str(200+i)), range(6)))
    assert len({r['claimed']['job']['id'] for r in results}) == 6
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        completions = list(pool.map(complete, results))
    assert all(r['status'] == 'DONE' for r in completions)
    assert sql("select count(*) from public.billing_jobs where payload#>>'{lastCheck,outcome}'='EXACT_INVOICE_PAID';") == '6'
    assert sql('select count(*) from public.billing_jobs where next_attempt_at is not null;') == '0'


def changed_input():
    first = claim([candidate(8000)])
    claim([candidate(8000, sourceRevision={'updatedAt': '2026-09-09T10:00:00Z'})], 'admit')
    result = complete(first)
    assert result['disposition'] == 'INPUT_CHANGED_RECHECK' and result['status'] == 'PENDING'
    assert claim()['claimed']['claimContext']['inputGeneration'] == 2


def canonical_proof():
    sql("insert into public.billing_documents(billing_case_id,document_type,revision,document_number,status,easybill_document_id,payload_hash,amount_cents,currency) select id,'INVOICE',0,'#NEONT8007','FINALIZED','987654','test-proof',1000,'EUR' from public.billing_cases where shopify_order_name='#NEONT8007';")
    sql('delete from public.billing_jobs;')  # Remove only fixture-trigger jobs before measuring this contract.
    result = claim([candidate(8007)])
    proof = dict(easybillDocumentId='987654', easybillNumber='#NEONT8007', invoiceAmountCents=2000, paidCents=2000, expectedAmountCents=2000, currency='EUR')
    expect_error('MANUAL_PAID_CANONICAL_PROOF_MISMATCH', lambda: complete(result, proof=proof))
    proof.update(invoiceAmountCents=1000, paidCents=1000, expectedAmountCents=1000, easybillDocumentId='111111')
    expect_error('MANUAL_PAID_CANONICAL_PROOF_MISMATCH', lambda: complete(result, proof=proof))
    sql("update public.billing_cases set total_gross_cents=2000,subtotal_net_cents=2000 where shopify_order_name='#NEONT8007';")
    assert complete(result)['disposition'] == 'INPUT_CHANGED_RECHECK'
    sql("update public.billing_cases set total_gross_cents=1000,subtotal_net_cents=1000 where shopify_order_name='#NEONT8007';")


def lease_expiry():
    result = claim([candidate(8000)])
    sql("update public.billing_jobs set lease_expires_at=now()-interval '1 second';")
    expect_error('BILLING_JOB_LEASE_INVALID', lambda: complete(result))
    assert claim([candidate(8000)])['claimed'] is None
    assert sql('select status from public.billing_jobs;') == 'BLOCKED'
    assert claim([candidate(8000, sourceRevision={'changed': True})])['claimed'] is None


def expired_while_waiting():
    result = claim([candidate(8000)])
    sql("update public.billing_jobs set lease_expires_at=clock_timestamp()+interval '400 milliseconds';")
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        lock = pool.submit(sql, "begin; select id from public.billing_jobs for update; select pg_sleep(0.8); commit;")
        time.sleep(0.1)
        expect_error('BILLING_JOB_LEASE_INVALID', lambda: complete(result))
        lock.result()
    assert sql('select status from public.billing_jobs;') == 'PROCESSING'


def waits_and_alerts():
    result = claim([candidate(8000)])
    done = complete(result, 'EASYBILL_PROJECTION_VERIFIED')
    assert done['status'] == 'PENDING'
    assert sql("select extract(epoch from next_attempt_at-now()) between 295 and 301 from public.billing_jobs;") == 't'
    assert claim([candidate(8000)])['claimed'] is None
    sql("update public.billing_jobs set next_attempt_at=now()-interval '1 second';")
    done = complete(claim(), 'BILLING_PAYMENTS_REGISTERED')
    assert sql("select extract(epoch from next_attempt_at-now()) between 895 and 901 from public.billing_jobs;") == 't'
    sql("update public.billing_jobs set next_attempt_at=now()-interval '1 second';")
    done = complete(claim(), 'REVIEW_REQUIRED', alert={'status': 'GATE_SUPPRESSED', 'key': '8000|tx-1'})
    assert done['status'] == 'PENDING'
    assert sql("select extract(epoch from next_attempt_at-now()) between 3595 and 3601 from public.billing_jobs;") == 't'


def accepted_mail():
    result = claim([candidate(8000, legacyAlerts=[{'key': '8000|old-tx', 'markedAt': '2026-01-01T00:00:00Z'}])])
    assert result['claimed']['job']['payload']['manualPaidAlerts']['8000|old-tx']['source'] == 'LEGACY_DEDUPE_MEMORY'
    expect_error('MANUAL_PAID_ALERT_PROOF_REQUIRED', lambda: complete(result, 'REVIEW_REQUIRED', alert={'status': 'SEND_ACCEPTED', 'key': '8000|tx-1'}))
    complete(result, 'REVIEW_REQUIRED', alert={'status': 'SEND_ACCEPTED', 'key': '8000|tx-1', 'proof': {'accepted': True}})
    assert sql("select payload#>>'{manualPaidAlerts,8000|tx-1,source}' from public.billing_jobs;") == 'API_ACCEPTANCE'
    sql("update public.billing_jobs set next_attempt_at=now()-interval '1 second';")
    done = complete(claim(), 'REVIEW_REQUIRED', alert={'status': 'UNKNOWN', 'key': '8000|tx-2'})
    assert done['status'] == 'BLOCKED'
    assert sql("select payload#>'{manualPaidAlerts,8000|tx-2}' is null from public.billing_jobs;") == 't'


def generic_isolation():
    result = claim([candidate(8000)])
    assert call('billing_job_claim', 'generic-worker', '{RECONCILE}', '120') is None
    expect_error('BILLING_JOB_SCOPE_REQUIRED', lambda: call('billing_job_complete', result['claimed']['job']['id'], result['claimed']['job']['lease_token'], 'true', {}))
    sql("insert into public.billing_jobs(billing_case_id,idempotency_key,job_type,next_attempt_at) select id,'generic-test','RECONCILE',now()+interval '1 hour' from public.billing_cases where shopify_order_name='#NEONT8007';")
    generic = call('billing_job_claim', 'generic-worker', '{RECONCILE}', '120')
    assert generic['job']['idempotency_key'] == 'generic-test'  # Its existing generic semantics remain unchanged.


def fairness():
    new_legacy = claim([candidate(9000)])
    assert new_legacy['claimed'] is None and new_legacy['legacySelected']['shopifyOrderId'] == '9000'
    assert new_legacy['legacySelected']['lockedUntil'] == 0
    claim([candidate(8000)], 'admit')
    result = claim([candidate(9000, 'legacy_due')])
    assert result['claimed'] is None and result['legacySelected']['shopifyOrderId'] == '9000'
    result = claim([candidate(8000, 'legacy_due'), candidate(9000, 'legacy_due', nextAttemptAt='2099-01-01T00:00:00Z')])
    assert result['legacySelected'] is None and result['claimed']['billingCase']['shopify_order_name'] == '#NEONT8000'
    complete(result)
    result = claim([candidate(8000, 'legacy_due'), candidate(9000, 'legacy_due')])
    assert result['legacySelected']['shopifyOrderId'] == '9000' and result['claimed'] is None


def limits_and_atomicity():
    rows = [candidate(8000)] + [candidate(9000+i, 'legacy_due') for i in range(200)]
    assert len(claim(rows, 'admit')['intake']) == 201
    expect_error('MANUAL_PAID_CANDIDATE_LIMIT', lambda: claim(rows+[candidate(9999, 'legacy_due')], 'admit'))
    reset()
    expect_error('MANUAL_PAID_CURRENCY_INVALID', lambda: claim([candidate(8000), candidate(8001, 'legacy_due', currency='USD')], 'admit'))
    assert sql('select count(*) from public.billing_jobs;') == '0'
    result = claim([candidate(8000, shopifyOrderName='#NEONT9999')])
    assert result['intake'][0]['result'] == 'IDENTITY_MISMATCH' and result['legacySelected'] is None


def rollback_boundary():
    claim([candidate(8000)], 'admit')
    rollback = (ROOT / 'supabase/rollbacks/20260909163454_manual_paid_reconciliation_state_rollback.sql').read_text()
    expect_error('MANUAL_PAID_STATE_EXISTS_REQUIRES_RECONCILED_ROLLBACK', lambda: sql(rollback))
    reset()
    sql(rollback)
    assert sql("select count(*) from pg_proc where proname in ('billing_manual_paid_claim','billing_manual_paid_complete');") == '0'
    sql(MIGRATION.read_text())
    assert claim([candidate(8000)], 'admit')['claimed'] is None


def role_boundary():
    body = dict(scope='MANUAL_SHOPIFY_PAID', operation='admit', worker='test', executionId='999', jobTypes=['RECONCILE'], candidates=[candidate(8000)])
    query = 'select public.billing_manual_paid_claim(' + literal(json.dumps(body)) + '::jsonb);'
    expect_error('permission denied', lambda: sql('set role anon;' + query))
    assert json.loads(sql('set role service_role;' + query))['intake'][0]['result'] == 'ACCEPTED'


try:
    run(['docker', 'run', '-d', '--pull=never', '--name', CONTAINER, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17-alpine'])
    for _ in range(50):
        ready = subprocess.run(['docker', 'exec', CONTAINER, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres'], capture_output=True)
        if ready.returncode == 0:
            break
        time.sleep(0.1)
    else:
        raise RuntimeError('Isolated PostgreSQL did not start')
    sql('create role anon; create role authenticated; create role service_role; create schema extensions; create extension pgcrypto with schema extensions; grant usage on schema public,extensions to service_role;')
    migrations = sorted(p for p in (ROOT/'supabase/migrations').glob('*.sql') if ('billing' in p.name or 'sync_vat_decision_to_shopify_before_proforma' in p.name) and '_rollback' not in p.name)
    for path in migrations:
        sql(path.read_text())
    sql(MIGRATION.read_text())
    sql("""insert into public.billing_cases(source_system,source_snapshot_hash,shopify_order_id,shopify_order_name,currency,subtotal_net_cents,vat_cents,total_gross_cents,tax_treatment,tax_review_status,status,portal_token_hash)
      select 'ISOLATED_TEST','snapshot-'||i,'gid://shopify/Order/'||i,'#NEONT'||i,'EUR',1000,0,1000,'DE_STANDARD','NOT_REQUIRED','INVOICED','portal-'||i from generate_series(8000,8007) i;""")
    for name, callback in [('admit without lease or case creation', admission), ('six duplicate starts, one owner, no 2A cache', duplicate), ('six independent concurrent completions', parallel_cases), ('new input while owned', changed_input), ('canonical invoice and amount proof binding', canonical_proof), ('expired lease cannot replay', lease_expiry), ('lease expiry while waiting for the row lock', expired_while_waiting), ('5/15/60 minute normal due states', waits_and_alerts), ('legacy alert memory and Outlook API acceptance', accepted_mail), ('generic worker isolation', generic_isolation), ('fair canonical/legacy selection and closed DONE', fairness), ('bounded complete admission and atomic rejection', limits_and_atomicity), ('service-role only RPC access', role_boundary), ('rollback refuses admitted state; empty rollback/reapply works', rollback_boundary)]:
        check(name, callback)
    print('PASS 14 isolated PostgreSQL scenarios; no payment/event/case-status side effects')
finally:
    subprocess.run(['docker', 'rm', '-f', CONTAINER], capture_output=True, text=True)
