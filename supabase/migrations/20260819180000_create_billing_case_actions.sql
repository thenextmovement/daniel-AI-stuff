create or replace function public.billing_case_apply_action(
  p_case_id uuid,
  p_action text,
  p_payload jsonb,
  p_actor text,
  p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_case public.billing_cases;
  v_terms integer;
  v_revision integer;
  v_document_number text;
  v_change public.billing_change_requests;
  v_changes jsonb;
  v_old jsonb;
  v_tax_sensitive boolean;
  v_tax_decision text;
  v_vat_rate numeric;
  v_vat_cents bigint;
  v_delivered_at timestamptz;
begin
  if length(trim(coalesce(p_actor,''))) < 2 then raise exception 'BILLING_ACTOR_REQUIRED'; end if;
  if length(trim(coalesce(p_idempotency_key,''))) < 8 then raise exception 'BILLING_IDEMPOTENCY_KEY_REQUIRED'; end if;

  select * into v_case from public.billing_cases where id=p_case_id for update;
  if not found then raise exception 'BILLING_CASE_NOT_FOUND'; end if;
  if exists(select 1 from public.billing_events where idempotency_key=p_idempotency_key) then
    return jsonb_build_object('id',v_case.id,'status',v_case.status,'duplicate',true);
  end if;

  if p_action='SET_PAYMENT_METHOD' then
    if v_case.final_invoice_at is not null then raise exception 'BILLING_CASE_FINALIZED'; end if;
    if p_payload->>'paymentMethod'='VORKASSE' then
      update public.billing_cases set payment_method='VORKASSE',payment_terms_days=null,lock_version=lock_version+1 where id=v_case.id returning * into v_case;
    elsif p_payload->>'paymentMethod'='KAUF_AUF_RECHNUNG' then
      v_terms := coalesce(nullif(p_payload->>'paymentTermsDays','')::integer,14);
      if v_terms not in (7,14,30) then raise exception 'BILLING_TERMS_INVALID'; end if;
      update public.billing_cases set payment_method='KAUF_AUF_RECHNUNG',payment_terms_days=v_terms,lock_version=lock_version+1 where id=v_case.id returning * into v_case;
    else
      raise exception 'BILLING_PAYMENT_METHOD_INVALID';
    end if;
  elsif p_action='CONFIRM_VAT' then
    if v_case.final_invoice_at is not null then raise exception 'BILLING_CASE_FINALIZED'; end if;
    if v_case.tax_review_status <> 'REVIEW_REQUIRED' then raise exception 'BILLING_VAT_REVIEW_NOT_REQUIRED'; end if;
    v_tax_decision := upper(coalesce(nullif(p_payload->>'taxDecision',''),'NET'));
    if v_tax_decision not in ('NET','GROSS') then raise exception 'BILLING_TAX_DECISION_INVALID'; end if;
    v_vat_rate := coalesce(nullif(v_case.totals->>'originalVatRate','')::numeric,nullif(p_payload->>'vatRate','')::numeric,19);
    if v_vat_rate < 0 or v_vat_rate > 30 then raise exception 'BILLING_VAT_RATE_INVALID'; end if;
    v_vat_cents := case when v_tax_decision='NET' then 0 else round(v_case.subtotal_net_cents*v_vat_rate/100.0)::bigint end;
    v_revision := v_case.current_revision + 1;
    v_document_number := 'PF-'||replace(v_case.shopify_order_name,'#','')||'-'||v_revision::text;
    update public.billing_cases
      set tax_review_status='VERIFIED',
          tax_exempt=v_tax_decision='NET',
          tax_treatment=case when v_tax_decision='NET' then 'EU_B2B_REVERSE_CHARGE' else 'EU_B2C_OSS' end,
          vat_cents=v_vat_cents,
          total_gross_cents=subtotal_net_cents+v_vat_cents,
          totals=coalesce(totals,'{}'::jsonb)||jsonb_build_object('subtotalNet',subtotal_net_cents/100.0,'vatAmount',v_vat_cents/100.0,'totalGross',(subtotal_net_cents+v_vat_cents)/100.0,'currency',currency,'originalVatRate',v_vat_rate),
          vat_validation=coalesce(vat_validation,'{}'::jsonb)||jsonb_build_object('manuallyVerified',true,'verifiedAt',now(),'verifiedBy',p_actor,'listedName',p_payload->>'listedName','listedAddress',p_payload->>'listedAddress','reviewNote',p_payload->>'note'),
          status='PROFORMA_PENDING',current_revision=v_revision,
          lock_version=lock_version+1
      where id=v_case.id returning * into v_case;
    insert into public.billing_jobs (billing_case_id,idempotency_key,job_type,payload)
      values (v_case.id,'job:'||p_idempotency_key||':proforma','CREATE_PROFORMA',jsonb_build_object('revision',v_revision,'documentNumber',v_document_number,'reason','VAT_REVIEW_CONFIRMED'));
    update public.billing_incidents set status='RESOLVED',resolved_by=p_actor,resolved_at=now() where billing_case_id=v_case.id and incident_key='vat-review:'||v_case.id::text and status<>'RESOLVED';
  elsif p_action='APPLY_CHANGE_REQUEST' then
    if v_case.final_invoice_at is not null then raise exception 'BILLING_CASE_FINALIZED'; end if;
    select * into v_change from public.billing_change_requests where id=nullif(p_payload->>'changeRequestId','')::uuid and billing_case_id=v_case.id for update;
    if not found then raise exception 'BILLING_CHANGE_REQUEST_NOT_FOUND'; end if;
    if v_change.status<>'PENDING' then raise exception 'BILLING_CHANGE_REQUEST_ALREADY_REVIEWED'; end if;
    v_changes := v_change.requested_changes;
    v_old := jsonb_build_object('billingAddress',v_case.billing_address,'deliveryAddress',v_case.delivery_address,'vatId',v_case.vat_id,'customerEmail',v_case.customer_email,'revision',v_case.current_revision);
    v_tax_sensitive := v_changes ? 'deliveryAddress' or (v_changes ? 'vatId' and upper(regexp_replace(coalesce(v_changes->>'vatId',''),'[^A-Za-z0-9]','','g')) is distinct from coalesce(v_case.vat_id,''));
    v_revision := v_case.current_revision + 1;
    update public.billing_cases set
      billing_address=case when jsonb_typeof(v_changes->'billingAddress')='object' then billing_address||(v_changes->'billingAddress') else billing_address end,
      delivery_address=case when jsonb_typeof(v_changes->'deliveryAddress')='object' then delivery_address||(v_changes->'deliveryAddress') else delivery_address end,
      vat_id=case when v_changes ? 'vatId' then nullif(upper(regexp_replace(v_changes->>'vatId','[^A-Za-z0-9]','','g')),'') else vat_id end,
      customer_email=case when v_changes ? 'invoiceEmail' then nullif(lower(trim(v_changes->>'invoiceEmail')),'') else customer_email end,
      customer=case when v_changes ? 'invoiceEmail' then customer||jsonb_build_object('email',lower(trim(v_changes->>'invoiceEmail'))) else customer end,
      tax_review_status=case when v_tax_sensitive then 'REVIEW_REQUIRED' else tax_review_status end,
      status=case when v_tax_sensitive then 'MANUAL_REVIEW' else 'PROFORMA_PENDING' end,
      current_revision=case when v_tax_sensitive then current_revision else v_revision end,
      lock_version=lock_version+1
    where id=v_case.id returning * into v_case;
    update public.billing_change_requests set status='APPLIED',reviewed_by=p_actor,reviewed_at=now(),review_note=nullif(p_payload->>'note','') where id=v_change.id;
    if v_tax_sensitive then
      insert into public.billing_incidents (billing_case_id,incident_key,severity,title,summary,details)
        values (v_case.id,'vat-review:'||v_case.id::text,'WARNING','Steuerrelevante Rechnungsänderung prüfen','Lieferdaten oder USt-ID wurden geändert. Bestellung, Produktion und Lieferung bleiben möglich; vor einer finalen Rechnung ist die Steuerentscheidung freizugeben.',jsonb_build_object('changeRequestId',v_change.id,'changes',v_changes))
        on conflict (incident_key) do update set status='OPEN',summary=excluded.summary,details=excluded.details,resolved_by=null,resolved_at=null;
      insert into public.billing_jobs (billing_case_id,idempotency_key,job_type,payload)
        values (v_case.id,'job:'||p_idempotency_key||':vat','VERIFY_VAT',jsonb_build_object('changeRequestId',v_change.id,'vatId',v_case.vat_id)) on conflict (idempotency_key) do nothing;
    else
      v_document_number := 'PF-'||replace(v_case.shopify_order_name,'#','')||'-'||v_revision::text;
      insert into public.billing_jobs (billing_case_id,idempotency_key,job_type,payload)
        values (v_case.id,'job:'||p_idempotency_key||':proforma','CREATE_PROFORMA',jsonb_build_object('revision',v_revision,'documentNumber',v_document_number,'reason','CUSTOMER_CHANGE_APPROVED'));
    end if;
    p_payload := p_payload||jsonb_build_object('old',v_old,'appliedChanges',v_changes,'taxSensitive',v_tax_sensitive);
  elsif p_action='REJECT_CHANGE_REQUEST' then
    select * into v_change from public.billing_change_requests where id=nullif(p_payload->>'changeRequestId','')::uuid and billing_case_id=v_case.id for update;
    if not found then raise exception 'BILLING_CHANGE_REQUEST_NOT_FOUND'; end if;
    if v_change.status<>'PENDING' then raise exception 'BILLING_CHANGE_REQUEST_ALREADY_REVIEWED'; end if;
    update public.billing_change_requests set status='REJECTED',reviewed_by=p_actor,reviewed_at=now(),review_note=nullif(p_payload->>'note','') where id=v_change.id;
  elsif p_action='CREATE_PROFORMA' then
    if v_case.final_invoice_at is not null then raise exception 'BILLING_CASE_FINALIZED'; end if;
    v_revision := v_case.current_revision + 1;
    v_document_number := 'PF-'||replace(v_case.shopify_order_name,'#','')||'-'||v_revision::text;
    update public.billing_cases set current_revision=v_revision,status='PROFORMA_PENDING',lock_version=lock_version+1 where id=v_case.id returning * into v_case;
    insert into public.billing_jobs (billing_case_id,idempotency_key,job_type,payload)
      values (v_case.id,'job:'||p_idempotency_key,'CREATE_PROFORMA',jsonb_build_object('revision',v_revision,'documentNumber',v_document_number,'reason',p_payload->>'reason'));
  elsif p_action='MARK_PAID' then
    update public.billing_cases set paid_at=coalesce(paid_at,now()),status=case when tax_review_status='REVIEW_REQUIRED' then 'MANUAL_REVIEW' else 'INVOICE_PENDING' end,lock_version=lock_version+1 where id=v_case.id returning * into v_case;
    if v_case.tax_review_status<>'REVIEW_REQUIRED' and v_case.final_invoice_at is null then
      insert into public.billing_jobs (billing_case_id,idempotency_key,job_type,payload)
        values (v_case.id,'billing:'||v_case.id::text||':invoice','CREATE_INVOICE',jsonb_build_object('documentNumber',v_case.shopify_order_name,'trigger','PAYMENT_RECEIVED'))
        on conflict (idempotency_key) do nothing;
    end if;
  elsif p_action='MARK_DELIVERED' then
    if length(trim(coalesce(p_payload->>'evidenceType','')))<3 or length(trim(coalesce(p_payload->>'reason','')))<3 then raise exception 'BILLING_DELIVERY_EVIDENCE_REQUIRED'; end if;
    begin v_delivered_at := nullif(p_payload->>'deliveredAt','')::timestamptz; exception when others then raise exception 'BILLING_DELIVERY_DATE_INVALID'; end;
    if v_delivered_at is null or v_delivered_at>now()+interval '5 minutes' then raise exception 'BILLING_DELIVERY_DATE_INVALID'; end if;
    update public.billing_cases set delivered_at=coalesce(delivered_at,v_delivered_at),status=case when payment_method='KAUF_AUF_RECHNUNG' and tax_review_status<>'REVIEW_REQUIRED' then 'INVOICE_PENDING' else 'DELIVERED' end,lock_version=lock_version+1 where id=v_case.id returning * into v_case;
    if v_case.payment_method='KAUF_AUF_RECHNUNG' and v_case.tax_review_status<>'REVIEW_REQUIRED' and v_case.final_invoice_at is null then
      insert into public.billing_jobs (billing_case_id,idempotency_key,job_type,payload)
        values (v_case.id,'billing:'||v_case.id::text||':invoice','CREATE_INVOICE',jsonb_build_object('documentNumber',v_case.shopify_order_name,'trigger','DELIVERED','paymentTermsDays',v_case.payment_terms_days))
        on conflict (idempotency_key) do nothing;
    end if;
  elsif p_action='CREATE_INVOICE' then
    if v_case.final_invoice_at is not null then raise exception 'BILLING_CASE_FINALIZED'; end if;
    if v_case.tax_review_status='REVIEW_REQUIRED' then raise exception 'BILLING_VAT_REVIEW_REQUIRED'; end if;
    if length(trim(coalesce(p_payload->>'reason','')))<3 then raise exception 'BILLING_INVOICE_REASON_REQUIRED'; end if;
    update public.billing_cases set status='INVOICE_PENDING',lock_version=lock_version+1 where id=v_case.id returning * into v_case;
    insert into public.billing_jobs (billing_case_id,idempotency_key,job_type,payload)
      values (v_case.id,'billing:'||v_case.id::text||':invoice','CREATE_INVOICE',jsonb_build_object('documentNumber',v_case.shopify_order_name,'trigger','MANUAL','reason',p_payload->>'reason'))
      on conflict (idempotency_key) do nothing;
  else
    raise exception 'BILLING_ACTION_INVALID';
  end if;

  insert into public.billing_events (billing_case_id,idempotency_key,event_type,source,actor,correlation_id,payload)
    values (v_case.id,p_idempotency_key,p_action,'OPS',p_actor,p_idempotency_key,coalesce(p_payload,'{}'::jsonb));
  return jsonb_build_object('id',v_case.id,'status',v_case.status,'paymentMethod',v_case.payment_method,'paymentTermsDays',v_case.payment_terms_days,'taxReviewStatus',v_case.tax_review_status,'currentRevision',v_case.current_revision,'duplicate',false);
end;
$$;

revoke all on function public.billing_case_apply_action(uuid,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.billing_case_apply_action(uuid,text,jsonb,text,text) to service_role;
