begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.followup_queue
  add column if not exists offer_public_url text;

update public.followup_queue
set offer_public_url = pandadoc_customer_link
where offer_public_url is null
  and pandadoc_customer_link ~* '^https://angebote\.neontrip\.de/offer/[^/?#]+$';

alter table public.followup_queue
  drop constraint if exists followup_queue_offer_public_url_check;

alter table public.followup_queue
  add constraint followup_queue_offer_public_url_check
  check (
    offer_public_url is null
    or offer_public_url ~* '^https://angebote\.neontrip\.de/offer/[^/?#]+$'
  ) not valid;

alter table public.followup_queue
  validate constraint followup_queue_offer_public_url_check;

create index if not exists followup_queue_offer_public_url_idx
  on public.followup_queue (offer_public_url)
  where offer_public_url is not null;

alter table if exists public.sales_call_list_items
  add column if not exists offer_status text;

update public.sales_call_list_items
set offer_status = pandadoc_status
where offer_status is null
  and pandadoc_status is not null;

update public.company_source_registry
set display_name = 'Retired external document archive',
    active = false,
    expected_freshness = null,
    description = 'Historical evidence only. All active offer operations use NEONTRIP Offers.',
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'retired_at', now(),
      'replacement_source', 'offers'
    ),
    updated_at = now()
where source_key = 'pandadoc';

create table if not exists public.offer_history_archive (
  id uuid primary key,
  request_id text,
  customer_id uuid,
  source_reference text,
  offer_status text,
  total_value numeric,
  currency text,
  created_at timestamptz,
  sent_at timestamptz,
  viewed_at timestamptz,
  accepted_at timestamptz,
  archived_at timestamptz not null default now()
);

insert into public.offer_history_archive (
  id,
  request_id,
  customer_id,
  source_reference,
  offer_status,
  total_value,
  currency,
  created_at,
  sent_at,
  viewed_at,
  accepted_at
)
select
  q.id,
  q.request_id,
  q.customer_id,
  q.pandadoc_id,
  q.pandadoc_status,
  q.total_value,
  q.currency,
  q.created_at,
  q.sent_at,
  q.viewed_at,
  q.signed_at
from public.master_quotes q
on conflict (id) do update
set request_id = excluded.request_id,
    customer_id = excluded.customer_id,
    source_reference = excluded.source_reference,
    offer_status = excluded.offer_status,
    total_value = excluded.total_value,
    currency = excluded.currency,
    created_at = excluded.created_at,
    sent_at = excluded.sent_at,
    viewed_at = excluded.viewed_at,
    accepted_at = excluded.accepted_at,
    archived_at = now();

alter table public.offer_history_archive enable row level security;
revoke all on table public.offer_history_archive
  from public, anon, authenticated;
grant select on table public.offer_history_archive
  to service_role;

create or replace view public.v_offer_history as
select
  q.id,
  mr.request_id,
  q.customer_id,
  'neontrip'::text as source,
  q.id::text as source_reference,
  q.status::text as offer_status,
  coalesce(q.customer_live_total, q.total_gross) as total_value,
  'EUR'::text as currency,
  q.created_at,
  q.sent_at,
  q.viewed_at,
  q.accepted_at
from public.crm_quotes q
left join public.master_requests mr on mr.id = q.request_id
union all
select
  a.id,
  a.request_id,
  a.customer_id,
  'archive'::text as source,
  a.source_reference,
  a.offer_status,
  a.total_value,
  a.currency,
  a.created_at,
  a.sent_at,
  a.viewed_at,
  a.accepted_at
from public.offer_history_archive a;

create or replace view public.v_quotes_by_email as
select
  mc.email,
  q.id::text as document_id,
  coalesce(
    nullif(btrim(mc.name), ''),
    nullif(btrim(concat_ws(' ', mc.first_name, mc.last_name)), ''),
    nullif(btrim(mc.company_name), '')
  ) as customer_name,
  q.status::text as status,
  q.total_gross as total_value,
  'https://angebote.neontrip.de/offer/' || q.token as share_link,
  q.created_at,
  q.sent_at,
  q.viewed_at,
  q.accepted_at as signed_at
from public.crm_quotes q
join public.master_customers mc on mc.id = q.customer_id;

revoke all on table public.v_offer_history
  from public, anon, authenticated;
revoke all on table public.v_quotes_by_email
  from public, anon, authenticated;
grant select on table public.v_offer_history, public.v_quotes_by_email
  to service_role;

drop function if exists public.check_quote_send_guards(text, text, text);

create or replace function public.check_offer_send_guards(
  p_request_id text,
  p_quote_id uuid default null
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
  where unique_id = p_request_id
    and status = 'sent';
  v_checks := v_checks || jsonb_build_object('quote_email_log', v_count > 0);
  if v_count > 0 and not v_blocked then
    v_blocked := true;
    v_reason := 'quote_email_already_sent';
  end if;

  select count(*) into v_count
  from public.crm_quotes q
  left join public.master_requests mr on mr.id = q.request_id
  where (
      (p_quote_id is not null and q.id = p_quote_id)
      or (p_request_id is not null and mr.request_id = p_request_id)
    )
    and q.sent_at is not null;
  v_checks := v_checks || jsonb_build_object('offer_sent', v_count > 0);
  if v_count > 0 and not v_blocked then
    v_blocked := true;
    v_reason := 'offer_already_sent';
  end if;

  select count(*) into v_count
  from public.crm_quotes q
  left join public.master_requests mr on mr.id = q.request_id
  where (
      (p_quote_id is not null and q.id = p_quote_id)
      or (p_request_id is not null and mr.request_id = p_request_id)
    )
    and (q.accepted_at is not null or q.status = 'accepted');
  v_checks := v_checks || jsonb_build_object('offer_accepted', v_count > 0);
  if v_count > 0 and not v_blocked then
    v_blocked := true;
    v_reason := 'offer_already_accepted';
  end if;

  select count(*) into v_count
  from public.master_requests
  where request_id = p_request_id
    and status in ('won', 'completed', 'paid');
  v_checks := v_checks || jsonb_build_object('request_won', v_count > 0);
  if v_count > 0 and not v_blocked then
    v_blocked := true;
    v_reason := 'request_already_won';
  end if;

  return jsonb_build_object(
    'allow_send', not v_blocked,
    'block_reason', v_reason,
    'checks', v_checks,
    'checked_at', now()
  );
end;
$$;

drop function if exists public.get_deal_id_by_pandadoc(text);

create or replace function public.get_deal_id_by_offer(p_quote_id uuid)
returns integer
language sql
stable
set search_path = public
as $$
  select mr.ac_deal_id
  from public.crm_quotes q
  join public.master_requests mr on mr.id = q.request_id
  where q.id = p_quote_id
  limit 1;
$$;

drop function if exists public.get_vip_quotes(numeric, integer);

create or replace function public.get_vip_offers(
  min_value numeric,
  days_back integer
)
returns table(
  id uuid,
  total_value numeric,
  offer_status text,
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
    q.total_gross,
    q.status::text,
    'https://angebote.neontrip.de/offer/' || q.token,
    q.sent_at,
    q.viewed_at,
    c.first_name,
    c.last_name,
    c.company_name,
    c.ac_contact_id,
    c.email,
    c.phone
  from public.crm_quotes q
  left join public.master_customers c on c.id = q.customer_id
  left join public.master_requests r on r.id = q.request_id
  where q.accepted_at is null
    and coalesce(q.total_gross, 0) >= min_value
    and q.sent_at >= now() - make_interval(days => greatest(days_back, 0))
    and q.status not in ('accepted', 'rejected', 'expired')
    and coalesce(r.deal_status, 'open') != 'lost'
  order by q.total_gross desc nulls last;
$$;

drop function if exists public.get_pending_fus_with_cards();

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
      from public.crm_quotes q
      where q.request_id = mr.id
        and (q.accepted_at is not null or q.status = 'accepted')
    )
  order by fq.scheduled_for asc
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
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
      offer_public_url,
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
      source_row.offer_public_url,
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

revoke all on function public.check_offer_send_guards(text, uuid)
  from public, anon, authenticated;
revoke all on function public.get_deal_id_by_offer(uuid)
  from public, anon, authenticated;
revoke all on function public.get_vip_offers(numeric, integer)
  from public, anon, authenticated;
revoke all on function public.get_pending_fus_with_cards(integer)
  from public, anon, authenticated;
revoke all on function public.complete_followup_delivery(uuid, uuid, text, text, text, text)
  from public, anon, authenticated;

grant execute on function public.check_offer_send_guards(text, uuid)
  to service_role;
grant execute on function public.get_deal_id_by_offer(uuid)
  to service_role;
grant execute on function public.get_vip_offers(numeric, integer)
  to service_role;
grant execute on function public.get_pending_fus_with_cards(integer)
  to service_role;
grant execute on function public.complete_followup_delivery(uuid, uuid, text, text, text, text)
  to service_role;

commit;
