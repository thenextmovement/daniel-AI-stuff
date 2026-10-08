-- Run in an isolated PostgreSQL fixture containing the three queue tables and the claim RPC.
\set ON_ERROR_STOP on
BEGIN;
DO $test$
DECLARE
 n int; job uuid;
 t timestamptz := '2026-10-08 10:00Z';
 daniel text := 'daniels-mac-arrival-label-a6-01';
 rahim text := 'rahims-mac-arrival-label-a6-fallback-01';
 a4 text := 'rahims-mac-arrival-delivery-note-a4-fallback-01';
BEGIN
 INSERT INTO arrival_label_print_jobs DEFAULT VALUES;
 SELECT count(*) INTO n FROM arrival_labels_claim_print_job(rahim,'shipping-a6',180,t + interval '4 minutes 59 seconds');
 ASSERT n=0, 'Fallback must not claim before five minutes';
 SELECT count(*) INTO n FROM arrival_labels_claim_print_job(daniel,'shipping-a6',180,t);
 ASSERT n=1, 'Daniel claims immediately';
 TRUNCATE arrival_label_print_jobs;
 INSERT INTO arrival_label_print_jobs DEFAULT VALUES RETURNING id INTO job;
 SELECT count(*) INTO n FROM arrival_labels_claim_print_job(rahim,'shipping-a6',180,t+interval '5 minutes');
 ASSERT n=1, 'Fallback claims at five minutes';
 SELECT count(*) INTO n FROM arrival_labels_claim_print_job(rahim,'shipping-a6',180,t+interval '5 minutes 10 seconds');
 ASSERT n=1 AND (SELECT attempts=1 AND id=job FROM arrival_label_print_jobs), 'Own lease resumes without another attempt';
 TRUNCATE arrival_label_print_jobs;
 INSERT INTO arrival_label_print_jobs(status,attempts,lease_owner,lease_expires_at) VALUES ('claimed',1,daniel,t+interval '10 minutes');
 SELECT count(*) INTO n FROM arrival_labels_claim_print_job(rahim,'shipping-a6',180,t+interval '6 minutes');
 ASSERT n=0, 'Fallback cannot steal an active Daniel lease';
 SELECT count(*) INTO n FROM arrival_labels_claim_print_job(rahim,'shipping-a6',180,t+interval '11 minutes');
 ASSERT n=1 AND (SELECT attempts=2 FROM arrival_label_print_jobs), 'Expired pre-dispatch claim remains safely retryable';
 TRUNCATE arrival_label_print_jobs;
 INSERT INTO arrival_label_print_jobs(status) VALUES ('dispatching'),('submitted'),('manual_review'),('printed');
 SELECT count(*) INTO n FROM arrival_labels_claim_print_job(rahim,'shipping-a6',180,t+interval '1 hour');
 ASSERT n=0, 'Uncertain, submitted and completed jobs must not be reprinted';
 TRUNCATE arrival_label_print_jobs;
 INSERT INTO arrival_label_print_jobs(status,attempts) VALUES ('retryable_error',3);
 SELECT count(*) INTO n FROM arrival_labels_claim_print_job(rahim,'shipping-a6',180,t+interval '1 hour');
 ASSERT n=0 AND (SELECT status='manual_review' FROM arrival_label_print_jobs), 'Exhausted attempts require manual review';
 TRUNCATE arrival_label_print_jobs;
 INSERT INTO arrival_label_print_jobs(printer_key,document_kind) VALUES ('shipping-a4-delivery-note','delivery_note');
 SELECT count(*) INTO n FROM arrival_labels_claim_print_job(rahim,'shipping-a6',180,t+interval '1 hour');
 ASSERT n=0, 'A6 does not claim A4';
 SELECT count(*) INTO n FROM arrival_labels_claim_print_job(a4,'shipping-a4-delivery-note',180,t+interval '4 minutes');
 ASSERT n=0, 'A4 fallback also waits five minutes';
 SELECT count(*) INTO n FROM arrival_labels_claim_print_job(a4,'shipping-a4-delivery-note',180,t+interval '5 minutes');
 ASSERT n=1, 'A4 fallback claims its separate queue';
 RAISE NOTICE 'PASS: 11 fallback/lease/dispatch assertions';
END;
$test$;
ROLLBACK;
