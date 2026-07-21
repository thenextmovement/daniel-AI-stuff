create or replace function public.claim_quote_approval(
  p_card_id text,
  p_card_name text,
  p_chat_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  safe_card_id text := nullif(btrim(p_card_id), '');
  safe_card_name text := left(nullif(btrim(p_card_name), ''), 500);
  safe_chat_id text := nullif(btrim(p_chat_id), '');
  approval public.quote_approvals%rowtype;
  inserted boolean := false;
begin
  if safe_card_id is null or safe_chat_id is null then
    raise exception 'card_id and chat_id are required';
  end if;
  if length(safe_card_id) > 200 or length(safe_chat_id) > 200 then
    raise exception 'Quote approval identity exceeds safe length';
  end if;

  insert into public.quote_approvals (
    card_id,
    card_name,
    chat_id,
    status
  ) values (
    safe_card_id,
    safe_card_name,
    safe_chat_id,
    'pending'
  )
  on conflict (card_id) do nothing
  returning * into approval;

  inserted := found;

  if not inserted then
    select existing.*
      into approval
    from public.quote_approvals as existing
    where existing.card_id = safe_card_id;
  end if;

  return jsonb_build_object(
    'claimed', inserted,
    'reason', case when inserted then 'new' else 'already_known' end,
    'card_id', safe_card_id,
    'card_name', coalesce(approval.card_name, safe_card_name),
    'chat_id', coalesce(approval.chat_id, safe_chat_id),
    'status', approval.status,
    'message_id', approval.message_id,
    'automatic_customer_send_allowed', false,
    'human_approval_required', true
  );
end;
$$;

revoke all on function public.claim_quote_approval(text, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_quote_approval(text, text, text)
  to service_role;

comment on function public.claim_quote_approval(text, text, text) is
  'Atomically claims one Trello card for internal Telegram approval projection; duplicate cards return already_known instead of HTTP 409.';
