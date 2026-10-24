\set ON_ERROR_STOP on
BEGIN;
DO $test$
DECLARE j uuid; t uuid:=gen_random_uuid(); r jsonb; saved jsonb;
BEGIN
 INSERT INTO repeat_business_outreach(customer_id,customer_email,status,claim_token,campaign_key,organization_key)
 VALUES(gen_random_uuid(),'buyer@fixture.invalid','reserved',t,'mika-reactivation-20260903','domain:fixture.invalid') RETURNING id INTO j;
 r:=finish_repeat_business_send(j,t,'preflight_failed','pre_send_check_failed',jsonb_build_object('source_node','CheckShopifyLive','error_code','provider_read_failed'));
 ASSERT r->>'status'='preflight_failed','Read failure before draft creation must not become ambiguous delivery';
 ASSERT (SELECT status='preflight_failed' AND verification->>'preflight_failure_count'='1' AND draft_message_id IS NULL FROM repeat_business_outreach WHERE id=j),'Persist first safe preflight failure';
 SELECT to_jsonb(o) INTO saved FROM repeat_business_outreach o WHERE id=j;
 r:=finish_repeat_business_send(j,t,'preflight_failed','duplicate',jsonb_build_object('source_node','CheckShopifyLive'));
 ASSERT (SELECT to_jsonb(o)=saved FROM repeat_business_outreach o WHERE id=j),'Same callback must not increase retry count or reset delay';
 UPDATE repeat_business_outreach SET status='sending',draft_message_id='immutable-message-123' WHERE id=j;
 BEGIN
  PERFORM finish_repeat_business_send(j,t,'preflight_failed','unsafe',jsonb_build_object('source_node','CheckShopifyLive'));
  RAISE EXCEPTION 'authorized send was incorrectly reclassified';
 EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='invalid_repeat_outcome','Sending cannot enter safe retry'; END;
 r:=finish_repeat_business_send(j,t,'unknown','provider_or_validation_failed_no_retry');
 ASSERT r->>'status'='unknown' AND (SELECT draft_message_id='immutable-message-123' FROM repeat_business_outreach WHERE id=j),'Ambiguous send keeps original lock and draft';
 BEGIN
  PERFORM finish_repeat_business_send(j,t,'preflight_failed','unsafe',jsonb_build_object('source_node','CheckShopifyLive'));
  RAISE EXCEPTION 'unknown was incorrectly reclassified';
 EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='invalid_repeat_outcome','Unknown must not auto-recover'; END;
 UPDATE repeat_business_outreach SET status='reserved',draft_message_id=NULL WHERE id=j;
 BEGIN
  PERFORM finish_repeat_business_send(j,t,'preflight_failed','unsafe',jsonb_build_object('source_node','CreateRepeatBusinessDraft'));
  RAISE EXCEPTION 'draft creation was incorrectly classified as a read';
 EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='invalid_repeat_outcome','Draft creation failures cannot enter preflight retry'; END;
 BEGIN
  PERFORM finish_repeat_business_send(j,gen_random_uuid(),'preflight_failed','unsafe',jsonb_build_object('source_node','CheckShopifyLive'));
  RAISE EXCEPTION 'wrong claim accepted';
 EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='repeat_reservation_not_found','Claim identity required'; END;
 RAISE NOTICE 'PASS: preflight state, idempotency, authorization and unknown guards, stage allowlist, claim binding';
END $test$;
ROLLBACK;

-- Freeze only the clock dependency in this isolated transaction; production SQL is unchanged.
BEGIN;
CREATE FUNCTION pg_temp.fixture_now() RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT current_setting('repeat_test.now')::timestamptz $$;
DO $$DECLARE f record; BEGIN
 FOR f IN SELECT oid FROM pg_proc WHERE proname IN ('claim_repeat_business_send','finish_repeat_business_send','authorize_repeat_business_send') AND pronamespace='public'::regnamespace LOOP
 EXECUTE replace(pg_get_functiondef(f.oid),'now()','pg_temp.fixture_now()');
 END LOOP;
END$$;
SELECT set_config('repeat_test.now','2026-10-26 10:01:00Z',true);
DO $test$
DECLARE j uuid; customer uuid:=gen_random_uuid(); token uuid:=gen_random_uuid(); old_token uuid; r jsonb; saved jsonb;
BEGIN
 INSERT INTO master_customers(id,email) VALUES(customer,'buyer@fixture.invalid');
 INSERT INTO repeat_business_outreach(customer_id,customer_email,status,claim_token,campaign_key,organization_key,updated_at,verification)
 VALUES(customer,'buyer@fixture.invalid','reserved',token,'mika-reactivation-20260903','domain:fixture.invalid',pg_temp.fixture_now(),'{"organization_emails":["buyer@fixture.invalid"]}') RETURNING id INTO j;
 PERFORM finish_repeat_business_send(j,token,'preflight_failed','read_failed',jsonb_build_object('source_node','CheckTrelloLive'));
 r:=claim_repeat_business_send('too-early');
 ASSERT r->>'route'='none' AND (SELECT status='preflight_failed' FROM repeat_business_outreach WHERE id=j),'Backoff prevents immediate claim';
 PERFORM set_config('repeat_test.now','2026-10-26 10:06:00Z',true);
 r:=claim_repeat_business_send('safe-retry-one');
 ASSERT r->>'route'='reserved' AND (r->>'id')::uuid=j AND r->>'execution_id'='safe-retry-one','Due preflight retry resumes the same immutable outreach';
 old_token:=token;token:=(r->>'claim_token')::uuid;
 ASSERT token<>old_token AND r->>'draft_message_id' IS NULL,'Retry rotates claim and cannot reuse a draft';
 ASSERT r#>>'{verification,preflight_failure_count}'='1','Retry retains failure budget';
 BEGIN
  PERFORM finish_repeat_business_send(j,old_token,'unknown');
  RAISE EXCEPTION 'old claim accepted';
 EXCEPTION WHEN raise_exception THEN ASSERT SQLERRM='repeat_reservation_not_found','Old execution cannot finalize new reservation'; END;
 PERFORM finish_repeat_business_send(j,token,'preflight_failed','read_failed',jsonb_build_object('source_node','CheckTrelloLive'));
 PERFORM set_config('repeat_test.now','2026-10-26 10:11:00Z',true);
 r:=claim_repeat_business_send('safe-retry-two');token:=(r->>'claim_token')::uuid;
 ASSERT r->>'route'='reserved' AND (r->>'id')::uuid=j,'Second and final safe retry';
 PERFORM finish_repeat_business_send(j,token,'preflight_failed','read_failed',jsonb_build_object('source_node','CheckTrelloLive'));
 PERFORM set_config('repeat_test.now','2026-10-26 10:16:00Z',true);
 r:=claim_repeat_business_send('exhausted');
 ASSERT r->>'route'='none' AND (SELECT status='preflight_failed' AND verification->>'preflight_failure_count'='3' FROM repeat_business_outreach WHERE id=j),'Three failures leave visible review state without endless retry';
 UPDATE repeat_business_outreach SET verification=jsonb_set(verification,'{preflight_failure_count}','1'),updated_at='2026-10-26 09:00Z',draft_message_id='unexpected-draft' WHERE id=j;
 r:=claim_repeat_business_send('draft-guard');
 ASSERT r->>'route'='none','Persisted draft blocks preflight recovery';
 UPDATE repeat_business_outreach SET draft_message_id=NULL WHERE id=j;
 PERFORM set_config('repeat_test.now','2026-10-25 10:00:00Z',true);
 r:=claim_repeat_business_send('sunday');
 ASSERT r->>'reason'='outside_business_hours','Preflight recovery respects business days';
 PERFORM set_config('repeat_test.now','2026-10-26 10:16:00Z',true);
 INSERT INTO repeat_business_outreach(customer_email,campaign_key,status,sent_at,updated_at) VALUES('other@fixture.invalid','mika-reactivation-20260903','sent','2026-10-26 09:30Z','2026-10-26 09:30Z');
 r:=claim_repeat_business_send('cadence');
 ASSERT r->>'reason'='cadence_limit','Recovery cannot bypass send cadence';
 DELETE FROM repeat_business_outreach WHERE id<>j;
 UPDATE repeat_business_outreach SET status='unknown' WHERE id=j;
 SELECT to_jsonb(o) INTO saved FROM repeat_business_outreach o WHERE id=j;
 r:=claim_repeat_business_send('unknown-lock');
 ASSERT r->>'reason'='manual_review_required' AND (SELECT to_jsonb(o)=saved FROM repeat_business_outreach o WHERE id=j),'Existing unknown holds cannot be bypassed';
 RAISE NOTICE 'PASS: bounded same-case preflight retries, backoff, stale token, exhaustion, draft guard, business hours, cadence, unknown lock';
END $test$;
ROLLBACK;
