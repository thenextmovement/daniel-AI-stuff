create or replace function public.billing_case_ingest(
  p_case jsonb,
  p_snapshot jsonb,
  p_snapshot_hash text,
  p_source_event_id text,
  p_portal_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_case public.billing_cases;
  v_conflict boolean := false;
  v_universal_replay boolean := false;
  v_initial_type text := upper(coalesce(nullif(p_case->>'initial_document_type',''),'PROFORMA'));
  v_job_type text;
  v_job_key text;
  v_document_number text;
begin
  if v_initial_type not in ('PROFORMA','INVOICE') then
    raise exception 'BILLING_INITIAL_DOCUMENT_TYPE_INVALID';
  end if;

  select * into v_case
  from public.billing_cases
  where shopify_order_id = p_case->>'shopify_order_id'
  for update;

  if found then
    v_universal_replay := p_case->>'source_system' = 'shopify-universal';
    v_conflict := not v_universal_replay and v_case.source_snapshot_hash <> p_snapshot_hash;

    insert into public.billing_events (
      billing_case_id,idempotency_key,event_type,source,actor,correlation_id,payload
    ) values (
      v_case.id,
      p_source_event_id,
      case when v_conflict then 'INTAKE_SNAPSHOT_CONFLICT' else 'INTAKE_REPLAY' end,
      coalesce(p_case->>'source_system','unknown'),
      'system',
      p_source_event_id,
      jsonb_build_object(
        'incomingHash',p_snapshot_hash,
        'storedHash',v_case.source_snapshot_hash,
        'universalReplay',v_universal_replay
      )
    ) on conflict (idempotency_key) do nothing;

    if v_conflict then
      update public.billing_cases
      set status='SYNC_BLOCKED',lock_version=lock_version+1
      where id=v_case.id
      returning * into v_case;

      insert into public.billing_incidents (
        billing_case_id,incident_key,severity,title,summary,details
      ) values (
        v_case.id,
        'intake-conflict:'||v_case.id::text||':'||p_snapshot_hash,
        'URGENT',
        'Shopify/Ops-Auftragssnapshot weicht ab',
        'Ein bekannter Shopify-Auftrag wurde mit abweichenden Finanz- oder Steuerdaten erneut übergeben.',
        jsonb_build_object('incomingHash',p_snapshot_hash,'storedHash',v_case.source_snapshot_hash)
      ) on conflict (incident_key) do nothing;
    end if;

    return jsonb_build_object(
      'id',v_case.id,
      'created',false,
      'conflict',v_conflict,
      'status',v_case.status
    );
  end if;

  insert into public.billing_cases (
    source_system,source_offer_id,source_acceptance_id,source_snapshot_hash,
    shopify_order_id,shopify_order_name,customer,customer_email,project_number,
    billing_address,delivery_address,line_items,totals,currency,
    subtotal_net_cents,vat_cents,total_gross_cents,payment_method,payment_terms_days,
    tax_treatment,tax_review_status,tax_exempt,vat_id,vat_validation,status,
    portal_token_hash,accepted_at,paid_at
  ) values (
    p_case->>'source_system',nullif(p_case->>'source_offer_id',''),nullif(p_case->>'source_acceptance_id',''),p_snapshot_hash,
    p_case->>'shopify_order_id',p_case->>'shopify_order_name',coalesce(p_case->'customer','{}'::jsonb),
    nullif(p_case->>'customer_email',''),nullif(p_case->>'project_number',''),
    coalesce(p_case->'billing_address','{}'::jsonb),coalesce(p_case->'delivery_address','{}'::jsonb),
    coalesce(p_case->'line_items','[]'::jsonb),coalesce(p_case->'totals','{}'::jsonb),p_case->>'currency',
    (p_case->>'subtotal_net_cents')::bigint,(p_case->>'vat_cents')::bigint,(p_case->>'total_gross_cents')::bigint,
    p_case->>'payment_method',nullif(p_case->>'payment_terms_days','')::integer,
    p_case->>'tax_treatment',p_case->>'tax_review_status',(p_case->>'tax_exempt')::boolean,
    nullif(p_case->>'vat_id',''),p_case->'vat_validation',p_case->>'status',p_portal_token_hash,
    nullif(p_case->>'accepted_at','')::timestamptz,nullif(p_case->>'paid_at','')::timestamptz
  ) returning * into v_case;

  insert into public.billing_case_versions (
    billing_case_id,revision,snapshot_hash,snapshot,source,actor,reason
  ) values (v_case.id,0,p_snapshot_hash,p_snapshot,v_case.source_system,'system','INITIAL_INTAKE');

  insert into public.billing_events (
    billing_case_id,idempotency_key,event_type,source,actor,correlation_id,payload
  ) values (
    v_case.id,p_source_event_id,'BILLING_CASE_CREATED',v_case.source_system,'system',p_source_event_id,p_snapshot
  );

  if v_initial_type = 'INVOICE' then
    v_job_type := 'CREATE_INVOICE';
    v_job_key := 'billing:'||v_case.id::text||':invoice';
    v_document_number := v_case.shopify_order_name;
  else
    v_job_type := 'CREATE_PROFORMA';
    v_job_key := 'billing:'||v_case.id::text||':proforma:0';
    v_document_number := 'PF-'||replace(v_case.shopify_order_name,'#','');
  end if;

  insert into public.billing_jobs (
    billing_case_id,idempotency_key,job_type,payload
  ) values (
    v_case.id,
    v_job_key,
    v_job_type,
    jsonb_build_object(
      'revision',0,
      'documentNumber',v_document_number,
      'trigger',case when v_initial_type='INVOICE' then 'SHOPIFY_ALREADY_PAID' else 'SHOPIFY_ORDER_CREATED' end
    )
  );

  if v_case.tax_review_status='REVIEW_REQUIRED' then
    insert into public.billing_incidents (
      billing_case_id,incident_key,severity,title,summary,details
    ) values (
      v_case.id,'vat-review:'||v_case.id::text,'WARNING',
      'Umsatzsteuer-ID passt nicht eindeutig zur Firma',
      'Bestellung und Produktion bleiben möglich. Bitte USt-ID, Firmenname und Anschrift vor der finalen Nettorechnung prüfen.',
      jsonb_build_object('vatId',v_case.vat_id,'validation',v_case.vat_validation)
    ) on conflict (incident_key) do nothing;

    insert into public.billing_jobs (
      billing_case_id,idempotency_key,job_type,payload
    ) values (
      v_case.id,'billing:'||v_case.id::text||':verify-vat','VERIFY_VAT',
      jsonb_build_object('vatId',v_case.vat_id,'validation',v_case.vat_validation)
    ) on conflict (idempotency_key) do nothing;
  end if;

  return jsonb_build_object('id',v_case.id,'created',true,'conflict',false,'status',v_case.status);
end;
$$;

create or replace function public.billing_case_ingest_with_portal(
  p_case jsonb,
  p_snapshot jsonb,
  p_snapshot_hash text,
  p_source_event_id text,
  p_portal_token_hash text,
  p_portal_url text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_case_id uuid;
begin
  if p_portal_url !~ '^https://rechnung\.neontrip\.de/[A-Za-z0-9_-]+$' then
    raise exception 'BILLING_PORTAL_URL_INVALID';
  end if;

  v_result := public.billing_case_ingest(
    p_case,p_snapshot,p_snapshot_hash,p_source_event_id,p_portal_token_hash
  );
  v_case_id := (v_result->>'id')::uuid;

  update public.billing_jobs
  set payload = payload || jsonb_build_object('portalUrl',p_portal_url)
  where billing_case_id = v_case_id
    and job_type in ('CREATE_PROFORMA','CREATE_INVOICE')
    and idempotency_key in (
      'billing:'||v_case_id::text||':proforma:0',
      'billing:'||v_case_id::text||':invoice'
    )
    and status in ('PENDING','FAILED');

  return v_result;
end;
$$;

revoke all on function public.billing_case_ingest(jsonb,jsonb,text,text,text) from public,anon,authenticated;
grant execute on function public.billing_case_ingest(jsonb,jsonb,text,text,text) to service_role;
revoke all on function public.billing_case_ingest_with_portal(jsonb,jsonb,text,text,text,text) from public,anon,authenticated;
grant execute on function public.billing_case_ingest_with_portal(jsonb,jsonb,text,text,text,text) to service_role;
