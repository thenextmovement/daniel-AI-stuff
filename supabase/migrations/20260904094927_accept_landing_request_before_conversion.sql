-- Persist a complete NEONTRIP landing-page request before the browser is
-- allowed to emit conversion events. The function is intentionally callable
-- only by the existing service-role intake credential.

create or replace function public.accept_landing_request(
  p_customer jsonb,
  p_request jsonb
)
returns table (
  ok boolean,
  created boolean,
  request_row_id uuid,
  accepted_request_id text,
  customer_row_id uuid,
  trello_card_id text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_request_id text := btrim(coalesce(p_request ->> 'request_id', ''));
  v_email text := lower(btrim(coalesce(p_customer ->> 'email', '')));
  v_customer_id uuid;
  v_request_row_id uuid;
  v_existing_customer_id uuid;
  v_existing_email text;
  v_existing_trello_card_id text;
  v_color text[] := '{}'::text[];
  v_file_urls text[] := '{}'::text[];
  v_attribution_raw jsonb := '{}'::jsonb;
begin
  if coalesce(jsonb_typeof(p_customer), 'null') <> 'object'
     or coalesce(jsonb_typeof(p_request), 'null') <> 'object' then
    raise exception using
      errcode = '22023',
      message = 'landing_request_payload_must_be_objects';
  end if;

  if v_request_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception using
      errcode = '22023',
      message = 'landing_request_id_must_be_uuid_v4';
  end if;

  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception using
      errcode = '22023',
      message = 'landing_request_email_invalid';
  end if;

  -- A completed replay must be returned before any customer mutation or
  -- projection side effect. The email comparison protects against a request-ID
  -- collision being treated as a legitimate replay.
  select
    request_row.id,
    request_row.customer_id,
    lower(btrim(customer_row.email)),
    request_row.trello_card_id
  into
    v_request_row_id,
    v_existing_customer_id,
    v_existing_email,
    v_existing_trello_card_id
  from public.master_requests as request_row
  left join public.master_customers as customer_row
    on customer_row.id = request_row.customer_id
  where request_row.request_id = v_request_id
  for update of request_row;

  if found then
    if v_existing_email is distinct from v_email then
      raise exception using
        errcode = '23505',
        message = 'landing_request_id_conflict';
    end if;

    return query select
      true,
      false,
      v_request_row_id,
      v_request_id,
      v_existing_customer_id,
      v_existing_trello_card_id;
    return;
  end if;

  -- Reuse an existing customer case-insensitively. New intake emails are stored
  -- normalized so future exact conflicts remain deterministic.
  select customer_row.id
  into v_customer_id
  from public.master_customers as customer_row
  where lower(btrim(customer_row.email)) = v_email
  order by customer_row.created_at nulls last, customer_row.id
  limit 1
  for update;

  if found then
    update public.master_customers as customer_row
    set
      first_name = coalesce(nullif(btrim(p_customer ->> 'first_name'), ''), customer_row.first_name),
      last_name = coalesce(nullif(btrim(p_customer ->> 'last_name'), ''), customer_row.last_name),
      phone = coalesce(nullif(btrim(p_customer ->> 'phone'), ''), customer_row.phone),
      company_name = coalesce(nullif(btrim(p_customer ->> 'company_name'), ''), customer_row.company_name),
      company = coalesce(nullif(btrim(p_customer ->> 'company_name'), ''), customer_row.company),
      source = coalesce(customer_row.source, nullif(btrim(p_customer ->> 'source'), '')),
      request_id = v_request_id
    where customer_row.id = v_customer_id;
  else
    insert into public.master_customers as target_customer (
      email,
      first_name,
      last_name,
      phone,
      company_name,
      company,
      source,
      request_id
    ) values (
      v_email,
      nullif(btrim(p_customer ->> 'first_name'), ''),
      nullif(btrim(p_customer ->> 'last_name'), ''),
      nullif(btrim(p_customer ->> 'phone'), ''),
      nullif(btrim(p_customer ->> 'company_name'), ''),
      nullif(btrim(p_customer ->> 'company_name'), ''),
      coalesce(nullif(btrim(p_customer ->> 'source'), ''), 'nerdy_forms'),
      v_request_id
    )
    on conflict (email) do update
      set
        first_name = coalesce(excluded.first_name, target_customer.first_name),
        last_name = coalesce(excluded.last_name, target_customer.last_name),
        phone = coalesce(excluded.phone, target_customer.phone),
        company_name = coalesce(excluded.company_name, target_customer.company_name),
        company = coalesce(excluded.company, target_customer.company),
        source = coalesce(target_customer.source, excluded.source),
        request_id = excluded.request_id
    returning target_customer.id into v_customer_id;
  end if;

  if jsonb_typeof(p_request -> 'color') = 'array' then
    select coalesce(array_agg(value), '{}'::text[])
    into v_color
    from jsonb_array_elements_text(p_request -> 'color') as color_value(value);
  end if;

  if jsonb_typeof(p_request -> 'file_urls') = 'array' then
    select coalesce(array_agg(value), '{}'::text[])
    into v_file_urls
    from jsonb_array_elements_text(p_request -> 'file_urls') as file_value(value);
  end if;

  if jsonb_typeof(p_request -> 'attribution_raw') = 'object' then
    v_attribution_raw := p_request -> 'attribution_raw';
  end if;

  insert into public.master_requests (
    request_id,
    customer_id,
    title,
    description,
    segment,
    status,
    size,
    color,
    application,
    delivery_time,
    customer_type,
    country,
    file_urls,
    form_id,
    product_type,
    gclid,
    gbraid,
    wbraid,
    utm_source,
    utm_medium,
    utm_campaign,
    utm_term,
    utm_content,
    landing_page_url,
    referrer,
    intake_source,
    form_variant,
    consent_ad_user_data,
    consent_ad_personalization,
    consent_recorded_at,
    consent_source,
    consent_policy_version,
    attribution_raw
  ) values (
    v_request_id,
    v_customer_id,
    nullif(btrim(p_request ->> 'title'), ''),
    nullif(p_request ->> 'description', ''),
    coalesce(nullif(btrim(p_request ->> 'segment'), ''), 'NT-9'),
    'new',
    nullif(btrim(p_request ->> 'size'), ''),
    v_color,
    nullif(btrim(p_request ->> 'application'), ''),
    nullif(btrim(p_request ->> 'delivery_time'), ''),
    nullif(btrim(p_request ->> 'customer_type'), ''),
    nullif(btrim(p_request ->> 'country'), ''),
    v_file_urls,
    coalesce(nullif(btrim(p_request ->> 'form_id'), ''), 'landing-page-form'),
    nullif(left(btrim(p_request ->> 'product_type'), 120), ''),
    nullif(btrim(p_request ->> 'gclid'), ''),
    nullif(btrim(p_request ->> 'gbraid'), ''),
    nullif(btrim(p_request ->> 'wbraid'), ''),
    nullif(btrim(p_request ->> 'utm_source'), ''),
    nullif(btrim(p_request ->> 'utm_medium'), ''),
    nullif(btrim(p_request ->> 'utm_campaign'), ''),
    nullif(btrim(p_request ->> 'utm_term'), ''),
    nullif(btrim(p_request ->> 'utm_content'), ''),
    nullif(btrim(p_request ->> 'landing_page_url'), ''),
    nullif(btrim(p_request ->> 'referrer'), ''),
    coalesce(nullif(btrim(p_request ->> 'intake_source'), ''), 'current_lp'),
    nullif(left(btrim(p_request ->> 'form_variant'), 120), ''),
    coalesce(nullif(btrim(p_request ->> 'consent_ad_user_data'), ''), 'unknown'),
    coalesce(nullif(btrim(p_request ->> 'consent_ad_personalization'), ''), 'unknown'),
    nullif(btrim(p_request ->> 'consent_recorded_at'), '')::timestamptz,
    nullif(btrim(p_request ->> 'consent_source'), ''),
    nullif(btrim(p_request ->> 'consent_policy_version'), ''),
    v_attribution_raw
  )
  on conflict (request_id) do nothing
  returning public.master_requests.id into v_request_row_id;

  if found then
    return query select
      true,
      true,
      v_request_row_id,
      v_request_id,
      v_customer_id,
      null::text;
    return;
  end if;

  -- Concurrent replay: the competing transaction inserted first. Re-read the
  -- authoritative row and apply the same collision guard.
  select
    request_row.id,
    request_row.customer_id,
    lower(btrim(customer_row.email)),
    request_row.trello_card_id
  into
    v_request_row_id,
    v_existing_customer_id,
    v_existing_email,
    v_existing_trello_card_id
  from public.master_requests as request_row
  left join public.master_customers as customer_row
    on customer_row.id = request_row.customer_id
  where request_row.request_id = v_request_id;

  if not found or v_existing_email is distinct from v_email then
    raise exception using
      errcode = '23505',
      message = 'landing_request_id_conflict';
  end if;

  return query select
    true,
    false,
    v_request_row_id,
    v_request_id,
    v_existing_customer_id,
    v_existing_trello_card_id;
end;
$$;

revoke all on function public.accept_landing_request(jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.accept_landing_request(jsonb, jsonb)
  to service_role;

comment on function public.accept_landing_request(jsonb, jsonb) is
  'Atomically accepts one complete NEONTRIP landing-page request before conversion tracking. Stable request IDs are replay-safe; Trello and notification projections remain downstream.';
