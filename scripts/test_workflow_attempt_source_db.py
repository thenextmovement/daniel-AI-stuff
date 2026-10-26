#!/usr/bin/env python3
"""Exercise the gap scanner and actual incident consumers without network."""
import os
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTAINER = f"neontrip-attempt-source-{os.getpid()}"
MIGRATION = ROOT / 'supabase/migrations/20261026200000_register_workflow_attempt_source.sql'
ROLLBACK = ROOT / 'supabase/rollbacks/20261026200000_register_workflow_attempt_source_rollback.sql'


def run(args, **kwargs):
    result = subprocess.run(args, text=True, capture_output=True, **kwargs)
    if result.returncode:
        raise RuntimeError(result.stderr or result.stdout)
    return result.stdout.strip()


def sql(query):
    return run(['docker', 'exec', '-i', CONTAINER, 'psql', '-XAtq', '-v',
                'ON_ERROR_STOP=1', '-U', 'postgres'], input=query)


def table(source, name):
    start = source.index(f'create table if not exists public.{name} (')
    return source[start:source.index('\n);', start) + 3]


def function(source, name):
    start = source.index(f'create or replace function public.{name}(')
    return source[start:source.index('\n$$;', start) + 4]


try:
    run(['docker', 'run', '-d', '--pull=never', '--name', CONTAINER, '--network',
         'none', '--memory', '256m', '--cpus', '1', '--pids-limit', '100',
         '--tmpfs', '/var/lib/postgresql/data', '-e',
         'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17-alpine'])
    for _ in range(60):
        if subprocess.run(['docker', 'exec', CONTAINER, 'pg_isready', '-h',
                           '127.0.0.1', '-U', 'postgres'], capture_output=True).returncode == 0:
            break
        time.sleep(.1)
    else:
        raise RuntimeError('PostgreSQL not ready')

    foundation = (ROOT / 'supabase/migrations/20260715193000_create_company_brain_foundation.sql').read_text()
    incidents = (ROOT / 'supabase/migrations/20260717073542_company_brain_operational_intelligence.sql').read_text()
    attempts = (ROOT / 'supabase/migrations/20260720185649_company_brain_closed_loop_control.sql').read_text()
    protection = (ROOT / 'supabase/migrations/20260720165256_reconcile_legacy_company_brain_workflow_incidents.sql').read_text()
    sql('create table company_entity_registry(id uuid primary key);'
        'create table workflow_audit_log(id uuid primary key,created_at timestamptz,status text,action text,document_id text,metadata jsonb);')
    sql(table(foundation, 'company_source_registry'))
    for name in ('company_brain_playbooks', 'company_brain_operational_incidents', 'company_brain_incident_events'):
        sql(table(incidents, name))
    sql(table(attempts, 'company_brain_workflow_attempts'))
    sql(function(foundation, 'touch_company_brain_updated_at'))
    for name in ('upsert_company_brain_incident', 'guard_company_brain_incident_event_immutable', 'transition_company_brain_incident'):
        sql(function(incidents, name))
    sql(function(attempts, 'scan_company_brain_workflow_attempt_gaps'))
    sql(function(protection, 'preserve_company_brain_specific_workflow_cause'))
    sql('''create table test_preview_delivery_queue(
             id uuid default gen_random_uuid(), idempotency_key text,
             metadata jsonb default '{}', status text, n8n_execution_id text,
             request_id text, trello_card_id text, last_error_code text,
             last_error_message text, attempts integer default 1,
             max_attempts integer default 3, created_at timestamptz default now(),
             updated_at timestamptz default now());''')
    sql(function(attempts, 'reconcile_company_brain_workflow_attempt_from_queue'))
    sql('''create trigger actual_queue_reconciler after insert or update on test_preview_delivery_queue
             for each row execute function reconcile_company_brain_workflow_attempt_from_queue();''')
    sql('''create trigger preserve_cause before update on company_brain_operational_incidents
             for each row execute function preserve_company_brain_specific_workflow_cause();
           create trigger immutable_events before update or delete on company_brain_incident_events
             for each row execute function guard_company_brain_incident_event_immutable();
           insert into company_brain_playbooks(playbook_key,version,title,category,owner_team,purpose,created_by)
             values('workflow_hard_error',1,'Test','automation','engineering','Test','test');''')
    for name in ('company_source_registry', 'company_brain_workflow_attempts', 'company_brain_operational_incidents'):
        sql(f'create trigger touch_updated before update on {name} for each row execute function touch_company_brain_updated_at();')

    if os.getenv('BASELINE') != '1':
        sql(MIGRATION.read_text())
        assert sql("select md5(prosrc) from pg_proc where oid='scan_company_brain_workflow_attempt_gaps()'::regprocedure") == '90257d3d984f5351c8bb80e6efae0d4a'
    print(sql((ROOT / 'tests/sql/workflow-attempt-source.test.sql').read_text()), flush=True)

    if os.getenv('BASELINE') != '1':
        before = sql('select row_to_json(r) from company_source_registry r where source_key=\'workflow_attempt\'')
        sql(MIGRATION.read_text())
        assert sql('select row_to_json(r) from company_source_registry r where source_key=\'workflow_attempt\'') == before
        try:
            sql(ROLLBACK.read_text())
        except RuntimeError as error:
            assert 'violates foreign key constraint' in str(error), str(error)
        else:
            raise AssertionError('Rollback discarded a referenced source')
        assert sql("select count(*) from company_brain_operational_incidents where incident_type='workflow_attempt_gap'") == '3'
        assert sql("select md5(prosrc) from pg_proc where oid='scan_company_brain_workflow_attempt_gaps()'::regprocedure") == '90257d3d984f5351c8bb80e6efae0d4a'
        print('PASS duplicate apply is unchanged; referenced rollback refuses without data loss', flush=True)

        sql('truncate company_brain_operational_incidents cascade; truncate company_brain_workflow_attempts;')
        sql(ROLLBACK.read_text())
        assert sql("select count(*) from company_source_registry where source_key='workflow_attempt'") == '0'
        assert sql("select md5(prosrc) from pg_proc where oid='scan_company_brain_workflow_attempt_gaps()'::regprocedure") == '586275f42f145687dc0d7df33c0736ee'
        sql(MIGRATION.read_text())
        print(sql((ROOT / 'tests/sql/workflow-attempt-source.test.sql').read_text()), flush=True)
        sql('truncate company_brain_operational_incidents cascade; truncate company_brain_workflow_attempts;')
        sql(ROLLBACK.read_text())
        sql("insert into company_source_registry(source_key,display_name,source_kind,authority,owner_team,description,active,metadata) values('workflow_attempt','Existing owner choice','projection','projection','operations','Existing',false,'{\"owner_setting\":true}');")
        existing = sql("select row_to_json(r) from company_source_registry r where source_key='workflow_attempt'")
        sql(MIGRATION.read_text())
        sql(ROLLBACK.read_text())
        assert sql("select row_to_json(r) from company_source_registry r where source_key='workflow_attempt'") == existing
        print('PASS unused rollback/reapply and pre-existing source settings are preserved', flush=True)
        sql("create or replace function scan_company_brain_workflow_attempt_gaps() returns table(stale_count integer) language plpgsql security definer set search_path=public as $$begin stale_count:=0;return next;end$$;")
        drift = sql("select md5(prosrc) from pg_proc where oid='scan_company_brain_workflow_attempt_gaps()'::regprocedure")
        for path in (MIGRATION, ROLLBACK):
            try:
                sql(path.read_text())
            except RuntimeError as error:
                assert 'workflow_attempt_scanner_definition_changed' in str(error), str(error)
            else:
                raise AssertionError('Unreviewed scanner drift was overwritten')
            assert sql("select md5(prosrc) from pg_proc where oid='scan_company_brain_workflow_attempt_gaps()'::regprocedure") == drift
            assert sql("select row_to_json(r) from company_source_registry r where source_key='workflow_attempt'") == existing
        print('PASS migration and rollback refuse unknown function drift atomically', flush=True)
        sql(function(attempts, 'scan_company_brain_workflow_attempt_gaps'))
    print(sql("select proname||':'||md5(prosrc) from pg_proc where proname in ('scan_company_brain_workflow_attempt_gaps','upsert_company_brain_incident','preserve_company_brain_specific_workflow_cause') order by proname"), flush=True)
finally:
    subprocess.run(['docker', 'rm', '-f', CONTAINER], capture_output=True)
