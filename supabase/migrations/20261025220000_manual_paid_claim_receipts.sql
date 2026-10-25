-- NEONTRIP only: retain claim/input identity in the same transaction as admission/lease.
-- A receipt is evidence of selection, NOT payment completion or replay authorization.
DO $$ BEGIN
 IF md5(pg_get_functiondef('public.billing_manual_paid_claim(jsonb)'::regprocedure))<>'fc007fbabfde868c6df063777801fb68'
 THEN RAISE EXCEPTION 'MANUAL_PAID_CLAIM_SOURCE_DRIFT'; END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.billing_manual_paid_claim_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 execution_id text NOT NULL CHECK (execution_id ~ '^[0-9]{1,30}$'),
 operation text NOT NULL CHECK (operation IN ('admit','claim')),
 worker text NOT NULL,
 request_fingerprint text NOT NULL CHECK (request_fingerprint ~ '^[a-f0-9]{64}$'),
 evidence jsonb NOT NULL CHECK (jsonb_typeof(evidence)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS billing_manual_paid_claim_receipts_execution_idx
 ON public.billing_manual_paid_claim_receipts(execution_id,created_at);
ALTER TABLE public.billing_manual_paid_claim_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_manual_paid_claim_receipts FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT ON public.billing_manual_paid_claim_receipts TO service_role;
DROP POLICY IF EXISTS manual_paid_claim_receipts_read ON public.billing_manual_paid_claim_receipts;
DROP POLICY IF EXISTS manual_paid_claim_receipts_append ON public.billing_manual_paid_claim_receipts;
CREATE POLICY manual_paid_claim_receipts_read ON public.billing_manual_paid_claim_receipts FOR SELECT TO service_role USING (true);
CREATE POLICY manual_paid_claim_receipts_append ON public.billing_manual_paid_claim_receipts FOR INSERT TO service_role WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.billing_manual_paid_record_claim_receipt(p_request jsonb,p_response jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'public','extensions' AS $receipt$
DECLARE
 candidates jsonb; selected jsonb; selection text:='none';
BEGIN
 -- Whitelist identifiers: never copy the job/case, lease token, source payload or customer data.
 SELECT coalesce(jsonb_agg(jsonb_build_object('origin',c->>'origin','shopifyOrderId',c->>'shopifyOrderId',
   'shopifyOrderName',c->>'shopifyOrderName')),'[]'::jsonb) INTO candidates
 FROM jsonb_array_elements(p_request->'candidates') c;
 IF p_response->'claimed' IS NOT NULL AND p_response->'claimed'<>'null'::jsonb THEN
   selection:='canonical';
   selected:=jsonb_build_object('jobId',p_response#>>'{claimed,job,id}',
     'billingCaseId',p_response#>>'{claimed,billingCase,id}',
     'shopifyOrderId',p_response#>>'{claimed,job,payload,input,observation,shopifyOrderId}',
     'shopifyOrderName',p_response#>>'{claimed,billingCase,shopify_order_name}',
     'inputGeneration',p_response#>'{claimed,claimContext,inputGeneration}',
     'inputFingerprint',p_response#>>'{claimed,claimContext,inputFingerprint}',
     'bindingFingerprint',p_response#>>'{claimed,claimContext,bindingFingerprint}',
     'startedAt',p_response#>>'{claimed,claimContext,startedAt}');
 ELSIF p_response->'legacySelected' IS NOT NULL AND p_response->'legacySelected'<>'null'::jsonb THEN
   selection:='legacy';
   selected:=jsonb_build_object('origin',p_response#>>'{legacySelected,origin}',
     'shopifyOrderId',p_response#>>'{legacySelected,shopifyOrderId}',
     'shopifyOrderName',p_response#>>'{legacySelected,shopifyOrderName}');
 END IF;
 INSERT INTO public.billing_manual_paid_claim_receipts(execution_id,operation,worker,request_fingerprint,evidence)
 VALUES(p_request->>'executionId',p_request->>'operation',p_request->>'worker',
   encode(extensions.digest(p_request::text,'sha256'),'hex'),
   jsonb_build_object('workflowId','6NZnfGpyfUVikqpf','scope','MANUAL_SHOPIFY_PAID',
     'candidates',candidates,'intake',p_response->'intake','selection',selection,'selected',selected));
 RETURN p_response;
END $receipt$;
REVOKE ALL ON FUNCTION public.billing_manual_paid_record_claim_receipt(jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_manual_paid_record_claim_receipt(jsonb,jsonb) TO service_role;

DO $patch$
DECLARE source text:=pg_get_functiondef('public.billing_manual_paid_claim(jsonb)'::regprocedure);
BEGIN
 IF md5(source)<>'fc007fbabfde868c6df063777801fb68' THEN RAISE EXCEPTION 'MANUAL_PAID_CLAIM_SOURCE_DRIFT'; END IF;
 source:=replace(source,$old$return jsonb_build_object('ok',true,'scope','MANUAL_SHOPIFY_PAID','intake',v_intake,'claimed',null,'legacySelected',null);$old$,$new$return public.billing_manual_paid_record_claim_receipt(p_request,jsonb_build_object('ok',true,'scope','MANUAL_SHOPIFY_PAID','intake',v_intake,'claimed',null,'legacySelected',null));$new$);
 source:=replace(source,$old$return jsonb_build_object('ok',true,'scope','MANUAL_SHOPIFY_PAID','intake',v_intake,'claimed',null,'legacySelected',v_legacy);$old$,$new$return public.billing_manual_paid_record_claim_receipt(p_request,jsonb_build_object('ok',true,'scope','MANUAL_SHOPIFY_PAID','intake',v_intake,'claimed',null,'legacySelected',v_legacy));$new$);
 source:=replace(source,$old$return jsonb_build_object('ok',true,'scope','MANUAL_SHOPIFY_PAID','intake',v_intake,'claimed',v_claimed,'legacySelected',null);$old$,$new$return public.billing_manual_paid_record_claim_receipt(p_request,jsonb_build_object('ok',true,'scope','MANUAL_SHOPIFY_PAID','intake',v_intake,'claimed',v_claimed,'legacySelected',null));$new$);
 EXECUTE source;
END $patch$;
