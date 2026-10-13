-- NEONTRIP: manual partial reconciliation already knows the exact outstanding
-- instalment. Its n8n workflow owns the per-Qonto projection job. Do not also
-- enqueue the cumulative total through the generic projection job.
-- Preserve the currently deployed function, including the Skonto policy.
DO $migration$
DECLARE
  original text := pg_get_functiondef('public.billing_payment_ingest(text,text,text,bigint,text,timestamptz,text,jsonb)'::regprocedure);
  guard_anchor text := '  select coalesce(sum(amount_cents),0)+p_amount_cents into v_total';
  branch_anchor text := '    elsif v_case.final_invoice_at is not null then';
  patched text;
BEGIN
  IF (length(original)-length(replace(original,guard_anchor,'')))/length(guard_anchor) <> 1
     OR (length(original)-length(replace(original,branch_anchor,'')))/length(branch_anchor) <> 1
     OR position('EXACT_EXISTING_INVOICE_REMAINDER' in original) > 0 THEN
    RAISE EXCEPTION 'BILLING_MANUAL_PARTIAL_FUNCTION_DRIFT';
  END IF;
  patched := replace(original,guard_anchor,$guard$
  -- BEGIN manual partial projection guard
  if p_evidence->>'projectionPolicy' = 'EXACT_EXISTING_INVOICE_REMAINDER' then
    if p_provider <> 'QONTO'
       or p_evidence->>'source' is distinct from 'NEONTRIP Manual Shopify Paid Qonto Reconciliation v1'
       or v_case.final_invoice_at is null
       or coalesce(p_evidence->>'manualShopifyTransactionId','') !~ '^[0-9]+$'
       or coalesce(p_evidence->>'easybillPaidCentsBefore','') !~ '^[0-9]+$'
       or coalesce(p_evidence->>'easybillRemainingCentsBefore','') !~ '^[0-9]+$'
       or (p_evidence->>'easybillPaidCentsBefore')::bigint <= 0
       or (p_evidence->>'easybillRemainingCentsBefore')::bigint <= 0
       or (p_evidence->>'easybillPaidCentsBefore')::bigint
          + (p_evidence->>'easybillRemainingCentsBefore')::bigint <> v_case.total_gross_cents
       or jsonb_typeof(p_evidence->'qontoTransactionIds') is distinct from 'array'
       or not coalesce((p_evidence->'qontoTransactionIds') ? p_provider_transaction_id,false)
       or not exists (
         select 1 from public.billing_documents d
         where d.billing_case_id=v_case.id and d.document_type='INVOICE'
           and d.status in ('FINALIZED','SENT')
           and d.easybill_document_id=p_evidence->>'easybillDocumentId'
           and d.amount_cents=v_case.total_gross_cents and d.currency=v_case.currency
       ) then
      raise exception 'BILLING_MANUAL_PARTIAL_PROJECTION_EVIDENCE_INVALID';
    end if;
  end if;
  -- END manual partial projection guard

$guard$ || guard_anchor);
  patched := replace(patched,branch_anchor,
    '    elsif v_case.final_invoice_at is not null and coalesce(p_evidence->>''projectionPolicy'','''') <> ''EXACT_EXISTING_INVOICE_REMAINDER'' then');
  EXECUTE patched;
END;
$migration$;
