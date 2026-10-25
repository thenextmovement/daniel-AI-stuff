-- Restore only the reviewed claim function. Preserve historical receipts; never drop evidence.
DO $rollback$
DECLARE source text:=pg_get_functiondef('public.billing_manual_paid_claim(jsonb)'::regprocedure);
BEGIN
 source:=replace(source,$old$return public.billing_manual_paid_record_claim_receipt(p_request,jsonb_build_object('ok',true,'scope','MANUAL_SHOPIFY_PAID','intake',v_intake,'claimed',null,'legacySelected',null));$old$,$new$return jsonb_build_object('ok',true,'scope','MANUAL_SHOPIFY_PAID','intake',v_intake,'claimed',null,'legacySelected',null);$new$);
 source:=replace(source,$old$return public.billing_manual_paid_record_claim_receipt(p_request,jsonb_build_object('ok',true,'scope','MANUAL_SHOPIFY_PAID','intake',v_intake,'claimed',null,'legacySelected',v_legacy));$old$,$new$return jsonb_build_object('ok',true,'scope','MANUAL_SHOPIFY_PAID','intake',v_intake,'claimed',null,'legacySelected',v_legacy);$new$);
 source:=replace(source,$old$return public.billing_manual_paid_record_claim_receipt(p_request,jsonb_build_object('ok',true,'scope','MANUAL_SHOPIFY_PAID','intake',v_intake,'claimed',v_claimed,'legacySelected',null));$old$,$new$return jsonb_build_object('ok',true,'scope','MANUAL_SHOPIFY_PAID','intake',v_intake,'claimed',v_claimed,'legacySelected',null);$new$);
 IF md5(source)<>'fc007fbabfde868c6df063777801fb68' THEN RAISE EXCEPTION 'MANUAL_PAID_CLAIM_ROLLBACK_DRIFT'; END IF;
 EXECUTE source;
END $rollback$;
DROP FUNCTION public.billing_manual_paid_record_claim_receipt(jsonb,jsonb);
REVOKE INSERT ON public.billing_manual_paid_claim_receipts FROM service_role;
