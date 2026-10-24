-- Apply arrival-print-fallback-base.sql, the fallback migration and the server-only migration first.
\set ON_ERROR_STOP on
BEGIN;
DO $test$
DECLARE
 n int; job uuid; case_id uuid := gen_random_uuid(); run_id uuid := gen_random_uuid();
 t timestamptz := '2026-10-24 07:07Z';
 server_worker text := 'hermes-server-arrival-label-a6-01';
 legacy_worker text;
BEGIN
 FOREACH legacy_worker IN ARRAY ARRAY['daniels-mac-arrival-label-a6-01', 'rahims-mac-arrival-label-a6-fallback-01', 'unknown-worker-01'] LOOP
   TRUNCATE arrival_label_print_jobs;
   INSERT INTO arrival_label_print_jobs(created_at) VALUES (t - interval '1 hour');
   SELECT count(*) INTO n FROM arrival_labels_claim_print_job(legacy_worker,'shipping-a6',180,t);
   ASSERT n=0, 'Only the approved server may claim A6 labels';
   ASSERT (SELECT status='queued' AND attempts=0 AND lease_owner IS NULL FROM arrival_label_print_jobs), 'Rejected workers cannot mutate the queue';
 END LOOP;
 TRUNCATE arrival_label_print_jobs;
 INSERT INTO arrival_label_print_jobs(created_at) VALUES (t) RETURNING id INTO job;
 SELECT count(*) INTO n FROM arrival_labels_claim_print_job(server_worker,'shipping-a6',180,t);
 ASSERT n=1 AND (SELECT lease_owner=server_worker AND attempts=1 FROM arrival_label_print_jobs), 'Server claims immediately';
 SELECT count(*) INTO n FROM arrival_labels_claim_print_job(server_worker,'shipping-a6',180,t+interval '10 seconds');
 ASSERT n=1 AND (SELECT id=job AND attempts=1 FROM arrival_label_print_jobs), 'Server resumes its lease without another attempt';
 TRUNCATE arrival_label_print_jobs;
 INSERT INTO arrival_label_print_jobs(status,attempts,lease_owner,lease_expires_at,claimed_at)
 VALUES ('claimed',1,'daniels-mac-arrival-label-a6-01',t+interval '3 minutes',t);
 SELECT count(*) INTO n FROM arrival_labels_claim_print_job('daniels-mac-arrival-label-a6-01','shipping-a6',180,t);
 ASSERT n=0, 'Retired worker cannot resume a claimed A6 job';
 SELECT count(*) INTO n FROM arrival_labels_claim_print_job(server_worker,'shipping-a6',180,t);
 ASSERT n=0, 'Server does not steal an active legacy lease';
 SELECT count(*) INTO n FROM arrival_labels_claim_print_job(server_worker,'shipping-a6',180,t+interval '4 minutes');
 ASSERT n=1 AND (SELECT lease_owner=server_worker AND attempts=2 FROM arrival_label_print_jobs), 'Only expired pre-dispatch claims can transfer safely to the server';
 TRUNCATE arrival_label_print_jobs;
 INSERT INTO arrival_label_print_jobs(status,lease_owner) VALUES
 ('dispatching','daniels-mac-arrival-label-a6-01'),('submitted','daniels-mac-arrival-label-a6-01'),('manual_review',server_worker),('printed',server_worker);
 SELECT count(*) INTO n FROM arrival_labels_claim_print_job(server_worker,'shipping-a6',180,t);
 ASSERT n=0, 'Server must not reprint uncertain, submitted or completed jobs';
 ASSERT (SELECT count(*)=4 AND bool_and(attempts=0) FROM arrival_label_print_jobs), 'Unconfirmed print evidence remains unchanged';
 TRUNCATE arrival_label_print_jobs;
 INSERT INTO arrival_label_cases(id,run_id,status) VALUES (case_id,run_id,'label_created');
 INSERT INTO arrival_label_print_jobs(case_id,status,attempts) VALUES (case_id,'retryable_error',3);
 SELECT count(*) INTO n FROM arrival_labels_claim_print_job(server_worker,'shipping-a6',180,t);
 ASSERT n=0 AND (SELECT status='manual_review' FROM arrival_label_print_jobs), 'Exhausted retries still require review';
 ASSERT (SELECT status='manual_review' FROM arrival_label_cases), 'Affected case remains visible for review';
 ASSERT (SELECT count(*)=1 FROM arrival_label_events WHERE event_type='print_retry_exhausted'), 'Failure event is retained for the existing alert path';
 PERFORM arrival_labels_claim_print_job(server_worker,'shipping-a6',180,t);
 ASSERT (SELECT count(*)=1 FROM arrival_label_events WHERE event_type='print_retry_exhausted'), 'Repeated polling does not duplicate the failure event';
 TRUNCATE arrival_label_print_jobs;
 INSERT INTO arrival_label_print_jobs(printer_key,document_kind,created_at) VALUES ('shipping-a4-delivery-note','delivery_note',t);
 SELECT count(*) INTO n FROM arrival_labels_claim_print_job(server_worker,'shipping-a6',180,t+interval '1 hour');
 ASSERT n=0, 'A6 server cannot claim A4 documents';
 SELECT count(*) INTO n FROM arrival_labels_claim_print_job('rahims-mac-arrival-delivery-note-a4-fallback-01','shipping-a4-delivery-note',180,t+interval '4 minutes');
 ASSERT n=0, 'Separate A4 fallback timing is preserved';
 SELECT count(*) INTO n FROM arrival_labels_claim_print_job('rahims-mac-arrival-delivery-note-a4-fallback-01','shipping-a4-delivery-note',180,t+interval '5 minutes');
 ASSERT n=1, 'Separate A4 routing is preserved';
 RAISE NOTICE 'PASS: server-only A6 ownership, legacy rejection, lease safety, no reprint, alert event, A4 isolation';
END;
$test$;
ROLLBACK;
