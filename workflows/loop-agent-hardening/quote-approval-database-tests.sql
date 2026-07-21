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

select pg_temp.assert_true(
  (public.claim_quote_approval('card-1', 'First card', 'chat-1')->>'claimed')::boolean,
  'first quote approval claim must insert'
);

select pg_temp.assert_true(
  not (public.claim_quote_approval('card-1', 'Duplicate card', 'chat-1')->>'claimed')::boolean,
  'duplicate quote approval claim must be a successful no-op'
);

select pg_temp.assert_true(
  (
    select count(*) = 1
      and bool_and(card_name = 'First card')
      and bool_and(status = 'pending')
    from public.quote_approvals
    where card_id = 'card-1'
  ),
  'duplicate claim must preserve the canonical approval row'
);

select pg_temp.assert_true(
  (public.claim_quote_approval('card-2', 'Safety flags', 'chat-2')->>'automatic_customer_send_allowed')::boolean is false,
  'approval projection must never authorize customer communication'
);

select pg_temp.assert_true(
  (public.claim_quote_approval('card-2', 'Safety flags', 'chat-2')->>'human_approval_required')::boolean,
  'approval projection must require a human decision'
);

do $$
begin
  set local role anon;
  begin
    perform public.claim_quote_approval('forbidden-card', 'Forbidden', 'forbidden-chat');
    raise exception 'anon unexpectedly claimed quote approval';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

select pg_temp.assert_true(
  has_function_privilege(
    'service_role',
    'public.claim_quote_approval(text,text,text)',
    'execute'
  ),
  'service role must be able to claim quote approvals'
);

select 'quote approval claim database tests passed' as result;
