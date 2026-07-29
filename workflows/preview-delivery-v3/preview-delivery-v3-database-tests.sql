create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception 'assertion failed: %', message; end if;
end;
$$;

do $$
declare
  enqueued jsonb;
  enqueued_replay jsonb;
  first_claim jsonb;
  claim_replay jsonb;
  finish_result jsonb;
  video_claim jsonb;
  v_case_id uuid;
  task_id uuid;
  claim_token uuid;
  original_job_id uuid;
  failure_result jsonb;
  v_failure_id uuid;
  retry_result jsonb;
  action_run_id uuid := gen_random_uuid();
  projection_claim jsonb;
  projection_finish jsonb;
  receipt_result jsonb;
  capacity_result jsonb;
  side_effect_result jsonb;
  side_effect_id uuid;
  regeneration_case_id uuid;
  regeneration_task_id uuid;
  regeneration_claim_token uuid := gen_random_uuid();
  regeneration_result jsonb;
begin
  enqueued := public.enqueue_preview_delivery_case_v3(jsonb_build_object(
    'trello_card_id', '6a0000000000000000000001',
    'trello_card_url', 'https://trello.com/c/synthetic',
    'request_id', 'REQ-V3-1',
    'source_event_id', 'trello-action-1',
    'source_revision_hash', 'rev-1',
    'context', jsonb_build_object('card_name', 'Synthetic card')
  ));
  v_case_id := (enqueued->'case'->>'id')::uuid;
  perform pg_temp.assert_true(
    enqueued->>'ok' = 'true'
      and enqueued->'task'->>'task_type' = 'VALIDATE'
      and enqueued->'case'->>'status' = 'QUEUED',
    'intake creates one DB-owned case and validation task'
  );

  enqueued_replay := public.enqueue_preview_delivery_case_v3(jsonb_build_object(
    'trello_card_id', '6a0000000000000000000001',
    'request_id', 'REQ-V3-1',
    'source_event_id', 'trello-action-1',
    'context', jsonb_build_object('replayed', true)
  ));
  perform pg_temp.assert_true(
    enqueued_replay->'case'->>'id' = v_case_id::text
      and (
        select count(*) = 1
        from public.preview_delivery_tasks_v3 t
        where t.case_id = v_case_id
      ),
    'intake replay is idempotent'
  );

  first_claim := public.claim_preview_delivery_task_v3('VALIDATE', 'worker:validate:1', 'exec-validate-1', 120);
  task_id := (first_claim->'task'->>'id')::uuid;
  claim_token := (first_claim->>'claim_token')::uuid;
  perform pg_temp.assert_true(
    first_claim->>'ok' = 'true'
      and first_claim->'task'->>'task_type' = 'VALIDATE'
      and claim_token is not null,
    'validation task is token-bound'
  );

  claim_replay := public.claim_preview_delivery_task_v3('VALIDATE', 'worker:validate:1', 'exec-validate-1', 120);
  perform pg_temp.assert_true(
    claim_replay->>'idempotent' = 'true'
      and (claim_replay->>'claim_token')::uuid = claim_token,
    'ambiguous claim retry returns the same task and token'
  );

  finish_result := public.complete_preview_delivery_task_v3(
    task_id, claim_token, 'exec-validate-1', 'SUCCEEDED',
    jsonb_build_object('next_task_type', 'VIDEO_POLL')
  );
  perform pg_temp.assert_true(
    finish_result->>'ok' = 'false'
      and finish_result->>'error' = 'invalid_stage_transition',
    'invalid cross-stage transition fails closed'
  );

  finish_result := public.complete_preview_delivery_task_v3(
    task_id, claim_token, 'exec-validate-1', 'SUCCEEDED',
    jsonb_build_object(
      'next_task_type', 'VIDEO_SUBMIT',
      'context', jsonb_build_object('validated', true)
    )
  );
  perform pg_temp.assert_true(
    finish_result->>'ok' = 'true'
      and finish_result->'next_task'->>'task_type' = 'VIDEO_SUBMIT'
      and finish_result->'case'->>'status' = 'VIDEO_SUBMIT_PENDING',
    'valid stage transition creates exactly one next task'
  );

  finish_result := public.complete_preview_delivery_task_v3(
    task_id, claim_token, 'exec-validate-1', 'SUCCEEDED',
    jsonb_build_object('next_task_type', 'VIDEO_SUBMIT')
  );
  perform pg_temp.assert_true(
    finish_result->>'ok' = 'true' and finish_result->>'idempotent' = 'true',
    'finish replay is idempotent'
  );

  video_claim := public.claim_preview_delivery_task_v3('VIDEO_SUBMIT', 'worker:video:1', 'exec-video-1', 120);
  perform pg_temp.assert_true(
    video_claim->'task'->>'task_type' = 'VIDEO_SUBMIT',
    'next stage is independently claimable'
  );

  capacity_result := public.reserve_preview_provider_capacity_v3('xai-video', 10, 20, 1, 1);
  perform pg_temp.assert_true(
    capacity_result->>'ok' = 'true'
      and capacity_result->>'reserved' = 'true'
      and capacity_result->>'in_flight_used' = '1',
    'provider capacity is reserved atomically in Postgres'
  );
  capacity_result := public.reserve_preview_provider_capacity_v3('xai-video', 10, 20, 1, 1);
  perform pg_temp.assert_true(
    capacity_result->>'reserved' = 'false'
      and capacity_result->>'reason' = 'in_flight_limit',
    'provider in-flight cap rejects excess work without static workflow data'
  );
  capacity_result := public.release_preview_provider_capacity_v3('xai-video', 1);
  perform pg_temp.assert_true(
    capacity_result->>'released' = 'true'
      and capacity_result->>'in_flight_used' = '0',
    'terminal provider outcome releases in-flight capacity'
  );

  side_effect_result := public.begin_preview_delivery_side_effect_v3(
    v_case_id,
    (video_claim->'task'->>'id')::uuid,
    'VIDEO_PROVIDER_SUBMIT',
    'preview-video-submit:' || v_case_id::text || ':1',
    'request-fingerprint-1',
    jsonb_build_object('model', 'synthetic-video')
  );
  side_effect_id := (side_effect_result->'effect'->>'id')::uuid;
  perform pg_temp.assert_true(
    side_effect_result->>'action' = 'CALL_PROVIDER',
    'first side-effect intent permits exactly one provider call'
  );
  side_effect_result := public.begin_preview_delivery_side_effect_v3(
    v_case_id,
    (video_claim->'task'->>'id')::uuid,
    'VIDEO_PROVIDER_SUBMIT',
    'preview-video-submit:' || v_case_id::text || ':1',
    'request-fingerprint-1',
    jsonb_build_object('model', 'synthetic-video')
  );
  perform pg_temp.assert_true(
    side_effect_result->>'action' = 'RECONCILE',
    'ambiguous side-effect replay reconciles instead of calling provider twice'
  );
  side_effect_result := public.finish_preview_delivery_side_effect_v3(
    side_effect_id,
    'CONFIRMED',
    'provider-video-1',
    jsonb_build_object('status', 'done'),
    null
  );
  perform pg_temp.assert_true(
    side_effect_result->>'ok' = 'true'
      and side_effect_result->'effect'->>'status' = 'CONFIRMED',
    'provider receipt confirms a durable side effect'
  );
  side_effect_result := public.begin_preview_delivery_side_effect_v3(
    v_case_id,
    (video_claim->'task'->>'id')::uuid,
    'VIDEO_PROVIDER_SUBMIT',
    'preview-video-submit:' || v_case_id::text || ':1',
    'request-fingerprint-1',
    jsonb_build_object('model', 'synthetic-video')
  );
  perform pg_temp.assert_true(
    side_effect_result->>'action' = 'SKIP_CONFIRMED',
    'confirmed side-effect replay is skipped'
  );

  insert into public.preview_delivery_cases_v3 (
    case_key, trello_card_id, source_event_id, status, current_stage
  ) values (
    'preview-case:regeneration-test',
    '6a0000000000000000000003',
    'synthetic-regeneration-event',
    'VIDEO_QC_PENDING',
    'MEDIA_QC'
  ) returning id into regeneration_case_id;
  insert into public.preview_delivery_tasks_v3 (
    case_id, task_type, generation, status, attempts, max_attempts,
    worker_id, workflow_execution_id, claim_token, locked_at, lease_until,
    idempotency_key
  ) values (
    regeneration_case_id,
    'MEDIA_QC',
    1,
    'LEASED',
    1,
    3,
    'worker:qc:1',
    'exec-qc-1',
    regeneration_claim_token,
    now(),
    now() + interval '2 minutes',
    'preview-task:' || regeneration_case_id::text || ':MEDIA_QC:1'
  ) returning id into regeneration_task_id;
  regeneration_result := public.complete_preview_delivery_task_v3(
    regeneration_task_id,
    regeneration_claim_token,
    'exec-qc-1',
    'REGENERATE',
    jsonb_build_object(
      'next_task_type', 'VIDEO_SUBMIT',
      'max_video_generations', 3,
      'context', jsonb_build_object('qc_reason', 'synthetic failure')
    )
  );
  perform pg_temp.assert_true(
    regeneration_result->>'ok' = 'true'
      and regeneration_result->>'outcome' = 'REGENERATE'
      and regeneration_result->'next_task'->>'task_type' = 'VIDEO_SUBMIT'
      and regeneration_result->'next_task'->>'generation' = '2',
    'failed media QC creates one bounded next-generation video task'
  );

  insert into public.preview_delivery_jobs (
    trello_card_id, trello_card_url, request_id, card_name, source_list_id,
    status, max_attempts, idempotency_key, last_error_code, last_error_message,
    failed_at, metadata
  ) values (
    '6a0000000000000000000002',
    'https://trello.com/c/legacy',
    'REQ-LEGACY-1',
    'Legacy failed card',
    '6a18389f5e45294188451924',
    'failed',
    2,
    'legacy-failed-job-1',
    'customer_data_invalid',
    'Invalid customer data',
    now(),
    jsonb_build_object('offer_send_idempotency_key', 'offer-send-stable-1')
  ) returning id into original_job_id;

  failure_result := public.record_preview_delivery_failure_v3(jsonb_build_object(
    'legacy_job_id', original_job_id,
    'trello_card_id', '6a0000000000000000000002',
    'request_id', 'REQ-LEGACY-1',
    'category', 'DATA_BLOCKED',
    'stage', 'OFFER_HANDOFF',
    'error_code', 'customer_data_invalid',
    'user_message_de', 'Die Kundendaten sind ungültig.',
    'retry_policy', 'AFTER_CORRECTION',
    'safe_action_key', 'correct_customer_data',
    'customer_communication_state', 'NOT_STARTED',
    'workflow_id', 'S4gjf0YeZjP0pqFR',
    'workflow_execution_id', 'exec-legacy-1',
    'fingerprint', 'legacy-failure-fingerprint-1',
    'invalid_fields', jsonb_build_array(
      jsonb_build_object('label', 'E-Mail', 'value', 't', 'reason', 'keine gültige E-Mail-Adresse')
    )
  ));
  v_failure_id := (failure_result->'failure'->>'id')::uuid;
  perform pg_temp.assert_true(
    failure_result->>'ok' = 'true'
      and failure_result->'failure'->>'error_code' = 'customer_data_invalid'
      and (
        select count(*) = 1
        from public.preview_delivery_projection_outbox_v3 p
        where p.failure_id = v_failure_id
      )
      and exists (
        select 1
        from public.preview_delivery_projection_outbox_v3 p
        where p.failure_id = v_failure_id
          and p.payload->>'text' like '%Kundenmail NICHT gestartet%'
          and p.payload->>'text' like '%E-Mail%'
      ),
    'canonical failure creates one understandable durable Trello comment'
  );

  retry_result := public.request_preview_delivery_retry_v1(
    original_job_id, v_failure_id, action_run_id, 'operator@example.com',
    'Customer data corrected',
    jsonb_build_object(
      'source_changed_after_failure', false,
      'delivery_proof_found', false,
      'delivery_outcome_unknown', false
    )
  );
  perform pg_temp.assert_true(
    retry_result->>'ok' = 'false' and retry_result->>'error' = 'source_not_changed_after_failure',
    'data failure cannot be retried without a changed source'
  );

  retry_result := public.request_preview_delivery_retry_v1(
    original_job_id, v_failure_id, action_run_id, 'operator@example.com',
    'Customer data corrected',
    jsonb_build_object(
      'source_changed_after_failure', true,
      'delivery_proof_found', false,
      'delivery_outcome_unknown', false
    )
  );
  perform pg_temp.assert_true(
    retry_result->>'ok' = 'true'
      and retry_result->'recovery_job'->>'status' = 'pending'
      and retry_result->'recovery_job'->>'max_attempts' = '1'
      and retry_result->'recovery_job'->'metadata'->>'recovery_of_job_id' = original_job_id::text
      and retry_result->'recovery_job'->'metadata'->>'offer_send_idempotency_key' = 'offer-send-stable-1',
    'guarded retry creates one child job and preserves send idempotency'
  );

  retry_result := public.request_preview_delivery_retry_v1(
    original_job_id, v_failure_id, action_run_id, 'operator@example.com',
    'Customer data corrected',
    jsonb_build_object(
      'source_changed_after_failure', true,
      'delivery_proof_found', false,
      'delivery_outcome_unknown', false
    )
  );
  perform pg_temp.assert_true(
    retry_result->>'ok' = 'true'
      and (select count(*) = 1 from public.preview_delivery_jobs where metadata->>'recovery_action_run_id' = action_run_id::text),
    'double-click retry remains one recovery job'
  );

  projection_claim := public.claim_preview_delivery_projection_v3(
    'worker:projection:1', 'exec-projection-1', 120
  );
  perform pg_temp.assert_true(
    projection_claim->'projection'->>'operation' = 'COMMENT_UPSERT'
      and projection_claim->'projection'->'payload'->>'marker' like 'NT-EVENT:%',
    'projection worker receives marker-based comment'
  );

  projection_finish := public.finish_preview_delivery_projection_v3(
    (projection_claim->'projection'->>'id')::uuid,
    (projection_claim->>'claim_token')::uuid,
    'exec-projection-1',
    'SUCCEEDED',
    'trello-action-1',
    null
  );
  perform pg_temp.assert_true(
    projection_finish->>'ok' = 'true'
      and projection_finish->'projection'->>'external_action_id' = 'trello-action-1',
    'projection receipt is durable'
  );

  receipt_result := public.record_offer_delivery_receipt_v3(
    v_case_id, jsonb_build_object('receipt_id', 'receipt-1', 'status', 'prepared')
  );
  perform pg_temp.assert_true(
    receipt_result->>'ok' = 'false',
    'prepared handoff is not a delivery receipt'
  );

  receipt_result := public.record_offer_delivery_receipt_v3(
    v_case_id, jsonb_build_object('receipt_id', 'receipt-1', 'status', 'DELIVERED')
  );
  perform pg_temp.assert_true(
    receipt_result->>'ok' = 'true'
      and receipt_result->'case'->>'status' = 'DELIVERED'
      and receipt_result->'case'->>'customer_communication_state' = 'DELIVERED',
    'only a confirmed dispatcher receipt marks delivered'
  );

  receipt_result := public.record_offer_delivery_receipt_v3(
    v_case_id, jsonb_build_object('receipt_id', 'receipt-1', 'status', 'DELIVERED')
  );
  perform pg_temp.assert_true(
    receipt_result->>'ok' = 'true' and receipt_result->>'idempotent' = 'true',
    'delivery receipt replay is idempotent'
  );
end;
$$;

select pg_temp.assert_true(
  not has_table_privilege('anon', 'public.preview_delivery_cases_v3', 'SELECT')
    and not has_table_privilege('authenticated', 'public.preview_delivery_tasks_v3', 'UPDATE')
    and has_table_privilege('service_role', 'public.preview_delivery_cases_v3', 'SELECT,INSERT,UPDATE')
    and not has_function_privilege('anon', 'public.request_preview_delivery_retry_v1(uuid,uuid,uuid,text,text,jsonb)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.request_preview_delivery_retry_v1(uuid,uuid,uuid,text,text,jsonb)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.begin_preview_delivery_side_effect_v3(uuid,uuid,text,text,text,jsonb)', 'EXECUTE')
    and has_function_privilege('service_role', 'public.reserve_preview_provider_capacity_v3(text,integer,integer,integer,integer)', 'EXECUTE')
    and not (
      select prosecdef
      from pg_proc
      where oid = 'public.request_preview_delivery_retry_v1(uuid,uuid,uuid,text,text,jsonb)'::regprocedure
    ),
  'v3 tables and RPCs are service-role only and security invoker'
);

select pg_temp.assert_true(
  (select count(*) >= 1 from public.preview_delivery_events_v3 where event_type = 'STALE_FINISH_REJECTED') is false,
  'normal happy-path test did not produce stale finishes'
);

select 'preview delivery v3 database tests passed' as result;
