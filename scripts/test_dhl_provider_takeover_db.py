#!/usr/bin/env python3
"""Disposable real-PostgreSQL regression: no ports, network or production data.
Run: python3 scripts/test_dhl_provider_takeover_db.py [--baseline]
"""
import concurrent.futures
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTAINER = f'neontrip-dhl-takeover-test-{os.getpid()}'
BASELINE = '--baseline' in sys.argv
CHANGE = ROOT / 'supabase/migrations/20261011110000_dhl_unified_provider_takeover.sql'
MIGRATIONS = [
    '202606050016_create_shipping_ops.sql',
    '20260605201640_create_inbound_shipping_ops.sql',
    '20260606165000_add_inbound_tracking_error_rpc.sql',
    '20260606173000_add_inbound_17track_registration.sql',
    '20260607061742_cleanup_inbound_17track_accepted_tracking_errors.sql',
    '20260607173607_add_inbound_17track_tracking_sync.sql',
    '20260616195021_fix_inbound_evaluate_status_ambiguity.sql',
    '20260617072050_tighten_inbound_clearance_status_mapping.sql',
    '20260623124500_add_shipping_17track_outbound.sql',
    '20260702162807_add_17track_daily_registration_cap.sql',
    '20261007224500_dhl_unified_tracking_ingest.sql',
]


def run(args, **kwargs):
    return subprocess.run(args, text=True, capture_output=True, check=True, **kwargs)


def sql(statement):
    try:
        return run(['docker', 'exec', '-i', CONTAINER, 'psql', '-XAtq', '-v',
                    'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres'], input=statement).stdout.strip()
    except subprocess.CalledProcessError as error:
        raise RuntimeError(error.stderr.strip()) from error


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def apply_change():
    if not BASELINE:
        sql(CHANGE.read_text())


def payload(number='0012345678'):
    return dict(carrier='dhl', trackingNumber=number,
                trelloCardId='111111111111111111111111',
                trelloBoardId='62bae9b97705e7419ed64593', trelloListId='69ff17bfab2afaaf96f7033a',
                events=[dict(eventKey='dhl-unified:' + number.zfill(64),
                             statusCode='transit', statusText='Arrived at DHL Sort Facility',
                             eventTime='2026-01-01T10:00:00Z', eventLocation='LEIPZIG, DE')],
                rawResponse=dict(provider='dhl-unified', id=number))


def ingest(p):
    return json.loads(sql('select public.inbound_record_dhl_unified_response(' + literal(json.dumps(p)) + '::jsonb);'))


def seed_shipment(p):
    return sql('insert into public.inbound_shipments(shipment_key,carrier,tracking_number,trello_card_id) values ('
               + ','.join(literal(value) for value in ['fixture:' + p['trackingNumber'], 'dhl', p['trackingNumber'], p['trelloCardId']])
               + ') returning id;')


def rpc(name, p):
    return json.loads(sql('select public.' + name + '(' + literal(json.dumps(p)) + '::jsonb);'))


def tracking_error(shipment, provider='17track'):
    p = dict(shipmentId=shipment, carrier='dhl', trackingError=dict(provider=provider, httpStatus=429))
    return json.loads(sql('select public.inbound_record_tracking_error(' + literal(json.dumps(p)) + "::jsonb, now()-interval '1 hour');"))['incident_id']


class TakeoverTests(unittest.TestCase):
    def setUp(self):
        sql('truncate public.inbound_shipments, public.shipping_shipments cascade;')

    def seed_claims(self, accepted=False):
        sql("""
          insert into public.inbound_shipments(shipment_key, carrier, tracking_number, metadata, status)
          values ('migrated', 'dhl', '1000000001', '{"tracking_provider":"dhl-unified"}', 'in_transit'),
                 ('legacy-dhl', 'dhl', '1000000002', '{}', 'in_transit'),
                 ('fedex', 'fedex', '1000000003', '{}', 'in_transit'),
                 ('fedex-marker', 'fedex', '1000000004', '{"tracking_provider":"dhl-unified"}', 'in_transit'),
                 ('terminal', 'dhl', '1000000005', '{}', 'delivered');
        """)
        if accepted:
            sql("""insert into public.inbound_tracking_registrations
              (shipment_id, provider, registration_key, carrier, tracking_number, status)
              select id, '17track', '17track:'||id::text, carrier, tracking_number, 'accepted'
              from public.inbound_shipments;""")

    def test_registration_claim_skips_only_migrated_dhl(self):
        self.seed_claims()
        numbers = sql('select tracking_number from public.inbound_claim_due_17track_registrations(50) order by tracking_number;')
        self.assertEqual(numbers.splitlines(), ['1000000002', '1000000003', '1000000004'])
        self.assertEqual(sql("select count(*) from public.inbound_tracking_registrations where tracking_number='1000000001';"), '0')
        self.assertEqual(sql('select count(*) from public.inbound_claim_due_17track_registrations(50);'), '0')

    def test_tracking_claim_skips_only_migrated_dhl(self):
        self.seed_claims(accepted=True)
        numbers = sql('select tracking_number from public.inbound_claim_due_17track_tracking_shipments(50) order by tracking_number;')
        self.assertEqual(numbers.splitlines(), ['1000000002', '1000000003', '1000000004'])
        self.assertEqual(sql("select next_check_at is null from public.inbound_shipments where shipment_key='migrated';"), 't')
        self.assertEqual(sql('select count(*) from public.inbound_claim_due_17track_tracking_shipments(50);'), '0')

    def test_success_resolves_legacy_error_and_preserves_customs_and_other_provider(self):
        p = payload()
        shipment = seed_shipment(p)
        old_error = tracking_error(shipment)
        other_error = tracking_error(shipment, 'dhl')
        p['events'][0].update(statusCode='DE', statusText='Shipment is on hold')
        ingest(p)
        self.assertEqual(sql(f"select status from public.inbound_incidents where id='{old_error}';"), 'resolved')
        self.assertEqual(sql(f"select status from public.inbound_incidents where id='{other_error}';"), 'open')
        self.assertEqual(sql("select status from public.inbound_incidents where incident_type='carrier_exception';"), 'open')
        self.assertEqual(sql('select status from public.inbound_shipments;'), 'exception')
        snapshot = sql(f"select row_to_json(i) from public.inbound_incidents i where id='{old_error}';")
        recovery = json.loads(snapshot)['metadata']
        self.assertEqual(recovery['tracking_error']['provider'], '17track')
        self.assertIsNotNone(recovery['tracking_recovered_at'])
        ingest(p)
        self.assertEqual(sql(f"select row_to_json(i) from public.inbound_incidents i where id='{old_error}';"), snapshot)
        self.assertEqual(sql('select count(*) from public.inbound_tracking_events;'), '1')
        self.assertEqual(sql('select count(*) from public.inbound_notifications;'), '0')

    def test_failed_or_invalid_dhl_response_does_not_resolve_legacy_error(self):
        p = payload()
        shipment = seed_shipment(p)
        old_error = tracking_error(shipment)
        ingest(p | dict(trackingError='dhl_http_429'))
        self.assertEqual(sql(f"select status from public.inbound_incidents where id='{old_error}';"), 'open')
        self.assertEqual(sql('select status_reason from public.inbound_shipments;'), 'tracking_api_error:dhl_http_429')
        for invalid in [p | dict(events=[]), p | dict(rawResponse=dict(provider='dhl-unified', id='9999999999'))]:
            with self.assertRaises(RuntimeError):
                ingest(invalid)
        self.assertEqual(sql(f"select status from public.inbound_incidents where id='{old_error}';"), 'open')
        self.assertEqual(sql('select count(*) from public.inbound_notifications;'), '0')

    def test_backfill_requires_later_verified_success_and_is_idempotent(self):
        # Restore the old ingest to reproduce already persisted, successfully tracked rows.
        sql((ROOT / 'supabase/migrations/20261007224500_dhl_unified_tracking_ingest.sql').read_text())
        incidents = {}
        for index, name in enumerate(['eligible', 'acknowledged', 'newer-error', 'api-error',
                                      'wrong-provider', 'wrong-id', 'no-events', 'unmigrated', 'ignored']):
            p = payload(str(2000000000 + index))
            shipment = seed_shipment(p)
            incidents[name] = tracking_error(shipment)
            ingest(p)
            if name == 'acknowledged':
                sql(f"update public.inbound_incidents set status='acknowledged' where id='{incidents[name]}';")
            elif name == 'newer-error':
                sql(f"update public.inbound_incidents set last_detected_at=now()+interval '1 hour' where id='{incidents[name]}';")
            elif name == 'api-error':
                ingest(p | dict(trackingError='dhl_http_429'))
            elif name == 'wrong-provider':
                sql(f"update public.inbound_shipments set carrier_last_response='{{\"provider\":\"17track\"}}' where id='{shipment}';")
            elif name == 'wrong-id':
                sql(f"update public.inbound_shipments set carrier_last_response=carrier_last_response||'{{\"id\":\"9999999999\"}}' where id='{shipment}';")
            elif name == 'no-events':
                sql(f"delete from public.inbound_tracking_events where shipment_id='{shipment}';")
            elif name == 'unmigrated':
                sql(f"update public.inbound_shipments set metadata=metadata-'tracking_provider' where id='{shipment}';")
            elif name == 'ignored':
                sql(f"update public.inbound_incidents set status='ignored' where id='{incidents[name]}';")
        apply_change()
        for name, incident in incidents.items():
            with self.subTest(name=name):
                expected = 'resolved' if name in ('eligible', 'acknowledged') else 'ignored' if name == 'ignored' else 'open'
                self.assertEqual(sql(f"select status from public.inbound_incidents where id='{incident}';"), expected)
        snapshot = sql('select row_to_json(i) from public.inbound_incidents i order by id;')
        apply_change()
        self.assertEqual(sql('select row_to_json(i) from public.inbound_incidents i order by id;'), snapshot)
        self.assertEqual(sql("select count(*) from public.inbound_incidents where incident_type='tracking_error';"), '9')
        self.assertEqual(sql('select count(*) from public.inbound_notifications;'), '0')

    def test_already_claimed_legacy_writes_cannot_overwrite_dhl_takeover(self):
        p = payload()
        shipment = seed_shipment(p)
        self.assertEqual(sql('select count(*) from public.inbound_claim_due_17track_registrations(50);'), '1')
        registration_before = sql('select row_to_json(r) from public.inbound_tracking_registrations r;')
        ingest(p)
        snapshot = sql('select row_to_json(s) from public.inbound_shipments s;')
        for status in ['accepted', 'failed']:
            result = rpc('inbound_record_17track_registration', dict(
                shipmentId=shipment, carrier='dhl', trackingNumber=p['trackingNumber'], status=status,
                rawResponse=dict(code=0)))
            self.assertEqual(result.get('status'), 'skipped_provider_takeover')
            self.assertEqual(sql('select row_to_json(r) from public.inbound_tracking_registrations r;'), registration_before)
        result = rpc('inbound_record_tracking_error', dict(shipmentId=shipment, carrier='dhl',
                     trackingError=dict(provider='17track', httpStatus=429), rawResponse=dict(error='quota')))
        self.assertEqual(result.get('status'), 'skipped_provider_takeover')
        # Sync responses use the real carrier and have no explicit provider marker.
        for events in [[], [dict(statusCode='DL', statusText='Delivered', eventTime='2026-01-02T10:00:00Z')]]:
            result = rpc('inbound_record_carrier_response', dict(shipmentId=shipment, carrier='dhl',
                         trackingNumber=p['trackingNumber'], events=events, rawResponse=dict(code=0, data=dict(accepted=[]))))
            self.assertEqual(result.get('status'), 'skipped_provider_takeover')
        self.assertEqual(sql('select row_to_json(s) from public.inbound_shipments s;'), snapshot)
        self.assertEqual(sql("select count(*) from public.inbound_incidents where incident_type='tracking_error';"), '0')
        self.assertEqual(sql('select count(*) from public.inbound_tracking_events;'), '1')
        # Existing explicit operator action still works on a DHL-managed shipment.
        result = rpc('inbound_record_carrier_response', dict(shipmentId=shipment, carrier='dhl',
                     trackingNumber=p['trackingNumber'], events=[dict(statusCode='OD', statusText='Out for delivery',
                     eventTime='2026-01-02T10:00:00Z')], rawResponse=dict(source='ops_manual')))
        self.assertEqual(result.get('status'), 'out_for_delivery')

    def test_legacy_writers_still_work_before_dhl_takeover_and_for_fedex(self):
        for index, carrier in enumerate(['dhl', 'fedex']):
            p = payload(str(3000000000 + index))
            shipment = seed_shipment(p)
            sql(f"update public.inbound_shipments set carrier='{carrier}' where id='{shipment}';")
            result = rpc('inbound_record_17track_registration', dict(shipmentId=shipment, carrier=carrier,
                         trackingNumber=p['trackingNumber'], status='failed', error='quota'))
            self.assertEqual(result.get('status'), 'failed')
            self.assertEqual(sql(f"select status_reason from public.inbound_shipments where id='{shipment}';"), 'tracking_api_error:17track')
            result = rpc('inbound_record_carrier_response', dict(shipmentId=shipment, carrier=carrier,
                         trackingNumber=p['trackingNumber'], events=[dict(statusCode='IT', statusText='In transit',
                         eventTime='2026-01-02T10:00:00Z')], rawResponse=dict(code=0)))
            self.assertEqual(result.get('status'), 'in_transit')

    def test_waiting_legacy_error_observes_committed_takeover(self):
        p = payload()
        shipment = seed_shipment(p)
        # The old worker starts while DHL ownership is still uncommitted.
        takeover = ('/*dhl-takeover-concurrent*/ begin; select public.inbound_record_dhl_unified_response('
                    + literal(json.dumps(p)) + "::jsonb); select pg_sleep(1) /*dhl-takeover-concurrent*/; commit;")
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(sql, takeover)
            for _ in range(100):
                if sql("select count(*) from pg_stat_activity where query like '%/*dhl-takeover-concurrent*/%' and wait_event='PgSleep';") == '1':
                    break
                time.sleep(0.01)
            else:
                self.fail('DHL fixture did not acquire the shipment lock')
            result = rpc('inbound_record_tracking_error', dict(shipmentId=shipment, carrier='dhl',
                         trackingError=dict(provider='17track', httpStatus=429), rawResponse=dict(error='quota')))
            pending.result()
        self.assertEqual(result.get('status'), 'skipped_provider_takeover')
        self.assertEqual(sql("select count(*) from public.inbound_incidents where incident_type='tracking_error';"), '0')
        self.assertEqual(sql("select carrier_last_response->>'provider' from public.inbound_shipments;"), 'dhl-unified')

    def test_original_ingest_contract_and_permissions(self):
        sql((ROOT / 'tests/fixtures/arrival-labels/dhl-unified-ingest.test.sql').read_text())
        for function in ['inbound_record_dhl_unified_response(jsonb)',
                         'inbound_claim_due_17track_registrations(integer,timestamptz)',
                         'inbound_claim_due_17track_tracking_shipments(integer,timestamptz)',
                         'inbound_record_carrier_response(jsonb,timestamptz)',
                         'inbound_record_tracking_error(jsonb,timestamptz)',
                         'inbound_record_17track_registration(jsonb,timestamptz)']:
            with self.subTest(function=function):
                self.assertEqual(sql(f"select has_function_privilege('anon','public.{function}','execute');"), 'f')
                self.assertEqual(sql(f"select has_function_privilege('authenticated','public.{function}','execute');"), 'f')
                self.assertEqual(sql(f"select has_function_privilege('service_role','public.{function}','execute');"), 't')
                self.assertEqual(sql(f"select prosecdef from pg_proc where oid='public.{function}'::regprocedure;"), 'f')


def main():
    try:
        run(['docker', 'run', '-d', '--pull=never', '--name', CONTAINER, '--network', 'none',
             '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17-alpine'])
        for _ in range(100):
            try:
                sql('select 1;')
                break
            except RuntimeError:
                time.sleep(0.1)
        sql('create role anon; create role authenticated; create role service_role;')
        for migration in MIGRATIONS:
            sql((ROOT / 'supabase/migrations' / migration).read_text())
        apply_change()
        result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(TakeoverTests))
        return 0 if result.wasSuccessful() else 1
    finally:
        run(['docker', 'rm', '-f', CONTAINER])


if __name__ == '__main__':
    raise SystemExit(main())
