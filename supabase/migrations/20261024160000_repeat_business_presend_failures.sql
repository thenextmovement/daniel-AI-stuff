-- NEONTRIP Repeat Business: distinguish pre-draft read failures from ambiguous provider writes.
-- No historical outreach is changed by this migration.
BEGIN;
ALTER TABLE public.repeat_business_outreach DROP CONSTRAINT repeat_business_outreach_status_check;
ALTER TABLE public.repeat_business_outreach ADD CONSTRAINT repeat_business_outreach_status_check
 CHECK (status IN ('sent','replied','converted','bounced','unsubscribed','reserved','sending','skipped','unknown','preflight_failed'));

CREATE OR REPLACE FUNCTION public.finish_repeat_business_send(p_id uuid, p_claim_token uuid, p_outcome text, p_reason text DEFAULT NULL::text, p_message jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_row public.repeat_business_outreach%ROWTYPE; v_to jsonb;
BEGIN
  SELECT * INTO v_row FROM public.repeat_business_outreach WHERE id=p_id AND claim_token=p_claim_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'repeat_reservation_not_found'; END IF;
  IF v_row.status='sent' THEN RETURN jsonb_build_object('status','sent','id',v_row.id,'already_recorded',true); END IF;
  IF p_outcome='sent' THEN
    v_to:=p_message->'toRecipients';
    IF v_row.status<>'sending' OR p_message->>'id' IS DISTINCT FROM v_row.draft_message_id
      OR p_message->>'isDraft' IS DISTINCT FROM 'false'
      OR p_message->>'subject' IS DISTINCT FROM v_row.email_subject
      OR lower(p_message#>>'{from,emailAddress,address}') IS DISTINCT FROM 'support@neontrip.de'
      OR jsonb_array_length(coalesce(v_to,'[]'::jsonb))<>1
      OR lower(v_to#>>'{0,emailAddress,address}') IS DISTINCT FROM v_row.customer_email
      OR coalesce(p_message->>'internetMessageId','')='' OR coalesce(p_message->>'sentDateTime','')=''
      OR coalesce(p_message->>'body_hash_match','')<>'true'
      OR coalesce(p_message->>'in_sent_items','')<>'true' THEN
      UPDATE public.repeat_business_outreach SET status='unknown',decision_reason='sent_proof_failed',updated_at=now() WHERE id=p_id;
      RETURN jsonb_build_object('status','unknown','reason','sent_proof_failed','id',p_id);
    END IF;
    UPDATE public.repeat_business_outreach SET status='sent',provider_message_id=p_message->>'id',internet_message_id=p_message->>'internetMessageId',
      sent_at=(p_message->>'sentDateTime')::timestamptz,updated_at=now(),decision_reason='sent_items_verified' WHERE id=p_id;
  ELSIF p_outcome='skipped' AND v_row.status='reserved' THEN
    UPDATE public.repeat_business_outreach SET status='skipped',decision_reason=left(coalesce(p_reason,'not_eligible'),200),updated_at=now() WHERE id=p_id;
  ELSIF p_outcome='preflight_failed'
    AND v_row.status IN ('reserved','preflight_failed')
    AND v_row.draft_message_id IS NULL AND v_row.provider_message_id IS NULL
    AND v_row.internet_message_id IS NULL AND v_row.sent_at IS NULL
    AND v_row.email_subject IS NULL AND v_row.email_body IS NULL
    AND v_row.consent_checked_at IS NULL
    AND p_message->>'source_node' IN ('ValidateReservation','CheckShopifyLive','ValidateShopifyAndConsent','CheckTrelloLive','BuildValidatedMikaMail') THEN
    -- Only the read-only path before draft creation may enter a bounded retry.
    -- Repeated delivery of the same error callback cannot consume another attempt.
    IF v_row.status='preflight_failed' THEN
      RETURN jsonb_build_object('status','preflight_failed','id',p_id,'already_recorded',true);
    END IF;
    UPDATE public.repeat_business_outreach SET status='preflight_failed',
      decision_reason='pre_send_check_failed',
      verification=verification||jsonb_build_object(
        'preflight_failure_count',coalesce((verification->>'preflight_failure_count')::int,0)+1,
        'preflight_last_failure',jsonb_build_object(
          'source_node',p_message->>'source_node',
          'error_code',CASE WHEN coalesce(p_message->>'error_code','') ~ '^[a-z0-9_]{1,100}$'
            THEN p_message->>'error_code' ELSE 'preflight_check_failed' END,
          'execution_id',v_row.execution_id,'at',now())),
      updated_at=now() WHERE id=p_id;
  ELSIF p_outcome='unknown' AND v_row.status IN ('reserved','sending','unknown') THEN
    UPDATE public.repeat_business_outreach SET status='unknown',decision_reason=left(coalesce(p_reason,'provider_result_unknown_no_retry'),200),updated_at=now() WHERE id=p_id;
  ELSE RAISE EXCEPTION 'invalid_repeat_outcome'; END IF;
  RETURN jsonb_build_object('status',p_outcome,'id',p_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_repeat_business_send(p_execution_id text, p_internal_test boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_campaign text := CASE WHEN p_internal_test THEN 'mika-reactivation-20260903-internal' ELSE 'mika-reactivation-20260903' END;
  v_row public.repeat_business_outreach%ROWTYPE;
  v_candidate record;
  v_emails jsonb;
  v_free text[] := ARRAY['gmail.com','googlemail.com','icloud.com','me.com','mac.com','web.de','gmx.de','gmx.net','gmx.at','gmx.ch','yahoo.com','yahoo.de','hotmail.com','hotmail.de','outlook.com','outlook.de','live.com','live.de','msn.com','aol.com','t-online.de','freenet.de','proton.me','protonmail.com','mailbox.org','posteo.de','zoho.com','yandex.com','yandex.ru','icloud.de'];
BEGIN
  IF p_execution_id IS NULL OR length(p_execution_id) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'invalid_execution_id'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('neontrip:'||v_campaign,0));
  UPDATE public.repeat_business_outreach SET status='unknown', decision_reason='stale_delivery_no_retry',updated_at=now()
    WHERE campaign_key=v_campaign AND status IN ('reserved','sending') AND updated_at<now()-interval '15 minutes';
  IF EXISTS(SELECT 1 FROM public.repeat_business_outreach WHERE campaign_key=v_campaign AND status='unknown') THEN
    RETURN jsonb_build_object('route','stop','reason','manual_review_required');
  END IF;
  IF EXISTS(SELECT 1 FROM public.repeat_business_outreach WHERE campaign_key=v_campaign AND status IN ('reserved','sending')) THEN
    RETURN jsonb_build_object('route','none','reason','delivery_in_progress');
  END IF;
  IF p_internal_test THEN
    IF EXISTS(SELECT 1 FROM public.repeat_business_outreach WHERE campaign_key=v_campaign) THEN
      RETURN jsonb_build_object('route','none','reason','internal_test_already_recorded');
    END IF;
    INSERT INTO public.repeat_business_outreach(campaign_key,organization_key,customer_email,customer_name,company_name,status,claim_token,execution_id,is_test,verification)
      VALUES(v_campaign,'internal:neontrip','support@neontrip.de','Mika Zangane','NEONTRIP – interner Test','reserved',gen_random_uuid(),p_execution_id,true,
      jsonb_build_object('organization_emails',jsonb_build_array('support@neontrip.de')))
      RETURNING * INTO v_row;
  ELSE
    IF extract(isodow from now() AT TIME ZONE 'Europe/Berlin') NOT BETWEEN 1 AND 5
      OR extract(hour from now() AT TIME ZONE 'Europe/Berlin') NOT BETWEEN 9 AND 18 THEN
      RETURN jsonb_build_object('route','none','reason','outside_business_hours');
    END IF;
    IF EXISTS(SELECT 1 FROM public.repeat_business_outreach WHERE campaign_key=v_campaign AND sent_at>now()-interval '60 minutes')
      OR (SELECT count(*) FROM public.repeat_business_outreach WHERE campaign_key=v_campaign AND (sent_at AT TIME ZONE 'Europe/Berlin')::date=(now() AT TIME ZONE 'Europe/Berlin')::date)>=10 THEN
      RETURN jsonb_build_object('route','none','reason','cadence_limit');
    END IF;
    -- Retry only proven read-only failures, at most twice after the initial attempt.
    -- Existing unknown rows, cadence, business hours and draft uncertainty remain guards.
    SELECT o.* INTO v_row FROM public.repeat_business_outreach o
      WHERE o.campaign_key=v_campaign AND NOT o.is_test AND o.status='preflight_failed'
        AND (o.verification->>'preflight_failure_count')::int BETWEEN 1 AND 2
        AND o.updated_at<=now()-interval '5 minutes'
        AND o.verification->'manual_exclusion' IS NULL
        AND o.draft_message_id IS NULL AND o.provider_message_id IS NULL
        AND o.internet_message_id IS NULL AND o.sent_at IS NULL
        AND o.email_subject IS NULL AND o.email_body IS NULL AND o.consent_checked_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM public.repeat_business_outreach other WHERE NOT other.is_test AND other.id<>o.id
          AND (lower(btrim(other.customer_email))=lower(btrim(o.customer_email)) OR other.organization_key=o.organization_key
            OR (o.company_key IS NOT NULL AND (other.company_key=o.company_key OR regexp_replace(lower(coalesce(other.company_name,'')),'[^[:alnum:]]','','g')=o.company_key))))
        AND NOT EXISTS(SELECT 1 FROM public.master_customers mc JOIN public.customer_communication_draft_jobs j ON j.source_id=mc.id::text
          WHERE j.communication_kind='repeat_business' AND (lower(btrim(mc.email))=lower(btrim(o.customer_email))
            OR (o.organization_key LIKE 'domain:%' AND lower(split_part(btrim(mc.email),'@',2))=substr(o.organization_key,8))
            OR (o.company_key IS NOT NULL AND regexp_replace(lower(coalesce(mc.company_name,'')),'[^[:alnum:]]','','g')=o.company_key)))
      ORDER BY o.updated_at,o.id LIMIT 1 FOR UPDATE;
    IF v_row.id IS NOT NULL THEN
      UPDATE public.repeat_business_outreach SET status='reserved',claim_token=gen_random_uuid(),
        execution_id=p_execution_id,decision_reason=NULL,updated_at=now(),
        verification=verification||jsonb_build_object('preflight_retried_at',now())
        WHERE id=v_row.id RETURNING * INTO v_row;
    ELSE
    -- Retry only explicitly re-approved, proven pre-send technical exclusions, once.
    -- Fresh candidates retain the other minute slots, so rechecks cannot starve intake.
    IF extract(minute from now())::int % 3 = 0 THEN
      SELECT o.* INTO v_row FROM public.repeat_business_outreach o
      WHERE o.campaign_key=v_campaign AND NOT o.is_test AND o.status='skipped'
        AND o.verification->>'recheck_after_fix_20260903'='true'
        AND o.verification->'manual_exclusion' IS NULL
        AND o.decision_reason IN ('no_current_marketing_consent','order_missing_trello_identifier','shopify_organization_identity_incomplete','organization_lookup_requires_manual_review')
        AND o.draft_message_id IS NULL AND o.provider_message_id IS NULL AND o.internet_message_id IS NULL AND o.sent_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM public.repeat_business_outreach other WHERE NOT other.is_test AND other.id<>o.id
          AND (lower(btrim(other.customer_email))=lower(btrim(o.customer_email)) OR other.organization_key=o.organization_key
            OR (o.company_key IS NOT NULL AND (other.company_key=o.company_key OR regexp_replace(lower(coalesce(other.company_name,'')),'[^[:alnum:]]','','g')=o.company_key))))
        AND NOT EXISTS(SELECT 1 FROM public.master_customers mc JOIN public.customer_communication_draft_jobs j ON j.source_id=mc.id::text
          WHERE j.communication_kind='repeat_business' AND (lower(btrim(mc.email))=lower(btrim(o.customer_email))
            OR (o.organization_key LIKE 'domain:%' AND lower(split_part(btrim(mc.email),'@',2))=substr(o.organization_key,8))
            OR (o.company_key IS NOT NULL AND regexp_replace(lower(coalesce(mc.company_name,'')),'[^[:alnum:]]','','g')=o.company_key)))
      ORDER BY o.total_orders ASC NULLS LAST,o.total_revenue DESC NULLS LAST,o.id LIMIT 1 FOR UPDATE;
    END IF;
    IF v_row.id IS NOT NULL THEN
      UPDATE public.repeat_business_outreach SET status='reserved',claim_token=gen_random_uuid(),execution_id=p_execution_id,
        decision_reason=NULL,updated_at=now(),verification=(verification-'recheck_after_fix_20260903')||jsonb_build_object('rechecked_after_fix_20260903',jsonb_build_object('previous_reason',v_row.decision_reason,'previous_execution_id',v_row.execution_id,'at',now()))
      WHERE id=v_row.id RETURNING * INTO v_row;
    ELSE
    WITH candidates AS (
      SELECT c.*, lower(btrim(c.email)) normalized_email,
        nullif(regexp_replace(lower(coalesce(c.company_name,'')),'[^[:alnum:]]','','g'),'') normalized_company,
        CASE WHEN lower(split_part(btrim(c.email),'@',2))=ANY(v_free)
          THEN 'company:'||regexp_replace(lower(coalesce(c.company_name,'')),'[^[:alnum:]]','','g')
          ELSE 'domain:'||lower(split_part(btrim(c.email),'@',2)) END org_key
      FROM public.get_repeat_business_candidates(10000) c
    )
    SELECT c.* INTO v_candidate FROM candidates c
      WHERE c.normalized_email ~ '^[A-Za-z0-9.!#$%&*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
        AND split_part(c.normalized_email,'@',2) NOT IN ('neontrip.de','riesenobjekte.de','example.com')
        AND c.org_key<>'company:'
        AND NOT EXISTS(SELECT 1 FROM public.repeat_business_outreach o WHERE NOT o.is_test AND
          (lower(btrim(o.customer_email))=c.normalized_email OR o.organization_key=c.org_key OR
          (c.normalized_company IS NOT NULL AND (o.company_key=c.normalized_company OR regexp_replace(lower(coalesce(o.company_name,'')),'[^[:alnum:]]','','g')=c.normalized_company))))
        AND NOT EXISTS(SELECT 1 FROM public.master_customers mc JOIN public.master_orders mo ON mo.customer_id=mc.id
          WHERE c.normalized_company IS NOT NULL AND regexp_replace(lower(coalesce(mc.company_name,'')),'[^[:alnum:]]','','g')=c.normalized_company
          AND mo.cancelled_at IS NULL AND mo.shopify_created_at>=now()-interval '30 days')
        AND NOT EXISTS(SELECT 1 FROM public.master_customers mc JOIN public.customer_communication_draft_jobs j ON j.source_id=mc.id::text
          WHERE j.communication_kind='repeat_business' AND c.normalized_company IS NOT NULL AND regexp_replace(lower(coalesce(mc.company_name,'')),'[^[:alnum:]]','','g')=c.normalized_company)
      ORDER BY c.total_revenue DESC NULLS LAST,c.last_order_date DESC,c.customer_id LIMIT 1;
    IF NOT FOUND THEN RETURN jsonb_build_object('route','none','reason','no_candidates'); END IF;
    SELECT jsonb_agg(DISTINCT lower(btrim(mc.email))) INTO v_emails FROM public.master_customers mc
      WHERE mc.id=v_candidate.customer_id OR
        (v_candidate.org_key LIKE 'domain:%' AND lower(split_part(btrim(mc.email),'@',2))=substr(v_candidate.org_key,8)) OR
        (v_candidate.normalized_company IS NOT NULL AND regexp_replace(lower(coalesce(mc.company_name,'')),'[^[:alnum:]]','','g')=v_candidate.normalized_company);
    INSERT INTO public.repeat_business_outreach(campaign_key,organization_key,company_key,customer_id,customer_email,customer_name,company_name,last_order_date,last_order_value,total_orders,total_revenue,status,claim_token,execution_id,verification)
      VALUES(v_campaign,v_candidate.org_key,v_candidate.normalized_company,v_candidate.customer_id,v_candidate.normalized_email,
      concat_ws(' ',v_candidate.first_name,v_candidate.last_name),v_candidate.company_name,v_candidate.last_order_date,v_candidate.last_order_value,
      v_candidate.total_orders,v_candidate.total_revenue,'reserved',gen_random_uuid(),p_execution_id,jsonb_build_object('organization_emails',v_emails))
      RETURNING * INTO v_row;
    END IF;
    END IF; -- bounded preflight retry or original candidate selection
    -- All firm contacts are searched; only real historical buyers must exist in Shopify.
    SELECT jsonb_agg(DISTINCT lower(btrim(mc.email))) INTO v_emails FROM public.master_customers mc
      WHERE mc.id=v_row.customer_id OR
        (v_row.organization_key LIKE 'domain:%' AND lower(split_part(btrim(mc.email),'@',2))=substr(v_row.organization_key,8)) OR
        (v_row.company_key IS NOT NULL AND regexp_replace(lower(coalesce(mc.company_name,'')),'[^[:alnum:]]','','g')=v_row.company_key);
    UPDATE public.repeat_business_outreach o SET verification=o.verification||jsonb_build_object(
      'organization_emails',v_emails,
      'organization_order_emails',(SELECT coalesce(jsonb_agg(DISTINCT lower(btrim(mc.email))),'[]'::jsonb)
        FROM public.master_customers mc WHERE lower(btrim(mc.email)) IN (SELECT jsonb_array_elements_text(v_emails))
        AND (mc.id=v_row.customer_id OR EXISTS(SELECT 1 FROM public.master_orders mo WHERE mo.customer_id=mc.id AND mo.shopify_order_id IS NOT NULL))))
      WHERE o.id=v_row.id RETURNING o.* INTO v_row;
  END IF;
  RETURN to_jsonb(v_row)||jsonb_build_object('route','reserved','organization_emails',v_row.verification->'organization_emails');
END;
$function$;

COMMIT;
