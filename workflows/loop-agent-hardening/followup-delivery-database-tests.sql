create or replace function pg_temp.assert_true(condition boolean, message text)
returns void
language plpgsql
as $$
begin
  if condition is not true then
    raise exception 'assertion failed: %', message;
  end if;
end;
$$;

insert into public.followup_queue (
  document_id, document_name, customer_name, customer_email, segment, anrede,
  followup_type, followup_number, scheduled_for, status, request_id,
  offer_public_url
) values
  ('doc-1', 'Angebot - 2026-1001', 'Ada Lovelace', 'ada@customer.invalid', 'NT-8', 'Frau',
   'followup_1', 1, now() - interval '1 minute', 'pending', 'REQ-1',
   'https://angebote.neontrip.de/offer/test'),
  ('doc-payment', 'Payment', 'Payment Contact', 'pay@customer.invalid', 'NT-2', 'Herr',
   'payment_reminder_1', 1, now() - interval '1 minute', 'pending', 'REQ-PAY',
   'https://angebote.neontrip.de/offer/test');

do $$
declare
  first_claim jsonb;
  replay jsonb;
  completed jsonb;
  next_row public.followup_queue%rowtype;
begin
  first_claim := public.claim_followup_delivery_candidate('execution-1', 900);
  perform pg_temp.assert_true(
    first_claim->>'route' = 'process'
      and first_claim->>'copy_mode' = 'deterministic'
      and not (first_claim->>'ai_copy_allowed')::boolean
      and not (first_claim->>'automatic_retry_allowed')::boolean
      and first_claim->'candidate'->>'document_id' = 'doc-1',
    'first claim must choose the non-payment follow-up only'
  );

  replay := public.claim_followup_delivery_candidate('execution-2', 900);
  perform pg_temp.assert_true(
    replay->>'route' = 'stop' and replay->>'reason' = 'no_candidate',
    'parallel/replay claim must not claim processing or payment rows'
  );

  completed := public.complete_followup_delivery(
    (first_claim->>'followup_queue_id')::uuid,
    (first_claim->>'claim_token')::uuid,
    'outlook-message-1',
    'execution-1',
    'Ihr NEONTRIP-Angebot',
    '<p>Deterministic body</p>'
  );
  perform pg_temp.assert_true(
    (completed->>'completed')::boolean
      and (completed->>'next_followup_inserted')::boolean
      and (completed->>'next_followup_number')::integer = 2,
    'confirmed Outlook delivery must complete and schedule the next follow-up'
  );

  select * into next_row
  from public.followup_queue
  where document_id = 'doc-1' and followup_number = 2;

  perform pg_temp.assert_true(
    next_row.status = 'pending'
      and next_row.scheduled_for between now() + interval '71 hours'
                                      and now() + interval '73 hours',
    'next follow-up must be inserted once at the deterministic interval'
  );

  completed := public.complete_followup_delivery(
    (first_claim->>'followup_queue_id')::uuid,
    (first_claim->>'claim_token')::uuid,
    'outlook-message-1',
    'execution-1',
    'Ihr NEONTRIP-Angebot',
    '<p>Deterministic body</p>'
  );
  perform pg_temp.assert_true(
    completed->>'reason' = 'already_completed',
    'completion replay must be idempotent'
  );
end;
$$;

insert into public.followup_queue (
  document_id, customer_name, customer_email, segment, followup_type,
  followup_number, scheduled_for, status, request_id, offer_public_url
) values (
  'doc-block', 'Grace Hopper', 'grace@customer.invalid', 'NT-2', 'followup_1',
  1, now() - interval '1 minute', 'pending', 'REQ-BLOCK',
  'https://angebote.neontrip.de/offer/test'
);

do $$
declare
  claim jsonb;
  blocked jsonb;
begin
  claim := public.claim_followup_delivery_candidate('execution-block', 900);
  blocked := public.block_followup_delivery(
    (claim->>'followup_queue_id')::uuid,
    (claim->>'claim_token')::uuid,
    'execution-block',
    'customer_reply_detected'
  );
  perform pg_temp.assert_true(
    (blocked->>'blocked')::boolean
      and (select status = 'human_review' from public.followup_queue where id = (claim->>'followup_queue_id')::uuid),
    'preflight blocks must route the queue row to human review'
  );
end;
$$;

insert into public.followup_queue (
  document_id, customer_name, customer_email, segment, followup_type,
  followup_number, scheduled_for, status, request_id, offer_public_url
) values (
  'doc-unknown', 'Katherine Johnson', 'katherine@customer.invalid', 'NT-2', 'followup_1',
  1, now() - interval '1 minute', 'pending', 'REQ-UNKNOWN',
  'https://angebote.neontrip.de/offer/test'
);

do $$
declare
  claim jsonb;
  marked jsonb;
begin
  claim := public.claim_followup_delivery_candidate('execution-unknown', 900);
  marked := public.mark_followup_delivery_unknown(
    (claim->>'followup_queue_id')::uuid,
    (claim->>'claim_token')::uuid,
    'execution-unknown',
    'synthetic_timeout'
  );
  perform pg_temp.assert_true(
    (marked->>'marked_unknown')::boolean
      and not (marked->>'automatic_retry_allowed')::boolean
      and (select status = 'human_review' from public.followup_queue where id = (claim->>'followup_queue_id')::uuid),
    'ambiguous Outlook result must become delivery_unknown and human review'
  );
end;
$$;

insert into public.followup_queue (
  document_id, customer_name, customer_email, segment, followup_type,
  followup_number, scheduled_for, status, request_id, offer_public_url
) values (
  'doc-stale', 'Dorothy Vaughan', 'dorothy@customer.invalid', 'NT-2', 'followup_1',
  1, now() - interval '1 minute', 'pending', 'REQ-STALE',
  'https://angebote.neontrip.de/offer/test'
);

do $$
declare
  stale_claim jsonb;
  recovery_claim jsonb;
begin
  stale_claim := public.claim_followup_delivery_candidate('execution-stale-1', 60);
  update public.followup_delivery_attempts
    set lease_until = now() - interval '1 second'
  where followup_queue_id = (stale_claim->>'followup_queue_id')::uuid;

  recovery_claim := public.claim_followup_delivery_candidate('execution-stale-2', 900);
  perform pg_temp.assert_true(
    (select status = 'delivery_unknown'
       from public.followup_delivery_attempts
      where followup_queue_id = (stale_claim->>'followup_queue_id')::uuid)
      and (select status = 'human_review'
       from public.followup_queue
      where id = (stale_claim->>'followup_queue_id')::uuid),
    'expired in-flight send must fail closed before another claim'
  );
end;
$$;

select pg_temp.assert_true(
  (
    select count(*) = 8
      and count(*) filter (where event_type = 'claimed') = 4
      and count(*) filter (where event_type = 'sent') = 1
      and count(*) filter (where event_type = 'blocked') = 1
      and count(*) filter (where event_type = 'delivery_unknown') = 2
    from public.followup_delivery_events
  ),
  'transition audit must contain exactly one event per state change'
);

select pg_temp.assert_true(
  not has_function_privilege(
    'anon',
    'public.claim_followup_delivery_candidate(text,integer)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.claim_followup_delivery_candidate(text,integer)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.claim_followup_delivery_candidate(text,integer)',
    'execute'
  ),
  'only service_role may claim follow-up deliveries'
);

select 'follow-up delivery database tests passed' as result;
