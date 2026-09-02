-- Restore the previous attachment-only request context before removing product_type.

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
  current_request_found boolean := false;
  attachment_context_ok boolean := false;
  attachment_state text := 'unknown';
begin
  if safe_current_request_id is not null then
    select
      lower(coalesce(request_row.form_id, '')),
      request_row.file_urls
    into current_form_id, current_file_urls
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
      'attachment_rule_version', 'neontrip_form_file_urls_v1'
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
    'brand', 'neontrip',
    'attachment_context_ok', attachment_context_ok,
    'attachment_state', attachment_state,
    'attachment_source_kind', current_form_id,
    'attachment_rule_version', 'neontrip_form_file_urls_v1'
  );
end;
$$;

revoke all on function public.get_request_autoreply_relationship_context(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_request_autoreply_relationship_context(text, text)
  to service_role;

comment on function public.get_request_autoreply_relationship_context(text, text) is
  'Returns a bounded NEONTRIP-only relationship class plus persisted form attachment state. Exact normalized email only; no RIESENOBJEKTE history.';

alter table public.master_requests
  drop column if exists product_type;
