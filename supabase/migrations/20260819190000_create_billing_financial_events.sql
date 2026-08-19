create or replace function public.billing_payment_ingest(
  p_shopify_order_id text,p_provider text,p_provider_transaction_id text,p_amount_cents bigint,p_currency text,p_booked_at timestamptz,p_source_event_id text,p_evidence jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_case public.billing_cases; v_payment public.billing_payments; v_total bigint; v_match text;
begin
  select * into v_case from public.billing_cases where shopify_order_id=p_shopify_order_id or shopify_order_id='gid://shopify/Order/'||p_shopify_order_id for update;
  if not found then raise exception 'BILLING_CASE_NOT_FOUND'; end if;
  select * into v_payment from public.billing_payments where provider=p_provider and provider_transaction_id=p_provider_transaction_id;
  if found then return jsonb_build_object('id',v_payment.id,'duplicate',true,'matchStatus',v_payment.match_status,'billingCaseId',v_case.id); end if;
  if p_amount_cents<=0 or upper(p_currency)<>v_case.currency then raise exception 'BILLING_PAYMENT_INVALID'; end if;
  select coalesce(sum(amount_cents),0)+p_amount_cents into v_total from public.billing_payments where billing_case_id=v_case.id and match_status in ('MATCHED','PARTIAL');
  v_match := case when v_total=v_case.total_gross_cents then 'MATCHED' when v_total<v_case.total_gross_cents then 'PARTIAL' else 'OVERPAID' end;
  insert into public.billing_payments (billing_case_id,provider,provider_transaction_id,amount_cents,currency,booked_at,match_status,raw_reference,evidence)
    values (v_case.id,p_provider,p_provider_transaction_id,p_amount_cents,upper(p_currency),p_booked_at,v_match,p_evidence->>'reference',coalesce(p_evidence,'{}'::jsonb)) returning * into v_payment;
  insert into public.billing_events (billing_case_id,idempotency_key,event_type,source,actor,correlation_id,payload)
    values (v_case.id,p_source_event_id,'PAYMENT_INGESTED',p_provider,'system',p_provider_transaction_id,to_jsonb(v_payment)) on conflict (idempotency_key) do nothing;
  if v_match='MATCHED' then
    update public.billing_cases set paid_at=coalesce(paid_at,p_booked_at),status=case when tax_review_status='REVIEW_REQUIRED' then 'MANUAL_REVIEW' else 'INVOICE_PENDING' end,lock_version=lock_version+1 where id=v_case.id returning * into v_case;
    if v_case.tax_review_status<>'REVIEW_REQUIRED' and v_case.final_invoice_at is null then
      insert into public.billing_jobs (billing_case_id,idempotency_key,job_type,payload)
        values (v_case.id,'billing:'||v_case.id::text||':invoice','CREATE_INVOICE',jsonb_build_object('documentNumber',v_case.shopify_order_name,'trigger','PAYMENT_RECEIVED')) on conflict (idempotency_key) do nothing;
    end if;
    insert into public.billing_jobs (billing_case_id,idempotency_key,job_type,payload)
      values (v_case.id,'payment:'||v_payment.id::text||':shopify','PROJECT_PAYMENT_SHOPIFY',jsonb_build_object('paymentId',v_payment.id,'amountCents',p_amount_cents,'bookedAt',p_booked_at)) on conflict (idempotency_key) do nothing;
  else
    update public.billing_cases set status='MANUAL_REVIEW',lock_version=lock_version+1 where id=v_case.id returning * into v_case;
    insert into public.billing_incidents (billing_case_id,incident_key,severity,title,summary,details)
      values (v_case.id,'payment-review:'||v_payment.id::text,'WARNING',case when v_match='PARTIAL' then 'Teilzahlung manuell prüfen' else 'Überzahlung manuell prüfen' end,'Teil- oder Überzahlungen erzeugen nicht automatisch eine finale Rechnung.',jsonb_build_object('paymentId',v_payment.id,'amountCents',p_amount_cents,'cumulativeCents',v_total,'expectedCents',v_case.total_gross_cents)) on conflict (incident_key) do nothing;
  end if;
  return jsonb_build_object('id',v_payment.id,'duplicate',false,'matchStatus',v_match,'billingCaseId',v_case.id,'billingCaseStatus',v_case.status);
end;
$$;

create or replace function public.billing_shopify_event_ingest(
  p_shopify_order_id text,p_event_id text,p_event_type text,p_amount_cents bigint default 0,p_net_cents bigint default 0,p_vat_cents bigint default 0,p_currency text default 'EUR',p_occurred_at timestamptz default now(),p_payload jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_case public.billing_cases; v_revision integer; v_number text; v_remaining bigint;
begin
  select * into v_case from public.billing_cases where shopify_order_id=p_shopify_order_id or shopify_order_id='gid://shopify/Order/'||p_shopify_order_id for update;
  if not found then raise exception 'BILLING_CASE_NOT_FOUND'; end if;
  if exists(select 1 from public.billing_events where idempotency_key=p_event_id) then return jsonb_build_object('billingCaseId',v_case.id,'duplicate',true,'status',v_case.status); end if;
  if p_event_type not in ('ORDER_DELIVERED','ORDER_CANCELLED','REFUND_CREATED') then raise exception 'BILLING_SHOPIFY_EVENT_INVALID'; end if;

  if p_event_type='ORDER_DELIVERED' then
    update public.billing_cases set delivered_at=coalesce(delivered_at,p_occurred_at),status=case when payment_method='KAUF_AUF_RECHNUNG' and tax_review_status<>'REVIEW_REQUIRED' and final_invoice_at is null then 'INVOICE_PENDING' else 'DELIVERED' end,lock_version=lock_version+1 where id=v_case.id returning * into v_case;
    if v_case.payment_method='KAUF_AUF_RECHNUNG' and v_case.tax_review_status<>'REVIEW_REQUIRED' and v_case.final_invoice_at is null then
      insert into public.billing_jobs (billing_case_id,idempotency_key,job_type,payload)
        values (v_case.id,'billing:'||v_case.id::text||':invoice','CREATE_INVOICE',jsonb_build_object('documentNumber',v_case.shopify_order_name,'trigger','DELIVERED','paymentTermsDays',v_case.payment_terms_days)) on conflict (idempotency_key) do nothing;
    end if;
  elsif p_event_type='ORDER_CANCELLED' then
    if v_case.final_invoice_at is null then
      update public.billing_jobs set status='DONE',last_error='Order cancelled before Pro-forma creation',next_attempt_at=null where billing_case_id=v_case.id and job_type='CREATE_PROFORMA' and status in ('PENDING','FAILED');
      insert into public.billing_jobs (billing_case_id,idempotency_key,job_type,payload)
        select v_case.id,'shopify:'||p_event_id||':void-proforma:'||d.id::text,'VOID_PROFORMA',jsonb_build_object('documentId',d.id,'easybillDocumentId',d.easybill_document_id,'documentNumber',d.document_number,'sourceEventId',p_event_id)
        from public.billing_documents d where d.billing_case_id=v_case.id and d.document_type='PROFORMA' and d.easybill_document_id is not null and d.status in ('FINALIZED','SENT')
        on conflict (idempotency_key) do nothing;
      update public.billing_cases set status='CANCELLED',cancelled_at=p_occurred_at,lock_version=lock_version+1 where id=v_case.id returning * into v_case;
      update public.billing_documents set status='SUPERSEDED' where billing_case_id=v_case.id and document_type='PROFORMA' and status not in ('SUPERSEDED','FAILED');
    else
      select count(*)::integer into v_revision from public.billing_events where billing_case_id=v_case.id and event_type='ORDER_CANCELLED';
      v_number := 'ST-'||replace(v_case.shopify_order_name,'#','')||case when v_revision=0 then '' else '-'||v_revision::text end;
      insert into public.billing_jobs (billing_case_id,idempotency_key,job_type,payload)
        values (v_case.id,'shopify:'||p_event_id||':cancellation','CREATE_CANCELLATION',jsonb_build_object('revision',v_revision,'documentNumber',v_number,'invoiceAmountCents',v_case.total_gross_cents,'sourceEventId',p_event_id)) on conflict (idempotency_key) do nothing;
      update public.billing_cases set status='CANCELLED',cancelled_at=p_occurred_at,lock_version=lock_version+1 where id=v_case.id returning * into v_case;
    end if;
  elsif p_event_type='REFUND_CREATED' then
    if upper(p_currency)<>v_case.currency or p_amount_cents<=0 or p_net_cents<0 or p_vat_cents<0 or p_net_cents+p_vat_cents<>p_amount_cents or p_net_cents>v_case.subtotal_net_cents or p_vat_cents>v_case.vat_cents then raise exception 'BILLING_REFUND_TOTALS_INVALID'; end if;
    v_remaining := v_case.total_gross_cents-p_amount_cents;
    if v_case.final_invoice_at is null then
      if v_remaining>0 and (coalesce(jsonb_typeof(p_payload->'postLineItems'),'')<>'array' or jsonb_array_length(p_payload->'postLineItems')=0) then raise exception 'BILLING_REFUND_POST_LINES_REQUIRED'; end if;
      v_revision := v_case.current_revision+1;
      update public.billing_jobs set status='DONE',last_error='Superseded by Shopify refund',next_attempt_at=null where billing_case_id=v_case.id and job_type='CREATE_PROFORMA' and status in ('PENDING','FAILED');
      insert into public.billing_jobs (billing_case_id,idempotency_key,job_type,payload)
        select v_case.id,'shopify:'||p_event_id||':void-proforma:'||d.id::text,'VOID_PROFORMA',jsonb_build_object('documentId',d.id,'easybillDocumentId',d.easybill_document_id,'documentNumber',d.document_number,'sourceEventId',p_event_id)
        from public.billing_documents d where d.billing_case_id=v_case.id and d.document_type='PROFORMA' and d.easybill_document_id is not null and d.status in ('FINALIZED','SENT')
        on conflict (idempotency_key) do nothing;
      update public.billing_cases set subtotal_net_cents=subtotal_net_cents-p_net_cents,vat_cents=vat_cents-p_vat_cents,total_gross_cents=v_remaining,totals=jsonb_build_object('subtotalNet',(subtotal_net_cents-p_net_cents)/100.0,'vatAmount',(vat_cents-p_vat_cents)/100.0,'totalGross',v_remaining/100.0,'currency',currency),line_items=case when v_remaining=0 then '[]'::jsonb else p_payload->'postLineItems' end,current_revision=v_revision,refunded_at=p_occurred_at,status=case when v_remaining=0 then 'REFUNDED' else 'PROFORMA_PENDING' end,lock_version=lock_version+1 where id=v_case.id returning * into v_case;
      update public.billing_documents set status='SUPERSEDED' where billing_case_id=v_case.id and document_type='PROFORMA' and status not in ('SUPERSEDED','FAILED');
      if v_remaining>0 then
        v_number := 'PF-'||replace(v_case.shopify_order_name,'#','')||'-'||v_revision::text;
        insert into public.billing_jobs (billing_case_id,idempotency_key,job_type,payload) values (v_case.id,'shopify:'||p_event_id||':proforma','CREATE_PROFORMA',jsonb_build_object('revision',v_revision,'documentNumber',v_number,'trigger','REFUND_CREATED')) on conflict (idempotency_key) do nothing;
      end if;
    else
      select count(*)::integer into v_revision from public.billing_events where billing_case_id=v_case.id and event_type='REFUND_CREATED';
      v_number := 'GS-'||replace(v_case.shopify_order_name,'#','')||case when v_revision=0 then '' else '-'||v_revision::text end;
      insert into public.billing_jobs (billing_case_id,idempotency_key,job_type,payload)
        values (v_case.id,'shopify:'||p_event_id||':credit','CREATE_CREDIT',jsonb_build_object('revision',v_revision,'documentNumber',v_number,'amountCents',p_amount_cents,'netCents',p_net_cents,'vatCents',p_vat_cents,'sourceEventId',p_event_id,'refundLineItems',coalesce(p_payload->'refundLineItems','[]'::jsonb))) on conflict (idempotency_key) do nothing;
      update public.billing_cases set refunded_at=p_occurred_at,status='REFUNDED',lock_version=lock_version+1 where id=v_case.id returning * into v_case;
    end if;
  end if;
  insert into public.billing_events (billing_case_id,idempotency_key,event_type,source,actor,correlation_id,payload)
    values (v_case.id,p_event_id,p_event_type,'SHOPIFY','system',p_event_id,coalesce(p_payload,'{}'::jsonb)||jsonb_build_object('amountCents',p_amount_cents,'netCents',p_net_cents,'vatCents',p_vat_cents)) on conflict (idempotency_key) do nothing;
  return jsonb_build_object('billingCaseId',v_case.id,'duplicate',false,'status',v_case.status,'currentRevision',v_case.current_revision);
end;
$$;

revoke all on function public.billing_payment_ingest(text,text,text,bigint,text,timestamptz,text,jsonb) from public,anon,authenticated;
grant execute on function public.billing_payment_ingest(text,text,text,bigint,text,timestamptz,text,jsonb) to service_role;
revoke all on function public.billing_shopify_event_ingest(text,text,text,bigint,bigint,bigint,text,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.billing_shopify_event_ingest(text,text,text,bigint,bigint,bigint,text,timestamptz,jsonb) to service_role;
