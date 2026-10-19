#!/usr/bin/env python3
"""Real PostgreSQL first-parcel safety tests; disposable network-disabled DB, synthetic data only."""
import concurrent.futures
import os
from pathlib import Path
import subprocess
import time
import unittest
ROOT = Path(__file__).resolve().parents[1]
CONTAINER = f"arrival-first-parcel-test-{os.getpid()}"
def run(args, **kwargs):
    return subprocess.run(args, text=True, capture_output=True, check=True, **kwargs)
def sql(value):
    try:
        return run(['docker','exec','-i',CONTAINER,'psql','-XAtq','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-U','postgres'],input="set search_path=public,extensions;"+value).stdout.strip()
    except subprocess.CalledProcessError as e:
        raise RuntimeError(e.stderr.strip()) from e
CARD='111111111111111111111111'
NUMBERS="array['0012345678','1123456789','2234567890']"
def pin(numbers=NUMBERS):
    return sql(f"select tracking_numbers from arrival_labels_pin_first_parcel('{CARD}',{numbers});")
def case(tracking='0012345678',order='123456'):
    return sql(f"""insert into arrival_label_cases(run_id,idempotency_key,incoming_dhl_tracking_number,trello_card_id,
      shopify_order_id,shopify_order_name,status,destination_class,selected_dpd_product,source_snapshot)
      values ((select id from arrival_label_runs limit 1),'fixture:{order}:{tracking}','{tracking}','{CARD}',
      'gid://shopify/Order/{order}','#NEONT123','label_planned','domestic_de','standard','{{"acrylicTableDeviceRequired":true}}') returning id;""")
def enqueue(cid):
    return sql(f"select id from arrival_labels_enqueue_browser_purchase('{cid}');")
def artifacts(cid, overlay):
    ids=[]
    for kind, content in [('original_pdf','application/pdf'),('annotated_pdf','application/pdf'),('rendered_preview','image/png')]:
        ids.append(sql(f"""insert into arrival_label_artifacts(case_id,artifact_kind,storage_bucket,storage_key,sha256,content_type,byte_size,qa_result)
          values ('{cid}','{kind}','test-only','{cid}/{kind}',repeat('a',64),'{content}',100,
          jsonb_build_object('ok',true,'overlayText','{overlay}')) returning id;"""))
    return ids

def completed(cid, artifact):
    sql(f"update arrival_label_cases set outlook_delivery_state='delivered_today',outlook_message_ids=array['test-message'],updated_at=now() where id='{cid}';")
    pid=sql(f"""insert into arrival_label_print_jobs(case_id,artifact_id,document_kind,idempotency_key,printer_key,document_sha256,status,cups_job_id)
      values ('{cid}','{artifact}','label','test-only-print:{cid}','shipping-a6',repeat('a',64),'printed','test-only-1') returning id;""")
    sql(f"""insert into arrival_label_outlook_archive_jobs(case_id,print_job_id,idempotency_key,source_message_id,expected_tracking_number,status,archived_at)
      values ('{cid}','{pid}','arrival-outlook-archive:'||repeat('a',64),'test-message','0012345678','archived',now());""")
    sql("update arrival_label_trello_arrival_settings set enabled=true,enabled_after=now()-interval '1 day';")

class FirstParcelTests(unittest.TestCase):
    def setUp(self):
        sql('truncate arrival_label_first_parcels, arrival_label_runs cascade;')
        sql("insert into arrival_label_runs(correlation_id,mode,trigger_type,local_date,status) values (gen_random_uuid()::text,'execute','manual_cli',current_date,'running');")
    def test_one_job_replay_and_acrylic_manual(self):
        pin(); cid=case(); first=enqueue(cid)
        self.assertEqual(enqueue(cid),first)
        self.assertEqual(sql('select count(*) from arrival_label_browser_purchase_jobs'),'1')
        self.assertEqual(sql(f"select arrival_labels_enqueue_trello_arrival('{cid}');"),'0')
    def test_reordered_selection_never_overwrites(self):
        first=pin()
        self.assertEqual(pin("array['2234567890','1123456789','0012345678']"),first)
        cid=case('2234567890')
        with self.assertRaisesRegex(RuntimeError,'pinned first parcel'): enqueue(cid)
        self.assertEqual(sql('select count(*) from arrival_label_browser_purchase_jobs'),'0')
    def test_second_case_cannot_buy_again(self):
        pin(); enqueue(case())
        with self.assertRaisesRegex(RuntimeError,'pinned first parcel'): enqueue(case(order='123457'))
        self.assertEqual(sql('select count(*) from arrival_label_browser_purchase_jobs'),'1')
    def test_existing_label_keeps_card_manual(self):
        cid=case(); sql(f"update arrival_label_cases set existing_dpd_tracking='01476817678011' where id='{cid}';")
        pin()
        self.assertIn('manuell',sql('select blocked_reason from arrival_label_first_parcels'))
    def test_selection_immutable_and_private(self):
        pin()
        for query in ["delete from arrival_label_first_parcels", "update arrival_label_first_parcels set tracking_numbers=array['1123456789','0012345678']"]:
            with self.assertRaisesRegex(RuntimeError,'permanent|immutable'): sql(query)
        self.assertEqual(sql("select has_function_privilege('anon','arrival_labels_pin_first_parcel(text,text[])','execute');"),'f')
        self.assertEqual(sql("select has_table_privilege('authenticated','arrival_label_first_parcels','select');"),'f')
    def test_exact_overlay_required_by_artifact_registration(self):
        pin(); cid=case(); job=enqueue(cid); original,annotated,preview=artifacts(cid,'345678')
        sql(f"update arrival_label_browser_purchase_jobs set status='purchased',lease_owner='fixture-worker' where id='{job}';")
        call=f"select id from arrival_labels_register_browser_artifacts('{job}','fixture-worker','01476817678011',repeat('a',64),'{original}','{annotated}','{preview}');"
        with self.assertRaisesRegex(RuntimeError,'failed QA'): sql(call)
        sql(f"update arrival_label_artifacts set qa_result=jsonb_build_object('ok',true,'overlayText','345678 Paket 1 von 3') where id='{annotated}';")
        self.assertEqual(sql(call),job)
    def test_partial_card_stays_open_while_single_card_still_projects(self):
        for multi in [False, True]:
            self.setUp()
            if multi: pin()
            cid=case(); original,annotated,preview=artifacts(cid,'345678 Paket 1 von 3' if multi else '345678')
            completed(cid,annotated)
            self.assertEqual(sql(f"select arrival_labels_enqueue_trello_arrival('{cid}');"),'0' if multi else '1')
    def test_single_card_keeps_its_approved_acrylic_parcel(self):
        enqueue(case())
        self.assertEqual(sql('select count(*) from arrival_label_browser_purchase_jobs'),'2')
    def test_concurrent_replays_create_one_purchase(self):
        pin(); cid=case()
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            results=list(pool.map(lambda _:enqueue(cid),range(4)))
        self.assertEqual(len(set(results)),1)
        self.assertEqual(sql('select count(*) from arrival_label_browser_purchase_jobs'),'1')
def main():
    try:
        run(['docker','run','-d','--pull=never','--name',CONTAINER,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-alpine'])
        for _ in range(100):
            try: sql('select 1'); break
            except RuntimeError: time.sleep(.1)
        sql('create role anon; create role authenticated; create role service_role bypassrls; create schema extensions; create extension pgcrypto with schema extensions;')
        sql('create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);')
        names=['20260720094159_create_arrival_label_automation.sql','20260720184500_archive_dhl_outlook_after_label_print.sql','20260721170915_create_arrival_label_browser_purchase_queue.sql',
          '20260723103508_finalize_dhl_delivery_to_trello_sign_arrived.sql','20260729182845_arrival_label_trello_sign_shipped_trigger.sql',
          '20260924111338_arrival_acrylic_second_parcel.sql','20261007124100_arrival_acrylic_tracking_overlay.sql','20261019160000_arrival_first_parcel.sql']
        for name in names: sql((ROOT/'supabase/migrations'/name).read_text())
        sql("""update arrival_label_browser_worker_settings set worker_enabled=true,live_purchase_enabled=true,
          approved_products='{"standard":{"label":"B2C","maxPurchaseCents":1000}}',approved_by='isolated test',approved_at=now();""")
        result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(FirstParcelTests))
        return 0 if result.wasSuccessful() else 1
    finally:
        run(['docker','rm','-f',CONTAINER])
if __name__=='__main__': raise SystemExit(main())
