-- First disable collective routing and drain its pending jobs. Never remove financial records.\nDROP FUNCTION IF EXISTS public.billing_collective_payment_ingest(jsonb,jsonb);\nCREATE OR REPLACE FUNCTION public.billing_job_claim(p_worker text, p_job_types text[], p_lease_seconds integer DEFAULT 120)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_job public.billing_jobs; v_case public.billing_cases; v_lease text; v_invoice jsonb;
begin
  if length(trim(coalesce(p_worker,'')))<3 then raise exception 'BILLING_WORKER_REQUIRED'; end if;
  if coalesce(array_length(p_job_types,1),0)=0 or not (p_job_types <@ array['CREATE_PROFORMA','CREATE_INVOICE','CREATE_CREDIT','CREATE_CANCELLATION','VOID_PROFORMA','PROJECT_PAYMENT_SHOPIFY','PROJECT_PAYMENT_EASYBILL','SEND_CUSTOMER_DOCUMENT','NOTIFY_CHANGE_REQUEST','VERIFY_VAT','SYNC_SHOPIFY_TAX','RECONCILE']::text[]) then raise exception 'BILLING_JOB_TYPES_INVALID'; end if;
  v_lease := gen_random_uuid()::text;
  select * into v_job from public.billing_jobs
    where job_type=any(p_job_types)
      and not (job_type='RECONCILE' and coalesce(payload->>'scope','')='MANUAL_SHOPIFY_PAID')
      and (status='PENDING' or (status='FAILED' and next_attempt_at<=now()) or (status='PROCESSING' and lease_expires_at<=now()))
    order by created_at asc for update skip locked limit 1;
  if not found then return null; end if;
  update public.billing_jobs set status='PROCESSING',attempt_count=attempt_count+1,lease_token=v_lease,lease_expires_at=now()+make_interval(secs=>greatest(30,least(coalesce(p_lease_seconds,120),600))),last_error=null where id=v_job.id returning * into v_job;
  select * into v_case from public.billing_cases where id=v_job.billing_case_id;
  select to_jsonb(d) into v_invoice from public.billing_documents d where d.billing_case_id=v_case.id and d.document_type='INVOICE' and d.status in ('FINALIZED','SENT') order by d.created_at desc limit 1;
  return jsonb_build_object('job',to_jsonb(v_job),'billingCase',to_jsonb(v_case),'originalInvoice',v_invoice);
end;
$function$
