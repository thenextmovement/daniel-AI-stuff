do $test$
declare
  seed_result jsonb;
  seed_replay jsonb;
  evaluation_result jsonb;
  gate_result jsonb;
  stage_result jsonb;
  blocked boolean := false;
  selected_case_key text;
begin
  seed_result := public.seed_email_agent_gold_cases_v1(
    50,
    'sql_test_reviewer',
    'A deterministic test reference set is frozen for regression testing.',
    'email-decision-shadow-v1:gold-baseline-v1',
    '11111111-1111-4111-8111-111111111111'::uuid
  );

  if (seed_result->>'seeded_count')::integer <> 50 then
    raise exception 'expected 50 seeded cases: %', seed_result;
  end if;
  if (select count(*) from public.email_agent_gold_cases where active) <> 50 then
    raise exception 'active gold set does not contain 50 cases';
  end if;
  if (select count(*) from public.email_agent_gold_cases where reference_decision = 'draft') <> 5 then
    raise exception 'expected five observed human reply cases';
  end if;
  if (select count(*) from public.email_agent_gold_cases where reference_decision = 'human_review') <> 20 then
    raise exception 'expected twenty safety-policy cases';
  end if;
  if (select count(*) from public.email_agent_gold_cases where reference_decision = 'no_reply') <> 25 then
    raise exception 'expected twenty-five safe no-reply cases';
  end if;
  if exists (
    select 1 from public.email_agent_gold_cases
    where message_id like 'unsafe-internal-reference-%'
  ) then
    raise exception 'internal_or_duplicate was accepted as a safe no-reply reference';
  end if;

  seed_replay := public.seed_email_agent_gold_cases_v1(
    50,
    'sql_test_reviewer',
    'A deterministic test reference set is frozen for regression testing.',
    'email-decision-shadow-v1:gold-baseline-v1',
    '11111111-1111-4111-8111-111111111111'::uuid
  );
  if coalesce((seed_replay->>'idempotent_replay')::boolean, false) is not true then
    raise exception 'seed replay was not idempotent: %', seed_replay;
  end if;

  evaluation_result := public.run_email_agent_evaluation_v1(
    'email-decision-shadow-v1:gold-baseline-v1',
    'sql_test_reviewer',
    'Baseline routing evaluation after freezing the fifty reference cases.',
    '22222222-2222-4222-8222-222222222222'::uuid
  );
  if coalesce((evaluation_result->>'gate_passed')::boolean, false) is not true then
    raise exception 'decision gate should pass: %', evaluation_result;
  end if;
  if (evaluation_result->>'evaluated_count')::integer <> 50
    or (evaluation_result->>'unsafe_no_reply_count')::integer <> 0
    or (evaluation_result->>'routing_accuracy')::numeric <> 1 then
    raise exception 'unexpected decision metrics: %', evaluation_result;
  end if;
  if (evaluation_result->>'exact_accuracy')::numeric <> 0.9 then
    raise exception 'exact decision accuracy should be 0.9: %', evaluation_result;
  end if;

  gate_result := public.get_email_agent_rollout_gate_v1();
  if gate_result->>'effective_stage' <> 'review_only'
    or gate_result#>>'{draft_quality_gate,status}' <> 'observing'
    or (gate_result->>'automatic_send_allowed')::boolean is not false then
    raise exception 'safe observing state was not preserved: %', gate_result;
  end if;

  begin
    perform public.set_email_agent_rollout_stage_v1(
      'routing_gate',
      'sql_test_reviewer',
      'This should remain blocked until current-version feedback is sufficient.',
      '33333333-3333-4333-8333-333333333333'::uuid
    );
  exception when others then
    blocked := position('both decision and current-version draft quality gates pass' in sqlerrm) > 0;
  end;
  if blocked is not true then
    raise exception 'routing gate unexpectedly bypassed draft quality observation';
  end if;

  insert into public.email_agent_log (message_id, context_snapshot)
  select
    'current-case-' || value,
    jsonb_build_object('evidence_card', jsonb_build_object(
      'version', 'email-evidence-card-v2',
      'facts_package_version', 'email-facts-package-v1'
    ))
  from generate_series(1, 30) value;

  insert into public.email_agent_feedback (
    source_message_id, sent_message_id, sent_body_text, edit_ratio, edit_labels, is_valid
  )
  select
    'current-case-' || value,
    'current-sent-' || value,
    'Sicherer aktueller Testentwurf',
    0.100000,
    array['minor_formatting']::text[],
    true
  from generate_series(1, 30) value;

  stage_result := public.set_email_agent_rollout_stage_v1(
    'routing_gate',
    'sql_test_reviewer',
    'Both deterministic gates now pass in the isolated integration test.',
    '44444444-4444-4444-8444-444444444444'::uuid
  );
  if stage_result->>'effective_stage' <> 'routing_gate'
    or coalesce((stage_result#>>'{draft_quality_gate,passed}')::boolean, false) is not true
    or coalesce((stage_result->>'automatic_send_allowed')::boolean, true) is not false then
    raise exception 'routing gate did not activate safely: %', stage_result;
  end if;

  select case_key into selected_case_key
  from public.email_agent_gold_cases
  order by id
  limit 1;

  begin
    perform public.record_email_agent_gold_prediction_v1(
      selected_case_key,
      'email-decision-shadow-v1:gold-baseline-v1',
      'no_reply',
      0.5000,
      false,
      'valid_ai',
      'offline_replay',
      'different-classifier',
      null
    );
  exception when others then
    blocked := position('immutable' in sqlerrm) > 0;
  end;
  if blocked is not true then
    raise exception 'conflicting prediction was not rejected';
  end if;

  if has_function_privilege('anon', 'public.get_email_agent_rollout_gate_v1()', 'execute') then
    raise exception 'anon must not execute rollout gate';
  end if;
end;
$test$;

select
  (select count(*) from public.email_agent_gold_cases where active) as active_gold_cases,
  (select count(*) from public.email_agent_gold_predictions) as predictions,
  (select count(*) from public.email_agent_evaluation_runs where gate_passed) as passing_runs,
  public.get_email_agent_rollout_gate_v1() as rollout_gate;
