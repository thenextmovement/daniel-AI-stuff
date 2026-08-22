alter table public.billing_jobs drop constraint if exists billing_jobs_type_check;
alter table public.billing_jobs add constraint billing_jobs_type_check check (job_type in (
  'CREATE_PROFORMA', 'CREATE_INVOICE', 'CREATE_CREDIT', 'CREATE_CANCELLATION',
  'VOID_PROFORMA', 'PROJECT_PAYMENT_SHOPIFY', 'PROJECT_PAYMENT_EASYBILL',
  'SEND_CUSTOMER_DOCUMENT', 'NOTIFY_CHANGE_REQUEST', 'VERIFY_VAT',
  'SYNC_SHOPIFY_TAX', 'RECONCILE'
));

create or replace function public.billing_portal_submit_change(p_portal_token_hash text,p_idempotency_key text,p_changes jsonb,p_requester_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_case public.billing_cases; v_request public.billing_change_requests;
begin
  select * into v_case from public.billing_cases where portal_token_hash=p_portal_token_hash and portal_revoked_at is null for update;
  if not found then raise exception 'BILLING_PORTAL_NOT_FOUND'; end if;
  if v_case.final_invoice_at is not null then raise exception 'BILLING_PORTAL_READ_ONLY'; end if;
  insert into public.billing_change_requests (billing_case_id,idempotency_key,source,requested_changes,requester_email)
  values (v_case.id,p_idempotency_key,'CUSTOMER_PORTAL',p_changes,nullif(p_requester_email,''))
  on conflict (idempotency_key) do update set idempotency_key=excluded.idempotency_key returning * into v_request;
  insert into public.billing_events (billing_case_id,idempotency_key,event_type,source,actor,correlation_id,payload)
  values (v_case.id,'event:'||p_idempotency_key,'CHANGE_REQUEST_SUBMITTED','CUSTOMER_PORTAL','customer',p_idempotency_key,jsonb_build_object('changeRequestId',v_request.id)) on conflict (idempotency_key) do nothing;
  insert into public.billing_jobs (billing_case_id,idempotency_key,job_type,payload)
  values (
    v_case.id,
    'notify-change-request:'||v_request.id::text,
    'NOTIFY_CHANGE_REQUEST',
    jsonb_build_object(
      'changeRequestId',v_request.id,
      'shopifyOrderName',v_case.shopify_order_name,
      'requesterEmail',nullif(p_requester_email,''),
      'requestedChanges',v_request.requested_changes,
      'submittedAt',v_request.created_at
    )
  ) on conflict (idempotency_key) do nothing;
  return jsonb_build_object('id',v_request.id,'status',v_request.status,'billingCaseId',v_case.id);
end;
$$;

create or replace function public.billing_job_claim(p_worker text,p_job_types text[],p_lease_seconds integer default 120)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_job public.billing_jobs; v_case public.billing_cases; v_lease text; v_invoice jsonb;
begin
  if length(trim(coalesce(p_worker,'')))<3 then raise exception 'BILLING_WORKER_REQUIRED'; end if;
  if coalesce(array_length(p_job_types,1),0)=0 or not (p_job_types <@ array['CREATE_PROFORMA','CREATE_INVOICE','CREATE_CREDIT','CREATE_CANCELLATION','VOID_PROFORMA','PROJECT_PAYMENT_SHOPIFY','PROJECT_PAYMENT_EASYBILL','SEND_CUSTOMER_DOCUMENT','NOTIFY_CHANGE_REQUEST','VERIFY_VAT','SYNC_SHOPIFY_TAX','RECONCILE']::text[]) then raise exception 'BILLING_JOB_TYPES_INVALID'; end if;
  v_lease := gen_random_uuid()::text;
  select * into v_job from public.billing_jobs
    where job_type=any(p_job_types)
      and (status='PENDING' or (status='FAILED' and next_attempt_at<=now()) or (status='PROCESSING' and lease_expires_at<=now()))
    order by created_at asc for update skip locked limit 1;
  if not found then return null; end if;
  update public.billing_jobs set status='PROCESSING',attempt_count=attempt_count+1,lease_token=v_lease,lease_expires_at=now()+make_interval(secs=>greatest(30,least(coalesce(p_lease_seconds,120),600))),last_error=null where id=v_job.id returning * into v_job;
  select * into v_case from public.billing_cases where id=v_job.billing_case_id;
  select to_jsonb(d) into v_invoice from public.billing_documents d where d.billing_case_id=v_case.id and d.document_type='INVOICE' and d.status in ('FINALIZED','SENT') order by d.created_at desc limit 1;
  return jsonb_build_object('job',to_jsonb(v_job),'billingCase',to_jsonb(v_case),'originalInvoice',v_invoice);
end;
$$;

revoke all on function public.billing_portal_submit_change(text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.billing_portal_submit_change(text,text,jsonb,text) to service_role;
revoke all on function public.billing_job_claim(text,text[],integer) from public,anon,authenticated;
grant execute on function public.billing_job_claim(text,text[],integer) to service_role;

create or replace function public.billing_job_complete(p_job_id uuid,p_lease_token text,p_success boolean,p_result jsonb default '{}'::jsonb,p_error text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_job public.billing_jobs; v_case public.billing_cases; v_type text; v_revision integer; v_number text; v_easybill_id text; v_retry timestamptz;
begin
  select * into v_job from public.billing_jobs where id=p_job_id and status='PROCESSING' and lease_token=p_lease_token and lease_expires_at>now() for update;
  if not found then raise exception 'BILLING_JOB_LEASE_INVALID'; end if;
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
      elsif v_type='PROFORMA' then
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
$$;

revoke all on function public.billing_job_complete(uuid,text,boolean,jsonb,text) from public,anon,authenticated;
grant execute on function public.billing_job_complete(uuid,text,boolean,jsonb,text) to service_role;
