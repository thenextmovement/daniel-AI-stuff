begin;
-- Email automation accepts only a previously signed and subsequently confirmed
-- metadata proposal. The API verifies its signature; this function locks the case
-- and delegates document creation to the existing billing functions and workers.
create or replace function public.billing_email_apply_confirmed(
 p_case_id uuid,p_revision integer,p_updated_at timestamptz,p_customer_email text,
 p_conversation_id text,p_request_message_id text,p_confirmation_message_id text,
 p_changes jsonb,p_convert boolean,p_proposal_key text,p_vat_validation jsonb default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare c public.billing_cases; previous jsonb; change_id uuid; result jsonb; snapshot jsonb; k text; address_key text; event_key text; reviewed jsonb;
begin
 if p_proposal_key !~ '^[a-f0-9]{64}$' or p_proposal_key is null
 or nullif(trim(p_conversation_id),'') is null or length(p_conversation_id)>1000
 or nullif(trim(p_request_message_id),'') is null or length(p_request_message_id)>1000
 or nullif(trim(p_confirmation_message_id),'') is null or length(p_confirmation_message_id)>1000
 or p_request_message_id=p_confirmation_message_id or p_convert is null then
  raise exception 'BILLING_EMAIL_CONFIRMATION_INVALID';
 end if;
 if p_changes is null or jsonb_typeof(p_changes)<>'object' then raise exception 'BILLING_EMAIL_FIELDS_INVALID'; end if;
 for k in select jsonb_object_keys(p_changes) loop
  if k not in ('billingAddress','deliveryAddress','vatId') then raise exception 'BILLING_EMAIL_FIELDS_INVALID'; end if;
 end loop;
 if p_convert and p_changes ? 'deliveryAddress' then raise exception 'BILLING_EMAIL_FIELDS_INVALID'; end if;
 foreach address_key in array array['billingAddress','deliveryAddress'] loop
  if p_changes ? address_key then
   if jsonb_typeof(p_changes->address_key)<>'object' or p_changes->address_key='{}'::jsonb then raise exception 'BILLING_EMAIL_FIELDS_INVALID'; end if;
   for k in select jsonb_object_keys(p_changes->address_key) loop
    if k not in ('company','name','firstName','lastName','street','zip','city','country','deliveryInstructions')
     or jsonb_typeof(p_changes->address_key->k)<>'string'
     or length(p_changes->address_key->>k)>500 then raise exception 'BILLING_EMAIL_FIELDS_INVALID'; end if;
   end loop;
  end if;
 end loop;
 if p_changes ? 'vatId' and (jsonb_typeof(p_changes->'vatId')<>'string' or length(p_changes->>'vatId')>40) then raise exception 'BILLING_EMAIL_FIELDS_INVALID'; end if;
 select * into c from public.billing_cases where id=p_case_id for update;
 if not found then raise exception 'BILLING_CASE_NOT_FOUND'; end if;
 if lower(trim(coalesce(c.customer_email,'')))<>lower(trim(coalesce(p_customer_email,'')))
 or nullif(trim(p_customer_email),'') is null then raise exception 'BILLING_EMAIL_CUSTOMER_MISMATCH'; end if;
 event_key:='billing-email:'||p_proposal_key;
 select payload into previous from public.billing_events where billing_case_id=c.id and idempotency_key=event_key;
 if previous is null then
  if c.final_invoice_at is not null or c.invoice_requested_at is not null then raise exception 'BILLING_EMAIL_FINALIZED'; end if;
  if c.current_revision is distinct from p_revision or c.updated_at is distinct from p_updated_at then raise exception 'BILLING_EMAIL_STALE'; end if;
  if c.cancelled_at is not null or c.refunded_at is not null or c.tax_review_status='REVIEW_REQUIRED'
   or c.status not in ('PAYMENT_PENDING','PAID','DELIVERED') then raise exception 'BILLING_EMAIL_NOT_READY'; end if;
  if exists(select 1 from public.billing_change_requests where billing_case_id=c.id and status in ('PENDING','APPROVED')) then raise exception 'BILLING_EMAIL_OTHER_CHANGE_PENDING'; end if;
  if exists(select 1 from public.billing_jobs where billing_case_id=c.id and status<>'DONE' and job_type in ('CREATE_PROFORMA','CREATE_INVOICE','VERIFY_VAT','SYNC_SHOPIFY_TAX','CREATE_CREDIT','CREATE_CANCELLATION','VOID_PROFORMA')) then raise exception 'BILLING_EMAIL_OTHER_JOB_PENDING'; end if;
  if p_changes<>'{}'::jsonb then
   insert into public.billing_change_requests(billing_case_id,idempotency_key,source,requested_changes,requester_email)
    values(c.id,event_key||':change','OPS',p_changes,p_customer_email) returning id into change_id;
   reviewed:=p_changes;
   if p_vat_validation is not null then
    if p_vat_validation->>'source' is distinct from 'EU_VIES' or (p_vat_validation->>'checked')::boolean is distinct from true
      or (p_vat_validation->>'valid')::boolean is distinct from true
      or p_vat_validation->>'identityComparison'='MISMATCH'
      or p_vat_validation->>'checkedAt' is null
      or (p_vat_validation->>'checkedAt')::timestamptz<now()-interval '10 minutes'
      or (p_vat_validation->>'checkedAt')::timestamptz>now()+interval '1 minute' then raise exception 'BILLING_VAT_VALIDATION_REQUIRED'; end if;
    reviewed:=reviewed||jsonb_build_object('vatId',coalesce(p_changes->>'vatId',c.vat_id),'vatValidation',p_vat_validation);
   end if;
   result:=public.billing_change_request_decide_silent(c.id,change_id,'APPLY',reviewed,
    'Kundenbestätigung per E-Mail: '||p_confirmation_message_id,'n8n-rechnungsservice',event_key||':apply');
   select * into c from public.billing_cases where id=p_case_id;
  elsif not p_convert then raise exception 'BILLING_EMAIL_NO_CHANGE';
  end if;
  snapshot:=jsonb_build_object('billingAddress',c.billing_address,'deliveryAddress',c.delivery_address,'vatId',c.vat_id,
   'lineItems',c.line_items,'currency',c.currency,'paymentMethod',c.payment_method,'paymentTermsDays',c.payment_terms_days);
  previous:=jsonb_build_object('snapshot',snapshot,'convert',p_convert,'changes',p_changes,'conversationId',p_conversation_id,
   'requestMessageId',p_request_message_id,'confirmationMessageId',p_confirmation_message_id,'changeRequestId',change_id);
  insert into public.billing_events(billing_case_id,idempotency_key,event_type,source,actor,correlation_id,payload)
   values(c.id,event_key,'BILLING_EMAIL_CONFIRMED','OPS','n8n-rechnungsservice',p_proposal_key,previous);
 else
  if previous->'changes' is distinct from p_changes or (previous->>'convert')::boolean is distinct from p_convert
   or previous->>'conversationId' is distinct from p_conversation_id or previous->>'requestMessageId' is distinct from p_request_message_id then raise exception 'BILLING_EMAIL_REPLAY_MISMATCH'; end if;
 end if;
 snapshot:=jsonb_build_object('billingAddress',c.billing_address,'deliveryAddress',c.delivery_address,'vatId',c.vat_id,
  'lineItems',c.line_items,'currency',c.currency,'paymentMethod',c.payment_method,'paymentTermsDays',c.payment_terms_days);
 if snapshot is distinct from previous->'snapshot' then raise exception 'BILLING_EMAIL_STALE'; end if;
 if c.cancelled_at is not null or c.refunded_at is not null then raise exception 'BILLING_EMAIL_NOT_READY'; end if;
 if c.tax_review_status='REVIEW_REQUIRED' or c.status in ('MANUAL_REVIEW','SYNC_BLOCKED') then
  return jsonb_build_object('stage','manual_review','reason','Steuerprüfung oder Dokumentverarbeitung noch nicht abgeschlossen.','caseId',c.id);
 end if;
 if p_convert then
  if c.invoice_requested_at is null then
   if exists(select 1 from public.billing_jobs where billing_case_id=c.id and status<>'DONE' and job_type in ('CREATE_PROFORMA','VERIFY_VAT','SYNC_SHOPIFY_TAX','VOID_PROFORMA')) then
    return jsonb_build_object('stage','pending','caseId',c.id);
   end if;
   result:=public.billing_ops_request_invoice(c.id,c.current_revision,c.updated_at,'n8n-rechnungsservice',p_confirmation_message_id,event_key||':invoice');
  end if;
  if exists(select 1 from public.billing_documents where billing_case_id=c.id and document_type='INVOICE' and status='SENT' and sent_at is not null) then
   return jsonb_build_object('stage','completed','caseId',c.id,'documentType','INVOICE');
  end if;
 else
  if c.final_invoice_at is not null or c.invoice_requested_at is not null then raise exception 'BILLING_EMAIL_FINALIZED'; end if;
  if exists(select 1 from public.billing_documents where billing_case_id=c.id and document_type='PROFORMA' and revision=c.current_revision and status='SENT' and sent_at is not null) then
   return jsonb_build_object('stage','completed','caseId',c.id,'documentType','PROFORMA');
  end if;
 end if;
 return jsonb_build_object('stage','pending','caseId',c.id);
end;
$$;
revoke all on function public.billing_email_apply_confirmed(uuid,integer,timestamptz,text,text,text,text,jsonb,boolean,text,jsonb) from public,anon,authenticated;
grant execute on function public.billing_email_apply_confirmed(uuid,integer,timestamptz,text,text,text,text,jsonb,boolean,text,jsonb) to service_role;
commit;
