create or replace function public.billing_change_request_decide(
  p_case_id uuid,
  p_change_request_id uuid,
  p_decision text,
  p_approved_changes jsonb,
  p_note text,
  p_actor text,
  p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_case public.billing_cases;
  v_change public.billing_change_requests;
  v_original jsonb;
  v_reviewed jsonb;
  v_result jsonb;
  v_vat_result jsonb;
  v_vat_validation jsonb;
  v_recipient text;
  v_portal_url text;
  v_action text;
  v_delivery_country text;
  v_normalized_vat text;
begin
  if upper(coalesce(p_decision,'')) not in ('APPLY','REJECT') then raise exception 'BILLING_CHANGE_DECISION_INVALID'; end if;
  select * into v_case from public.billing_cases where id=p_case_id for update;
  if not found then raise exception 'BILLING_CASE_NOT_FOUND'; end if;
  if v_case.final_invoice_at is not null then raise exception 'BILLING_CASE_FINALIZED'; end if;
  select * into v_change from public.billing_change_requests where id=p_change_request_id and billing_case_id=p_case_id for update;
  if not found then raise exception 'BILLING_CHANGE_REQUEST_NOT_FOUND'; end if;
  if v_change.status <> 'PENDING' then raise exception 'BILLING_CHANGE_REQUEST_ALREADY_REVIEWED'; end if;

  v_original := v_change.requested_changes;
  v_reviewed := case
    when jsonb_typeof(p_approved_changes)='object' and p_approved_changes<>'{}'::jsonb then p_approved_changes
    when jsonb_typeof(v_change.ops_draft_changes)='object' and v_change.ops_draft_changes<>'{}'::jsonb then v_change.ops_draft_changes
    else v_original
  end;
  v_action := case when upper(p_decision)='APPLY' then 'APPLY_CHANGE_REQUEST' else 'REJECT_CHANGE_REQUEST' end;

  v_delivery_country := upper(coalesce(v_reviewed->'deliveryAddress'->>'country',v_case.delivery_address->>'country',''));
  v_delivery_country := case v_delivery_country when 'ÖSTERREICH' then 'AT' when 'OESTERREICH' then 'AT' when 'AUSTRIA' then 'AT' when 'DEUTSCHLAND' then 'DE' when 'GERMANY' then 'DE' else v_delivery_country end;

  if v_action='APPLY_CHANGE_REQUEST'
     and v_delivery_country in ('AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','GR','HU','IE','IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE')
     and nullif(regexp_replace(upper(coalesce(v_reviewed->>'vatId','')),'[^A-Z0-9]','','g'),'') is not null then
    v_vat_validation := v_reviewed->'vatValidation';
    v_normalized_vat := regexp_replace(upper(v_reviewed->>'vatId'),'[^A-Z0-9]','','g');
    if coalesce((v_vat_validation->>'checked')::boolean,false) is not true
       or coalesce((v_vat_validation->>'valid')::boolean,false) is not true
       or upper(coalesce(v_vat_validation->>'normalizedVatId','')) <> v_normalized_vat
       or upper(coalesce(v_vat_validation->>'countryCode','')) <> v_delivery_country then
      raise exception 'BILLING_VAT_VALIDATION_REQUIRED';
    end if;
  end if;

  if v_action='APPLY_CHANGE_REQUEST' then
    update public.billing_change_requests set requested_changes=v_reviewed where id=v_change.id;
  end if;
  v_result := public.billing_case_apply_action(
    p_case_id,
    v_action,
    jsonb_build_object('changeRequestId',p_change_request_id,'note',nullif(trim(coalesce(p_note,'')),'')),
    p_actor,
    p_idempotency_key
  );

  if v_action='APPLY_CHANGE_REQUEST'
     and coalesce((v_vat_validation->>'valid')::boolean,false) is true
     and v_result->>'taxReviewStatus'='REVIEW_REQUIRED' then
    update public.billing_cases set vat_validation=v_vat_validation,lock_version=lock_version+1 where id=p_case_id;
    delete from public.billing_jobs where billing_case_id=p_case_id and idempotency_key='job:'||p_idempotency_key||':vat' and job_type='VERIFY_VAT' and status='PENDING';
    v_vat_result := public.billing_case_apply_action(
      p_case_id,
      'CONFIRM_VAT',
      jsonb_build_object(
        'taxDecision','NET',
        'listedName',v_vat_validation->>'name',
        'listedAddress',v_vat_validation->>'address',
        'note','EU-VIES-Prüfung erfolgreich; durch Ops angenommen'
      ),
      p_actor,
      p_idempotency_key||':verified-vat'
    );
    v_result := v_result||v_vat_result;
  end if;

  update public.billing_change_requests
    set requested_changes=v_original,
        applied_changes=case when v_action='APPLY_CHANGE_REQUEST' then v_reviewed else null end,
        ops_draft_changes=case when v_action='APPLY_CHANGE_REQUEST' then v_reviewed else ops_draft_changes end,
        updated_at=now()
    where id=v_change.id returning * into v_change;
  select * into v_case from public.billing_cases where id=p_case_id;

  v_recipient := case when v_action='APPLY_CHANGE_REQUEST'
    then coalesce(nullif(v_case.customer_email,''),nullif(v_case.customer->>'email',''))
    else coalesce(nullif(v_change.requester_email,''),nullif(v_case.customer_email,''),nullif(v_case.customer->>'email',''))
  end;
  v_recipient := lower(trim(coalesce(v_recipient,'')));
  if v_recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(v_recipient)>254 then
    raise exception 'BILLING_CHANGE_EMAIL_INVALID';
  end if;
  select payload->>'portalUrl' into v_portal_url
    from public.billing_jobs
    where billing_case_id=p_case_id and job_type='CREATE_PROFORMA' and coalesce(payload->>'portalUrl','')<>''
    order by created_at asc limit 1;
  if coalesce(v_portal_url,'') !~ '^https://rechnung\.neontrip\.de/[A-Za-z0-9_-]+$' then
    raise exception 'BILLING_CHANGE_PORTAL_URL_MISSING';
  end if;

  insert into public.billing_jobs (billing_case_id,idempotency_key,job_type,payload)
    values (
      p_case_id,
      'notify-change-decision:'||p_change_request_id::text||':'||upper(p_decision),
      'NOTIFY_CHANGE_REQUEST',
      jsonb_build_object(
        'notificationKind','DECISION_CUSTOMER',
        'changeRequestId',p_change_request_id,
        'decision',upper(p_decision),
        'recipient',v_recipient,
        'portalUrl',v_portal_url,
        'shopifyOrderName',v_case.shopify_order_name,
        'reviewedChanges',case when v_action='APPLY_CHANGE_REQUEST' then v_reviewed else v_original end,
        'reviewNote',nullif(trim(coalesce(p_note,'')),''),
        'reviewedBy',p_actor,
        'reviewedAt',v_change.reviewed_at
      )
    ) on conflict (idempotency_key) do nothing;
  return v_result||jsonb_build_object('changeRequestId',v_change.id,'decision',upper(p_decision),'notificationQueued',true);
end;
$$;

revoke all on function public.billing_change_request_decide(uuid,uuid,text,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.billing_change_request_decide(uuid,uuid,text,jsonb,text,text,text) to service_role;
