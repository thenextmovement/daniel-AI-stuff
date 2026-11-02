#!/usr/bin/env python3
"""Synthetic PostgreSQL checks, isolated disposable container, no network or mail."""
import concurrent.futures
import os
from pathlib import Path
import subprocess
import time
import unittest
ROOT = Path(__file__).resolve().parents[1]
CONTAINER = f'shipping-installation-test-{os.getpid()}'
OWNER='11111111-1111-4111-8111-111111111111'
def run(args, **kw): return subprocess.run(args,text=True,capture_output=True,check=True,**kw)
def sql(query):
    try: return run(['docker','exec','-i',CONTAINER,'psql','-XAtq','-v','ON_ERROR_STOP=1','-U','postgres'],input=query).stdout.strip()
    except subprocess.CalledProcessError as e: raise RuntimeError(e.stderr.strip()) from e

def reserve(tracking="array['parcel-1']", metadata='{"expected":{"sentFolderId":"sent-folder"}}'):
    return sql(f"select id from shipping_reserve_installation_documents('123','456',{tracking},'synthetic@example.test','{OWNER}','{metadata}');")
def event(shipment=None, when="now()-interval '1 hour'", source='shopify_fulfillment_event', status='IN_TRANSIT', eventid='gid://shopify/FulfillmentEvent/100', raw=None):
    shipment = shipment or sql('select id from shipping_shipments limit 1')
    raw = raw or ('{"source":"'+source+'"}')
    return sql(f"""insert into shipping_tracking_events(shipment_id,carrier,tracking_number,carrier_event_id,event_key,carrier_status_code,event_time,normalized_status,mapping_version,raw_event)
      select id,carrier,tracking_number,'{eventid}',gen_random_uuid()::text,'{status}',{when},'in_transit','fixture','{raw}' from shipping_shipments where id='{shipment}' returning id;""")
def authorize(nid,owner=OWNER):
    return sql(f"select id from shipping_authorize_installation_send('{nid}','{owner}','immutable-draft');")
class InstallationTests(unittest.TestCase):
    def setUp(self):
        sql("truncate shipping_shipments cascade; insert into shipping_audit_log(action,idempotency_key,created_at) values('installation_documents_activation','installation_documents_activation:v1',now()-interval '2 days');")
        sql("insert into shipping_shipments(shipment_key,source,shopify_order_id,shopify_fulfillment_id,carrier,tracking_number,status) values('fixture','shopify','123','456','dhl','parcel-1','in_transit');")
    def test_no_scan_and_unknown_normalization_never_qualify(self):
        self.assertEqual(reserve(),''); event(status='UNKNOWN'); self.assertEqual(reserve(),'')
    def test_label_and_shopify_status_fallback_never_qualify(self):
        event(status='LABEL_PRINTED'); event(eventid='gid://shopify/Fulfillment/456'); self.assertEqual(reserve(),'')
    def test_tracking_mismatch_and_terminal_statuses(self):
        event(); self.assertEqual(reserve("array['wrong']"),'')
        for status in ['returning','returned','closed']:
            sql(f"update shipping_shipments set status='{status}';"); self.assertEqual(reserve(),'')
    def test_old_first_scan_is_not_backfilled_even_with_new_event(self):
        event(when="now()-interval '3 days'"); event(); self.assertEqual(reserve(),'')
    def test_future_scan_is_not_confirmation(self):
        event(when="now()+interval '1 hour'"); self.assertEqual(reserve(),'')
    def test_explicit_17track_event_required(self):
        event(source='17track', status='InTransit', raw='{"source":"17track","event":{"track_info":{"latest_status":{"status":"InTransit"}}}}')
        self.assertEqual(reserve(),'')
        stamp=sql("select to_char(now()-interval '1 hour','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')")
        event(when="'"+stamp+"'::timestamptz", source='17track', status='InTransit', raw='{"source":"17track","event":{"status":"InTransit","time_iso":"'+stamp+'"}}')
        self.assertTrue(reserve())
    def test_one_fulfillment_multiple_parcels_reserves_once(self):
        event(); second=sql("insert into shipping_shipments(shipment_key,shopify_order_id,shopify_fulfillment_id,carrier,tracking_number,status) values('second','123','456','dhl','parcel-2','in_transit') returning id;")
        event(second); self.assertTrue(reserve()); self.assertEqual(reserve("array['parcel-2']"),'')
    def test_competing_reservations_have_one_winner(self):
        event()
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool: results=list(pool.map(lambda _: reserve(),range(6)))
        self.assertEqual(sum(bool(r) for r in results),1)
    def test_no_lease_reclaim_and_owner_required(self):
        event(); nid=reserve()
        self.assertEqual(authorize(nid,'22222222-2222-4222-8222-222222222222'),'')
        self.assertEqual(authorize(nid),nid); self.assertEqual(authorize(nid),'')
        sql("update shipping_notifications set claimed_at=now()-interval '1 day';")
        self.assertEqual(sql('select notification_id from shipping_claim_pending_notifications();'),'')
        self.assertEqual(reserve(),'')
    def test_review_and_expired_reservations_do_not_authorize(self):
        event(); nid=reserve(metadata='{"review_reason":"backlit_manual_not_cleared"}')
        self.assertEqual(authorize(nid),'')
        sql("update shipping_notifications set last_error=null,created_at=now()-interval '16 minutes';")
        self.assertEqual(authorize(nid),'')
    def test_terminal_after_preparation_stops_authorization(self):
        event(); nid=reserve(); sql("update shipping_shipments set status='returned';")
        self.assertEqual(authorize(nid),'')
    def test_legacy_paths_exclude_new_kind_and_keep_pickup(self):
        event(); nid=reserve()
        for fn,args in [('shipping_mark_notification_sent',f"'{nid}'"),('shipping_mark_notification_failed',f"'{nid}','fixture'")]:
            with self.assertRaisesRegex(RuntimeError,'not found'): sql(f'select id from {fn}({args});')
        pickup=sql("insert into shipping_notifications(notification_key,shipment_id,kind,recipient_type,recipient_email) select 'pickup',id,'customer_pickup_available','customer','synthetic@example.test' from shipping_shipments returning id;")
        self.assertEqual(sql('select notification_id from shipping_claim_pending_notifications();'),pickup)
        self.assertEqual(sql(f"select status from shipping_mark_notification_sent('{pickup}','pickup-message');"),'sent')
    def test_receipt_must_match_reserved_draft_and_folder(self):
        event(); nid=reserve(); authorize(nid)
        def finish(mid='immutable-draft',folder='sent-folder'):
            return sql(f'''select status from shipping_complete_installation_send('{nid}','{OWNER}','{mid}','{{"id":"{mid}","isDraft":false,"internetMessageId":"provider-receipt","parentFolderId":"{folder}"}}');''')
        self.assertEqual(finish('wrong'),''); self.assertEqual(finish(folder='wrong'),'')
        self.assertEqual(finish(),'sent'); self.assertEqual(finish(),''); self.assertEqual(reserve(),'')
    def test_invalid_or_synthetic_17track_timestamp_is_not_scan(self):
        for stamp in ['2026-99-99T00:00:00Z','2020-01-01T00:00:00Z']:
            event(source='17track',status='InTransit',raw='{"source":"17track","event":{"status":"InTransit","time_iso":"'+stamp+'"}}')
        self.assertEqual(reserve(),'')
    def test_older_scan_on_other_parcel_prevents_backfill(self):
        event(when="now()-interval '3 days'")
        second=sql("insert into shipping_shipments(shipment_key,shopify_order_id,shopify_fulfillment_id,carrier,tracking_number,status) values('second','123','456','dhl','parcel-2','in_transit') returning id;")
        event(second); self.assertEqual(reserve("array['parcel-2']"),'')
    def test_reapply_keeps_original_activation_boundary(self):
        before=sql("select created_at from shipping_audit_log where idempotency_key='installation_documents_activation:v1'")
        sql((ROOT/'supabase/migrations/20261102122441_shipping_installation_documents.sql').read_text())
        self.assertEqual(sql("select created_at from shipping_audit_log where idempotency_key='installation_documents_activation:v1'"),before)
    def test_new_scan_followed_by_delivery_still_sends_documents(self):
        event(); sql("update shipping_shipments set status='delivered';")
        nid=reserve(); self.assertTrue(nid); self.assertEqual(authorize(nid),nid)
    def test_service_role_only_functions(self):
        for role in ['anon','authenticated']:
            self.assertEqual(sql(f"select has_function_privilege('{role}','shipping_reserve_installation_documents(text,text,text[],text,uuid,jsonb)','EXECUTE');"),'f')

if __name__=='__main__':
    try:
        run(['docker','run','--pull=never','--name',CONTAINER,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','-d','postgres:17-alpine'])
        for _ in range(40):
            try: sql('select 1'); break
            except RuntimeError: time.sleep(.2)
        sql('create role anon; create role authenticated; create role service_role;')
        for filename in ['202606050016_create_shipping_ops.sql','202606051840_create_shipping_notifications.sql','20261102122441_shipping_installation_documents.sql']:
            sql((ROOT/'supabase/migrations'/filename).read_text())
        unittest.main(verbosity=2)
    finally: subprocess.run(['docker','rm','-f',CONTAINER],capture_output=True)
