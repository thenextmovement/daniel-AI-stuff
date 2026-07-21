create or replace function pg_temp.assert_true(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then raise exception 'assertion failed: %', message; end if;
end;
$$;

insert into public.preview_delivery_jobs (
  trello_card_id, request_id, card_name, source_list_id, priority,
  max_attempts, idempotency_key
) values
  ('6a0000000000000000000001', 'REQ-TOKEN-1', 'Token one', '6a18389f5e45294188451924', 200, 3, 'token-test-1'),
  ('6a0000000000000000000002', 'REQ-TOKEN-2', 'Token two', '6a18389f5e45294188451924', 100, 3, 'token-test-2');

do $$
declare
  first_claim jsonb;
  claim_replay jsonb;
  second_claim jsonb;
  result jsonb;
  first_token uuid;
  second_token uuid;
  new_second_token uuid;
begin
  first_claim := public.claim_next_preview_delivery_job_v2('worker:exec-1', 'exec-1', 900, 3);
  first_token := (first_claim->>'claim_token')::uuid;
  perform pg_temp.assert_true(
    first_claim->>'ok' = 'true'
      and first_claim->'job'->>'trello_card_id' = '6a0000000000000000000001'
      and first_token is not null
      and first_claim->>'automatic_retry_allowed' = 'false',
    'first claim must carry a token and choose highest priority'
  );

  claim_replay := public.claim_next_preview_delivery_job_v2('worker:exec-1', 'exec-1', 900, 3);
  perform pg_temp.assert_true(
    claim_replay->>'reason' = 'existing_execution_claim'
      and (claim_replay->>'claim_token')::uuid = first_token
      and claim_replay->'job'->>'id' = first_claim->'job'->>'id',
    'ambiguous HTTP claim replay must return the original lease'
  );

  second_claim := public.claim_next_preview_delivery_job_v2('worker:exec-2', 'exec-2', 900, 3);
  second_token := (second_claim->>'claim_token')::uuid;
  perform pg_temp.assert_true(
    second_claim->'job'->>'trello_card_id' = '6a0000000000000000000002'
      and second_token is not null
      and second_token <> first_token,
    'parallel execution must claim a different row and token'
  );

  result := public.finish_preview_delivery_job_v2(
    (first_claim->'job'->>'id')::uuid, first_token, 'sent', null, null,
    'exec-1', '{}'::jsonb
  );
  perform pg_temp.assert_true(
    result->>'ok' = 'false' and result->>'error' = 'delivery_receipt_required',
    'sent requires a deterministic offer-delivery receipt'
  );

  result := public.finish_preview_delivery_job_v2(
    (first_claim->'job'->>'id')::uuid, first_token, 'sent', null, null,
    'exec-1', '{"offer_delivery_handoff_accepted":true}'::jsonb
  );
  perform pg_temp.assert_true(
    result->>'ok' = 'true'
      and result->>'effective_status' = 'sent'
      and result->'job'->>'claim_token' is null,
    'receipt-backed finish must consume the token and mark sent'
  );

  result := public.finish_preview_delivery_job_v2(
    (first_claim->'job'->>'id')::uuid, first_token, 'sent', null, null,
    'exec-1', '{"offer_delivery_handoff_accepted":true}'::jsonb
  );
  perform pg_temp.assert_true(
    result->>'ok' = 'true' and result->>'reason' = 'already_finished',
    'finish replay must be idempotent for the same token and execution'
  );

  result := public.finish_preview_delivery_job_v2(
    (second_claim->'job'->>'id')::uuid, gen_random_uuid(), 'failed',
    'synthetic', 'wrong token', 'stale-exec', '{}'::jsonb
  );
  perform pg_temp.assert_true(
    result->>'ok' = 'false' and result->>'error' = 'stale_or_missing_claim',
    'wrong claim token must fail closed'
  );

  result := public.finish_preview_delivery_job_v2(
    (second_claim->'job'->>'id')::uuid, second_token, 'retry',
    'synthetic_retry', 'retry test', 'exec-2', '{}'::jsonb
  );
  perform pg_temp.assert_true(
    result->>'ok' = 'true' and result->>'effective_status' = 'retry',
    'current token may schedule a bounded retry'
  );

  update public.preview_delivery_jobs
    set next_attempt_at = now() - interval '1 second'
  where id = (second_claim->'job'->>'id')::uuid;

  second_claim := public.claim_next_preview_delivery_job_v2('worker:exec-3', 'exec-3', 900, 3);
  new_second_token := (second_claim->>'claim_token')::uuid;
  perform pg_temp.assert_true(
    new_second_token is not null and new_second_token <> second_token,
    'a retry lease must receive a new token'
  );

  result := public.finish_preview_delivery_job_v2(
    (second_claim->'job'->>'id')::uuid, second_token, 'failed',
    'late_old_attempt', 'old execution returned late', 'exec-2', '{}'::jsonb
  );
  perform pg_temp.assert_true(
    result->>'ok' = 'false' and result->>'error' = 'stale_or_missing_claim',
    'old execution cannot finish a newly leased retry'
  );

  result := public.finish_preview_delivery_job_v2(
    (second_claim->'job'->>'id')::uuid, new_second_token, 'failed',
    'synthetic_final', 'final test', 'exec-3', '{}'::jsonb
  );
  perform pg_temp.assert_true(
    result->>'ok' = 'true' and result->>'effective_status' = 'failed',
    'current retry token may finish the job'
  );
end;
$$;

select pg_temp.assert_true(
  (select count(*) = 3 from public.preview_delivery_job_events where event_type = 'claimed')
    and (select count(*) = 1 from public.preview_delivery_job_events where event_type = 'sent')
    and (select count(*) = 1 from public.preview_delivery_job_events where event_type = 'retry')
    and (select count(*) = 1 from public.preview_delivery_job_events where event_type = 'failed')
    and (select count(*) = 2 from public.preview_delivery_job_events where event_type = 'stale_finish_rejected')
    and (select count(*) = 1 from public.preview_delivery_job_events where event_type = 'delivery_receipt_rejected'),
  'claim, finish and rejected transition events must be append-only and exact'
);

select pg_temp.assert_true(
  not has_function_privilege('anon','public.claim_next_preview_delivery_job_v2(text,text,integer,integer)','EXECUTE')
    and not has_function_privilege('authenticated','public.claim_next_preview_delivery_job_v2(text,text,integer,integer)','EXECUTE')
    and has_function_privilege('service_role','public.claim_next_preview_delivery_job_v2(text,text,integer,integer)','EXECUTE')
    and not has_table_privilege('anon','public.preview_delivery_jobs','SELECT')
    and not has_table_privilege('authenticated','public.preview_delivery_jobs','UPDATE')
    and has_table_privilege('service_role','public.preview_delivery_jobs','SELECT,INSERT,UPDATE')
    and not (select prosecdef from pg_proc where oid='public.claim_next_preview_delivery_job_v2(text,text,integer,integer)'::regprocedure),
  'v2 functions are security invoker and internal tables are service-role only'
);

select 'preview delivery claim-token database tests passed' as result;

