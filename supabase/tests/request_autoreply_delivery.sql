\set ON_ERROR_STOP on

-- Run after the disposable fixture and the request auto-reply migration.

set role service_role;

do $$
declare
  result jsonb;
begin
  select public.configure_request_autoreply(
    'live',
    'disposable database integration test',
    null,
    'sql-test'
  ) into result;
  if result ->> 'mode' <> 'live' then
    raise exception 'Expected live mode, got %', result;
  end if;
end;
$$;

insert into public.master_customers (
  id, email, first_name, last_name, company_name, country
) values (
  '10000000-0000-4000-8000-000000000001',
  'thomas@kundendomain.de',
  'Thomas',
  'Test',
  'Test GmbH',
  'DE'
);

insert into public.master_requests (
  id,
  request_id,
  customer_id,
  title,
  description,
  status,
  size,
  application,
  form_id,
  attribution_raw
) values (
  '20000000-0000-4000-8000-000000000001',
  'REQ-AUTOREPLY-TEST-1',
  '10000000-0000-4000-8000-000000000001',
  'LED-Leuchtschild außen',
  'Bitte ein Schild in 120 x 60 cm für außen anbieten.',
  'new',
  '120 x 60 cm',
  'Außenbereich',
  'landing-page-form',
  '{}'::jsonb
);

-- The current request does not count as history.
do $$
declare
  relationship jsonb;
begin
  select public.get_request_autoreply_relationship_context(
    '  THOMAS@KUNDENDOMAIN.DE ',
    'REQ-AUTOREPLY-TEST-1'
  ) into relationship;
  if relationship ->> 'relationship_type' <> 'new'
     or relationship ->> 'match_method' <> 'exact_normalized_email'
     or relationship ->> 'attachment_state' <> 'missing'
     or (relationship ->> 'attachment_context_ok')::boolean is not true
     or relationship ->> 'attachment_source_kind' <> 'landing-page-form' then
    raise exception 'Current request was incorrectly treated as history: %', relationship;
  end if;
end;
$$;

-- Attachment context is taken only from the persisted request row.
update public.master_requests
set file_urls = array['https://files.invalid/test-design.svg']::text[]
where request_id = 'REQ-AUTOREPLY-TEST-1';

do $$
declare
  context jsonb;
begin
  select public.get_request_autoreply_relationship_context(
    'thomas@kundendomain.de',
    'REQ-AUTOREPLY-TEST-1'
  ) into context;
  if context ->> 'attachment_state' <> 'present'
     or (context ->> 'attachment_context_ok')::boolean is not true then
    raise exception 'Persisted attachment was not classified as present: %', context;
  end if;

  select public.get_request_autoreply_relationship_context(
    'thomas@kundendomain.de',
    'REQ-DOES-NOT-EXIST'
  ) into context;
  if context ->> 'attachment_state' <> 'unknown'
     or (context ->> 'attachment_context_ok')::boolean is not false then
    raise exception 'Missing request context did not fail safe to unknown: %', context;
  end if;
end;
$$;

update public.master_requests
set file_urls = '{}'::text[]
where request_id = 'REQ-AUTOREPLY-TEST-1';

insert into public.master_customers (
  id, email, first_name, last_name, company_name, country
) values
  (
    '10000000-0000-4000-8000-000000000002',
    'repeat@kundendomain.de',
    'Rita',
    'Repeat',
    'Repeat GmbH',
    'DE'
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    'buyer@kundendomain.de',
    'Berta',
    'Buyer',
    'Buyer GmbH',
    'DE'
  ),
  (
    '10000000-0000-4000-8000-000000000004',
    'offer@kundendomain.de',
    'Olaf',
    'Offer',
    'Offer GmbH',
    'DE'
  );

insert into public.master_requests (
  id, request_id, customer_id, title, status, form_id, attribution_raw, created_at
) values (
  '20000000-0000-4000-8000-000000000010',
  'REQ-AUTOREPLY-HISTORIC-REPEAT',
  '10000000-0000-4000-8000-000000000002',
  'Frühere Anfrage',
  'new',
  'landing-page-form',
  '{"auto_reply_suppressed":true}'::jsonb,
  now() - interval '30 days'
);

insert into public.master_orders (
  id, customer_id, shopify_order_id, status, cancelled_at, shopify_created_at
) values (
  '40000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000003',
  'SHOPIFY-PAID-1',
  'paid',
  null,
  now() - interval '90 days'
);

insert into public.crm_quotes (
  id, customer_id, status, sent_at
) values (
  '50000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000004',
  'sent',
  now() - interval '45 days'
);

insert into public.supplier_sales (
  id, source, customer_email, shopify_payment_status,
  payment_decision_status, assignment_status, created_at
) values (
  '60000000-0000-4000-8000-000000000001',
  'neontrip-offers',
  'offer-buyer@kundendomain.de',
  'unknown',
  'paid_confirmed',
  'in_production',
  now() - interval '20 days'
);

do $$
declare
  relationship jsonb;
begin
  select public.get_request_autoreply_relationship_context(
    'repeat@kundendomain.de',
    'REQ-CURRENT-REPEAT'
  ) into relationship;
  if relationship ->> 'relationship_type' <> 'repeat_inquiry' then
    raise exception 'Prior request was not classified as repeat inquiry: %', relationship;
  end if;

  select public.get_request_autoreply_relationship_context(
    'buyer@kundendomain.de',
    'REQ-CURRENT-BUYER'
  ) into relationship;
  if relationship ->> 'relationship_type' <> 'existing_customer' then
    raise exception 'Paid order was not classified as existing customer: %', relationship;
  end if;

  select public.get_request_autoreply_relationship_context(
    'offer@kundendomain.de',
    'REQ-CURRENT-OFFER'
  ) into relationship;
  if relationship ->> 'relationship_type' <> 'repeat_inquiry' then
    raise exception 'Sent offer was not classified as repeat inquiry: %', relationship;
  end if;

  select public.get_request_autoreply_relationship_context(
    'offer-buyer@kundendomain.de',
    'REQ-CURRENT-OFFER-BUYER'
  ) into relationship;
  if relationship ->> 'relationship_type' <> 'existing_customer' then
    raise exception 'Paid own-offer sale was not classified as existing customer: %', relationship;
  end if;
end;
$$;

do $$
declare
  jobs integer;
  due_delta interval;
begin
  select count(*), min(due_at - created_at)
  into jobs, due_delta
  from public.request_autoreply_jobs
  where request_id = 'REQ-AUTOREPLY-TEST-1';

  if jobs <> 1 then
    raise exception 'Expected exactly one enqueued job, got %', jobs;
  end if;
  if due_delta < interval '5 minutes 55 seconds'
     or due_delta > interval '6 minutes 5 seconds' then
    raise exception 'Expected approximately six minute delay, got %', due_delta;
  end if;
end;
$$;

-- An upsert replay updates the existing request row and must not enqueue again.
insert into public.master_requests (
  id,
  request_id,
  customer_id,
  title,
  description,
  status,
  form_id,
  attribution_raw
) values (
  '20000000-0000-4000-8000-000000000001',
  'REQ-AUTOREPLY-TEST-1',
  '10000000-0000-4000-8000-000000000001',
  'Replay',
  'Replay',
  'new',
  'landing-page-form',
  '{}'::jsonb
)
on conflict (request_id) do update
set title = excluded.title;

do $$
begin
  if (select count(*) from public.request_autoreply_jobs where request_id = 'REQ-AUTOREPLY-TEST-1') <> 1 then
    raise exception 'Request replay created a duplicate job';
  end if;
end;
$$;

update public.request_autoreply_jobs
set due_at = now() - interval '1 second'
where request_id = 'REQ-AUTOREPLY-TEST-1';

do $$
declare
  claim jsonb;
  replay jsonb;
  receipt jsonb;
begin
  select public.claim_request_autoreply_candidate('sql-exec-1', 900) into claim;
  if claim ->> 'route' <> 'process'
     or claim #>> '{candidate,recipient}' <> 'thomas@kundendomain.de'
     or claim #>> '{candidate,recipient_mode}' <> 'live'
     or claim #>> '{candidate,source_kind}' <> 'landing-page-form' then
    raise exception 'Unexpected live claim: %', claim;
  end if;

  select public.claim_request_autoreply_candidate('sql-exec-1', 900) into replay;
  if replay ->> 'reason' <> 'execution_already_has_active_claim' then
    raise exception 'Execution replay consumed or exposed another candidate: %', replay;
  end if;

  select public.complete_request_autoreply_delivery(
    (claim ->> 'job_id')::uuid,
    (claim ->> 'claim_token')::uuid,
    'sql-exec-1',
    'provider-test-message-1',
    'sql_test',
    'ai',
    'Vielen Dank für Ihre Anfrage bei NEONTRIP',
    'fnv1a32:12345678'
  ) into receipt;
  if receipt ->> 'status' <> 'sent' or (receipt ->> 'sent')::boolean is not true then
    raise exception 'Completion receipt failed: %', receipt;
  end if;

  select public.complete_request_autoreply_delivery(
    (claim ->> 'job_id')::uuid,
    (claim ->> 'claim_token')::uuid,
    'sql-exec-1',
    'provider-test-message-1',
    'sql_test',
    'ai',
    'Vielen Dank für Ihre Anfrage bei NEONTRIP',
    'fnv1a32:12345678'
  ) into replay;
  if replay ->> 'reason' <> 'already_completed' then
    raise exception 'Completion replay was not idempotent: %', replay;
  end if;
end;
$$;

-- Suppressed and non-allowlisted sources must never enter the queue.
insert into public.master_requests (
  id, request_id, customer_id, title, status, form_id, attribution_raw
) values
  (
    '20000000-0000-4000-8000-000000000002',
    'REQ-AUTOREPLY-SUPPRESSED',
    '10000000-0000-4000-8000-000000000001',
    'Suppressed',
    'new',
    'outlook_email',
    '{"auto_reply_suppressed":true}'::jsonb
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    'REQ-AUTOREPLY-MANUAL',
    '10000000-0000-4000-8000-000000000001',
    'Manual',
    'new',
    'manual_ops_import',
    '{}'::jsonb
  );

do $$
begin
  if exists (
    select 1 from public.request_autoreply_jobs
    where request_id in ('REQ-AUTOREPLY-SUPPRESSED', 'REQ-AUTOREPLY-MANUAL')
  ) then
    raise exception 'Suppressed/manual source was enqueued';
  end if;
end;
$$;

-- Provider ambiguity is terminal and replay-safe.
insert into public.master_requests (
  id, request_id, customer_id, title, description, status, form_id, attribution_raw
) values (
  '20000000-0000-4000-8000-000000000004',
  'REQ-AUTOREPLY-UNKNOWN',
  '10000000-0000-4000-8000-000000000001',
  'Unknown outcome test',
  'Schild für innen',
  'new',
  'outlook_email',
  '{"source":"outlook_email"}'::jsonb
);

update public.request_autoreply_jobs
set due_at = now() - interval '1 second'
where request_id = 'REQ-AUTOREPLY-UNKNOWN';

do $$
declare
  claim jsonb;
  receipt jsonb;
  replay jsonb;
begin
  select public.claim_request_autoreply_candidate('sql-exec-2', 900) into claim;
  if claim ->> 'route' <> 'process' then
    raise exception 'Could not claim ambiguity test job: %', claim;
  end if;

  select public.mark_request_autoreply_delivery_unknown(
    (claim ->> 'job_id')::uuid,
    (claim ->> 'claim_token')::uuid,
    'sql-exec-2',
    'outlook_send_unknown',
    'synthetic provider ambiguity'
  ) into receipt;
  if receipt ->> 'status' <> 'delivery_unknown'
     or (receipt ->> 'manual_review_required')::boolean is not true then
    raise exception 'Ambiguous outcome was not quarantined: %', receipt;
  end if;

  select public.mark_request_autoreply_delivery_unknown(
    (claim ->> 'job_id')::uuid,
    (claim ->> 'claim_token')::uuid,
    'sql-exec-2',
    'outlook_send_unknown',
    'synthetic provider ambiguity'
  ) into replay;
  if replay ->> 'reason' <> 'already_marked_unknown' then
    raise exception 'Unknown receipt replay was not idempotent: %', replay;
  end if;
end;
$$;

-- Deterministic pre-send failures are blocked before Outlook and are replay-safe.
insert into public.master_requests (
  id, request_id, customer_id, title, description, status, form_id, attribution_raw
) values (
  '20000000-0000-4000-8000-000000000006',
  'REQ-AUTOREPLY-BLOCK',
  '10000000-0000-4000-8000-000000000001',
  'Pre-send block test',
  'Schild für außen',
  'new',
  'landing-page-form',
  '{}'::jsonb
);

update public.request_autoreply_jobs
set due_at = now() - interval '1 second'
where request_id = 'REQ-AUTOREPLY-BLOCK';

do $$
declare
  claim jsonb;
  receipt jsonb;
  replay jsonb;
begin
  select public.claim_request_autoreply_candidate('sql-exec-block', 900) into claim;
  if claim ->> 'route' <> 'process' then
    raise exception 'Could not claim pre-send block test job: %', claim;
  end if;

  select public.block_request_autoreply_delivery(
    (claim ->> 'job_id')::uuid,
    (claim ->> 'claim_token')::uuid,
    'sql-exec-block',
    'pre_send_validation_failed'
  ) into receipt;
  if receipt ->> 'status' <> 'blocked'
     or (receipt ->> 'automatic_send_allowed')::boolean is not false then
    raise exception 'Pre-send failure was not blocked: %', receipt;
  end if;

  select public.block_request_autoreply_delivery(
    (claim ->> 'job_id')::uuid,
    (claim ->> 'claim_token')::uuid,
    'sql-exec-block',
    'pre_send_validation_failed'
  ) into replay;
  if replay ->> 'reason' <> 'already_blocked' then
    raise exception 'Pre-send block replay was not idempotent: %', replay;
  end if;
end;
$$;

-- Expired processing leases are quarantined before another claim is considered.
insert into public.master_requests (
  id, request_id, customer_id, title, description, status, form_id, attribution_raw
) values (
  '20000000-0000-4000-8000-000000000005',
  'REQ-AUTOREPLY-STALE',
  '10000000-0000-4000-8000-000000000001',
  'Stale lease test',
  'Schild für innen',
  'new',
  '2418',
  '{}'::jsonb
);

update public.request_autoreply_jobs
set status = 'processing',
    attempt_count = 1,
    claim_token = '30000000-0000-4000-8000-000000000001',
    claimed_at = now() - interval '20 minutes',
    lease_until = now() - interval '5 minutes',
    last_execution_id = 'stale-exec',
    due_at = now() - interval '20 minutes'
where request_id = 'REQ-AUTOREPLY-STALE';

select public.claim_request_autoreply_candidate('sql-exec-stale-sweep', 900);

do $$
begin
  if (select status from public.request_autoreply_jobs where request_id = 'REQ-AUTOREPLY-STALE') <> 'delivery_unknown' then
    raise exception 'Expired lease was not quarantined';
  end if;
end;
$$;

-- Canary is internally addressed and does not require a synthetic master request.
select public.configure_request_autoreply(
  'canary',
  'disposable canary test',
  'support@neontrip.de',
  'sql-test'
);
select public.enqueue_request_autoreply_canary('sql-canary-1', 'sql-test');

do $$
declare
  claim jsonb;
begin
  select public.claim_request_autoreply_candidate('sql-exec-canary', 900) into claim;
  if claim ->> 'route' <> 'process'
     or claim #>> '{candidate,recipient}' <> 'support@neontrip.de'
     or claim #>> '{candidate,recipient_mode}' <> 'canary'
     or claim #>> '{candidate,source_kind}' <> 'canary' then
    raise exception 'Unexpected canary claim: %', claim;
  end if;
end;
$$;

-- Kill switch blocks further claims and enqueue activity.
select public.configure_request_autoreply(
  'off',
  'disposable kill switch test',
  null,
  'sql-test'
);

do $$
declare
  result jsonb;
begin
  select public.claim_request_autoreply_candidate('sql-exec-off', 900) into result;
  if result ->> 'reason' <> 'delivery_disabled' then
    raise exception 'Kill switch did not stop claims: %', result;
  end if;
end;
$$;

reset role;

do $$
begin
  if has_table_privilege('anon', 'public.request_autoreply_jobs', 'select') then
    raise exception 'anon unexpectedly has request auto-reply job access';
  end if;
  if has_function_privilege(
    'anon',
    'public.claim_request_autoreply_candidate(text,integer)',
    'execute'
  ) then
    raise exception 'anon unexpectedly has request auto-reply claim access';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.claim_request_autoreply_candidate(text,integer)',
    'execute'
  ) then
    raise exception 'service_role is missing request auto-reply claim access';
  end if;
  if has_function_privilege(
    'anon',
    'public.get_request_autoreply_relationship_context(text,text)',
    'execute'
  ) then
    raise exception 'anon unexpectedly has relationship lookup access';
  end if;
  if not has_function_privilege(
    'service_role',
    'public.get_request_autoreply_relationship_context(text,text)',
    'execute'
  ) then
    raise exception 'service_role is missing relationship lookup access';
  end if;
end;
$$;

select 'request autoreply SQL checks passed' as result;
