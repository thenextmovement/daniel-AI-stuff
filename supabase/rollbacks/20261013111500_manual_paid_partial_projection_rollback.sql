-- Disable the n8n ledger-based instalment release before this rollback.
DO $rollback$
DECLARE
  original text := pg_get_functiondef('public.billing_payment_ingest(text,text,text,bigint,text,timestamptz,text,jsonb)'::regprocedure);
  guard_start text := E'\n  -- BEGIN manual partial projection guard';
  guard_end text := E'  -- END manual partial projection guard\n\n';
  branch text := '    elsif v_case.final_invoice_at is not null and coalesce(p_evidence->>''projectionPolicy'','''') <> ''EXACT_EXISTING_INVOICE_REMAINDER'' then';
  start_at integer;
  end_at integer;
  restored text;
BEGIN
  start_at := position(guard_start in original);
  end_at := position(guard_end in original);
  IF start_at=0 OR end_at<=start_at OR position(branch in original)=0 THEN
    RAISE EXCEPTION 'BILLING_MANUAL_PARTIAL_ROLLBACK_DRIFT';
  END IF;
  restored := substring(original from 1 for start_at-1) || substring(original from end_at+length(guard_end));
  restored := replace(restored,branch,'    elsif v_case.final_invoice_at is not null then');
  EXECUTE restored;
END;
$rollback$;
