-- NEONTRIP only. Deployment is separate from preparing this migration.
-- Reuse master_orders, the paid/refund resolver, the existing Google Ads
-- conversion ledger, leases, provider receipts and adjustment uploader.
begin;

create table private.configurator_measurement (
  checkout_id text primary key check (checkout_id ~ '^[a-f0-9]{64}$'),
  owner_hash text not null check (owner_hash ~ '^[a-f0-9]{64}$'),
  context jsonb not null,
  captured_at timestamptz not null default current_timestamp,
  updated_at timestamptz not null default current_timestamp,
  revoked_at timestamptz,
  expires_at timestamptz not null default current_timestamp + interval '90 days'
);
alter table private.configurator_measurement enable row level security;
revoke all on private.configurator_measurement from public, anon, authenticated;
grant usage on schema private to service_role;
grant select, insert, update, delete on private.configurator_measurement to service_role;
create policy configurator_measurement_service on private.configurator_measurement
  for all to service_role using (true) with check (true);
create index configurator_measurement_expiry on private.configurator_measurement(expires_at);

-- Server-only RPC; the Offers route verifies the existing checkout owner.
-- Revocation is sticky for this checkout: a delayed grant cannot resurrect IDs.
create function public.record_configurator_measurement_v1(
  p_checkout_id text, p_owner_hash text, p_context jsonb, p_revoke boolean default false
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare
  v_context jsonb;
  v_key text;
  v_count integer;
begin
  if p_checkout_id !~ '^[a-f0-9]{64}$' or p_owner_hash !~ '^[a-f0-9]{64}$'
    or p_checkout_id is null or p_owner_hash is null then return false; end if;
  v_context := jsonb_build_object('version',1,'analytics',false,'marketing',false);
  if not p_revoke then
    if jsonb_typeof(p_context) is distinct from 'object' or p_context->>'version' is distinct from '1'
      or jsonb_typeof(p_context->'analytics') is distinct from 'boolean'
      or jsonb_typeof(p_context->'marketing') is distinct from 'boolean'
      or p_context is null then return false; end if;
    v_context := jsonb_build_object('version',1,'analytics',p_context->'analytics','marketing',p_context->'marketing','privacy_bridge',coalesce(p_context->'privacy_bridge'='true'::jsonb,false));
    if p_context->'analytics' = 'true'::jsonb then
      if p_context->>'client_id' ~ '^[0-9]{1,20}\.[0-9]{1,20}$' then
        v_context := v_context || jsonb_build_object('client_id',p_context->>'client_id');
      end if;
      if p_context->>'session_id' ~ '^[1-9][0-9]{0,19}$' then
        v_context := v_context || jsonb_build_object('session_id',p_context->>'session_id');
      end if;
    end if;
    if p_context->'marketing' = 'true'::jsonb then
      foreach v_key in array array['gclid','gbraid','wbraid'] loop
        if p_context->>v_key ~ '^[A-Za-z0-9._~-]+$' and length(p_context->>v_key) between 25 and 512
          and p_context->>v_key !~* '^(test|diagnostic-|codex_)' then
          v_context := v_context || jsonb_build_object(v_key,p_context->>v_key);
          exit;
        end if;
      end loop;
    end if;
  end if;
  delete from private.configurator_measurement where expires_at <= current_timestamp;
  insert into private.configurator_measurement(checkout_id,owner_hash,context,revoked_at)
  values(p_checkout_id,p_owner_hash,v_context,case when p_revoke then current_timestamp end)
  on conflict(checkout_id) do update set
    -- Freeze the first checkout attribution. A later visit/retry must not
    -- replace the click used by an already paid but not yet exported order.
    context = case when configurator_measurement.revoked_at is not null
        or excluded.revoked_at is not null
        or (configurator_measurement.context->'analytics'='true'::jsonb and excluded.context->'analytics'='false'::jsonb)
        or (configurator_measurement.context->'marketing'='true'::jsonb and excluded.context->'marketing'='false'::jsonb)
      then jsonb_build_object('version',1,'analytics',false,'marketing',false)
      else configurator_measurement.context || jsonb_build_object('privacy_bridge',
        coalesce(configurator_measurement.context->'privacy_bridge'='true'::jsonb,false)
        or coalesce(excluded.context->'privacy_bridge'='true'::jsonb,false)) end,
    updated_at = current_timestamp,
    revoked_at = coalesce(configurator_measurement.revoked_at,excluded.revoked_at,
      case when (configurator_measurement.context->'analytics'='true'::jsonb and excluded.context->'analytics'='false'::jsonb)
        or (configurator_measurement.context->'marketing'='true'::jsonb and excluded.context->'marketing'='false'::jsonb)
      then current_timestamp end)
  where configurator_measurement.owner_hash = excluded.owner_hash;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;
revoke all on function public.record_configurator_measurement_v1(text,text,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.record_configurator_measurement_v1(text,text,jsonb,boolean) to service_role;

-- The checkout reference is attribution linkage, never a purchase dedupe key:
-- two genuine orders for the same design remain two purchases.
create function private.configurator_order_context_v1(p_order_id text)
returns table(checkout_id text,context jsonb,captured_at timestamptz,revoked_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  with checkout_refs as (
    select distinct attribute->>'value' as checkout_id
    from public.master_orders mo
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(mo.line_items)='array' then mo.line_items else '[]'::jsonb end
    ) line
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(line->'properties')='array' then line->'properties' else '[]'::jsonb end
    ) attribute
    where mo.shopify_order_id=p_order_id and attribute->>'name'='_Entwurf'
  )
  select m.checkout_id,m.context,m.captured_at,m.revoked_at
  from checkout_refs r join private.configurator_measurement m using(checkout_id)
  join public.master_orders mo on mo.shopify_order_id=p_order_id
  where (select count(*) from checkout_refs)=1
    and m.expires_at>current_timestamp
    -- No historical backfill from a later visit or later consent.
    and m.captured_at<=mo.shopify_created_at
$$;
revoke all on function private.configurator_order_context_v1(text) from public,anon,authenticated;
grant execute on function private.configurator_order_context_v1(text) to service_role;

create function private.paid_order_business_key_v1(p_order_id text)
returns text language sql stable security invoker set search_path = '' as $$
  select case
    when count(distinct nullif(source_acceptance_id,'')) > 1 then null
    when count(distinct nullif(source_acceptance_id,'')) = 1
      then 'acceptance:' || min(nullif(source_acceptance_id,''))
    else 'shopify:' || p_order_id end
  from public.billing_cases where shopify_order_id=p_order_id
$$;
revoke all on function private.paid_order_business_key_v1(text) from public,anon,authenticated;
grant execute on function private.paid_order_business_key_v1(text) to service_role;

alter table public.google_ads_conversions add column paid_business_key text;
create unique index google_ads_paid_business_key_unique
  on public.google_ads_conversions(paid_business_key)
  where conversion_name='Offline: Deal gewonnen' and paid_business_key is not null;
alter table public.google_ads_conversions drop constraint google_ads_conversions_deal_request_source_check;
alter table public.google_ads_conversions add constraint google_ads_conversions_deal_request_source_check
  check (deal_request_resolution_source is null or deal_request_resolution_source in
    ('shopify_note_request_id','supplier_sales.request_id','shopify_note+supplier_sales.request_id','unique_customer_request','configurator_checkout'));

-- v2 stays intact for rollback. Its B2B matching and value contract are reused.
create function public.gads_paid_deal_export_candidates_v3(p_lookback_days integer default 90,p_limit integer default 100)
returns table(shopify_order_number text,shopify_created_at timestamptz,request_id uuid,email text,
 first_name text,last_name text,phone text,conversion_value numeric,conversion_time timestamptz,
 value_source text,time_source text,request_resolution_source text,billing_case_id uuid,
 supplier_sale_id uuid,refund_net_cents bigint,gclid text,gbraid text,wbraid text,
 hashed_email text,consent_ad_user_data text,paid_business_key text)
language sql stable security definer set search_path = '' as $$
  with candidates as (
    select old.*,private.paid_order_business_key_v1(mo.shopify_order_id) as paid_business_key
    from public.gads_paid_deal_export_candidates_v2(p_lookback_days,500) old
    join public.master_orders mo on mo.shopify_order_number=old.shopify_order_number
    -- Creation time is not a payment timestamp.
    where old.time_source in ('billing_cases.paid_at','supplier_sale_events.first_paid')
      -- Configurator orders must use their checkout consent, even if an older
      -- inquiry/customer link also resolves. Never fall back around revocation,
      -- missing capture, expiry or the privacy bridge.
      and not coalesce(jsonb_path_exists(mo.line_items,
        '$[*].properties[*] ? (@.name == "_Entwurf")'),false)
    union all
    select mo.shopify_order_number,mo.shopify_created_at,null::uuid,null::text,
      ''::text,''::text,''::text,round(financial.remaining_net_cents::numeric/100,2),
      financial.conversion_time,financial.value_source,financial.time_source,
      'configurator_checkout'::text,financial.billing_case_id,financial.supplier_sale_id,
      financial.refund_net_cents,context.context->>'gclid',context.context->>'gbraid',
      context.context->>'wbraid',null::text,'granted'::text,
      private.paid_order_business_key_v1(mo.shopify_order_id)
    from public.master_orders mo
    cross join lateral private.configurator_order_context_v1(mo.shopify_order_id) context
    cross join lateral private.gads_deal_financial_state_v1(mo.shopify_order_id,mo.shopify_order_number) financial
    where context.revoked_at is null and context.context->'marketing'='true'::jsonb
      and context.context->'privacy_bridge'='true'::jsonb
      and coalesce(context.context->>'gclid',context.context->>'gbraid',context.context->>'wbraid') is not null
      and financial.paid_evidence and not financial.cancelled and financial.refund_ledger_valid
      and financial.remaining_net_cents>0
      and financial.time_source in ('billing_cases.paid_at','supplier_sale_events.first_paid')
      and financial.conversion_time>=current_timestamp-make_interval(days=>least(90,greatest(1,coalesce(p_lookback_days,90))))
      and financial.conversion_time<=current_timestamp
      and nullif(btrim(mo.shopify_order_number),'') is not null
  ), unique_candidates as (
    select c.*,count(*) over(partition by c.paid_business_key) as same_business_orders
    from candidates c
    where c.paid_business_key is not null and not exists (
      select 1 from public.google_ads_conversions gc
      left join public.master_orders existing on regexp_replace(existing.shopify_order_number,'^#','')=regexp_replace(gc.shopify_order_number,'^#','')
      where gc.conversion_name='Offline: Deal gewonnen' and (
        regexp_replace(gc.shopify_order_number,'^#','')=regexp_replace(c.shopify_order_number,'^#','')
        or coalesce(gc.paid_business_key,private.paid_order_business_key_v1(existing.shopify_order_id))=c.paid_business_key
      )
    )
  )
  select c.shopify_order_number,c.shopify_created_at,c.request_id,c.email,c.first_name,c.last_name,c.phone,
    c.conversion_value,c.conversion_time,c.value_source,c.time_source,c.request_resolution_source,
    c.billing_case_id,c.supplier_sale_id,c.refund_net_cents,c.gclid,c.gbraid,c.wbraid,c.hashed_email,
    c.consent_ad_user_data,c.paid_business_key
  from unique_candidates c
  -- Ambiguous multiple paid orders for one acceptance need reconciliation,
  -- rather than silently adding amounts or picking a convenient order.
  where c.same_business_orders=1
  order by c.conversion_time,c.shopify_order_number
  limit least(500,greatest(1,coalesce(p_limit,100)))
$$;
revoke all on function public.gads_paid_deal_export_candidates_v3(integer,integer) from public,anon,authenticated;
grant execute on function public.gads_paid_deal_export_candidates_v3(integer,integer) to service_role;

-- Read-only internal reconciliation includes paid orders without Google IDs or
-- consent. No advertising eligibility filter may erase a real internal sale.
create function public.paid_purchase_reconciliation_v1(p_from timestamptz,p_to timestamptz)
returns table(shopify_order_id text,shopify_order_number text,business_key text,
 paid_at timestamptz,payment_time_verified boolean,net_value numeric,remaining_net_value numeric,
 cancelled boolean,refund_valid boolean,measurement_status text,google_receipted boolean)
language sql stable security definer set search_path = '' as $$
  select mo.shopify_order_id,mo.shopify_order_number,
    private.paid_order_business_key_v1(mo.shopify_order_id),
    case when f.time_source in ('billing_cases.paid_at','supplier_sale_events.first_paid') then f.conversion_time end,
    f.time_source in ('billing_cases.paid_at','supplier_sale_events.first_paid'),
    round(f.original_net_cents::numeric/100,2),round(f.remaining_net_cents::numeric/100,2),
    f.cancelled,f.refund_ledger_valid,
    case when m.revoked_at is not null then 'revoked'
      when m.checkout_id is null then 'unlinked'
      when m.context->'marketing'<>'true'::jsonb then 'no_ad_consent'
      when m.context->'privacy_bridge' is distinct from 'true'::jsonb then 'privacy_bridge_missing'
      when coalesce(m.context->>'gclid',m.context->>'gbraid',m.context->>'wbraid') is null then 'no_google_click'
      else 'attributable' end,
    exists(select 1 from public.google_ads_conversions gc
      join private.google_ads_upload_attempts receipt on receipt.source_type='conversion'
        and receipt.source_id=gc.id
        and coalesce(receipt.operation_type,'conversion_upload')='conversion_upload'
        and receipt.status in('success','duplicate') and receipt.job_id is not null
      where regexp_replace(gc.shopify_order_number,'^#','')=regexp_replace(mo.shopify_order_number,'^#','')
        and gc.conversion_name='Offline: Deal gewonnen')
  from public.master_orders mo
  cross join lateral private.gads_deal_financial_state_v1(mo.shopify_order_id,mo.shopify_order_number) f
  left join lateral private.configurator_order_context_v1(mo.shopify_order_id) m on true
  where f.paid_evidence and coalesce(f.conversion_time,mo.shopify_created_at)>=p_from
    and coalesce(f.conversion_time,mo.shopify_created_at)<p_to
$$;
revoke all on function public.paid_purchase_reconciliation_v1(timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.paid_purchase_reconciliation_v1(timestamptz,timestamptz) to service_role;

-- Derived from the currently active v2 definition, with only the new paid
-- checkout identity and business-dedupe gates. The recorder/adjustments stay v2.
CREATE OR REPLACE FUNCTION public.claim_pending_gads_conversions_v3(p_limit integer DEFAULT 200, p_lease_seconds integer DEFAULT 900)
 RETURNS TABLE(conversion_id uuid, claim_token uuid, gclid text, gbraid text, wbraid text, hashed_email text, consent_ad_user_data text, consent_ad_personalization text, conversion_name text, conversion_value numeric, conversion_time timestamp with time zone, order_id text, value_source text, time_source text, request_resolution_source text, refund_net_cents bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_limit integer := least(2000, greatest(1, coalesce(p_limit, 200)));
  v_lease_seconds integer := least(3600, greatest(60, coalesce(p_lease_seconds, 900)));
  v_now timestamptz := current_timestamp;
  v_claim_token uuid;
  v_row record;
begin
  for v_row in
    select
      gc.id,
      gc.conversion_name,
      case
        when gc.conversion_name = 'Offline: Deal gewonnen'
          then private.gads_valid_click_id_v1((case when gc.deal_request_resolution_source = 'configurator_checkout' then checkout_context.context->>'gclid' else deal_request.gclid end))
        else offer_identity.gclid
      end as resolved_gclid,
      case
        when gc.conversion_name = 'Offline: Deal gewonnen'
          then private.gads_valid_click_id_v1((case when gc.deal_request_resolution_source = 'configurator_checkout' then checkout_context.context->>'gbraid' else deal_request.gbraid end))
        else null
      end as resolved_gbraid,
      case
        when gc.conversion_name = 'Offline: Deal gewonnen'
          then private.gads_valid_click_id_v1((case when gc.deal_request_resolution_source = 'configurator_checkout' then checkout_context.context->>'wbraid' else deal_request.wbraid end))
        else null
      end as resolved_wbraid,
      case
        when gc.conversion_name = 'Offline: Deal gewonnen'
         and (case when gc.deal_request_resolution_source = 'configurator_checkout' then 'granted' else deal_request.consent_ad_user_data end) = 'granted'
         and customer_match_v2.normalize_buyer_email(case when gc.deal_request_resolution_source = 'configurator_checkout' then null else deal_customer.email end) is not null
          then pg_catalog.encode(
            extensions.digest(
              customer_match_v2.normalize_buyer_email(case when gc.deal_request_resolution_source = 'configurator_checkout' then null else deal_customer.email end),
              'sha256'
            ),
            'hex'
          )
        else null
      end as resolved_hashed_email,
      case
        when gc.conversion_name = 'Offline: Deal gewonnen'
          then (case when gc.deal_request_resolution_source = 'configurator_checkout' then 'granted' else deal_request.consent_ad_user_data end)
        else null
      end as resolved_consent_ad_user_data,
      case
        when gc.conversion_name = 'Offline: Deal gewonnen'
          then (case when gc.deal_request_resolution_source = 'configurator_checkout' then 'granted' else deal_request.consent_ad_personalization end)
        else null
      end as resolved_consent_ad_personalization,
      case
        when gc.conversion_name = 'Offline: Deal gewonnen'
          then pg_catalog.round(financial.remaining_net_cents::numeric / 100.0, 2)
        else gc.conversion_value
      end as resolved_conversion_value,
      case
        when gc.conversion_name = 'Offline: Deal gewonnen'
          then financial.conversion_time
        else coalesce(gc.conversion_time, gc.exported_at)
      end as resolved_conversion_time,
      case
        when gc.conversion_name = 'Offline: Deal gewonnen'
          then financial.value_source
        else null
      end as resolved_value_source,
      case
        when gc.conversion_name = 'Offline: Deal gewonnen'
          then financial.time_source
        else null
      end as resolved_time_source,
      case
        when gc.conversion_name = 'Offline: Deal gewonnen'
          then case when gc.deal_request_resolution_source = 'configurator_checkout' then 'configurator_checkout' else deal_link.resolution_source end
        else null
      end as resolved_request_source,
      case
        when gc.conversion_name = 'Offline: Deal gewonnen'
          then case when gc.deal_request_resolution_source = 'configurator_checkout' then null else deal_link.resolved_request_id end
        else gc.request_id
      end as resolved_request_id,
      case
        when gc.conversion_name = 'Offline: Deal gewonnen'
          then financial.refund_net_cents
        else 0::bigint
      end as refund_net_cents
    from public.google_ads_conversions gc
    left join lateral (
      select mo.*
      from public.master_orders mo
      where (
          nullif(pg_catalog.btrim(gc.shopify_order_number), '') is not null
          and pg_catalog.regexp_replace(coalesce(mo.shopify_order_number, ''), '^#', '') =
              pg_catalog.regexp_replace(coalesce(gc.shopify_order_number, ''), '^#', '')
        )
      order by coalesce(mo.shopify_created_at, mo.created_at) desc nulls last, mo.id
      limit 1
    ) order_row on true
    left join lateral private.configurator_order_context_v1(order_row.shopify_order_id) checkout_context
      on gc.deal_request_resolution_source = 'configurator_checkout'
    left join lateral public.resolve_shopify_order_request_link_v1(
      order_row.shopify_order_id,
      order_row.shopify_order_number,
      order_row.customer_id,
      coalesce(order_row.shopify_created_at, order_row.created_at),
      order_row.note
    ) deal_link
      on gc.conversion_name = 'Offline: Deal gewonnen'
    left join public.master_requests deal_request
      on deal_request.id = deal_link.resolved_request_id
    left join public.master_customers deal_customer
      on deal_customer.id = deal_request.customer_id
    left join lateral private.gads_deal_financial_state_v1(
      order_row.shopify_order_id,
      order_row.shopify_order_number
    ) financial
      on gc.conversion_name = 'Offline: Deal gewonnen'
    left join public.master_requests direct_request
      on direct_request.id = gc.request_id
    left join public.master_requests order_request
      on order_request.id = order_row.request_id
    left join lateral (
      select coalesce(
        private.gads_valid_click_id_v1(gc.gclid),
        private.gads_valid_click_id_v1(direct_request.gclid),
        private.gads_valid_click_id_v1(order_request.gclid)
      ) as gclid
    ) offer_identity on true
    where gc.uploaded_to_gads = false
      and gc.conversion_name in (
        'Offline: Angebot versendet',
        'Offline: Deal gewonnen'
      )
      and (
        gc.upload_claim_token is null
        or gc.upload_claim_expires_at <= v_now
      )
      and (
        (
          gc.conversion_name = 'Offline: Angebot versendet'
          and offer_identity.gclid is not null
          and coalesce(gc.conversion_time, gc.exported_at) is not null
        )
        or (
          gc.conversion_name = 'Offline: Deal gewonnen'
          and (
            (gc.deal_request_resolution_source = 'configurator_checkout'
              and checkout_context.checkout_id is not null
              and checkout_context.revoked_at is null
              and checkout_context.context->'marketing' = 'true'::jsonb
              and checkout_context.context->'privacy_bridge' = 'true'::jsonb)
            or (gc.deal_request_resolution_source is distinct from 'configurator_checkout'
              and not coalesce(jsonb_path_exists(order_row.line_items,
                '$[*].properties[*] ? (@.name == "_Entwurf")'),false)
              and deal_link.resolved_request_id is not null)
          )
          and financial.time_source in ('billing_cases.paid_at','supplier_sale_events.first_paid')
          and financial.conversion_time <= v_now
          and private.paid_order_business_key_v1(order_row.shopify_order_id) is not null
          and (gc.paid_business_key is null or gc.paid_business_key = private.paid_order_business_key_v1(order_row.shopify_order_id))
          and not exists (
            select 1 from public.google_ads_conversions other
            join public.master_orders other_order on regexp_replace(other_order.shopify_order_number,'^#','') = regexp_replace(other.shopify_order_number,'^#','')
            where other.id<>gc.id and other.conversion_name='Offline: Deal gewonnen'
              and coalesce(other.paid_business_key,private.paid_order_business_key_v1(other_order.shopify_order_id)) = private.paid_order_business_key_v1(order_row.shopify_order_id)
          )
          and financial.paid_evidence
          and not financial.cancelled
          and financial.refund_ledger_valid
          and financial.remaining_net_cents > 0
          and financial.conversion_time is not null
          and (
            private.gads_valid_click_id_v1((case when gc.deal_request_resolution_source = 'configurator_checkout' then checkout_context.context->>'gclid' else deal_request.gclid end)) is not null
            or private.gads_valid_click_id_v1((case when gc.deal_request_resolution_source = 'configurator_checkout' then checkout_context.context->>'gbraid' else deal_request.gbraid end)) is not null
            or private.gads_valid_click_id_v1((case when gc.deal_request_resolution_source = 'configurator_checkout' then checkout_context.context->>'wbraid' else deal_request.wbraid end)) is not null
            or (
              (case when gc.deal_request_resolution_source = 'configurator_checkout' then 'granted' else deal_request.consent_ad_user_data end) = 'granted'
              and customer_match_v2.normalize_buyer_email(case when gc.deal_request_resolution_source = 'configurator_checkout' then null else deal_customer.email end) is not null
            )
          )
        )
      )
      and not exists (
        select 1
        from private.google_ads_upload_attempts attempt
        where attempt.source_type = 'conversion'
          and attempt.source_id = gc.id
          and coalesce(attempt.operation_type, 'conversion_upload') = 'conversion_upload'
          and (
            (
              attempt.status in ('success', 'duplicate')
              and attempt.job_id is not null
            )
            or (
              attempt.status = 'permanent_failure'
              and not (
                gc.conversion_name = 'Offline: Deal gewonnen'
                and attempt.error_code = 'LOCAL_NO_CLICK_ID'
                and (
                  private.gads_valid_click_id_v1((case when gc.deal_request_resolution_source = 'configurator_checkout' then checkout_context.context->>'gclid' else deal_request.gclid end)) is not null
                  or private.gads_valid_click_id_v1((case when gc.deal_request_resolution_source = 'configurator_checkout' then checkout_context.context->>'gbraid' else deal_request.gbraid end)) is not null
                  or private.gads_valid_click_id_v1((case when gc.deal_request_resolution_source = 'configurator_checkout' then checkout_context.context->>'wbraid' else deal_request.wbraid end)) is not null
                  or (
                    (case when gc.deal_request_resolution_source = 'configurator_checkout' then 'granted' else deal_request.consent_ad_user_data end) = 'granted'
                    and customer_match_v2.normalize_buyer_email(case when gc.deal_request_resolution_source = 'configurator_checkout' then null else deal_customer.email end) is not null
                  )
                )
              )
            )
            or (
              attempt.status in ('retryable', 'request_failure')
              and coalesce(
                attempt.retry_after,
                attempt.recorded_at + interval '1 hour'
              ) > v_now
            )
          )
      )
    order by
      case
        when gc.conversion_name = 'Offline: Deal gewonnen'
          then financial.conversion_time
        else coalesce(gc.conversion_time, gc.exported_at)
      end asc,
      gc.id
    limit v_limit
    for update of gc skip locked
  loop
    v_claim_token := extensions.gen_random_uuid();

    update public.google_ads_conversions as claimed
    set
      upload_claim_token = v_claim_token,
      upload_claim_expires_at = v_now + pg_catalog.make_interval(secs => v_lease_seconds),
      conversion_value = case
        when v_row.conversion_name = 'Offline: Deal gewonnen'
          then v_row.resolved_conversion_value
        else claimed.conversion_value
      end,
      conversion_time = case
        when v_row.conversion_name = 'Offline: Deal gewonnen'
          then v_row.resolved_conversion_time
        else claimed.conversion_time
      end,
      request_id = case
        when v_row.conversion_name = 'Offline: Deal gewonnen'
          then v_row.resolved_request_id
        else claimed.request_id
      end,
      deal_value_source = case
        when v_row.conversion_name = 'Offline: Deal gewonnen'
          then v_row.resolved_value_source
        else claimed.deal_value_source
      end,
      deal_time_source = case
        when v_row.conversion_name = 'Offline: Deal gewonnen'
          then v_row.resolved_time_source
        else claimed.deal_time_source
      end,
      deal_request_resolution_source = case
        when v_row.conversion_name = 'Offline: Deal gewonnen'
          then v_row.resolved_request_source
        else claimed.deal_request_resolution_source
      end,
      deal_financial_checked_at = case
        when v_row.conversion_name = 'Offline: Deal gewonnen'
          then v_now
        else claimed.deal_financial_checked_at
      end
    where claimed.id = v_row.id;

    conversion_id := v_row.id;
    claim_token := v_claim_token;
    gclid := v_row.resolved_gclid;
    gbraid := v_row.resolved_gbraid;
    wbraid := v_row.resolved_wbraid;
    hashed_email := v_row.resolved_hashed_email;
    consent_ad_user_data := v_row.resolved_consent_ad_user_data;
    consent_ad_personalization := v_row.resolved_consent_ad_personalization;
    conversion_name := v_row.conversion_name;
    conversion_value := v_row.resolved_conversion_value;
    conversion_time := v_row.resolved_conversion_time;
    order_id := v_row.id::text;
    value_source := v_row.resolved_value_source;
    time_source := v_row.resolved_time_source;
    request_resolution_source := v_row.resolved_request_source;
    refund_net_cents := v_row.refund_net_cents;
    return next;
  end loop;
end;
$function$;
revoke all on function public.claim_pending_gads_conversions_v3(integer,integer) from public,anon,authenticated;
grant execute on function public.claim_pending_gads_conversions_v3(integer,integer) to service_role;
commit;
