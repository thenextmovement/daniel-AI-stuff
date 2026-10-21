-- Behavioral checks on an isolated fixture database only.
do $test$
declare v_claim uuid; v_id uuid; v_count integer;
begin
  if has_function_privilege('anon','public.record_configurator_measurement_v1(text,text,jsonb,boolean)','EXECUTE')
    or has_table_privilege('authenticated','private.configurator_measurement','SELECT') then
    raise exception 'measurement data exposed'; end if;

  if not public.record_configurator_measurement_v1(repeat('a',64),repeat('b',64),
    jsonb_build_object('version',1,'analytics',true,'marketing',true,'privacy_bridge',true,'client_id','123.456','session_id','1792500000',
      'gclid',repeat('G',30),'gbraid',repeat('B',30),'email','must-not-survive@example.invalid')) then raise exception 'save'; end if;
  perform public.record_configurator_measurement_v1(repeat('a',64),repeat('b',64),jsonb_build_object('version',1,'analytics',true,'marketing',true,'gclid',repeat('L',30)));
  if (select context->>'gclid' from private.configurator_measurement where checkout_id=repeat('a',64))<>repeat('G',30) then raise exception 'late attribution overwrite'; end if;
  if exists(select 1 from private.configurator_measurement where context ? 'email' or context ? 'gbraid') then raise exception 'allowlist/one click'; end if;
  if public.record_configurator_measurement_v1(repeat('a',64),repeat('c',64),'{"version":1,"analytics":false,"marketing":false}') then raise exception 'owner collision'; end if;
  if public.record_configurator_measurement_v1(repeat('d',64),repeat('b',64),'{"version":1}') then raise exception 'invalid consent accepted'; end if;

  -- One paid order, then an actual repeat order with the same design reference.
  insert into public.master_orders(shopify_order_id,shopify_order_number,shopify_created_at,line_items)
    select id,'#'||id,now()+interval '1 second',
      jsonb_build_array(jsonb_build_object('properties',jsonb_build_array(jsonb_build_object('name','_Entwurf','value',repeat('a',64)))))
    from unnest(array['101','102','103','104','105','106']) id;
  insert into public.fixture_financial
    select shopify_order_id,id,null,null,shopify_order_id<>'103',shopify_order_id='104',now()-interval '1 second',
      case when shopify_order_id='105' then 'master_orders.shopify_created_at' else 'billing_cases.paid_at' end,
      10000,case when shopify_order_id='106' then 10000 else 0 end,case when shopify_order_id='106' then 0 else 10000 end,
      'billing_cases.subtotal_net_cents',true from public.master_orders;
  -- Freeze earlier capture (fixture only), as it must precede real creation.
  update private.configurator_measurement set captured_at=now()-interval '1 hour';
  -- A legacy inquiry link for the same checkout must not produce a second
  -- candidate or later bypass checkout withdrawal.
  insert into public.fixture_b2b(shopify_order_number,shopify_created_at,conversion_time,time_source,request_resolution_source,gclid)
    values('#101',now(),now()-interval '1 second','billing_cases.paid_at','shopify_note_request_id',repeat('I',30));
  select count(*) into v_count from public.gads_paid_deal_export_candidates_v3();
  if v_count<>2 then raise exception 'paid/repeat/unpaid/cancelled/creation/refund eligibility: %',v_count; end if;
  if (select count(*) from public.paid_purchase_reconciliation_v1(now()-interval '1 day',now()+interval '1 day'))<>5 then
    raise exception 'internal reconciliation hides real paid/refunded orders'; end if;

  insert into public.google_ads_conversions(shopify_order_number,conversion_name,conversion_value,conversion_time,
    deal_request_resolution_source,paid_business_key)
  select shopify_order_number,'Offline: Deal gewonnen',conversion_value,conversion_time,request_resolution_source,paid_business_key
  from public.gads_paid_deal_export_candidates_v3();
  if exists(select 1 from public.gads_paid_deal_export_candidates_v3()) then raise exception 'producer replay'; end if;
  select count(*) into v_count from public.claim_pending_gads_conversions_v3();
  if v_count<>2 then raise exception 'first claim: %',v_count; end if;
  if exists(select 1 from public.claim_pending_gads_conversions_v3()) then raise exception 'concurrent lease replay'; end if;
  select id into v_id from public.google_ads_conversions where shopify_order_number='#101';
  insert into private.google_ads_upload_attempts(source_type,source_id,operation_type,status,job_id)
    values('conversion',v_id,'conversion_upload','success','provider-job-fixture');
  if not exists(select 1 from public.paid_purchase_reconciliation_v1(now()-interval '1 day',now()+interval '1 day')
    where shopify_order_id='101' and google_receipted) then raise exception 'provider receipt missing from reconciliation'; end if;
  insert into public.google_ads_conversions(shopify_order_number,conversion_name,uploaded_to_gads)
    values('#106','Offline: Deal gewonnen',true);
  if exists(select 1 from public.paid_purchase_reconciliation_v1(now()-interval '1 day',now()+interval '1 day')
    where shopify_order_id='106' and google_receipted) then raise exception 'uploaded flag mistaken for provider receipt'; end if;
  update public.google_ads_conversions set upload_claim_expires_at=now()-interval '1 second';
  if (select count(*) from public.claim_pending_gads_conversions_v3())<>1 then raise exception 'provider receipt replay'; end if;

  -- Revocation wins over late requests and is checked again at export/claim.
  perform public.record_configurator_measurement_v1(repeat('a',64),repeat('b',64),null,true);
  perform public.record_configurator_measurement_v1(repeat('a',64),repeat('b',64),'{"version":1,"analytics":true,"marketing":true,"gclid":"GGGGGGGGGGGGGGGGGGGGGGGGGGGGGG"}');
  if exists(select 1 from private.configurator_measurement where context ? 'gclid' or context ? 'client_id') then raise exception 'withdrawal resurrected identifiers'; end if;
  update public.google_ads_conversions set upload_claim_expires_at=now()-interval '1 second';
  if exists(select 1 from public.claim_pending_gads_conversions_v3()) then raise exception 'withdrawn purchase upload'; end if;
  if exists(select 1 from public.gads_paid_deal_export_candidates_v3()) then raise exception 'legacy inquiry bypassed checkout consent'; end if;
  if (select count(*) from public.paid_purchase_reconciliation_v1(now()-interval '1 day',now()+interval '1 day'))<>5 then raise exception 'withdrawal erased internal payment'; end if;

  -- Two Shopify orders for one authoritative acceptance cannot both be counted.
  insert into public.billing_cases values('101','same-acceptance'),('102','same-acceptance');
  update public.google_ads_conversions set paid_business_key='acceptance:same-acceptance' where shopify_order_number='#101';
  begin
    update public.google_ads_conversions set paid_business_key='acceptance:same-acceptance' where shopify_order_number='#102';
    raise exception 'business dedupe not enforced';
  exception when unique_violation then null; end;

  -- Existing offer conversion remains GCLID-only and uses its existing value.
  insert into public.google_ads_conversions(shopify_order_number,conversion_name,gclid,conversion_value,conversion_time)
    values('#offer-fixture','Offline: Angebot versendet',repeat('O',30),7,now());
  if not exists(select 1 from public.claim_pending_gads_conversions_v3() where conversion_name='Offline: Angebot versendet' and conversion_value=7 and hashed_email is null)
    then raise exception 'unchanged offer neighbor'; end if;
end;
$test$;
do $boundaries$
begin
  perform public.record_configurator_measurement_v1(repeat('c',64),repeat('b',64),
    jsonb_build_object('version',1,'analytics',true,'marketing',true,'privacy_bridge',false,'gclid',repeat('C',30)));
  perform public.record_configurator_measurement_v1(repeat('d',64),repeat('b',64),
    jsonb_build_object('version',1,'analytics',true,'marketing',true,'privacy_bridge',true,'gclid',repeat('D',30)));
  perform public.record_configurator_measurement_v1(repeat('e',64),repeat('b',64),
    jsonb_build_object('version',1,'analytics',true,'marketing',true,'privacy_bridge',true,'gclid',repeat('E',30)));
  update private.configurator_measurement set captured_at=now()-interval '1 hour' where checkout_id in(repeat('c',64),repeat('e',64));
  insert into public.master_orders(shopify_order_id,shopify_order_number,shopify_created_at,line_items)
    select id,'#'||id,now()-interval '30 minutes',
      jsonb_build_array(jsonb_build_object('properties',jsonb_build_array(jsonb_build_object('name','_Entwurf',
        'value',repeat(case id when '201' then 'c' when '202' then 'd' else 'e' end,64)))))
    from unnest(array['201','202','203','204']) id;
  insert into public.fixture_financial
    select shopify_order_id,id,null,null,true,false,now()-interval '1 minute','billing_cases.paid_at',
      10000,0,10000,'billing_cases.subtotal_net_cents',true from public.master_orders where shopify_order_id in('201','202','203','204');
  insert into public.billing_cases values('203','ambiguous-acceptance'),('204','ambiguous-acceptance');
  if exists(select 1 from public.gads_paid_deal_export_candidates_v3())
    then raise exception 'missing bridge, later consent, or ambiguous acceptance was exported'; end if;

  -- A pending legacy-linked ledger row must not bypass checkout revocation.
  insert into public.master_requests(id,gclid,consent_ad_user_data)
    values('11111111-1111-1111-1111-111111111111',repeat('I',30),'granted');
  update public.master_orders set request_id='11111111-1111-1111-1111-111111111111' where shopify_order_id='102';
  update public.google_ads_conversions set deal_request_resolution_source='shopify_note_request_id',
    upload_claim_expires_at=now()-interval '1 second' where shopify_order_number='#102';
  if exists(select 1 from public.claim_pending_gads_conversions_v3() where conversion_name='Offline: Deal gewonnen')
    then raise exception 'old pending ledger bypassed checkout consent'; end if;

  -- Ordinary paid B2B deals still use the existing candidate/link/claim path.
  insert into public.master_orders(shopify_order_id,shopify_order_number,shopify_created_at,line_items,request_id)
    values('205','#205',now()-interval '30 minutes','[]','11111111-1111-1111-1111-111111111111');
  insert into public.fixture_financial
    select shopify_order_id,id,null,null,true,false,now()-interval '1 minute','billing_cases.paid_at',
      10000,0,10000,'billing_cases.subtotal_net_cents',true from public.master_orders where shopify_order_id='205';
  insert into public.fixture_b2b(shopify_order_number,shopify_created_at,request_id,conversion_value,conversion_time,time_source,request_resolution_source,gclid)
    values('#205',now()-interval '30 minutes','11111111-1111-1111-1111-111111111111',100,
      now()-interval '1 minute','billing_cases.paid_at','shopify_note_request_id',repeat('I',30));
  if (select count(*) from public.gads_paid_deal_export_candidates_v3())<>1 then raise exception 'paid B2B neighbor candidate'; end if;
  insert into public.google_ads_conversions(shopify_order_number,conversion_name,conversion_value,conversion_time,
    deal_request_resolution_source,paid_business_key)
    select shopify_order_number,'Offline: Deal gewonnen',conversion_value,conversion_time,request_resolution_source,paid_business_key
    from public.gads_paid_deal_export_candidates_v3();
  if not exists(select 1 from public.claim_pending_gads_conversions_v3() where conversion_name='Offline: Deal gewonnen' and conversion_value=100 and request_resolution_source='shopify_note_request_id')
    then raise exception 'paid B2B neighbor claim'; end if;
end;
$boundaries$;
select 'paid measurement behavior passed' as result;
