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
  duplicate_claim jsonb;
  completed jsonb;
begin
  first_claim := public.claim_supplier_quote_request_delivery(
    'card-1',
    ' Supplier.One@Example.com ',
    'execution-1',
    900
  );

  perform pg_temp.assert_true(
    first_claim->>'route' = 'send' and (first_claim->>'claimed')::boolean,
    'first recipient claim must authorize exactly one send'
  );
  perform pg_temp.assert_true(
    first_claim->>'recipient' = 'supplier.one@example.com',
    'recipient identity must be normalized'
  );
  perform pg_temp.assert_true(
    not (first_claim->>'automatic_retry_allowed')::boolean,
    'claim must never authorize automatic mail retry'
  );

  duplicate_claim := public.claim_supplier_quote_request_delivery(
    'card-1',
    'supplier.one@example.com',
    'execution-duplicate',
    900
  );
  perform pg_temp.assert_true(
    duplicate_claim->>'route' = 'stop' and duplicate_claim->>'reason' = 'active_lease',
    'an active claim must suppress a parallel or replayed send'
  );

  completed := public.complete_supplier_quote_request_delivery(
    'card-1',
    'supplier.one@example.com',
    (first_claim->>'claim_token')::uuid,
    'execution-1'
  );
  perform pg_temp.assert_true(
    (completed->>'completed')::boolean and completed->>'status' = 'sent',
    'successful Outlook confirmation must complete the canonical delivery row'
  );

  duplicate_claim := public.claim_supplier_quote_request_delivery(
    'card-1',
    'supplier.one@example.com',
    'execution-replay',
    900
  );
  perform pg_temp.assert_true(
    duplicate_claim->>'route' = 'continue' and duplicate_claim->>'reason' = 'already_sent',
    'a sent recipient must be skipped without stopping the remaining loop'
  );

  completed := public.complete_supplier_quote_request_delivery(
    'card-1',
    'supplier.one@example.com',
    (first_claim->>'claim_token')::uuid,
    'execution-1'
  );
  perform pg_temp.assert_true(
    completed->>'reason' = 'already_completed',
    'completion replay from the same execution must be idempotent'
  );
end;
$$;

do $$
declare
  first_claim jsonb;
  unknown_result jsonb;
  replay_claim jsonb;
begin
  first_claim := public.claim_supplier_quote_request_delivery(
    'card-2',
    'supplier.two@example.com',
    'execution-2',
    900
  );
  unknown_result := public.mark_supplier_quote_request_delivery_unknown(
    'card-2',
    'supplier.two@example.com',
    (first_claim->>'claim_token')::uuid,
    'execution-2',
    'outlook_send_failed'
  );

  perform pg_temp.assert_true(
    (unknown_result->>'marked_unknown')::boolean
      and (unknown_result->>'manual_review_required')::boolean
      and not (unknown_result->>'automatic_retry_allowed')::boolean,
    'ambiguous send failure must fail closed for manual review'
  );

  replay_claim := public.claim_supplier_quote_request_delivery(
    'card-2',
    'supplier.two@example.com',
    'execution-retry',
    900
  );
  perform pg_temp.assert_true(
    replay_claim->>'route' = 'stop' and replay_claim->>'reason' = 'manual_review_required',
    'delivery_unknown must never be retried automatically'
  );
end;
$$;

do $$
declare
  first_claim jsonb;
  stale_claim jsonb;
begin
  first_claim := public.claim_supplier_quote_request_delivery(
    'card-3',
    'supplier.three@example.com',
    'execution-3',
    60
  );

  update public.supplier_quote_request_deliveries
    set lease_until = now() - interval '1 second'
  where id = (first_claim->>'delivery_id')::uuid;

  stale_claim := public.claim_supplier_quote_request_delivery(
    'card-3',
    'supplier.three@example.com',
    'execution-stale-replay',
    900
  );

  perform pg_temp.assert_true(
    stale_claim->>'route' = 'stop'
      and stale_claim->>'reason' = 'stale_lease_delivery_unknown'
      and stale_claim->>'status' = 'delivery_unknown',
    'expired in-flight send must become delivery_unknown instead of being retried'
  );
end;
$$;

select pg_temp.assert_true(
  (
    select count(*) = 3
      and count(*) filter (where status = 'sent') = 1
      and count(*) filter (where status = 'delivery_unknown') = 2
    from public.supplier_quote_request_deliveries
  ),
  'canonical ledger must contain exactly one row per tested identity'
);

select pg_temp.assert_true(
  (
    select count(*) = 6
      and count(*) filter (where event_type = 'claimed') = 3
      and count(*) filter (where event_type = 'sent') = 1
      and count(*) filter (where event_type = 'delivery_unknown') = 2
    from public.supplier_quote_request_delivery_events
  ),
  'append-only audit must record every state transition exactly once'
);

do $$
begin
  begin
    perform public.claim_supplier_quote_request_delivery(
      'card-invalid',
      'not-an-email',
      'execution-invalid',
      900
    );
    raise exception 'invalid recipient unexpectedly passed validation';
  exception
    when others then
      if sqlerrm = 'invalid recipient unexpectedly passed validation' then
        raise;
      end if;
  end;
end;
$$;

do $$
begin
  set local role anon;
  begin
    perform public.claim_supplier_quote_request_delivery(
      'forbidden-card',
      'supplier@example.com',
      'forbidden-execution',
      900
    );
    raise exception 'anon unexpectedly claimed a supplier delivery';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

select pg_temp.assert_true(
  has_function_privilege(
    'service_role',
    'public.claim_supplier_quote_request_delivery(text,text,text,integer)',
    'execute'
  ),
  'service role must be able to claim supplier deliveries'
);

select 'supplier delivery database tests passed' as result;
