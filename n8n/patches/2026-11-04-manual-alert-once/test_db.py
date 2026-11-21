#!/usr/bin/env python3
"""Isolated PostgreSQL regression: no credentials, production data or network."""
import concurrent.futures,json,subprocess,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
NAME='manual-paid-alert-once-test'
def run(args,**kw):
 r=subprocess.run(args,text=True,capture_output=True,**kw)
 if r.returncode: raise RuntimeError(r.stderr or r.stdout)
 return r.stdout.strip()
def sql(s): return run(['docker','exec','-i',NAME,'psql','-XAtq','-v','ON_ERROR_STOP=1','-U','postgres'],input=s)
def claim(key,execution,order='1'):
 return json.loads(sql("set role service_role; select claim_manual_paid_error_mail('%s','%s',array['%s']);"%(key,execution,order)))
try:
 run(['docker','run','-d','--pull=never','--name',NAME,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-alpine'])
 for _ in range(60):
  if subprocess.run(['docker','exec',NAME,'pg_isready','-h','127.0.0.1','-U','postgres'],capture_output=True).returncode==0:break
  time.sleep(.1)
 else:raise RuntimeError('Postgres not ready')
 sql('create role anon; create role authenticated; create role service_role;')
 sql((ROOT/'supabase/migrations/20261104194553_manual_paid_error_mail_once.sql').read_text())
 with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
  results=list(pool.map(lambda i:claim('manual-paid-claim:claim:502',str(1000+i),str(2000+i)),range(12)))
 assert sum(r['approved'] for r in results)==1,results
 print('PASS: 12 simultaneous different candidate orders permit exactly one mail')
 assert sql("select suppressed_count||':'||cardinality(candidate_order_ids) from manual_paid_error_mail_incidents where incident_key='manual-paid-claim:claim:502'")=='11:12'
 assert not claim('manual-paid-claim:claim:502','1000')['approved']
 assert claim('manual-paid-claim:claim:503','2000')['approved']
 print('PASS: replay denied, all candidate IDs recorded, distinct error remains visible')
 sql("update manual_paid_error_mail_incidents set first_seen_at=now()-interval '3 days' where incident_key='manual-paid-claim:claim:502'")
 assert not claim('manual-paid-claim:claim:502','3000')['approved']
 sql("update manual_paid_error_mail_incidents set last_seen_at=now()-interval '25 hours' where incident_key='manual-paid-claim:claim:502'")
 assert claim('manual-paid-claim:claim:502','4000')['approved']
 assert not claim('manual-paid-claim:claim:502','4000')['approved']
 print('PASS: continuous incident never reminds; only 24h silence permits a new incident')
 for statement in [
  "set role anon;select claim_manual_paid_error_mail('manual-paid-claim:claim:502','5','{}')",
  "set role authenticated;select * from manual_paid_error_mail_incidents",
  "set role service_role;select * from manual_paid_error_mail_incidents",
  "set role service_role;select claim_manual_paid_error_mail('other','5','{}')",
  "set role service_role;select claim_manual_paid_error_mail('manual-paid-claim:claim:502','bad','{}')",
  "set role service_role;select claim_manual_paid_error_mail('manual-paid-claim:claim:502','5',array['bad'])",
 ]:
  try:sql(statement)
  except RuntimeError:pass
  else:raise AssertionError(statement)
 print('PASS: RPC service-role only, table private, malformed scope/IDs rejected')
finally:
 subprocess.run(['docker','rm','-f',NAME],capture_output=True)
