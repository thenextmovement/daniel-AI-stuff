#!/usr/bin/env python3
"""Disposable PostgreSQL test; no network, credentials or production calls."""
import os,subprocess,time,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
C=f"neontrip-qc-moved-{os.getpid()}"
def run(args,**kw):
 r=subprocess.run(args,text=True,capture_output=True,**kw)
 if r.returncode: raise RuntimeError(r.stderr or r.stdout)
 return r.stdout.strip()
def sql(s): return run(['docker','exec','-i',C,'psql','-XAtq','-v','ON_ERROR_STOP=1','-U','postgres'],input=s)
try:
 run(['docker','run','-d','--pull=never','--name',C,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-alpine'])
 for _ in range(60):
  if subprocess.run(['docker','exec',C,'pg_isready','-h','127.0.0.1','-U','postgres'],capture_output=True).returncode==0: break
  time.sleep(.1)
 else: raise RuntimeError('PostgreSQL not ready')
 sql("create role anon;create role authenticated;create role service_role; create table public.workflow_audit_log(id uuid primary key,workflow_name text not null,action text not null,document_id text,status text,error_message text,created_at timestamptz default now(),metadata jsonb);")
 source=(ROOT/'supabase/migrations/20260720185649_company_brain_closed_loop_control.sql').read_text()
 sql(source[source.index('create table if not exists public.company_brain_workflow_attempts'):source.index('create index if not exists')])
 start=source.index('create or replace function public.reconcile_company_brain_workflow_attempt_from_audit()')
 end=source.index('\n$$;',start)+4
 sql(source[start:end])
 sql('create trigger seed_attempt after insert on workflow_audit_log for each row execute function reconcile_company_brain_workflow_attempt_from_audit();')
 migration=ROOT/'supabase/migrations/20261026120000_qc_moved_audit_projection.sql'
 if os.getenv('BASELINE')!='1': sql(migration.read_text())
 print(sql((ROOT/'tests/sql/qc-moved-audit.test.sql').read_text()),flush=True)
 if os.getenv('BASELINE')!='1':
  sql((ROOT/'supabase/rollbacks/20261026120000_qc_moved_audit_projection_rollback.sql').read_text())
  assert sql("select count(*) from pg_trigger where tgname='trg_qc_moved_audit_projection'")=='0'
  sql(migration.read_text())
  print(sql((ROOT/'tests/sql/qc-moved-audit.test.sql').read_text()),flush=True)
  print('PASS 11 PostgreSQL assertions plus rollback/reapply',flush=True)
  repair=(ROOT/'ops/repairs/20261026-qc-moved-audit.sql').read_text()
  metadata=re.search(r"metadata is distinct from '(.*?)'::jsonb",repair,re.S).group(1)
  aid='17df6902-c5e1-18d0-8e04-b568552b9730'
  pid='571aa0d2-9be6-418b-aab1-3928a08b7ff7'
  sql(f"insert into workflow_audit_log values('{aid}','NEONTRIP - Quote Ready QC Check v3','qc_auto_repair_v1','6adf159dd4f7aadbd2908cdb','processing',null,'2026-10-26T09:00:52.251544Z','{metadata}'::jsonb); update company_brain_workflow_attempts set id='{pid}' where source_audit_id='{aid}';")
  for col in ['created_at','document_id']:
   sql(f"update workflow_audit_log set {col}=null where id='{aid}';")
   try: sql(repair)
   except RuntimeError as e: assert 'QC_HISTORICAL_BINDING_DRIFT' in str(e),str(e)
   else: raise AssertionError(f'NULL {col} accepted')
   assert sql(f"select state from company_brain_workflow_attempts where id='{pid}'")=='running'
   sql(f"update workflow_audit_log set created_at='2026-10-26T09:00:52.251544Z',document_id='6adf159dd4f7aadbd2908cdb' where id='{aid}';")
  sql(repair)
  assert sql(f"select status from workflow_audit_log where id='{aid}'")=='blocked'
  assert sql(f"select state from company_brain_workflow_attempts where id='{pid}'")=='blocked'
  before=sql(f"select to_jsonb(t) from workflow_audit_log t where id='{aid}'")
  projected=sql(f"select to_jsonb(t) from company_brain_workflow_attempts t where id='{pid}'")
  sql(repair)
  assert sql(f"select to_jsonb(t) from workflow_audit_log t where id='{aid}'")==before
  assert sql(f"select to_jsonb(t) from company_brain_workflow_attempts t where id='{pid}'")==projected
  sql(f"update workflow_audit_log set document_id='wrong-card' where id='{aid}';")
  try: sql(repair)
  except RuntimeError as e: assert 'QC_HISTORICAL_BINDING_DRIFT' in str(e)
  else: raise AssertionError('historical drift accepted')
  assert sql(f"select to_jsonb(t) from company_brain_workflow_attempts t where id='{pid}'")==projected
  print('PASS 10 historical assertions: two terminal records, duplicate no-op, wrong binding rollback',flush=True)
finally:
 subprocess.run(['docker','rm','-f',C],capture_output=True)
