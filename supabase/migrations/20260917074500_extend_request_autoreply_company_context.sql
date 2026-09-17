-- Extend only the existing read-only lookup. Preserve exact-email and attachment/product semantics.

create or replace function public.get_request_autoreply_relationship_context(
  p_email text,
  p_current_request_id text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  normalized_email text := lower(btrim(coalesce(p_email, '')));
  safe_current_request_id text := nullif(btrim(p_current_request_id), '');
  prior_request_count integer := 0;
  prior_offer_count integer := 0;
  paid_order_count integer := 0;
  paid_offer_sale_count integer := 0;
  relationship_type text := 'new';
  current_form_id text := '';
  current_file_urls text[];
  current_product_type text := '';
  current_request_found boolean := false;
  attachment_context_ok boolean := false;
  attachment_state text := 'unknown';
  organization_relationship_type text := 'new';
  organization_match_method text := 'none';
  organization_request_count integer := 0;
  organization_offer_count integer := 0;
  organization_order_count integer := 0;
  organization_sale_count integer := 0;
  organization_customer_ids uuid[] := '{}'::uuid[];
  organization_emails text[] := '{}'::text[];
begin
  if safe_current_request_id is not null then
    select
      lower(coalesce(request_row.form_id, '')),
      request_row.file_urls,
      left(coalesce(request_row.product_type, ''), 120)
    into current_form_id, current_file_urls, current_product_type
    from public.master_requests as request_row
    where request_row.request_id = safe_current_request_id
    limit 1;

    current_request_found := found;
  end if;

  if current_request_found then
    if current_form_id in ('landing-page-form', '2418') then
      if current_file_urls is null then
        attachment_state := 'unknown';
      elsif cardinality(current_file_urls) > 0 then
        attachment_state := 'present';
        attachment_context_ok := true;
      else
        attachment_state := 'missing';
        attachment_context_ok := true;
      end if;
    else
      attachment_state := 'not_applicable';
      attachment_context_ok := true;
    end if;
  end if;

  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return jsonb_build_object(
      'lookup_ok', false,
      'relationship_type', 'new',
      'prior_request_count', 0,
      'prior_offer_count', 0,
      'completed_order_count', 0,
      'match_method', 'none',
      'brand', 'neontrip',
      'attachment_context_ok', attachment_context_ok,
      'attachment_state', attachment_state,
      'attachment_source_kind', current_form_id,
      'attachment_rule_version', 'neontrip_request_file_urls_product_v2',
      'product_context_ok', current_request_found,
      'product_type', current_product_type
    );
  end if;

  select count(*)::integer
    into prior_request_count
  from public.master_requests as request_row
  join public.master_customers as customer_row
    on customer_row.id = request_row.customer_id
  where lower(btrim(customer_row.email)) = normalized_email
    and request_row.request_id is distinct from safe_current_request_id
    and request_row.created_at >= now() - interval '24 months'
    and lower(coalesce(request_row.form_id, '')) in (
      'landing-page-form',
      '2418',
      'outlook_email'
    )
    and lower(coalesce(request_row.customer_type, '')) <> 'anfrage_autoreply'
    and request_row.request_id not like 'autoreply-%';

  select count(*)::integer
    into prior_offer_count
  from public.crm_quotes as quote_row
  join public.master_customers as customer_row
    on customer_row.id = quote_row.customer_id
  where lower(btrim(customer_row.email)) = normalized_email
    and coalesce(quote_row.sent_at, quote_row.created_at) >= now() - interval '24 months'
    and quote_row.status::text <> 'draft';

  select count(*)::integer
    into paid_order_count
  from public.master_orders as order_row
  join public.master_customers as customer_row
    on customer_row.id = order_row.customer_id
  where lower(btrim(customer_row.email)) = normalized_email
    and order_row.cancelled_at is null
    and coalesce(order_row.shopify_created_at, order_row.created_at) >= now() - interval '5 years'
    and lower(coalesce(order_row.status, '')) in ('paid', 'partially_paid');

  select count(*)::integer
    into paid_offer_sale_count
  from public.supplier_sales as sale_row
  where lower(btrim(coalesce(sale_row.customer_email, ''))) = normalized_email
    and sale_row.source = 'neontrip-offers'
    and sale_row.created_at >= now() - interval '5 years'
    and sale_row.assignment_status <> 'canceled'
    and sale_row.payment_decision_status not in ('canceled', 'refunded')
    and (
      sale_row.shopify_payment_status in ('paid', 'partially_paid')
      or sale_row.payment_decision_status = 'paid_confirmed'
      or sale_row.assignment_status in ('in_production', 'completed')
    );

  if paid_order_count > 0 or paid_offer_sale_count > 0 then
    relationship_type := 'existing_customer';
  elsif prior_request_count > 0 or prior_offer_count > 0 then
    relationship_type := 'repeat_inquiry';
  end if;


  -- organization_id is the tenant, NOT the customer's company. It only limits scope.
  -- Reuse the canonical shared-provider/privacy-relay denylist. No fuzzy company matches.
  with normalized as materialized (
    select c.id, c.organization_id, lower(btrim(coalesce(c.email, ''))) email,
      lower(btrim(coalesce(c.first_name, ''))) first_name,
      lower(btrim(coalesce(c.last_name, ''))) last_name,
      regexp_replace(regexp_replace(lower(btrim(coalesce(nullif(c.company_name, ''), c.company, ''))),
        '\m(gmbh|mbh|ag|kg|ug|ltd|limited|llc|inc|co|haftungsbeschränkt)\M', '', 'g'),
        '[^[:alnum:]]', '', 'g') company_key,
      public.neontrip_request_segmentation_domain_facts(c.email) domain_facts
    from public.master_customers c
  ), current_contact as (
    select c.* from normalized c
    join public.master_requests r on r.customer_id = c.id
    where r.request_id = safe_current_request_id and c.email = normalized_email
      and lower(coalesce(r.form_id, '')) in ('landing-page-form', '2418', 'outlook_email')
      and length(c.company_key) >= 6
      and c.company_key not in ('privat', 'private', 'privatperson', 'unbekannt', 'keinefirma', 'unknown', 'selbstständig', 'selbststaendig')
  ), corroborated_domains as (
    select distinct peer.domain_facts->>'email_domain' domain,
      case when (cur.domain_facts->>'email_domain_cache_allowed')::boolean
        then 'business_domain_and_company' else 'same_person_and_company' end method
    from current_contact cur join normalized peer
      on peer.organization_id = cur.organization_id
      and peer.company_key = cur.company_key
      and peer.email <> cur.email
    where (peer.domain_facts->>'email_domain_cache_allowed')::boolean
      and case when (cur.domain_facts->>'email_domain_cache_allowed')::boolean
        then peer.domain_facts->>'email_domain' = cur.domain_facts->>'email_domain'
        else length(cur.first_name) >= 2 and length(cur.last_name) >= 2
          and cur.first_name = peer.first_name and cur.last_name = peer.last_name
      end
  ), unique_domain as (
    select min(domain) domain, min(method) method from corroborated_domains
    having count(*) = 1
  ), peers as (
    select peer.id, peer.email, d.method
    from current_contact cur cross join unique_domain d join normalized peer
      on peer.organization_id = cur.organization_id
      and peer.company_key = cur.company_key
      and peer.domain_facts->>'email_domain' = d.domain
    where (peer.domain_facts->>'email_domain_cache_allowed')::boolean
      and peer.email <> cur.email
  )
  select coalesce(array_agg(id), '{}'::uuid[]), coalesce(array_agg(email), '{}'::text[]),
    coalesce(min(method), 'none')
  into organization_customer_ids, organization_emails, organization_match_method
  from peers;

  if cardinality(organization_customer_ids) > 0 then
    select count(*)::integer into organization_request_count
    from public.master_requests r
    where r.customer_id = any(organization_customer_ids)
      and r.request_id is distinct from safe_current_request_id
      and r.created_at >= now() - interval '24 months'
      and lower(coalesce(r.form_id, '')) in ('landing-page-form', '2418', 'outlook_email')
      and lower(coalesce(r.customer_type, '')) <> 'anfrage_autoreply'
      and r.request_id not like 'autoreply-%';
    select count(*)::integer into organization_offer_count
    from public.crm_quotes q
    where q.customer_id = any(organization_customer_ids)
      and coalesce(q.sent_at, q.created_at) >= now() - interval '24 months'
      and q.status::text <> 'draft';
    select count(*)::integer into organization_order_count
    from public.master_orders o
    where o.customer_id = any(organization_customer_ids) and o.cancelled_at is null
      and coalesce(o.shopify_created_at, o.created_at) >= now() - interval '5 years'
      and lower(coalesce(o.status, '')) in ('paid', 'partially_paid');
    select count(*)::integer into organization_sale_count
    from public.supplier_sales s
    where lower(btrim(coalesce(s.customer_email, ''))) = any(organization_emails)
      and s.source = 'neontrip-offers' and s.created_at >= now() - interval '5 years'
      and s.assignment_status <> 'canceled' and s.payment_decision_status not in ('canceled', 'refunded')
      and (s.shopify_payment_status in ('paid', 'partially_paid')
        or s.payment_decision_status = 'paid_confirmed' or s.assignment_status in ('in_production', 'completed'));
    if organization_order_count > 0 or organization_sale_count > 0 then
      organization_relationship_type := 'existing_customer';
    elsif organization_request_count > 0 or organization_offer_count > 0 then
      organization_relationship_type := 'repeat_inquiry';
    end if;
  end if;

  return jsonb_build_object(
    'lookup_ok', true,
    'relationship_type', relationship_type,
    'prior_request_count', prior_request_count,
    'prior_offer_count', prior_offer_count,
    'completed_order_count', case
      when paid_order_count > 0 then paid_order_count
      else paid_offer_sale_count
    end,
    'match_method', 'exact_normalized_email',
    'organization_relationship_type', organization_relationship_type,
    'organization_match_method', organization_match_method,
    'organization_prior_request_count', organization_request_count,
    'organization_prior_offer_count', organization_offer_count,
    'organization_completed_order_count', greatest(organization_order_count, organization_sale_count),
    'brand', 'neontrip',
    'attachment_context_ok', attachment_context_ok,
    'attachment_state', attachment_state,
    'attachment_source_kind', current_form_id,
    'attachment_rule_version', 'neontrip_request_file_urls_product_v2',
    'product_context_ok', current_request_found,
    'product_type', current_product_type
  );
end;
$$;

revoke all on function public.get_request_autoreply_relationship_context(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_request_autoreply_relationship_context(text, text)
  to service_role;

comment on function public.get_request_autoreply_relationship_context(text, text) is
  'Returns bounded NEONTRIP relationship, persisted attachment state, and request product. Exact email plus corroborated company history; tenant ID is never a company key. No RIESENOBJEKTE history.';
