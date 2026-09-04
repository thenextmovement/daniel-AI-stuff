\set ON_ERROR_STOP on

begin;
set local role service_role;

do $$
declare
  first_result record;
  replay_result record;
  request_count integer;
  customer_count integer;
begin
  select * into first_result
  from public.accept_landing_request(
    jsonb_build_object(
      'email', 'lp-confirmed-conversion@example.invalid',
      'first_name', 'LP',
      'last_name', 'Test',
      'phone', '+492110000000',
      'company_name', 'NEONTRIP Integration Test',
      'source', 'nerdy_forms'
    ),
    jsonb_build_object(
      'request_id', '90409271-0000-4000-8000-000000000001',
      'title', 'LP confirmed conversion test',
      'description', 'Transactional acceptance test',
      'segment', 'NT-9',
      'size', '100cm',
      'color', jsonb_build_array('Pink'),
      'application', 'Indoor',
      'delivery_time', 'Standard',
      'country', 'Deutschland',
      'file_urls', '[]'::jsonb,
      'form_id', 'landing-page-form',
      'product_type', 'LED Neonschild',
      'intake_source', 'current_lp',
      'consent_ad_user_data', 'unknown',
      'consent_ad_personalization', 'unknown',
      'attribution_raw', jsonb_build_object('auto_reply_suppressed', true)
    )
  );

  if first_result.ok is not true
     or first_result.created is not true
     or first_result.request_row_id is null
     or first_result.customer_row_id is null then
    raise exception 'First acceptance was not confirmed: %', row_to_json(first_result);
  end if;

  select * into replay_result
  from public.accept_landing_request(
    jsonb_build_object(
      'email', 'LP-CONFIRMED-CONVERSION@example.invalid',
      'first_name', 'Changed',
      'last_name', 'Replay',
      'company_name', 'Must not overwrite on replay'
    ),
    jsonb_build_object(
      'request_id', '90409271-0000-4000-8000-000000000001',
      'title', 'Replay must not create side effects',
      'form_id', 'landing-page-form'
    )
  );

  if replay_result.ok is not true
     or replay_result.created is not false
     or replay_result.request_row_id is distinct from first_result.request_row_id
     or replay_result.customer_row_id is distinct from first_result.customer_row_id then
    raise exception 'Replay contract failed: %', row_to_json(replay_result);
  end if;

  select count(*) into request_count
  from public.master_requests
  where request_id = '90409271-0000-4000-8000-000000000001';

  select count(*) into customer_count
  from public.master_customers
  where lower(btrim(email)) = 'lp-confirmed-conversion@example.invalid';

  if request_count <> 1 or customer_count <> 1 then
    raise exception 'Acceptance was not idempotent: requests %, customers %', request_count, customer_count;
  end if;

  if has_function_privilege('anon', 'public.accept_landing_request(jsonb,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.accept_landing_request(jsonb,jsonb)', 'execute')
     or not has_function_privilege('service_role', 'public.accept_landing_request(jsonb,jsonb)', 'execute') then
    raise exception 'accept_landing_request grants are unsafe';
  end if;
end;
$$;

rollback;
