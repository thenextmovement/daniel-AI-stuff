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

do $$
declare
  first_claim jsonb;
  active_replay jsonb;
  completed jsonb;
  completed_replay jsonb;
  final_replay jsonb;
begin
  first_claim := public.claim_customer_communication_draft(
    'design_reminder', 'message-1', 'design-reminder-v2', 'execution-1', 900
  );
  perform pg_temp.assert_true(
    first_claim->>'route' = 'draft'
      and (first_claim->>'claimed')::boolean
      and not (first_claim->>'automatic_send_allowed')::boolean
      and (first_claim->>'human_approval_required')::boolean,
    'first design reminder claim must authorize one human-reviewed draft only'
  );

  active_replay := public.claim_customer_communication_draft(
    'design_reminder', 'message-1', 'design-reminder-v2', 'execution-2', 900
  );
  perform pg_temp.assert_true(
    active_replay->>'route' = 'stop' and active_replay->>'reason' = 'active_lease',
    'active draft claim must suppress a parallel duplicate'
  );

  completed := public.complete_customer_communication_draft(
    'design_reminder',
    'message-1',
    (first_claim->>'claim_token')::uuid,
    'outlook-draft-1',
    'execution-1'
  );
  perform pg_temp.assert_true(
    (completed->>'completed')::boolean and completed->>'status' = 'draft_created',
    'confirmed Outlook draft must complete the canonical job'
  );

  completed_replay := public.complete_customer_communication_draft(
    'design_reminder',
    'message-1',
    (first_claim->>'claim_token')::uuid,
    'outlook-draft-1',
    'execution-1'
  );
  perform pg_temp.assert_true(
    completed_replay->>'reason' = 'already_completed',
    'completion replay from the same execution must be idempotent'
  );

  final_replay := public.claim_customer_communication_draft(
    'design_reminder', 'message-1', 'design-reminder-v2', 'execution-3', 900
  );
  perform pg_temp.assert_true(
    final_replay->>'route' = 'continue' and final_replay->>'reason' = 'draft_already_created',
    'completed source must skip without creating another draft'
  );
end;
$$;

do $$
declare
  first_claim jsonb;
  marked jsonb;
  replay jsonb;
begin
  first_claim := public.claim_customer_communication_draft(
    'winback', 'deal-1', 'winback-draft-v2', 'execution-4', 900
  );
  marked := public.mark_customer_communication_draft_unknown(
    'winback',
    'deal-1',
    (first_claim->>'claim_token')::uuid,
    'execution-4',
    'outlook_draft_failed'
  );
  perform pg_temp.assert_true(
    (marked->>'marked_unknown')::boolean
      and not (marked->>'automatic_retry_allowed')::boolean,
    'ambiguous Outlook draft result must fail closed'
  );

  replay := public.claim_customer_communication_draft(
    'winback', 'deal-1', 'winback-draft-v2', 'execution-5', 900
  );
  perform pg_temp.assert_true(
    replay->>'route' = 'stop' and replay->>'reason' = 'manual_review_required',
    'draft_unknown must never be retried automatically'
  );
end;
$$;

do $$
declare
  first_claim jsonb;
  replay jsonb;
begin
  first_claim := public.claim_customer_communication_draft(
    'winback', 'deal-stale', 'winback-draft-v2', 'execution-6', 60
  );
  update public.customer_communication_draft_jobs
    set lease_until = now() - interval '1 second'
  where id = (first_claim->>'job_id')::uuid;

  replay := public.claim_customer_communication_draft(
    'winback', 'deal-stale', 'winback-draft-v2', 'execution-7', 900
  );
  perform pg_temp.assert_true(
    replay->>'route' = 'stop'
      and replay->>'reason' = 'stale_lease_draft_unknown'
      and replay->>'status' = 'draft_unknown',
    'expired in-flight draft creation must become draft_unknown'
  );
end;
$$;

select pg_temp.assert_true(
  (
    select count(*) = 3
      and count(*) filter (where status = 'draft_created') = 1
      and count(*) filter (where status = 'draft_unknown') = 2
    from public.customer_communication_draft_jobs
  ),
  'draft ledger must keep exactly one row per source identity'
);

select pg_temp.assert_true(
  (
    select count(*) = 6
      and count(*) filter (where event_type = 'claimed') = 3
      and count(*) filter (where event_type = 'draft_created') = 1
      and count(*) filter (where event_type = 'draft_unknown') = 2
    from public.customer_communication_draft_events
  ),
  'append-only audit must record each draft transition exactly once'
);

do $$
begin
  set local role anon;
  begin
    perform public.claim_customer_communication_draft(
      'winback', 'forbidden', 'winback-draft-v2', 'forbidden-execution', 900
    );
    raise exception 'anon unexpectedly claimed a customer draft';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

select pg_temp.assert_true(
  has_function_privilege(
    'service_role',
    'public.claim_customer_communication_draft(text,text,text,text,integer)',
    'execute'
  ),
  'service role must be able to claim customer drafts'
);

do $$
declare
  claim jsonb;
  completed jsonb;
begin
  claim := public.claim_customer_communication_draft(
    'activecampaign_autoreply',
    'deal-claim-test',
    'ac-autoreply-human-review-draft-v2',
    'execution-ac-1',
    900
  );
  perform pg_temp.assert_true(
    claim->>'route' = 'draft'
      and not (claim->>'automatic_send_allowed')::boolean
      and (claim->>'human_approval_required')::boolean,
    'ActiveCampaign auto-reply must authorize one human-reviewed draft only'
  );

  completed := public.complete_customer_communication_draft(
    'activecampaign_autoreply',
    'deal-claim-test',
    (claim->>'claim_token')::uuid,
    'outlook-draft-ac-1',
    'execution-ac-1'
  );
  perform pg_temp.assert_true(
    (completed->>'completed')::boolean,
    'ActiveCampaign auto-reply draft completion must be receipted'
  );
end;
$$;

select 'customer communication draft database tests passed' as result;

do $$
declare
  post_claim jsonb;
  post_complete jsonb;
  repeat_claim jsonb;
  repeat_unknown jsonb;
begin
  post_claim := public.claim_customer_communication_draft(
    'post_delivery',
    'order-claim-test',
    'post-delivery-human-review-draft-v2',
    'execution-post-1',
    900
  );
  perform pg_temp.assert_true(
    post_claim->>'route' = 'draft'
      and not (post_claim->>'automatic_send_allowed')::boolean
      and (post_claim->>'human_approval_required')::boolean,
    'post-delivery must authorize one human-reviewed draft only'
  );

  post_complete := public.complete_customer_communication_draft(
    'post_delivery',
    'order-claim-test',
    (post_claim->>'claim_token')::uuid,
    'outlook-draft-post-1',
    'execution-post-1'
  );
  perform pg_temp.assert_true(
    (post_complete->>'completed')::boolean,
    'post-delivery draft completion must be receipted'
  );

  repeat_claim := public.claim_customer_communication_draft(
    'repeat_business',
    'customer-claim-test',
    'repeat-business-human-review-draft-v2',
    'execution-repeat-1',
    900
  );
  repeat_unknown := public.mark_customer_communication_draft_unknown(
    'repeat_business',
    'customer-claim-test',
    (repeat_claim->>'claim_token')::uuid,
    'execution-repeat-1',
    'outlook_draft_failed'
  );
  perform pg_temp.assert_true(
    (repeat_unknown->>'marked_unknown')::boolean
      and not (repeat_unknown->>'automatic_retry_allowed')::boolean,
    'repeat-business ambiguous draft outcome must fail closed'
  );
end;
$$;

select pg_temp.assert_true(
  (
    select count(*) = 2
    from public.customer_communication_draft_jobs
    where communication_kind in ('post_delivery', 'repeat_business')
  ),
  'both new outreach identities must be represented exactly once'
);

select 'post-delivery and repeat-business draft database tests passed' as result;
