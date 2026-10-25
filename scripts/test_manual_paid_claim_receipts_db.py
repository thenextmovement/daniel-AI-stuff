#!/usr/bin/env python3
"""Disposable offline PostgreSQL regression. No network, live DB or credentials."""
import os, subprocess, time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
CONTAINER=f"neontrip-manual-receipts-{os.getpid()}"
def run(args, **kw):
    result=subprocess.run(args,text=True,capture_output=True,**kw)
    if result.returncode: raise RuntimeError(result.stderr or result.stdout)
    return result.stdout.strip()
def sql(value):
    return run(['docker','exec','-i',CONTAINER,'psql','-XAtq','-v','ON_ERROR_STOP=1','-U','postgres'],input=value)
try:
    run(['docker','run','-d','--pull=never','--name',CONTAINER,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-alpine'])
    for _ in range(50):
        if subprocess.run(['docker','exec',CONTAINER,'pg_isready','-h','127.0.0.1','-U','postgres'],capture_output=True).returncode==0: break
        time.sleep(.1)
    else: raise RuntimeError('PostgreSQL startup failed')
    sql('create role anon; create role authenticated; create role service_role; create schema extensions; create extension pgcrypto with schema extensions; grant usage on schema public,extensions to service_role;')
    for path in sorted((ROOT/'supabase/migrations').glob('*.sql')):
        if ('billing' in path.name or 'sync_vat_decision_to_shopify_before_proforma' in path.name) and '_rollback' not in path.name:
            sql(path.read_text())
    for name in ['20260909163454_manual_paid_reconciliation_state.sql','20260909170545_manual_paid_reconciliation_reuse.sql','20261020101455_manual_paid_read_rate_limit.sql']:
        sql((ROOT/'supabase/migrations'/name).read_text())
    print('Base claim MD5:',sql("select md5(pg_get_functiondef('public.billing_manual_paid_claim(jsonb)'::regprocedure));"),flush=True)
    migration=ROOT/'supabase/migrations/20261025220000_manual_paid_claim_receipts.sql'
    if os.getenv('BASELINE')!='1': sql(migration.read_text())
    print(sql((ROOT/'tests/sql/billing-manual-paid-claim-receipts.test.sql').read_text()),flush=True)
    if os.getenv('BASELINE')!='1':
        # Existing completion/backoff protections must still hold.
        print(sql((ROOT/'tests/sql/billing-manual-paid-read-rate-limit.test.sql').read_text()),flush=True)
        sql('''select billing_manual_paid_claim('{"scope":"MANUAL_SHOPIFY_PAID","operation":"claim","worker":"isolated-test","executionId":"999","jobTypes":["RECONCILE"],"candidates":[]}');''')
        before=sql("select jsonb_agg(to_jsonb(r) order by id) from billing_manual_paid_claim_receipts r;")
        sql((ROOT/'supabase/rollbacks/20261025220000_manual_paid_claim_receipts_rollback.sql').read_text())
        assert sql("select md5(pg_get_functiondef('public.billing_manual_paid_claim(jsonb)'::regprocedure));")=='fc007fbabfde868c6df063777801fb68'
        assert sql("select jsonb_agg(to_jsonb(r) order by id) from billing_manual_paid_claim_receipts r;")==before
        sql(migration.read_text())
        print(sql((ROOT/'tests/sql/billing-manual-paid-claim-receipts.test.sql').read_text()),flush=True)
        print('PASS: current PostgreSQL contract, prior backoff/unknown-result protections, rollback and reapply',flush=True)
finally:
    subprocess.run(['docker','rm','-f',CONTAINER],capture_output=True)
