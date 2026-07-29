begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

update public.company_source_registry
set display_name = 'PandaDoc',
    active = true,
    expected_freshness = interval '15 minutes',
    description = 'External quote document state and signatures.',
    metadata = coalesce(metadata, '{}'::jsonb) - 'retired_at' - 'replacement_source',
    updated_at = now()
where source_key = 'pandadoc';

drop function if exists public.check_offer_send_guards(text, uuid);
drop function if exists public.get_deal_id_by_offer(uuid);
drop function if exists public.get_vip_offers(numeric, integer);
drop view if exists public.v_offer_history;

create or replace view public.v_quotes_by_email as
select
  mc.email,
  mq.pandadoc_id as document_id,
  mc.name as customer_name,
  mq.pandadoc_status as status,
  mq.total_value,
  mq.share_link,
  mq.created_at,
  mq.sent_at,
  mq.viewed_at,
  mq.signed_at
from public.master_quotes mq
join public.master_customers mc on mc.id = mq.customer_id;

revoke all on table public.v_quotes_by_email
  from public, anon, authenticated;
grant select on table public.v_quotes_by_email
  to service_role;

create or replace function public.check_quote_send_guards(
  p_unique_id text,
  p_email text default null,
  p_document_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_blocked boolean := false;
  v_reason text := null;
  v_checks jsonb := '{}'::jsonb;
  v_count integer;
begin
  select count(*) into v_count
  from public.quote_email_log
  where unique_id = p_unique_id and status = 'sent';
  v_checks := v_checks || jsonb_build_object('quote_email_log', v_count > 0);
  if v_count > 0 and not v_blocked then
    v_blocked := true;
    v_reason := 'quote_email_already_sent';
  end if;

  select count(*) into v_count
  from public.master_quotes
  where request_id = p_unique_id and email_sent is not null;
  v_checks := v_checks || jsonb_build_object('master_quotes_sent', v_count > 0);
  if v_count > 0 and not v_blocked then
    v_blocked := true;
    v_reason := 'master_quotes_email_sent';
  end if;

  if p_document_id is not null then
    select count(*) into v_count
    from public.document_journey
    where pandadoc_id = p_document_id
      and current_status = 'document.completed';
    v_checks := v_checks || jsonb_build_object('document_completed', v_count > 0);
    if v_count > 0 and not v_blocked then
      v_blocked := true;
      v_reason := 'document_already_completed';
    end if;
  end if;

  if p_unique_id is not null then
    select count(*) into v_count
    from public.master_requests
    where request_id = p_unique_id
      and status in ('won', 'completed', 'paid');
    v_checks := v_checks || jsonb_build_object('request_won', v_count > 0);
    if v_count > 0 and not v_blocked then
      v_blocked := true;
      v_reason := 'request_already_won';
    end if;
  end if;

  return jsonb_build_object(
    'allow_send', not v_blocked,
    'block_reason', v_reason,
    'checks', v_checks,
    'checked_at', now()
  );
end;
$$;

create or replace function public.get_deal_id_by_pandadoc(doc_id text)
returns integer
language sql
stable
set search_path = public
as $$
  select mr.ac_deal_id
  from public.master_quotes mq
  join public.master_requests mr on mq.request_id = mr.request_id
  where mq.pandadoc_id = doc_id
  limit 1;
$$;

create or replace function public.get_vip_quotes(min_value numeric, days_back integer)
returns table(
  id uuid,
  total_value numeric,
  pandadoc_status text,
  share_link text,
  sent_at timestamptz,
  viewed_at timestamptz,
  customer_first_name text,
  customer_last_name text,
  customer_company_name text,
  customer_ac_contact_id text,
  customer_email text,
  customer_phone text
)
language sql
stable
set search_path = public
as $$
  select
    q.id,
    q.total_value,
    q.pandadoc_status,
    q.share_link,
    q.sent_at,
    q.viewed_at,
    c.first_name,
    c.last_name,
    c.company_name,
    c.ac_contact_id,
    c.email,
    c.phone
  from public.master_quotes q
  left join public.master_customers c on q.customer_id = c.id
  left join public.master_requests r on q.request_id = r.request_id
  where q.signed_at is null
    and q.total_value >= min_value
    and q.sent_at >= now() - make_interval(days => greatest(days_back, 0))
    and q.pandadoc_status not in (
      'completed',
      'declined',
      'document.deleted',
      'document.completed',
      'document.declined'
    )
    and coalesce(r.deal_status, 'open') != 'lost'
  order by q.total_value desc;
$$;

create or replace function public.get_pending_fus_with_cards(p_limit integer default 100)
returns table(
  fu_id uuid,
  request_id text,
  customer_name text,
  trello_card_id text
)
language sql
security definer
set search_path = public
as $$
  select fq.id, fq.request_id, fq.customer_name, mr.trello_card_id
  from public.followup_queue fq
  join public.master_requests mr on mr.request_id = fq.request_id
  where fq.status = 'pending'
    and fq.followup_type not like 'payment_reminder%'
    and fq.cancelled_at is null
    and mr.trello_card_id is not null
    and (mr.status is null or mr.status not in ('won', 'completed', 'paid', 'lost', 'cancelled'))
    and not exists (
      select 1
      from public.document_journey dj
      where dj.pandadoc_id = fq.document_id
        and dj.current_status in ('document.completed', 'document.paid', 'completed')
    )
  order by fq.scheduled_for asc
  limit p_limit;
$$;

create or replace function public.get_pending_fus_with_cards()
returns table(
  fu_id uuid,
  request_id text,
  customer_name text,
  trello_card_id text
)
language sql
security definer
set search_path = public
as $$
  select fq.id, fq.request_id, fq.customer_name, mr.trello_card_id
  from public.followup_queue fq
  join public.master_requests mr on mr.request_id = fq.request_id
  where fq.status = 'pending'
    and fq.followup_type not like 'payment_reminder%'
    and mr.trello_card_id is not null
  order by fq.scheduled_for asc;
$$;

create or replace function public.complete_followup_delivery(
  p_followup_queue_id uuid,
  p_claim_token uuid,
  p_provider_message_id text,
  p_workflow_execution_id text,
  p_email_subject text,
  p_email_body text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  safe_execution_id text := left(nullif(btrim(p_workflow_execution_id), ''), 200);
  safe_message_id text := left(nullif(btrim(p_provider_message_id), ''), 2000);
  safe_subject text := left(nullif(btrim(p_email_subject), ''), 250);
  safe_body text := left(nullif(p_email_body, ''), 10000);
  attempt public.followup_delivery_attempts%rowtype;
  source_row public.followup_queue%rowtype;
  next_number integer;
  max_followups integer;
  next_inserted boolean := false;
begin
  if p_followup_queue_id is null or p_claim_token is null
     or safe_message_id is null or safe_execution_id is null
     or safe_subject is null or safe_body is null then
    raise exception 'queue id, claim token, provider message id, execution id, subject and body are required';
  end if;

  update public.followup_delivery_attempts
    set status = 'sent',
        claim_token = null,
        lease_until = null,
        provider_message_id = safe_message_id,
        sent_at = now(),
        last_execution_id = safe_execution_id,
        last_error_code = null,
        updated_at = now()
  where followup_queue_id = p_followup_queue_id
    and status = 'processing'
    and claim_token = p_claim_token
  returning * into attempt;

  if not found then
    select existing.* into attempt
    from public.followup_delivery_attempts as existing
    where existing.followup_queue_id = p_followup_queue_id;

    if attempt.status = 'sent'
       and attempt.provider_message_id = safe_message_id
       and attempt.last_execution_id = safe_execution_id then
      return jsonb_build_object('completed', false, 'reason', 'already_completed', 'status', attempt.status);
    end if;
    raise exception 'Follow-up completion rejected because the claim is stale or missing';
  end if;

  update public.followup_queue
    set status = 'sent',
        sent_at = now(),
        email_subject = safe_subject,
        email_body = safe_body,
        processing_started_at = null,
        retry_count = coalesce(retry_count, 0),
        last_error = null,
        email_context_decision = 'sent_deterministic',
        email_context_reason = 'deterministic_preflight_passed'
  where id = p_followup_queue_id
  returning * into source_row;

  if not found then
    raise exception 'Follow-up queue source disappeared during completion';
  end if;

  next_number := coalesce(source_row.followup_number, 1) + 1;
  max_followups := case
    when source_row.segment in ('NT-2', 'NT-8', 'NT-9', 'NT-12', 'NT-15', 'NT-17') then 4
    else 5
  end;

  if next_number <= max_followups then
    insert into public.followup_queue (
      document_id,
      document_name,
      customer_name,
      customer_email,
      customer_company,
      segment,
      anrede,
      is_urgent,
      budget_tier,
      visual_style,
      decision_window_hours,
      value,
      currency,
      followup_type,
      followup_number,
      scheduled_for,
      status,
      retry_count,
      pandadoc_customer_link,
      mockup_url,
      mockup_url_2,
      mockup_url_3,
      request_id
    ) values (
      source_row.document_id,
      source_row.document_name,
      source_row.customer_name,
      source_row.customer_email,
      source_row.customer_company,
      source_row.segment,
      source_row.anrede,
      source_row.is_urgent,
      source_row.budget_tier,
      source_row.visual_style,
      source_row.decision_window_hours,
      source_row.value,
      coalesce(source_row.currency, 'EUR'),
      'followup_' || next_number::text,
      next_number,
      now() + interval '72 hours',
      'pending',
      0,
      source_row.pandadoc_customer_link,
      source_row.mockup_url,
      source_row.mockup_url_2,
      source_row.mockup_url_3,
      source_row.request_id
    )
    on conflict (document_id, followup_number) do nothing;
    next_inserted := found;
  end if;

  insert into public.followup_delivery_events (
    attempt_id, event_key, event_type, workflow_execution_id, metadata
  ) values (
    attempt.id,
    'followup-delivery:' || attempt.id::text || ':sent',
    'sent',
    safe_execution_id,
    jsonb_build_object(
      'provider', 'outlook',
      'copy_mode', 'deterministic',
      'next_followup_number', case when next_inserted then next_number else null end
    )
  )
  on conflict (event_key) do nothing;

  return jsonb_build_object(
    'completed', true,
    'reason', 'sent',
    'status', attempt.status,
    'next_followup_inserted', next_inserted,
    'next_followup_number', case when next_inserted then next_number else null end,
    'automatic_retry_allowed', false
  );
end;
$$;

revoke all on function public.check_quote_send_guards(text, text, text)
  from public, anon, authenticated;
revoke all on function public.get_deal_id_by_pandadoc(text)
  from public, anon, authenticated;
revoke all on function public.get_vip_quotes(numeric, integer)
  from public, anon, authenticated;
revoke all on function public.get_pending_fus_with_cards(integer)
  from public, anon, authenticated;
revoke all on function public.get_pending_fus_with_cards()
  from public, anon, authenticated;
revoke all on function public.complete_followup_delivery(uuid, uuid, text, text, text, text)
  from public, anon, authenticated;

grant execute on function public.check_quote_send_guards(text, text, text)
  to service_role;
grant execute on function public.get_deal_id_by_pandadoc(text)
  to service_role;
grant execute on function public.get_vip_quotes(numeric, integer)
  to service_role;
grant execute on function public.get_pending_fus_with_cards(integer)
  to service_role;
grant execute on function public.get_pending_fus_with_cards()
  to service_role;
grant execute on function public.complete_followup_delivery(uuid, uuid, text, text, text, text)
  to service_role;

drop index if exists public.followup_queue_offer_public_url_idx;
alter table public.followup_queue
  drop constraint if exists followup_queue_offer_public_url_check;
alter table public.followup_queue
  drop column if exists offer_public_url;
alter table if exists public.sales_call_list_items
  drop column if exists offer_status;
drop table if exists public.offer_history_archive;

commit;
