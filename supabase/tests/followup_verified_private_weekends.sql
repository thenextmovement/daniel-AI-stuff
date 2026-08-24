\set ON_ERROR_STOP on

-- Transactional checks for verified-private weekend follow-ups. The fixtures
-- are rolled back and the claim/send RPCs are never executed.

begin;

set role service_role;

do $private_weekend_helper_test$
declare
  private_cadence jsonb := '{"weekend_allowed":true}'::jsonb;
  weekday_cadence jsonb := '{"weekend_allowed":false}'::jsonb;
  calendar_slot timestamptz;
  business_slot timestamptz;
  claim_source text;
  completion_source text;
begin
  calendar_slot := public.neontrip_followup_calendar_slot(
    '2026-08-28 10:00:00+02'::timestamptz,
    2,
    'private-weekend-first'
  );
  business_slot := public.neontrip_followup_business_slot(
    '2026-08-28 10:00:00+02'::timestamptz,
    2,
    'small-weekday-first'
  );

  if (calendar_slot at time zone 'Europe/Berlin')::date <> date '2026-08-30'
     or (business_slot at time zone 'Europe/Berlin')::date <> date '2026-09-01' then
    raise exception 'Calendar/business weekend crossing is wrong: %, %',
      calendar_slot, business_slot;
  end if;

  if not public.neontrip_followup_delivery_window_allowed(
       private_cadence,
       '2026-08-29 10:00:00+02'::timestamptz
     )
     or not public.neontrip_followup_delivery_window_allowed(
       private_cadence,
       '2026-08-30 15:30:00+02'::timestamptz
     )
     or public.neontrip_followup_delivery_window_allowed(
       private_cadence,
       '2026-08-29 08:59:59+02'::timestamptz
     )
     or public.neontrip_followup_delivery_window_allowed(
       private_cadence,
       '2026-08-29 16:00:00+02'::timestamptz
     ) then
    raise exception 'Verified-private weekend delivery window is wrong';
  end if;

  if public.neontrip_followup_delivery_window_allowed(
       weekday_cadence,
       '2026-08-29 10:00:00+02'::timestamptz
     )
     or not public.neontrip_followup_delivery_window_allowed(
       weekday_cadence,
       '2026-08-31 10:00:00+02'::timestamptz
     ) then
    raise exception 'Weekday-only cadence leaked into the weekend';
  end if;

  claim_source := pg_get_functiondef(to_regprocedure(
    'public.claim_followup_delivery_candidate(text,integer)'
  ));
  completion_source := pg_get_functiondef(to_regprocedure(
    'public.complete_followup_delivery(uuid,uuid,text,text,text,text)'
  ));
  if position(
       'neontrip_followup_delivery_window_allowed(decision.value, now())'
       in claim_source
     ) = 0
     or position('neontrip_followup_calendar_slot' in completion_source) = 0 then
    raise exception 'Weekend helpers are not wired into claim/completion';
  end if;
end;
$private_weekend_helper_test$;

reset role;

do $private_weekend_acl_test$
begin
  if has_function_privilege(
       'anon',
       'public.neontrip_followup_calendar_slot(timestamptz,integer,text)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.neontrip_followup_calendar_slot(timestamptz,integer,text)',
       'execute'
     )
     or has_function_privilege(
       'anon',
       'public.neontrip_followup_delivery_window_allowed(jsonb,timestamptz)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'public.neontrip_followup_delivery_window_allowed(jsonb,timestamptz)',
       'execute'
     )
     or not has_function_privilege(
       'service_role',
       'public.neontrip_followup_calendar_slot(timestamptz,integer,text)',
       'execute'
     )
     or not has_function_privilege(
       'service_role',
       'public.neontrip_followup_delivery_window_allowed(jsonb,timestamptz)',
       'execute'
     ) then
    raise exception 'Private-weekend helper ACL is unsafe';
  end if;
end;
$private_weekend_acl_test$;

set session_replication_role = replica;

insert into public.segment_taxonomy_versions (
  version, lifecycle_status, decision_unit, created_by
) values (
  'nt_taxonomy_v2_20260819_cx8',
  'approved',
  'requesting_or_contracting_entity',
  'private-weekend-sql-test'
) on conflict (version) do nothing;

insert into public.segment_taxonomy_definitions (
  taxonomy_version, segment, label, default_s_kategorie, description,
  required_evidence_code, tie_breaker, priority, review_threshold, active
) values
  (
    'nt_taxonomy_v2_20260819_cx8', 'NT-8', 'Privatkunde', 'S1',
    'Disposable weekend fixture.', 'private_person', 'Fixture only.', 80, 0.8, true
  ),
  (
    'nt_taxonomy_v2_20260819_cx8', 'NT-9', 'Kleinunternehmen', 'S1',
    'Disposable weekday fixture.', 'small_business', 'Fixture only.', 70, 0.8, true
  ),
  (
    'nt_taxonomy_v2_20260819_cx8', 'NT-10', 'Institution', 'S1',
    'Disposable weekly fixture.', 'institution', 'Fixture only.', 100, 0.8, true
  )
on conflict (taxonomy_version, segment) do nothing;

insert into public.segment_quality_gate_versions (
  version, taxonomy_version, classifier_version, prompt_version, active,
  min_unique_gold_total, min_gold_per_segment,
  min_precision_per_predicted_class, min_recall_per_actual_class,
  min_accepted_coverage, critical_segments, min_critical_precision,
  required_mapping_integrity, max_provenance_violations,
  manual_activation_required, created_by
) values (
  'nt_quality_gate_v6_20260821_treatment_shadow',
  'nt_taxonomy_v2_20260819_cx8',
  'segment_classifier_v7_20260821_treatment_shadow',
  'segment_prompt_v7_20260821_treatment_shadow',
  true, 1, 1, 0.8, 0.8, 0.8, array['NT-8'], 0.8, 1.0, 0, true,
  'private-weekend-sql-test'
);

insert into public.segment_policy_versions (
  version, active, mode, created_by, taxonomy_version,
  classifier_version, prompt_version, quality_gate_version
) values (
  'nt_policy_v6_20260821_treatment_shadow', true, 'shadow',
  'private-weekend-sql-test', 'nt_taxonomy_v2_20260819_cx8',
  'segment_classifier_v7_20260821_treatment_shadow',
  'segment_prompt_v7_20260821_treatment_shadow',
  'nt_quality_gate_v6_20260821_treatment_shadow'
);

insert into public.master_requests (
  id, request_id, title, status, segment, segment_status, segment_source,
  segment_taxonomy_version, segment_organization_scale, attribution_raw
) values
  (
    '85000000-0000-4000-8000-000000000001',
    'FOLLOWUP-PRIVATE-WEEKEND-SQL-TEST',
    'Verified private fixture', 'new', 'NT-8', 'accepted',
    'manual_private_weekend_test', 'nt_taxonomy_v2_20260819_cx8', 'small',
    '{}'::jsonb
  ),
  (
    '85000000-0000-4000-8000-000000000002',
    'FOLLOWUP-SMALL-WEEKDAY-SQL-TEST',
    'Small business fixture', 'new', 'NT-9', 'accepted',
    'manual_private_weekend_test', 'nt_taxonomy_v2_20260819_cx8', 'small',
    '{}'::jsonb
  ),
  (
    '85000000-0000-4000-8000-000000000003',
    'FOLLOWUP-INSTITUTION-WEEKLY-SQL-TEST',
    'Institution fixture', 'new', 'NT-10', 'accepted',
    'manual_private_weekend_test', 'nt_taxonomy_v2_20260819_cx8', 'large',
    '{}'::jsonb
  ),
  (
    '85000000-0000-4000-8000-000000000004',
    'FOLLOWUP-AI-PRIVATE-WEEKEND-SQL-TEST',
    'AI verified private fixture', 'new', null, null, null,
    null, null, '{}'::jsonb
  );

insert into public.request_segment_classifications (
  id, request_id, input_hash, status, segment, s_kategorie, confidence,
  evidence_grade, reasoning_short, classifier_json, policy_json,
  prompt_version, classifier_version, policy_version, taxonomy_version,
  organization_scale, evidence_provenance_valid, mapping_integrity
) values (
  '87000000-0000-4000-8000-000000000001',
  '85000000-0000-4000-8000-000000000004',
  public.neontrip_compute_request_segment_input_hash(
    '85000000-0000-4000-8000-000000000004'
  ),
  'shadow', 'NT-8', 'S3', 0.95, 'strong', 'Verified private fixture.',
  jsonb_build_object(
    'validator_version', 'n8n_cx8_validator_v4',
    'treatment_contract', 'treatment_focus_v2_20260821_always_on',
    'effective_status', 'shadow',
    'effective_segment', null,
    'segment', 'NT-8',
    'db_validation', jsonb_build_object(
      'contract_match', true,
      'input_hash_current', true,
      'mapping_integrity', true,
      'context_tags_valid', true,
      'organization_scale_valid', true,
      'first_party_business_choice_valid', false
    )
  ),
  '{}'::jsonb,
  'segment_prompt_v7_20260821_treatment_shadow',
  'segment_classifier_v7_20260821_treatment_shadow',
  'nt_policy_v6_20260821_treatment_shadow',
  'nt_taxonomy_v2_20260819_cx8',
  'solo', true, true
);

set session_replication_role = origin;

insert into public.followup_queue (
  id, document_id, document_name, customer_name, customer_email, segment,
  followup_type, followup_number, scheduled_for, status, request_id,
  offer_public_url, enriched_context
) values
  (
    '86000000-0000-4000-8000-000000000001',
    'offer-private-weekend-sql-test', 'A/N TEST PRIVATE', 'Privat Test',
    'private-weekend-fixture@customer.invalid', 'NT-8', 'initial_reminder', 1,
    '2026-08-28 10:00:00+02'::timestamptz, 'pending',
    'FOLLOWUP-PRIVATE-WEEKEND-SQL-TEST',
    'https://angebote.neontrip.de/offer/private-weekend-fixture',
    jsonb_build_object(
      'cadence_contract', 'offer_followup_cadence_v1_20260824',
      'first_sent_at', '2026-08-28 10:00:00+02'
    )
  ),
  (
    '86000000-0000-4000-8000-000000000002',
    'offer-small-weekday-sql-test', 'A/N TEST SMALL', 'Kleinbetrieb Test',
    'small-weekday-fixture@customer.invalid', 'NT-9', 'initial_reminder', 1,
    '2026-08-28 10:00:00+02'::timestamptz, 'pending',
    'FOLLOWUP-SMALL-WEEKDAY-SQL-TEST',
    'https://angebote.neontrip.de/offer/small-weekday-fixture',
    jsonb_build_object(
      'cadence_contract', 'offer_followup_cadence_v1_20260824',
      'first_sent_at', '2026-08-28 10:00:00+02'
    )
  ),
  (
    '86000000-0000-4000-8000-000000000003',
    'offer-institution-weekly-sql-test', 'A/N TEST INSTITUTION',
    'Institution Test', 'institution-weekly-fixture@customer.invalid',
    'NT-10', 'initial_reminder', 1,
    '2026-08-28 10:00:00+02'::timestamptz, 'pending',
    'FOLLOWUP-INSTITUTION-WEEKLY-SQL-TEST',
    'https://angebote.neontrip.de/offer/institution-weekly-fixture',
    jsonb_build_object(
      'cadence_contract', 'offer_followup_cadence_v1_20260824',
      'first_sent_at', '2026-08-28 10:00:00+02'
    )
  ),
  (
    '86000000-0000-4000-8000-000000000004',
    'offer-ai-private-weekend-sql-test', 'A/N TEST AI PRIVATE',
    'AI Privat Test', 'ai-private-weekend-fixture@customer.invalid',
    'NT-8', 'initial_reminder', 1,
    '2026-08-28 10:00:00+02'::timestamptz, 'pending',
    'FOLLOWUP-AI-PRIVATE-WEEKEND-SQL-TEST',
    'https://angebote.neontrip.de/offer/ai-private-weekend-fixture',
    jsonb_build_object(
      'cadence_contract', 'offer_followup_cadence_v1_20260824',
      'first_sent_at', '2026-08-28 10:00:00+02'
    )
  );

set role service_role;

do $private_weekend_cadence_test$
declare
  private_decision jsonb;
  small_decision jsonb;
  weekly_decision jsonb;
  ai_private_decision jsonb;
  missing_decision jsonb;
begin
  private_decision := public.neontrip_get_followup_queue_cadence_decision(
    '86000000-0000-4000-8000-000000000001'
  );
  small_decision := public.neontrip_get_followup_queue_cadence_decision(
    '86000000-0000-4000-8000-000000000002'
  );
  weekly_decision := public.neontrip_get_followup_queue_cadence_decision(
    '86000000-0000-4000-8000-000000000003'
  );
  ai_private_decision := public.neontrip_get_followup_queue_cadence_decision(
    '86000000-0000-4000-8000-000000000004'
  );
  missing_decision := public.neontrip_get_followup_queue_cadence_decision(
    '86000000-0000-4000-8000-000000000099'
  );

  if private_decision->>'cadence_tier' <> 'frequent'
     or private_decision->>'weekend_allowed' <> 'true'
     or private_decision->>'delay_day_mode' <> 'calendar_days'
     or (private_decision->>'max_followups')::integer <> 6
     or (private_decision->>'first_delay_days')::integer <> 2
     or (private_decision->>'next_delay_days')::integer <> 3
     or ((private_decision->>'first_due_at')::timestamptz
           at time zone 'Europe/Berlin')::date <> date '2026-08-30' then
    raise exception 'Verified private cadence is wrong: %', private_decision;
  end if;

  if small_decision->>'cadence_tier' <> 'frequent'
     or small_decision->>'weekend_allowed' <> 'false'
     or small_decision->>'delay_day_mode' <> 'business_days'
     or (small_decision->>'max_followups')::integer <> 6
     or ((small_decision->>'first_due_at')::timestamptz
           at time zone 'Europe/Berlin')::date <> date '2026-09-01' then
    raise exception 'Small-business weekday cadence is wrong: %', small_decision;
  end if;

  if weekly_decision->>'cadence_tier' <> 'weekly'
     or weekly_decision->>'weekend_allowed' <> 'false'
     or weekly_decision->>'delay_day_mode' <> 'business_days'
     or (weekly_decision->>'max_followups')::integer <> 3
     or ((weekly_decision->>'first_due_at')::timestamptz
           at time zone 'Europe/Berlin')::date <> date '2026-09-04' then
    raise exception 'Institutional weekly cadence is wrong: %', weekly_decision;
  end if;

  if ai_private_decision->>'source_authority' <> 'ai_shadow'
     or ai_private_decision->>'segment' <> 'NT-8'
     or ai_private_decision->>'weekend_allowed' <> 'true'
     or ai_private_decision->>'delay_day_mode' <> 'calendar_days'
     or (ai_private_decision->>'max_followups')::integer <> 6 then
    raise exception 'Verified AI private cadence is wrong: %',
      ai_private_decision;
  end if;

  if missing_decision->>'weekend_allowed' <> 'false'
     or missing_decision->>'delay_day_mode' <> 'business_days'
     or coalesce((missing_decision->>'send_allowed')::boolean, true) then
    raise exception 'Missing/unclear cadence did not fail closed: %', missing_decision;
  end if;
end;
$private_weekend_cadence_test$;

rollback;
