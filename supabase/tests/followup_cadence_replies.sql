\set ON_ERROR_STOP on

-- Transactional post-migration checks for a disposable schema. This script
-- never calls the claim RPC or sends a customer message, and rolls back every
-- fixture row.

begin;
set role service_role;

do $followup_cadence_contract_test$
declare
  slot_2 timestamptz;
  slot_3 timestamptz;
  slot_5 timestamptz;
  missing jsonb;
begin
  if to_regprocedure(
       'public.neontrip_get_followup_queue_cadence_decision(uuid)'
     ) is null
     or to_regprocedure(
       'public.apply_followup_reply_decision(uuid,uuid,text,text,text,text,numeric,text,text,text,text)'
     ) is null then
    raise exception 'Follow-up cadence functions are missing';
  end if;

  slot_2 := public.neontrip_followup_business_slot(
    '2026-08-24 10:00:00+02'::timestamptz,
    2,
    'frequent-first'
  );
  slot_3 := public.neontrip_followup_business_slot(
    '2026-08-24 10:00:00+02'::timestamptz,
    3,
    'frequent-next'
  );
  slot_5 := public.neontrip_followup_business_slot(
    '2026-08-24 10:00:00+02'::timestamptz,
    5,
    'weekly-next'
  );

  if (slot_2 at time zone 'Europe/Berlin')::date <> date '2026-08-26'
     or (slot_3 at time zone 'Europe/Berlin')::date <> date '2026-08-27'
     or (slot_5 at time zone 'Europe/Berlin')::date <> date '2026-08-31' then
    raise exception 'Business-day cadence is wrong: %, %, %', slot_2, slot_3, slot_5;
  end if;

  if (slot_2 at time zone 'Europe/Berlin')::time < time '09:00'
     or (slot_2 at time zone 'Europe/Berlin')::time >= time '16:00'
     or (slot_3 at time zone 'Europe/Berlin')::time < time '09:00'
     or (slot_3 at time zone 'Europe/Berlin')::time >= time '16:00'
     or (slot_5 at time zone 'Europe/Berlin')::time < time '09:00'
     or (slot_5 at time zone 'Europe/Berlin')::time >= time '16:00' then
    raise exception 'A cadence slot is outside the 09:00-16:00 window';
  end if;

  missing := public.neontrip_get_followup_queue_cadence_decision(
    '00000000-0000-4000-8000-000000000000'
  );
  if coalesce((missing->>'send_allowed')::boolean, true)
     or missing->>'cadence_tier' <> 'weekly'
     or (missing->>'max_followups')::integer <> 3
     or missing->>'reason' <> 'queue_not_found' then
    raise exception 'Missing queue did not fail safe: %', missing;
  end if;
end;
$followup_cadence_contract_test$;

reset role;

do $followup_cadence_acl_test$
begin
  if has_function_privilege(
       'anon',
       'public.apply_followup_reply_decision(uuid,uuid,text,text,text,text,numeric,text,text,text,text)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.apply_followup_reply_decision(uuid,uuid,text,text,text,text,numeric,text,text,text,text)',
       'execute'
     )
     or not has_function_privilege(
       'service_role',
       'public.apply_followup_reply_decision(uuid,uuid,text,text,text,text,numeric,text,text,text,text)',
       'execute'
     ) then
    raise exception 'Reply decision RPC ACL is unsafe';
  end if;
end;
$followup_cadence_acl_test$;

set session_replication_role = replica;

insert into public.segment_taxonomy_versions (
  version, lifecycle_status, decision_unit, created_by
) values (
  'nt_taxonomy_v2_20260819_cx8',
  'approved',
  'requesting_or_contracting_entity',
  'followup-cadence-sql-test'
) on conflict (version) do nothing;

insert into public.segment_taxonomy_definitions (
  taxonomy_version, segment, label, default_s_kategorie, description,
  required_evidence_code, tie_breaker, priority, review_threshold, active
) values
  (
    'nt_taxonomy_v2_20260819_cx8', 'NT-8', 'Privatkunde', 'S1',
    'Disposable cadence fixture.', 'private_person', 'Fixture only.', 80, 0.8, true
  ),
  (
    'nt_taxonomy_v2_20260819_cx8', 'NT-10', 'Institution', 'S1',
    'Disposable cadence fixture.', 'institution', 'Fixture only.', 100, 0.8, true
  )
on conflict (taxonomy_version, segment) do nothing;

insert into public.master_requests (
  id, request_id, title, status, segment, segment_status, segment_source,
  segment_taxonomy_version, segment_organization_scale, attribution_raw
) values
  (
    '81000000-0000-4000-8000-000000000001',
    'FOLLOWUP-CADENCE-FREQUENT-SQL-TEST',
    'Private fixture', 'new', 'NT-8', 'accepted', 'manual_sql_test',
    'nt_taxonomy_v2_20260819_cx8', 'small', '{}'::jsonb
  ),
  (
    '81000000-0000-4000-8000-000000000002',
    'FOLLOWUP-CADENCE-WEEKLY-SQL-TEST',
    'Institution fixture', 'new', 'NT-10', 'accepted', 'manual_sql_test',
    'nt_taxonomy_v2_20260819_cx8', 'large', '{}'::jsonb
  );

set session_replication_role = origin;

insert into public.followup_queue (
  id, document_id, document_name, customer_name, customer_email, segment,
  followup_type, followup_number, scheduled_for, status, request_id,
  offer_public_url, enriched_context
) values
  (
    '82000000-0000-4000-8000-000000000001',
    'offer-frequent-sql-test', 'A/N TEST FREQUENT', 'Privat Test',
    'private-fixture@customer.invalid', 'NT-8', 'initial_reminder', 1,
    now() - interval '1 minute', 'processing',
    'FOLLOWUP-CADENCE-FREQUENT-SQL-TEST',
    'https://angebote.neontrip.de/offer/frequent-fixture',
    jsonb_build_object(
      'cadence_contract', 'offer_followup_cadence_v1_20260824',
      'first_sent_at', now() - interval '10 days'
    )
  ),
  (
    '82000000-0000-4000-8000-000000000002',
    'offer-weekly-sql-test', 'A/N TEST WEEKLY', 'Institution Test',
    'institution-fixture@customer.invalid', 'NT-10', 'initial_reminder', 1,
    now() - interval '1 minute', 'processing',
    'FOLLOWUP-CADENCE-WEEKLY-SQL-TEST',
    'https://angebote.neontrip.de/offer/weekly-fixture',
    jsonb_build_object(
      'cadence_contract', 'offer_followup_cadence_v1_20260824',
      'first_sent_at', now() - interval '10 days'
    )
  ),
  (
    '82000000-0000-4000-8000-000000000003',
    'offer-snooze-sql-test', 'A/N TEST SNOOZE', 'Snooze Test',
    'snooze-fixture@customer.invalid', 'NT-8', 'initial_reminder', 1,
    now() - interval '1 minute', 'processing',
    'FOLLOWUP-CADENCE-FREQUENT-SQL-TEST',
    'https://angebote.neontrip.de/offer/snooze-fixture',
    jsonb_build_object(
      'cadence_contract', 'offer_followup_cadence_v1_20260824',
      'first_sent_at', now() - interval '10 days'
    )
  ),
  (
    '82000000-0000-4000-8000-000000000004',
    'offer-decline-sql-test', 'A/N TEST DECLINE', 'Decline Test',
    'decline-fixture@customer.invalid', 'NT-8', 'initial_reminder', 1,
    now() - interval '1 minute', 'processing',
    'FOLLOWUP-CADENCE-FREQUENT-SQL-TEST',
    'https://angebote.neontrip.de/offer/decline-fixture',
    jsonb_build_object(
      'cadence_contract', 'offer_followup_cadence_v1_20260824',
      'first_sent_at', now() - interval '10 days'
    )
  );

insert into public.followup_delivery_attempts (
  id, followup_queue_id, status, claim_token, lease_until, last_execution_id
) values
  (
    '83000000-0000-4000-8000-000000000001',
    '82000000-0000-4000-8000-000000000001',
    'processing', '84000000-0000-4000-8000-000000000001',
    now() + interval '15 minutes', 'fixture-frequent-execution'
  ),
  (
    '83000000-0000-4000-8000-000000000002',
    '82000000-0000-4000-8000-000000000002',
    'processing', '84000000-0000-4000-8000-000000000002',
    now() + interval '15 minutes', 'fixture-weekly-execution'
  ),
  (
    '83000000-0000-4000-8000-000000000003',
    '82000000-0000-4000-8000-000000000003',
    'processing', '84000000-0000-4000-8000-000000000003',
    now() + interval '15 minutes', 'fixture-snooze-execution'
  ),
  (
    '83000000-0000-4000-8000-000000000004',
    '82000000-0000-4000-8000-000000000004',
    'processing', '84000000-0000-4000-8000-000000000004',
    now() + interval '15 minutes', 'fixture-decline-execution'
  );

do $followup_cadence_fixture_test$
declare
  frequent jsonb;
  weekly jsonb;
  result jsonb;
  expected_next timestamptz;
begin
  frequent := public.neontrip_get_followup_queue_cadence_decision(
    '82000000-0000-4000-8000-000000000001'
  );
  weekly := public.neontrip_get_followup_queue_cadence_decision(
    '82000000-0000-4000-8000-000000000002'
  );

  if frequent->>'cadence_tier' <> 'frequent'
     or frequent->>'weekend_allowed' <> 'true'
     or frequent->>'delay_day_mode' <> 'calendar_days'
     or (frequent->>'max_followups')::integer <> 6
     or (frequent->>'first_delay_business_days')::integer <> 2
     or (frequent->>'next_delay_business_days')::integer <> 3 then
    raise exception 'Frequent cadence fixture failed: %', frequent;
  end if;
  if weekly->>'cadence_tier' <> 'weekly'
     or weekly->>'weekend_allowed' <> 'false'
     or weekly->>'delay_day_mode' <> 'business_days'
     or (weekly->>'max_followups')::integer <> 3
     or (weekly->>'first_delay_business_days')::integer <> 5
     or (weekly->>'next_delay_business_days')::integer <> 5 then
    raise exception 'Weekly cadence fixture failed: %', weekly;
  end if;

  result := public.complete_followup_delivery(
    '82000000-0000-4000-8000-000000000001',
    '84000000-0000-4000-8000-000000000001',
    'provider-fixture-frequent',
    'fixture-frequent-execution',
    'Fixture subject',
    '<p>Fixture body</p>'
  );
  expected_next := public.neontrip_followup_calendar_slot(
    now(), 3, 'offer-frequent-sql-test:2'
  );
  if not coalesce((result->>'completed')::boolean, false)
     or (result->>'max_followups')::integer <> 6
     or not coalesce((result->>'next_followup_inserted')::boolean, false)
     or not exists (
       select 1 from public.followup_queue
       where document_id = 'offer-frequent-sql-test'
         and followup_number = 2
         and status = 'pending'
         and scheduled_for = expected_next
     ) then
    raise exception 'Frequent completion failed: %', result;
  end if;

  result := public.complete_followup_delivery(
    '82000000-0000-4000-8000-000000000002',
    '84000000-0000-4000-8000-000000000002',
    'provider-fixture-weekly',
    'fixture-weekly-execution',
    'Fixture subject',
    '<p>Fixture body</p>'
  );
  expected_next := public.neontrip_followup_business_slot(
    now(), 5, 'offer-weekly-sql-test:2'
  );
  if (result->>'max_followups')::integer <> 3
     or not exists (
       select 1 from public.followup_queue
       where document_id = 'offer-weekly-sql-test'
         and followup_number = 2
         and status = 'pending'
         and scheduled_for = expected_next
     ) then
    raise exception 'Weekly completion failed: %', result;
  end if;

  result := public.apply_followup_reply_decision(
    '82000000-0000-4000-8000-000000000003',
    '84000000-0000-4000-8000-000000000003',
    'offer-snooze-sql-test',
    'fixture-snooze-execution',
    'SNOOZE_7_DAYS',
    'needs_time',
    0.95,
    'Der Kunde braucht noch Zeit.',
    'Der Kunde braucht noch Zeit.',
    'fixture-snooze-message',
    'followup_reply_classifier_v1_20260824'
  );
  expected_next := public.neontrip_followup_business_slot(
    now(), 5, 'offer-snooze-sql-test:reply-snooze:fixture-snooze-execution'
  );
  if result->>'queue_status' <> 'pending'
     or not exists (
       select 1 from public.followup_queue
       where id = '82000000-0000-4000-8000-000000000003'
         and status = 'pending'
         and scheduled_for = expected_next
         and email_context_snapshot->>'reply_message_id' = 'fixture-snooze-message'
     )
     or not exists (
       select 1 from public.followup_delivery_attempts
       where followup_queue_id = '82000000-0000-4000-8000-000000000003'
         and status = 'blocked'
         and block_reason = 'customer_reply_snooze_7_days'
     ) then
    raise exception 'Reply snooze failed: %', result;
  end if;

  result := public.apply_followup_reply_decision(
    '82000000-0000-4000-8000-000000000004',
    '84000000-0000-4000-8000-000000000004',
    'offer-decline-sql-test',
    'fixture-decline-execution',
    'DECLINED',
    'explicit_decline',
    0.99,
    'Der Kunde hat abgesagt.',
    'Der Kunde hat abgesagt.',
    'fixture-decline-message',
    'followup_reply_classifier_v1_20260824'
  );
  if result->>'queue_status' <> 'cancelled'
     or not exists (
       select 1 from public.followup_queue
       where id = '82000000-0000-4000-8000-000000000004'
         and status = 'cancelled'
         and cancel_reason = 'customer_declined'
     ) then
    raise exception 'Reply decline failed: %', result;
  end if;
end;
$followup_cadence_fixture_test$;

rollback;
