-- Execute after the X migration in a disposable PostgreSQL database only.
begin;
do $$
declare h text := repeat('a',64); j jsonb; payload jsonb; retry_payload jsonb; payment jsonb;
begin
  perform public.x_ads_capture(h,'test_click',now()-interval '2 hours',now()-interval '2 hours',false);
  perform public.x_ads_capture(h,'must_not_overwrite',now()-interval '1 hour',now()-interval '1 hour',false);
  if (select twclid from public.x_ads_purchases where checkout_hash=h) <> 'test_click' then raise exception 'attribution overwritten'; end if;
  if public.x_ads_claim() is not null then raise exception 'unassociated checkout claimed'; end if;
  perform public.x_ads_associate(jsonb_build_array(jsonb_build_object('hash',h,'id','1234567890123')));
  j:=public.x_ads_claim();
  if j is null or public.x_ads_claim() is not null then raise exception 'claim lease failed'; end if;
  payment:=jsonb_build_object('order_id','1234567890123','checkout_hash',h,'amount_cents',12345,'currency','EUR','paid_at',now()-interval '1 hour');
  if public.x_ads_prepare(h,(j->>'lease_id')::uuid,payment||'{"checkout_hash":"wrong"}') is not null then raise exception 'wrong checkout accepted'; end if;
  payload:=public.x_ads_prepare(h,(j->>'lease_id')::uuid,payment);
  if payload#>>'{conversions,0,value}' <> '123.45' or payload#>>'{conversions,0,event_id}' <> 'rhd5x' then raise exception 'payload wrong'; end if;
  perform public.x_ads_finish(h,(j->>'lease_id')::uuid,null,'x_unconfirmed');
  update public.x_ads_purchases set next_attempt_at=now()-interval '1 second' where checkout_hash=h;
  j:=public.x_ads_claim();retry_payload:=public.x_ads_prepare(h,(j->>'lease_id')::uuid,payment);
  if retry_payload is distinct from payload then raise exception 'retry changed event'; end if;
  perform public.x_ads_finish(h,(j->>'lease_id')::uuid,'receipt_test_1234',null);
  if (select status<>'delivered' or twclid is not null or debug_id is null from public.x_ads_purchases where checkout_hash=h) then raise exception 'receipt not committed'; end if;
  if public.x_ads_claim() is not null then raise exception 'delivered event replayed'; end if;
  -- Withdrawal wins even when a grant arrives late or a job is already claimed.
  h:=repeat('b',64);
  perform public.x_ads_capture(h,'test_click',now()-interval '2 hours',now()-interval '2 hours',false);
  perform public.x_ads_associate(jsonb_build_array(jsonb_build_object('hash',h,'id','1234567890124')));
  j:=public.x_ads_claim();
  perform public.x_ads_capture(h,null,null,null,true);
  perform public.x_ads_capture(h,'late_grant',now()-interval '2 hours',now()-interval '2 hours',false);
  if public.x_ads_prepare(h,(j->>'lease_id')::uuid,payment) is not null then raise exception 'revoked claim sent'; end if;
  if (select twclid is not null or status<>'revoked' from public.x_ads_purchases where checkout_hash=h) then raise exception 'revocation resurrected'; end if;
  -- A permanent X rejection must not retry, and changed payment facts cannot
  -- overwrite an uncertain already-sent event.
  h:=repeat('c',64);
  perform public.x_ads_capture(h,'test_click',now()-interval '2 hours',now()-interval '2 hours',false);
  perform public.x_ads_associate(jsonb_build_array(jsonb_build_object('hash',h,'id','1234567890125')));
  j:=public.x_ads_claim();
  payment:=payment||jsonb_build_object('order_id','1234567890125','checkout_hash',h);
  payload:=public.x_ads_prepare(h,(j->>'lease_id')::uuid,payment);
  if payload is null then raise exception 'valid payment not prepared'; end if;
  perform public.x_ads_finish(h,(j->>'lease_id')::uuid,null,'x_rejected');
  if (select status<>'blocked' or twclid is not null from public.x_ads_purchases where checkout_hash=h) then raise exception 'permanent rejection retried'; end if;
  h:=repeat('d',64);
  perform public.x_ads_capture(h,'test_click',now()-interval '2 hours',now()-interval '2 hours',false);
  perform public.x_ads_associate(jsonb_build_array(jsonb_build_object('hash',h,'id','1234567890126')));
  j:=public.x_ads_claim();
  payment:=payment||jsonb_build_object('order_id','1234567890126','checkout_hash',h);
  payload:=public.x_ads_prepare(h,(j->>'lease_id')::uuid,payment);
  update public.x_ads_purchases set lease_until=now()-interval '1 second' where checkout_hash=h;
  j:=public.x_ads_claim();
  if j is null then raise exception 'abandoned lease not recovered'; end if;
  if public.x_ads_prepare(h,(j->>'lease_id')::uuid,payment||'{"amount_cents":999}') is not null then raise exception 'changed payment replayed'; end if;
  if (select status<>'blocked' from public.x_ads_purchases where checkout_hash=h) then raise exception 'changed payment not blocked'; end if;
  if has_table_privilege('anon','public.x_ads_purchases','SELECT') or has_function_privilege('authenticated','public.x_ads_claim()','EXECUTE') then raise exception 'public ledger access'; end if;
end $$;
rollback;
