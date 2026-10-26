-- Issue #231: read-only snapshot of real production worker functions, 2026-10-26.
-- Synthetic-data offline tests only. No credentials or customer records.
-- billing_job_claim MD5 1008a11de20dcc637e4021ee67ef9f85
CREATE OR REPLACE FUNCTION public.billing_job_claim(p_worker text, p_job_types text[], p_lease_seconds integer DEFAULT 120)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_job public.billing_jobs; v_case public.billing_cases; v_lease text; v_invoice jsonb; v_collective public.billing_payments;
begin
  if length(trim(coalesce(p_worker,'')))<3 then raise exception 'BILLING_WORKER_REQUIRED'; end if;
  if coalesce(array_length(p_job_types,1),0)=0 or not (p_job_types <@ array['CREATE_PROFORMA','CREATE_INVOICE','CREATE_CREDIT','CREATE_CANCELLATION','VOID_PROFORMA','PROJECT_PAYMENT_SHOPIFY','PROJECT_PAYMENT_EASYBILL','SEND_CUSTOMER_DOCUMENT','NOTIFY_CHANGE_REQUEST','VERIFY_VAT','SYNC_SHOPIFY_TAX','RECONCILE']::text[]) then raise exception 'BILLING_JOB_TYPES_INVALID'; end if;
  v_lease := gen_random_uuid()::text;
  select * into v_job from public.billing_jobs
    where job_type=any(p_job_types)
      and not (job_type='RECONCILE' and coalesce(payload->>'scope','')='MANUAL_SHOPIFY_PAID')
      and (status='PENDING' or (status='FAILED' and next_attempt_at<=now()) or (status='PROCESSING' and lease_expires_at<=now()))
      and case when payload ? 'collectiveRequiredShopifyPaymentIds' then
        case when jsonb_typeof(payload->'collectiveRequiredShopifyPaymentIds')='array' then
          jsonb_array_length(payload->'collectiveRequiredShopifyPaymentIds') between 2 and 10
          and (select count(*)=jsonb_array_length(billing_jobs.payload->'collectiveRequiredShopifyPaymentIds')
               and bool_and(bp.shopify_projection_status='DONE' and bp.evidence->>'collectivePaymentId'=billing_jobs.payload->>'collectivePaymentId'
                 and bc.cancelled_at is null and bc.refunded_at is null and bc.tax_review_status<>'REVIEW_REQUIRED'
                 and bc.status in ('INVOICE_PENDING','INVOICED') and bc.total_gross_cents=bp.amount_cents and bc.currency=bp.currency and bc.paid_at is not null)
               from public.billing_payments bp join public.billing_cases bc on bc.id=bp.billing_case_id where bp.id::text in
                 (select jsonb_array_elements_text(billing_jobs.payload->'collectiveRequiredShopifyPaymentIds')))
        else false end
      else true end
    order by created_at asc for update skip locked limit 1;
  if not found then return null; end if;
  update public.billing_jobs set status='PROCESSING',attempt_count=attempt_count+1,lease_token=v_lease,lease_expires_at=now()+make_interval(secs=>greatest(30,least(coalesce(p_lease_seconds,120),600))),last_error=null where id=v_job.id returning * into v_job;
  select * into v_case from public.billing_cases where id=v_job.billing_case_id;
  select to_jsonb(d) into v_invoice from public.billing_documents d where d.billing_case_id=v_case.id and d.document_type='INVOICE' and d.status in ('FINALIZED','SENT') order by d.created_at desc limit 1;
  if v_job.job_type='PROJECT_PAYMENT_EASYBILL' then
    select * into v_collective from billing_payments where billing_case_id=v_case.id
      and match_status='MATCHED' and evidence ? 'collectivePaymentId';
    if found then
      if v_collective.amount_cents<>(v_job.payload->>'amountCents')::bigint then raise exception 'COLLECTIVE_PROJECTION_AMOUNT'; end if;
      v_job.payload:=v_job.payload||jsonb_build_object('collectivePaymentId',v_collective.evidence->>'collectivePaymentId','collectiveAllocationId',v_collective.provider_transaction_id);
    end if;
  end if;
  return jsonb_build_object('job',to_jsonb(v_job),'billingCase',to_jsonb(v_case),'originalInvoice',v_invoice);
end;
$function$
;

-- billing_job_complete MD5 88bab2b24b0ab9df1ea69dc6949f4ac5
CREATE OR REPLACE FUNCTION public.billing_job_complete(p_job_id uuid, p_lease_token text, p_success boolean, p_result jsonb DEFAULT '{}'::jsonb, p_error text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare v_job public.billing_jobs; v_case public.billing_cases; v_type text; v_revision integer; v_number text; v_easybill_id text; v_retry timestamptz;
begin
  select * into v_job from public.billing_jobs where id=p_job_id and status='PROCESSING' and lease_token=p_lease_token and lease_expires_at>now() for update;
  if not found then raise exception 'BILLING_JOB_LEASE_INVALID'; end if;
  if v_job.job_type='RECONCILE' and v_job.payload->>'scope'='MANUAL_SHOPIFY_PAID' then
    raise exception 'BILLING_JOB_SCOPE_REQUIRED';
  end if;
  select * into v_case from public.billing_cases where id=v_job.billing_case_id for update;
  if p_success then
    update public.billing_jobs set status='DONE',lease_token=null,lease_expires_at=null,next_attempt_at=null,last_error=null where id=v_job.id returning * into v_job;
    if v_job.job_type in ('CREATE_PROFORMA','CREATE_INVOICE','CREATE_CREDIT','CREATE_CANCELLATION') then
      v_type := case v_job.job_type when 'CREATE_PROFORMA' then 'PROFORMA' when 'CREATE_INVOICE' then 'INVOICE' when 'CREATE_CREDIT' then 'CREDIT' else 'CANCELLATION' end;
      v_revision := case when v_type='INVOICE' then 0 else coalesce((v_job.payload->>'revision')::integer,0) end;
      v_number := coalesce(nullif(p_result->>'documentNumber',''),v_job.payload->>'documentNumber');
      v_easybill_id := nullif(p_result->>'easybillDocumentId','');
      if v_number is null or v_easybill_id is null then raise exception 'BILLING_DOCUMENT_RESULT_INVALID'; end if;
      insert into public.billing_documents (billing_case_id,document_type,revision,document_number,status,easybill_document_id,payload_hash,amount_cents,currency,finalized_at,sent_at)
        values (v_case.id,v_type,v_revision,v_number,case when coalesce((p_result->>'sent')::boolean,false) then 'SENT' else 'FINALIZED' end,v_easybill_id,coalesce(nullif(p_result->>'payloadHash',''),encode(extensions.digest(v_job.payload::text,'sha256'),'hex')),case when v_type='CREDIT' then (v_job.payload->>'amountCents')::bigint when v_type='CANCELLATION' then coalesce((v_job.payload->>'invoiceAmountCents')::bigint,v_case.total_gross_cents) else v_case.total_gross_cents end,v_case.currency,now(),case when coalesce((p_result->>'sent')::boolean,false) then now() else null end)
        on conflict (billing_case_id,document_type,revision) do update set status=excluded.status,easybill_document_id=excluded.easybill_document_id,finalized_at=excluded.finalized_at,sent_at=excluded.sent_at,updated_at=now();
      if v_type='INVOICE' then
        update public.billing_cases set status='INVOICED',final_invoice_at=coalesce(final_invoice_at,now()),lock_version=lock_version+1 where id=v_case.id returning * into v_case;
        if v_case.paid_at is not null then
          insert into public.billing_jobs (billing_case_id,idempotency_key,job_type,payload)
            values (v_case.id,'billing:'||v_case.id::text||':project-payment-easybill','PROJECT_PAYMENT_EASYBILL',jsonb_build_object('documentId',v_easybill_id,'amountCents',v_case.total_gross_cents,'paidAt',v_case.paid_at))
            on conflict (idempotency_key) do nothing;
        end if;
      elsif v_type='PROFORMA' and v_case.paid_at is null and v_case.final_invoice_at is null then
        update public.billing_cases set status=case when tax_review_status='REVIEW_REQUIRED' then 'MANUAL_REVIEW' else 'PAYMENT_PENDING' end,lock_version=lock_version+1 where id=v_case.id returning * into v_case;
      end if;
    elsif v_job.job_type='VOID_PROFORMA' then
      update public.billing_documents set status='SUPERSEDED',updated_at=now()
        where billing_case_id=v_case.id and easybill_document_id=coalesce(nullif(p_result->>'easybillDocumentId',''),v_job.payload->>'easybillDocumentId');
    elsif v_job.job_type='PROJECT_PAYMENT_SHOPIFY' then
      update public.billing_payments set shopify_projection_status='DONE' where id=(v_job.payload->>'paymentId')::uuid;
    elsif v_job.job_type='PROJECT_PAYMENT_EASYBILL' then
      update public.billing_payments set easybill_projection_status='DONE' where billing_case_id=v_case.id and match_status='MATCHED';
    end if;
    insert into public.billing_events (billing_case_id,idempotency_key,event_type,source,actor,correlation_id,payload)
      values (v_case.id,'job-done:'||v_job.id::text,'BILLING_JOB_DONE','N8N',coalesce(p_result->>'worker','billing-worker'),v_job.id::text,coalesce(p_result,'{}'::jsonb)) on conflict (idempotency_key) do nothing;
  else
    v_retry := case v_job.attempt_count when 1 then now()+interval '1 minute' when 2 then now()+interval '5 minutes' when 3 then now()+interval '15 minutes' else null end;
    update public.billing_jobs set status=case when v_retry is null then 'BLOCKED' else 'FAILED' end,next_attempt_at=v_retry,lease_token=null,lease_expires_at=null,last_error=left(coalesce(p_error,'Unbekannter Adapterfehler'),2000) where id=v_job.id returning * into v_job;
    if v_job.job_type='PROJECT_PAYMENT_SHOPIFY' then update public.billing_payments set shopify_projection_status='FAILED' where id=(v_job.payload->>'paymentId')::uuid; end if;
    if v_job.job_type='PROJECT_PAYMENT_EASYBILL' then update public.billing_payments set easybill_projection_status='FAILED' where billing_case_id=v_case.id and match_status='MATCHED'; end if;
    if v_retry is null then
      if v_job.job_type='NOTIFY_CHANGE_REQUEST' then
        insert into public.billing_incidents (billing_case_id,incident_key,severity,title,summary,details)
          values (
            v_case.id,
            'change-request-notification-blocked:'||v_job.id::text,
            'URGENT',
            'Rechnungsänderung wartet ohne interne Benachrichtigung',
            'Die Kundenanfrage ist sicher gespeichert, aber die interne Prüf-E-Mail konnte nach vier Versuchen nicht versendet werden.',
            jsonb_build_object('jobId',v_job.id,'jobType',v_job.job_type,'error',p_error,'shopifyOrderName',v_case.shopify_order_name,'changeRequestId',v_job.payload->>'changeRequestId')
          ) on conflict (incident_key) do nothing;
      else
        update public.billing_cases set status='SYNC_BLOCKED',lock_version=lock_version+1 where id=v_case.id returning * into v_case;
        insert into public.billing_incidents (billing_case_id,incident_key,severity,title,summary,details)
          values (v_case.id,'job-blocked:'||v_job.id::text,'URGENT','Fehler Rechnung Shopify/Easybill','Ein Billing-Job ist nach vier Versuchen blockiert. Keine weiteren automatischen Finanzaktionen werden ausgeführt.',jsonb_build_object('jobId',v_job.id,'jobType',v_job.job_type,'error',p_error,'shopifyOrderName',v_case.shopify_order_name)) on conflict (incident_key) do nothing;
      end if;
    end if;
  end if;
  return jsonb_build_object('jobId',v_job.id,'status',v_job.status,'billingCaseId',v_case.id,'billingCaseStatus',v_case.status,'nextAttemptAt',v_job.next_attempt_at);
end;
$function$
;

-- Issue #231: real CompanyBrain transition/trigger definitions; offline only.
CREATE OR REPLACE FUNCTION public.guard_company_brain_incident_event_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  raise exception 'company_brain_incident_events_are_append_only';
end;
$function$
;
CREATE OR REPLACE FUNCTION public.preserve_company_brain_specific_workflow_cause()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  has_later_delivery boolean := false;
  failure_anchor_at timestamptz := old.first_seen_at;
begin
  if old.incident_type <> 'workflow_failure' then
    return new;
  end if;

  if old.root_cause_code not in ('workflow_hard_error','offer_api_failed','automation_failed','unknown')
    and new.root_cause_code in ('workflow_hard_error','offer_api_failed','automation_failed','unknown') then
    new.root_cause_code := old.root_cause_code;
    new.detail := old.detail;
    new.playbook_key := old.playbook_key;
    new.playbook_version := old.playbook_version;
    new.severity := old.severity;
    new.owner_team := old.owner_team;
    new.metadata := coalesce(old.metadata, '{}'::jsonb) || coalesce(new.metadata, '{}'::jsonb);
  end if;

  if old.source_ref like 'workflow_audit:%' then
    select audit.created_at
    into failure_anchor_at
    from public.workflow_audit_log audit
    where audit.id::text = split_part(old.source_ref, ':', 2)
    limit 1;
    failure_anchor_at := coalesce(failure_anchor_at, old.first_seen_at);
  end if;

  if old.status = 'resolved' and new.status = 'open' then
    select exists (
      select 1
      from public.workflow_audit_log audit
      where lower(coalesce(audit.status,'')) in ('success','sent','completed','ok')
        and lower(coalesce(audit.action,'')) in ('initial_delivery_complete','guarded_offer_resend','offer_sent_recorded')
        and audit.created_at >= failure_anchor_at
        and (
          (old.request_id is not null and coalesce(nullif(audit.metadata->>'request_id',''), nullif(audit.document_id,'')) = old.request_id)
          or (old.trello_card_id is not null and nullif(audit.metadata->>'trello_card_id','') = old.trello_card_id)
          or (old.offer_id is not null and nullif(audit.metadata->>'offer_id','') = old.offer_id)
        )
    ) into has_later_delivery;

    if has_later_delivery then
      new.status := old.status;
      new.acknowledged_at := old.acknowledged_at;
      new.acknowledged_by := old.acknowledged_by;
      new.resolved_at := old.resolved_at;
      new.resolved_by := old.resolved_by;
      new.resolution_note := old.resolution_note;
    end if;
  end if;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.touch_company_brain_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.transition_company_brain_incident(p_incident_id uuid, p_status text, p_actor text, p_note text DEFAULT NULL::text, p_assigned_to text DEFAULT NULL::text)
 RETURNS company_brain_operational_incidents
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  current_row public.company_brain_operational_incidents;
  saved_row public.company_brain_operational_incidents;
  normalized_status text := lower(btrim(p_status));
  normalized_actor text := lower(btrim(p_actor));
  normalized_note text := nullif(btrim(p_note), '');
begin
  if normalized_actor = '' then
    raise exception 'company_brain_incident_actor_required';
  end if;
  if normalized_status not in ('open', 'acknowledged', 'resolved', 'ignored') then
    raise exception 'company_brain_incident_invalid_transition';
  end if;
  if normalized_status in ('resolved', 'ignored') and char_length(coalesce(normalized_note, '')) < 10 then
    raise exception 'company_brain_incident_resolution_note_required';
  end if;

  select * into current_row
  from public.company_brain_operational_incidents
  where id = p_incident_id
  for update;
  if current_row.id is null then
    raise exception 'company_brain_incident_not_found';
  end if;

  if current_row.status = normalized_status
     and coalesce(current_row.assigned_to, '') = coalesce(nullif(lower(btrim(p_assigned_to)), ''), current_row.assigned_to, '') then
    return current_row;
  end if;

  update public.company_brain_operational_incidents
  set status = normalized_status,
      assigned_to = coalesce(nullif(lower(btrim(p_assigned_to)), ''), assigned_to),
      acknowledged_at = case when normalized_status = 'acknowledged' then now() when normalized_status = 'open' then null else acknowledged_at end,
      acknowledged_by = case when normalized_status = 'acknowledged' then normalized_actor when normalized_status = 'open' then null else acknowledged_by end,
      resolved_at = case when normalized_status = 'resolved' then now() when normalized_status = 'open' then null else resolved_at end,
      resolved_by = case when normalized_status = 'resolved' then normalized_actor when normalized_status = 'open' then null else resolved_by end,
      resolution_note = case when normalized_status in ('resolved', 'ignored') then normalized_note when normalized_status = 'open' then null else resolution_note end
  where id = current_row.id
  returning * into saved_row;

  insert into public.company_brain_incident_events (
    incident_id, event_type, actor, previous_status, new_status, note, snapshot
  ) values (
    saved_row.id,
    case normalized_status
      when 'acknowledged' then 'acknowledged'
      when 'resolved' then 'resolved'
      when 'ignored' then 'ignored'
      else 'reopened'
    end,
    normalized_actor,
    current_row.status,
    saved_row.status,
    normalized_note,
    jsonb_build_object('assigned_to', saved_row.assigned_to)
  );
  return saved_row;
end;
$function$
;
create trigger trg_company_brain_operational_incidents_updated_at before update on public.company_brain_operational_incidents for each row execute function public.touch_company_brain_updated_at();
create trigger trg_preserve_company_brain_specific_workflow_cause before update on public.company_brain_operational_incidents for each row execute function public.preserve_company_brain_specific_workflow_cause();
create trigger trg_company_brain_incident_events_immutable before update or delete on public.company_brain_incident_events for each row execute function public.guard_company_brain_incident_event_immutable();