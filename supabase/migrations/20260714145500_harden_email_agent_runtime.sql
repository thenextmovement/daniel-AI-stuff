alter table public.email_locks
  add column if not exists message_id text,
  add column if not exists internet_message_id text,
  add column if not exists conversation_id text,
  add column if not exists status text,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists lease_until timestamptz,
  add column if not exists next_retry_at timestamptz,
  add column if not exists last_error text,
  add column if not exists draft_id text,
  add column if not exists updated_at timestamptz not null default now();

update public.email_locks as lock
set status = case
      when log.draft_created is true then 'draft_created'
      when nullif(log.error_message, '') is not null then 'failed_retryable'
      else 'draft_created'
    end,
    attempt_count = greatest(lock.attempt_count, 1),
    next_retry_at = case
      when log.draft_created is not true and nullif(log.error_message, '') is not null then now()
      else null
    end,
    last_error = nullif(log.error_message, ''),
    draft_id = nullif(log.draft_id, ''),
    updated_at = now()
from public.email_agent_log as log
where lock.status is null
  and log.message_id = replace(lock.request_id, 'ai-email-v2:', '');

update public.email_locks
set status = 'draft_created',
    attempt_count = greatest(attempt_count, 1),
    updated_at = now()
where status is null;

alter table public.email_locks
  alter column status set default 'processing',
  alter column status set not null;

alter table public.email_locks
  drop constraint if exists email_locks_status_check,
  drop constraint if exists email_locks_attempt_count_check;

alter table public.email_locks
  add constraint email_locks_status_check check (
    status in ('processing', 'draft_created', 'failed_retryable', 'failed_final')
  ),
  add constraint email_locks_attempt_count_check check (
    attempt_count >= 0 and attempt_count <= 20
  );

create unique index if not exists email_locks_internet_message_id_key
  on public.email_locks (internet_message_id)
  where internet_message_id is not null;

create index if not exists email_locks_retry_due_idx
  on public.email_locks (status, next_retry_at)
  where status = 'failed_retryable';

alter table public.email_agent_log
  add column if not exists request_id text,
  add column if not exists internet_message_id text,
  add column if not exists message_source text,
  add column if not exists latest_message_fingerprint text,
  add column if not exists reply_length_class text,
  add column if not exists risk_level text,
  add column if not exists validation_reasons text[] not null default '{}',
  add column if not exists context_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists draft_body_hash text,
  add column if not exists draft_body_text text,
  add column if not exists review_status text not null default 'pending_review',
  add column if not exists final_message_id text,
  add column if not exists final_body_hash text,
  add column if not exists edit_ratio numeric(7,6),
  add column if not exists reviewed_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

alter table public.email_agent_log
  drop constraint if exists email_agent_log_reply_length_class_check,
  drop constraint if exists email_agent_log_risk_level_check,
  drop constraint if exists email_agent_log_review_status_check,
  drop constraint if exists email_agent_log_edit_ratio_check;

alter table public.email_agent_log
  add constraint email_agent_log_reply_length_class_check check (
    reply_length_class is null or reply_length_class in ('ack_only', 'simple', 'complex')
  ),
  add constraint email_agent_log_risk_level_check check (
    risk_level is null or risk_level in ('low', 'medium', 'high')
  ),
  add constraint email_agent_log_review_status_check check (
    review_status in ('pending_review', 'sent_unchanged', 'sent_edited', 'discarded', 'failed')
  ),
  add constraint email_agent_log_edit_ratio_check check (
    edit_ratio is null or (edit_ratio >= 0 and edit_ratio <= 1)
  );

create index if not exists email_agent_log_review_status_created_idx
  on public.email_agent_log (review_status, created_at desc);

create index if not exists email_agent_log_conversation_created_idx
  on public.email_agent_log (conversation_id, created_at desc);

create table if not exists public.email_agent_feedback (
  id bigint generated always as identity primary key,
  source_message_id text not null,
  conversation_id text,
  draft_id text,
  sent_message_id text not null,
  draft_body_hash text,
  sent_body_hash text,
  edit_ratio numeric(7,6),
  edit_summary jsonb not null default '{}'::jsonb,
  collected_at timestamptz not null default now(),
  constraint email_agent_feedback_sent_message_id_key unique (sent_message_id),
  constraint email_agent_feedback_edit_ratio_check check (
    edit_ratio is null or (edit_ratio >= 0 and edit_ratio <= 1)
  )
);

create index if not exists email_agent_feedback_source_message_idx
  on public.email_agent_feedback (source_message_id, collected_at desc);

alter table public.email_agent_feedback enable row level security;

drop policy if exists email_agent_feedback_service_role_all on public.email_agent_feedback;
create policy email_agent_feedback_service_role_all
  on public.email_agent_feedback
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.email_locks, public.email_agent_log, public.email_agent_feedback
  from public, anon, authenticated;
grant select, insert, update on public.email_locks, public.email_agent_log, public.email_agent_feedback
  to service_role;
grant usage, select on sequence public.email_agent_feedback_id_seq
  to service_role;

create or replace function public.claim_email_agent_message(
  p_request_id text,
  p_message_id text,
  p_internet_message_id text,
  p_conversation_id text,
  p_lease_seconds integer default 900
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_lock public.email_locks%rowtype;
  lease_seconds integer := least(greatest(coalesce(p_lease_seconds, 900), 60), 1800);
begin
  if nullif(btrim(p_request_id), '') is null or nullif(btrim(p_message_id), '') is null then
    raise exception 'request_id and message_id are required';
  end if;

  select *
    into current_lock
  from public.email_locks
  where request_id = p_request_id
     or (
       nullif(btrim(p_internet_message_id), '') is not null
       and internet_message_id = btrim(p_internet_message_id)
     )
  order by case when request_id = p_request_id then 0 else 1 end
  limit 1
  for update;

  if not found then
    insert into public.email_locks (
      request_id,
      message_id,
      internet_message_id,
      conversation_id,
      status,
      attempt_count,
      locked_at,
      lease_until,
      updated_at
    ) values (
      btrim(p_request_id),
      btrim(p_message_id),
      nullif(btrim(p_internet_message_id), ''),
      nullif(btrim(p_conversation_id), ''),
      'processing',
      1,
      now(),
      now() + make_interval(secs => lease_seconds),
      now()
    )
    returning * into current_lock;

    return jsonb_build_object(
      'claimed', true,
      'reason', 'new',
      'attempt_count', current_lock.attempt_count,
      'request_id', current_lock.request_id
    );
  end if;

  if current_lock.status = 'draft_created' then
    return jsonb_build_object('claimed', false, 'reason', 'draft_already_created', 'attempt_count', current_lock.attempt_count);
  end if;

  if current_lock.status = 'failed_final' or current_lock.attempt_count >= 5 then
    if current_lock.status <> 'failed_final' then
      update public.email_locks
      set status = 'failed_final', updated_at = now()
      where request_id = current_lock.request_id;
    end if;
    return jsonb_build_object('claimed', false, 'reason', 'attempt_limit', 'attempt_count', current_lock.attempt_count);
  end if;

  if current_lock.status = 'processing' and current_lock.lease_until is not null and current_lock.lease_until > now() then
    return jsonb_build_object('claimed', false, 'reason', 'active_lease', 'attempt_count', current_lock.attempt_count);
  end if;

  if current_lock.status = 'failed_retryable' and current_lock.next_retry_at is not null and current_lock.next_retry_at > now() then
    return jsonb_build_object('claimed', false, 'reason', 'retry_not_due', 'attempt_count', current_lock.attempt_count);
  end if;

  update public.email_locks
  set request_id = btrim(p_request_id),
      message_id = btrim(p_message_id),
      internet_message_id = coalesce(nullif(btrim(p_internet_message_id), ''), internet_message_id),
      conversation_id = coalesce(nullif(btrim(p_conversation_id), ''), conversation_id),
      status = 'processing',
      attempt_count = attempt_count + 1,
      locked_at = now(),
      lease_until = now() + make_interval(secs => lease_seconds),
      next_retry_at = null,
      last_error = null,
      updated_at = now()
  where request_id = current_lock.request_id
  returning * into current_lock;

  return jsonb_build_object(
    'claimed', true,
    'reason', 'retry',
    'attempt_count', current_lock.attempt_count,
    'request_id', current_lock.request_id
  );
end;
$$;

create or replace function public.resolve_email_agent_customer_context(
  p_email text,
  p_context_since timestamptz,
  p_allow_domain boolean default false,
  p_limit integer default 24
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with input as (
    select
      lower(btrim(coalesce(p_email, ''))) as email,
      split_part(lower(btrim(coalesce(p_email, ''))), '@', 2) as domain,
      coalesce(p_context_since, now() - interval '15 months') as context_since,
      least(greatest(coalesce(p_limit, 24), 1), 40) as result_limit
  ),
  exact_customers as (
    select
      customer.id,
      coalesce(customer.customer_organization_id, customer.organization_id) as organization_id
    from public.master_customers as customer
    cross join input
    where lower(btrim(customer.email)) = input.email
       or lower(btrim(coalesce(customer.billing_email, ''))) = input.email
       or lower(btrim(coalesce(customer.original_email, ''))) = input.email
       or exists (
         select 1 from unnest(customer.cc_emails) as cc(email)
         where lower(btrim(cc.email)) = input.email
       )
  ),
  exact_organizations as (
    select distinct organization_id
    from exact_customers
    where organization_id is not null
  ),
  master_email_rows as (
    select
      customer.id as customer_id,
      coalesce(customer.customer_organization_id, customer.organization_id) as organization_id,
      lower(btrim(email_value.email)) as contact_email,
      coalesce(customer.updated_at, customer.created_at, now()) as touched_at,
      case
        when exact.id is not null then 0
        when exact_org.organization_id is not null then 1
        else 2
      end as priority
    from public.master_customers as customer
    cross join input
    cross join lateral unnest(
      array_remove(
        array[customer.email, customer.billing_email, customer.original_email] || customer.cc_emails,
        null
      )
    ) as email_value(email)
    left join exact_customers as exact on exact.id = customer.id
    left join exact_organizations as exact_org
      on exact_org.organization_id = coalesce(customer.customer_organization_id, customer.organization_id)
    where lower(btrim(email_value.email)) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
      and (
        exact.id is not null
        or exact_org.organization_id is not null
        or (
          p_allow_domain
          and input.domain <> ''
          and split_part(lower(btrim(email_value.email)), '@', 2) = input.domain
          and coalesce(customer.updated_at, customer.created_at, now()) >= input.context_since
        )
      )
  ),
  quote_email_rows as (
    select
      null::uuid as customer_id,
      null::uuid as organization_id,
      lower(btrim(email_value.email)) as contact_email,
      coalesce(quote.updated_at, quote.created_at, now()) as touched_at,
      3 as priority
    from public.crm_quotes as quote
    cross join input
    cross join lateral unnest(array_remove(array[quote.contact_email, quote.billing_email, quote.original_email], null)) as email_value(email)
    where p_allow_domain
      and input.domain <> ''
      and split_part(lower(btrim(email_value.email)), '@', 2) = input.domain
      and coalesce(quote.updated_at, quote.created_at, now()) >= input.context_since
  ),
  candidate_rows as (
    select * from master_email_rows
    union all
    select * from quote_email_rows
    union all
    select null::uuid, null::uuid, input.email, now(), 0
    from input
    where input.email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  ranked_emails as (
    select distinct on (contact_email)
      customer_id,
      organization_id,
      contact_email,
      touched_at,
      priority
    from candidate_rows
    where contact_email not like '%@neontrip.de'
      and contact_email not like '%@no-customer-email.invalid'
    order by contact_email, priority, touched_at desc
  ),
  limited_emails as (
    select *
    from ranked_emails
    order by priority, touched_at desc
    limit (select result_limit from input)
  ),
  selected_organization as (
    select organization_id
    from limited_emails
    where organization_id is not null
    order by priority, touched_at desc
    limit 1
  ),
  organization_details as (
    select organization.name
    from public.customer_organizations as organization
    join selected_organization as selected
      on organization.id = selected.organization_id
      or organization.organization_id = selected.organization_id
    order by organization.updated_at desc nulls last
    limit 1
  ),
  related_requests as (
    select distinct request.request_id
    from public.master_requests as request
    where coalesce(request.updated_at, request.created_at, now()) >= (select context_since from input)
      and (
        request.customer_id in (select customer_id from limited_emails where customer_id is not null)
        or request.organization_id in (select organization_id from limited_emails where organization_id is not null)
      )
    order by request.request_id
    limit 40
  )
  select jsonb_build_object(
    'matched', exists(select 1 from exact_customers) or (select count(*) from limited_emails) > 1,
    'match_basis', case
      when exists(select 1 from exact_organizations) then 'organization'
      when exists(select 1 from exact_customers) then 'exact_contact'
      when (select count(*) from limited_emails) > 1 then 'domain_candidate'
      else 'sender_only'
    end,
    'organization_id', (select organization_id from selected_organization),
    'organization_name', (select name from organization_details),
    'related_emails', coalesce((select jsonb_agg(contact_email order by priority, touched_at desc) from limited_emails), '[]'::jsonb),
    'request_ids', coalesce((select jsonb_agg(request_id order by request_id) from related_requests), '[]'::jsonb),
    'context_since', (select context_since from input)
  );
$$;

create or replace function public.complete_email_agent_message(
  p_request_id text,
  p_record jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  knowledge_ids uuid[] := array(
    select value::uuid
    from jsonb_array_elements_text(coalesce(p_record->'knowledge_version_ids', '[]'::jsonb)) as item(value)
    where value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    limit 8
  );
  validation_values text[] := array(
    select left(value, 240)
    from jsonb_array_elements_text(coalesce(p_record->'validation_reasons', '[]'::jsonb)) as item(value)
    limit 30
  );
begin
  insert into public.email_agent_log (
    message_id, conversation_id, from_email, from_name, subject, body_preview,
    category, confidence, order_found, order_count, draft_created, draft_id,
    draft_body_preview, error_message, processing_time_ms, knowledge_version_ids,
    knowledge_match_count, request_id, internet_message_id, message_source,
    latest_message_fingerprint, reply_length_class, risk_level, validation_reasons,
    context_snapshot, draft_body_hash, draft_body_text, review_status, updated_at
  ) values (
    p_record->>'message_id', nullif(p_record->>'conversation_id', ''), p_record->>'from_email',
    nullif(p_record->>'from_name', ''), nullif(p_record->>'subject', ''), nullif(p_record->>'body_preview', ''),
    coalesce(nullif(p_record->>'category', ''), 'general'), nullif(p_record->>'confidence', '')::double precision,
    coalesce((p_record->>'order_found')::boolean, false), coalesce((p_record->>'order_count')::integer, 0),
    true, nullif(p_record->>'draft_id', ''), nullif(p_record->>'draft_body_preview', ''),
    nullif(p_record->>'error_message', ''), nullif(p_record->>'processing_time_ms', '')::integer,
    knowledge_ids, coalesce((p_record->>'knowledge_match_count')::integer, 0), p_request_id,
    nullif(p_record->>'internet_message_id', ''), nullif(p_record->>'message_source', ''),
    nullif(p_record->>'latest_message_fingerprint', ''), nullif(p_record->>'reply_length_class', ''),
    nullif(p_record->>'risk_level', ''), validation_values,
    coalesce(p_record->'context_snapshot', '{}'::jsonb), nullif(p_record->>'draft_body_hash', ''),
    nullif(p_record->>'draft_body_text', ''),
    'pending_review', now()
  )
  on conflict (message_id) do update
  set conversation_id = excluded.conversation_id,
      from_email = excluded.from_email,
      from_name = excluded.from_name,
      subject = excluded.subject,
      body_preview = excluded.body_preview,
      category = excluded.category,
      confidence = excluded.confidence,
      order_found = excluded.order_found,
      order_count = excluded.order_count,
      draft_created = true,
      draft_id = excluded.draft_id,
      draft_body_preview = excluded.draft_body_preview,
      error_message = excluded.error_message,
      processing_time_ms = excluded.processing_time_ms,
      knowledge_version_ids = excluded.knowledge_version_ids,
      knowledge_match_count = excluded.knowledge_match_count,
      request_id = excluded.request_id,
      internet_message_id = excluded.internet_message_id,
      message_source = excluded.message_source,
      latest_message_fingerprint = excluded.latest_message_fingerprint,
      reply_length_class = excluded.reply_length_class,
      risk_level = excluded.risk_level,
      validation_reasons = excluded.validation_reasons,
      context_snapshot = excluded.context_snapshot,
      draft_body_hash = excluded.draft_body_hash,
      draft_body_text = excluded.draft_body_text,
      review_status = 'pending_review',
      updated_at = now();

  update public.email_locks
  set status = 'draft_created',
      message_id = coalesce(nullif(p_record->>'message_id', ''), message_id),
      internet_message_id = coalesce(nullif(p_record->>'internet_message_id', ''), internet_message_id),
      conversation_id = coalesce(nullif(p_record->>'conversation_id', ''), conversation_id),
      draft_id = nullif(p_record->>'draft_id', ''),
      lease_until = null,
      next_retry_at = null,
      last_error = null,
      updated_at = now()
  where request_id = p_request_id;

  return jsonb_build_object('completed', true, 'request_id', p_request_id, 'draft_id', p_record->>'draft_id');
end;
$$;

create or replace function public.fail_email_agent_message(
  p_request_id text,
  p_record jsonb,
  p_retryable boolean default true
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  attempt integer;
  final_status text;
begin
  select attempt_count into attempt
  from public.email_locks
  where request_id = p_request_id
  for update;

  attempt := coalesce(attempt, 1);
  final_status := case when p_retryable and attempt < 5 then 'failed_retryable' else 'failed_final' end;

  update public.email_locks
  set status = final_status,
      lease_until = null,
      next_retry_at = case
        when final_status = 'failed_retryable' then now() + make_interval(mins => least(30, greatest(2, attempt * 3)))
        else null
      end,
      last_error = left(coalesce(p_record->>'error_message', 'Unknown workflow error'), 1500),
      updated_at = now()
  where request_id = p_request_id;

  insert into public.email_agent_log (
    message_id, conversation_id, from_email, from_name, subject, body_preview,
    category, confidence, order_found, order_count, draft_created, draft_id,
    draft_body_preview, error_message, processing_time_ms, request_id,
    internet_message_id, message_source, latest_message_fingerprint,
    reply_length_class, risk_level, validation_reasons, context_snapshot,
    review_status, updated_at
  ) values (
    p_record->>'message_id', nullif(p_record->>'conversation_id', ''), p_record->>'from_email',
    nullif(p_record->>'from_name', ''), nullif(p_record->>'subject', ''), nullif(p_record->>'body_preview', ''),
    coalesce(nullif(p_record->>'category', ''), 'general'), nullif(p_record->>'confidence', '')::double precision,
    coalesce((p_record->>'order_found')::boolean, false), coalesce((p_record->>'order_count')::integer, 0),
    coalesce((p_record->>'draft_created')::boolean, false), nullif(p_record->>'draft_id', ''),
    nullif(p_record->>'draft_body_preview', ''), left(coalesce(p_record->>'error_message', 'Unknown workflow error'), 1500),
    nullif(p_record->>'processing_time_ms', '')::integer, p_request_id,
    nullif(p_record->>'internet_message_id', ''), nullif(p_record->>'message_source', ''),
    nullif(p_record->>'latest_message_fingerprint', ''), nullif(p_record->>'reply_length_class', ''),
    nullif(p_record->>'risk_level', ''), '{}', coalesce(p_record->'context_snapshot', '{}'::jsonb),
    'failed', now()
  )
  on conflict (message_id) do update
  set draft_created = excluded.draft_created,
      draft_id = excluded.draft_id,
      draft_body_preview = excluded.draft_body_preview,
      error_message = excluded.error_message,
      processing_time_ms = excluded.processing_time_ms,
      request_id = excluded.request_id,
      internet_message_id = excluded.internet_message_id,
      message_source = excluded.message_source,
      latest_message_fingerprint = excluded.latest_message_fingerprint,
      reply_length_class = excluded.reply_length_class,
      risk_level = excluded.risk_level,
      context_snapshot = excluded.context_snapshot,
      review_status = 'failed',
      updated_at = now();

  return jsonb_build_object('failed', true, 'status', final_status, 'attempt_count', attempt);
end;
$$;

create or replace function public.record_email_agent_feedback(
  p_source_message_id text,
  p_conversation_id text,
  p_draft_id text,
  p_sent_message_id text,
  p_draft_body_hash text,
  p_sent_body_hash text,
  p_edit_ratio numeric,
  p_edit_summary jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  review_value text := case when coalesce(p_edit_ratio, 1) <= 0.02 then 'sent_unchanged' else 'sent_edited' end;
begin
  insert into public.email_agent_feedback (
    source_message_id, conversation_id, draft_id, sent_message_id,
    draft_body_hash, sent_body_hash, edit_ratio, edit_summary
  ) values (
    p_source_message_id, nullif(p_conversation_id, ''), nullif(p_draft_id, ''), p_sent_message_id,
    nullif(p_draft_body_hash, ''), nullif(p_sent_body_hash, ''), p_edit_ratio,
    coalesce(p_edit_summary, '{}'::jsonb)
  )
  on conflict (sent_message_id) do update
  set source_message_id = excluded.source_message_id,
      conversation_id = excluded.conversation_id,
      draft_id = excluded.draft_id,
      draft_body_hash = excluded.draft_body_hash,
      sent_body_hash = excluded.sent_body_hash,
      edit_ratio = excluded.edit_ratio,
      edit_summary = excluded.edit_summary,
      collected_at = now();

  update public.email_agent_log
  set review_status = review_value,
      final_message_id = p_sent_message_id,
      final_body_hash = nullif(p_sent_body_hash, ''),
      edit_ratio = p_edit_ratio,
      reviewed_at = now(),
      updated_at = now()
  where message_id = p_source_message_id;

  return jsonb_build_object('recorded', true, 'review_status', review_value);
end;
$$;

revoke all on function public.claim_email_agent_message(text, text, text, text, integer)
  from public, anon, authenticated;
revoke all on function public.resolve_email_agent_customer_context(text, timestamptz, boolean, integer)
  from public, anon, authenticated;
revoke all on function public.complete_email_agent_message(text, jsonb)
  from public, anon, authenticated;
revoke all on function public.fail_email_agent_message(text, jsonb, boolean)
  from public, anon, authenticated;
revoke all on function public.record_email_agent_feedback(text, text, text, text, text, text, numeric, jsonb)
  from public, anon, authenticated;

grant execute on function public.claim_email_agent_message(text, text, text, text, integer)
  to service_role;
grant execute on function public.resolve_email_agent_customer_context(text, timestamptz, boolean, integer)
  to service_role;
grant execute on function public.complete_email_agent_message(text, jsonb)
  to service_role;
grant execute on function public.fail_email_agent_message(text, jsonb, boolean)
  to service_role;
grant execute on function public.record_email_agent_feedback(text, text, text, text, text, text, numeric, jsonb)
  to service_role;

do $$
declare
  entry record;
  article_id_value uuid;
  version_id_value uuid;
  next_version integer;
begin
  for entry in
    select *
    from jsonb_to_recordset($seed$
      [
        {
          "slug": "email-support-attachment-evidence",
          "title": "Anhänge und erwähnte Dokumente getrennt prüfen",
          "content": "Eine Datei gilt nur dann als erhalten, wenn sie in der aktuellen Nachricht technisch vorhanden und als passender Dokumenttyp erkannt wurde. Nennt die Kundennachricht eine Bestellbestätigung, einen Lieferschein, eine Rechnung oder eine Grafikdatei als Anhang, die passende Datei fehlt aber, muss der Entwurf kurz und konkret um erneute Zusendung bitten. Bei einer fehlenden Bestellbestätigung ist als Grund zu nennen, dass Liefer- und Rechnungsadresse korrekt übernommen und geprüft werden müssen. Bereits früher im Verlauf erhaltene Dateien dürfen nur als früher erhalten bezeichnet werden, nicht als Anhang der aktuellen Nachricht.",
          "risk_class": "sensitive"
        },
        {
          "slug": "email-support-concise-replies",
          "title": "Antwortlänge an den tatsächlichen Klärungsbedarf anpassen",
          "content": "Reine Bestätigungen, kurze Klarstellungen und Nachrichten ohne neue Frage werden in ein bis zwei kurzen Absätzen beantwortet. Einfache Fragen erhalten höchstens drei kurze Absätze. Nur mehrere voneinander unabhängige Fragen oder erklärungsbedürftige Sachverhalte rechtfertigen bis zu fünf Absätze. Inhalte der Kundennachricht werden nicht unnötig vollständig wiederholt.",
          "risk_class": "standard"
        },
        {
          "slug": "email-support-production-commitments",
          "title": "Produktionsstart niemals ungeprüft zusagen",
          "content": "Formulierungen wie wir starten direkt mit der Produktion, die Produktion kann beginnen oder nach Zusendung geht es sofort weiter sind verbindliche operative Zusagen und dürfen nicht aus einer E-Mail oder einem Anhang abgeleitet werden. Ohne eindeutig verifizierten und freigegebenen Produktionsstatus wird nur der nächste sichere Prüfschritt beschrieben.",
          "risk_class": "sensitive"
        },
        {
          "slug": "email-support-organization-context",
          "title": "Organisationskontext ist nur ein Suchhinweis",
          "content": "Mehrere Kontakte derselben Organisation können an verschiedenen Projekten arbeiten. E-Mail-Domain, Firmenname oder Organisationszuordnung dürfen deshalb nur passende zeitnahe Vorgänge als Kandidaten liefern. Ein Kundenentwurf darf einen Vorgang erst dann zuordnen oder bestätigen, wenn zusätzlich Angebot, Projektnummer, Thema, Zeitbezug oder eine andere verifizierte Referenz passt. Technische Formular- und Relay-Domains sind keine Kundenorganisationen.",
          "risk_class": "sensitive"
        }
      ]
    $seed$::jsonb) as seed_entry(slug text, title text, content text, risk_class text)
  loop
    insert into public.voice_knowledge_articles (slug, created_by)
    values (entry.slug, 'daniel_klesse_user_authorized_2026-07-14')
    on conflict (slug) do update set updated_at = now()
    returning id into article_id_value;

    select version.id
      into version_id_value
    from public.voice_knowledge_versions as version
    where version.article_id = article_id_value
      and version.content_hash = md5(entry.content)
    order by version.version_number desc
    limit 1;

    if version_id_value is null then
      select coalesce(max(version.version_number), 0) + 1
        into next_version
      from public.voice_knowledge_versions as version
      where version.article_id = article_id_value;

      insert into public.voice_knowledge_versions (
        article_id, version_number, title, content, status, allowed_modes,
        risk_class, source_refs, content_hash, valid_from, authored_by,
        reviewed_by, reviewed_at
      ) values (
        article_id_value, next_version, entry.title, entry.content, 'approved',
        array['email_drafting']::text[], entry.risk_class,
        jsonb_build_array(jsonb_build_object(
          'type', 'internal_policy',
          'label', 'AI Email Agent v2 hardening',
          'verified_at', '2026-07-14'
        )),
        md5(entry.content), now(), 'codex_from_user_authorized_policy',
        'daniel_klesse_user_authorized_2026-07-14', now()
      )
      returning id into version_id_value;

      insert into public.voice_knowledge_chunks (version_id, chunk_index, content)
      values (version_id_value, 0, entry.title || E'\n\n' || entry.content);
    end if;
  end loop;
end $$;

comment on function public.resolve_email_agent_customer_context(text, timestamptz, boolean, integer) is
  'Resolves time-bounded related contacts from Postgres sources of truth. Domain matches remain candidates, never proof of project identity.';
comment on table public.email_agent_feedback is
  'Human-review outcomes for AI email drafts. Postgres is source of truth; no customer email is sent by this table or its RPC.';
