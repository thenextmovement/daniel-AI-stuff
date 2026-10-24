-- Approved one-case recovery only, after fresh read-only provider and mailbox checks.
-- Does not send, draft, claim, or clear any provider/authorization evidence.
BEGIN;
DO $recovery$
DECLARE r public.repeat_business_outreach%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.repeat_business_outreach
 WHERE id='034e7b76-a7a3-4997-a8a2-0e224f61b77d' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'repeat_recovery_case_missing'; END IF;
 IF r.verification ? 'recovery_20261024_presend' THEN
   RAISE NOTICE 'Recovery already recorded; no change'; RETURN;
 END IF;
 IF md5((to_jsonb(r)-'claim_token')::text)<>'de4780a5b2c7d65f808d4d09379f0c34'
   OR r.status<>'unknown' OR r.execution_id<>'10128625'
   OR r.decision_reason<>'provider_or_validation_failed_no_retry'
   OR r.draft_message_id IS NOT NULL OR r.provider_message_id IS NOT NULL
   OR r.internet_message_id IS NOT NULL OR r.sent_at IS NOT NULL
   OR r.email_subject IS NOT NULL OR r.email_body IS NOT NULL
   OR r.consent_checked_at IS NOT NULL THEN
   RAISE EXCEPTION 'repeat_recovery_state_changed_or_authorized';
 END IF;
 UPDATE public.repeat_business_outreach SET status='preflight_failed',
   decision_reason='verified_pre_authorization_recovery',updated_at=now(),
   verification=verification||jsonb_build_object(
     'preflight_failure_count',1,
     'recovery_20261024_presend',jsonb_build_object(
       'at',now(),'source_execution_id','10128625',
       'previous_status',r.status,'previous_reason',r.decision_reason,
       'previous_updated_at',r.updated_at,
       'evidence','No persisted authorization or draft; unchanged authorize/send invariant; fresh read-only checks and mailbox review required before applying',
       'original_failed_node','not_recoverable'))
 WHERE id=r.id;
END $recovery$;
COMMIT;
