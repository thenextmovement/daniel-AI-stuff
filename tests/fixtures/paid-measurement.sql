-- Isolated PostgreSQL fixture. Never run against a production database.
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role bypassrls; exception when duplicate_object then null; end $$;
create schema private;
create schema extensions;
create schema customer_match_v2;
create extension pgcrypto schema extensions;
create table public.master_customers(id uuid primary key,email text);
create table public.master_requests(id uuid primary key,customer_id uuid,gclid text,gbraid text,wbraid text,consent_ad_user_data text,consent_ad_personalization text);
create table public.master_orders(id uuid primary key default gen_random_uuid(),shopify_order_id text unique,
 shopify_order_number text,customer_id uuid,request_id uuid,note text,created_at timestamptz default now(),shopify_created_at timestamptz,line_items jsonb);
create table public.billing_cases(shopify_order_id text,source_acceptance_id text);
create table public.google_ads_conversions(id uuid primary key default gen_random_uuid(),shopify_order_number text unique,
 email text,gclid text,conversion_name text not null,conversion_value numeric,conversion_time timestamptz,
 exported_at timestamptz default now(),request_id uuid,uploaded_to_gads boolean default false,
 upload_claim_token uuid,upload_claim_expires_at timestamptz,deal_value_source text,deal_time_source text,
 deal_request_resolution_source text,deal_financial_checked_at timestamptz,
 constraint google_ads_conversions_deal_request_source_check check(deal_request_resolution_source in ('shopify_note_request_id','unique_customer_request')));
create table private.google_ads_upload_attempts(source_type text,source_id uuid,operation_type text,status text,
 job_id text,error_code text,retry_after timestamptz,recorded_at timestamptz default now());
create table public.fixture_financial(shopify_order_id text primary key,master_order_id uuid,billing_case_id uuid,
 supplier_sale_id uuid,paid_evidence boolean,cancelled boolean,conversion_time timestamptz,time_source text,
 original_net_cents bigint,refund_net_cents bigint,remaining_net_cents bigint,value_source text,refund_ledger_valid boolean);
create function private.gads_deal_financial_state_v1(text,text)
returns table(master_order_id uuid,billing_case_id uuid,supplier_sale_id uuid,paid_evidence boolean,cancelled boolean,
 conversion_time timestamptz,time_source text,original_net_cents bigint,refund_net_cents bigint,remaining_net_cents bigint,value_source text,refund_ledger_valid boolean)
language sql stable as $$select master_order_id,billing_case_id,supplier_sale_id,paid_evidence,cancelled,conversion_time,time_source,
 original_net_cents,refund_net_cents,remaining_net_cents,value_source,refund_ledger_valid from public.fixture_financial where shopify_order_id=$1$$;
create function public.resolve_shopify_order_request_link_v1(text,text,uuid,timestamptz,text)
returns table(resolved_request_id uuid,resolution_source text) language sql stable as $$
 select request_id,'shopify_note_request_id' from public.master_orders where shopify_order_id=$1$$;
create function private.gads_valid_click_id_v1(text) returns text language sql immutable as $$
 select case when $1 ~ '^[A-Za-z0-9._~-]+$' and length($1) between 25 and 512 and $1 !~* '^(test|diagnostic-|codex_)' then $1 end$$;
create function customer_match_v2.normalize_buyer_email(text) returns text language sql immutable as $$select lower(nullif(trim($1),''))$$;
create table public.fixture_b2b(shopify_order_number text,shopify_created_at timestamptz,request_id uuid,email text,
 first_name text,last_name text,phone text,conversion_value numeric,conversion_time timestamptz,value_source text,
 time_source text,request_resolution_source text,billing_case_id uuid,supplier_sale_id uuid,refund_net_cents bigint,
 gclid text,gbraid text,wbraid text,hashed_email text,consent_ad_user_data text);
create function public.gads_paid_deal_export_candidates_v2(integer default 90,integer default 100)
returns setof public.fixture_b2b language sql stable as $$select * from public.fixture_b2b$$;
grant usage on schema public,private to service_role;
grant all on all tables in schema public,private to service_role;
