-- Human-gated learning and support knowledge governance for the AI email agent.
-- AI may propose signals and knowledge, but only explicit, auditable human reviews
-- can make aggregate style guidance or support knowledge available to drafting.

create table if not exists public.email_agent_learning_review_audit (
  id uuid primary key default gen_random_uuid(),
  feedback_id bigint not null references public.email_agent_feedback(id) on delete restrict,
  idempotency_key text not null unique,
  request_hash text not null,
  decision text not null,
  previous_status text not null,
  new_status text not null,
  reviewer text not null,
  review_note text not null,
  eligibility_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint email_agent_learning_review_audit_decision_check
    check (decision in ('approved', 'rejected', 'ignored')),
  constraint email_agent_learning_review_audit_status_check
    check (
      previous_status in ('pending', 'approved', 'rejected', 'ignored')
      and new_status in ('pending', 'approved', 'rejected', 'ignored')
    ),
  constraint email_agent_learning_review_audit_reviewer_check
    check (char_length(btrim(reviewer)) between 2 and 200),
  constraint email_agent_learning_review_audit_note_check
    check (char_length(btrim(review_note)) between 8 and 2000),
  constraint email_agent_learning_review_audit_idempotency_check
    check (char_length(btrim(idempotency_key)) between 16 and 200)
);

create index if not exists email_agent_learning_review_audit_feedback_idx
  on public.email_agent_learning_review_audit (feedback_id, created_at desc);

alter table public.email_agent_learning_review_audit enable row level security;

drop policy if exists email_agent_learning_review_audit_service_role_all
  on public.email_agent_learning_review_audit;
create policy email_agent_learning_review_audit_service_role_all
  on public.email_agent_learning_review_audit
  for all to service_role using (true) with check (true);

revoke all on table public.email_agent_learning_review_audit
  from public, anon, authenticated;
grant select, insert on table public.email_agent_learning_review_audit
  to service_role;

comment on table public.email_agent_learning_review_audit is
  'Append-only review trail for style-learning decisions. Contains metadata only, never reusable customer facts or message bodies.';

create or replace function public.get_email_agent_feedback_learning_eligibility_v1(
  p_feedback_id bigint
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $function$
declare
  feedback_row public.email_agent_feedback%rowtype;
  log_draft_body text;
  log_risk_level text;
  reasons text[] := '{}'::text[];
  blocked_labels constant text[] := array[
    'question_added', 'question_removed', 'amount_changed', 'date_changed',
    'attachment_reference_changed', 'commitment_changed', 'internal_detail_removed',
    'factual_correction', 'manual_rewrite', 'needs_human_review'
  ]::text[];
begin
  select feedback.*
    into feedback_row
  from public.email_agent_feedback as feedback
  where feedback.id = p_feedback_id;

  if not found then
    return jsonb_build_object(
      'version', 'email-learning-eligibility-v1',
      'eligible', false,
      'blocked_reasons', jsonb_build_array('feedback_not_found'),
      'style_only', true,
      'customer_content_reusable', false
    );
  end if;

  select log.draft_body_text, log.risk_level
    into log_draft_body, log_risk_level
  from public.email_agent_log as log
  where log.message_id = feedback_row.source_message_id
    and log.draft_created = true
  order by log.created_at desc
  limit 1;

  if feedback_row.is_valid is distinct from true then
    reasons := array_append(reasons, 'feedback_invalid');
  end if;
  if nullif(btrim(coalesce(feedback_row.sent_body_text, '')), '') is null then
    reasons := array_append(reasons, 'sent_body_missing');
  end if;
  if nullif(btrim(coalesce(log_draft_body, '')), '') is null then
    reasons := array_append(reasons, 'matching_draft_missing');
  end if;
  if nullif(btrim(coalesce(feedback_row.draft_body_hash, '')), '') is null
     or nullif(btrim(coalesce(feedback_row.sent_body_hash, '')), '') is null then
    reasons := array_append(reasons, 'comparison_hash_missing');
  end if;
  if feedback_row.edit_ratio is null
     or feedback_row.edit_ratio < 0
     or feedback_row.edit_ratio > 1 then
    reasons := array_append(reasons, 'edit_ratio_invalid');
  end if;
  if coalesce(feedback_row.edit_summary->>'sent_words', '') !~ '^[1-9][0-9]{0,3}$' then
    reasons := array_append(reasons, 'sent_word_count_invalid');
  end if;
  if coalesce(feedback_row.edit_labels, '{}'::text[]) && blocked_labels then
    reasons := array_append(reasons, 'fact_or_intent_change_detected');
  end if;
  if feedback_row.review_priority = 'high' or log_risk_level = 'high' then
    reasons := array_append(reasons, 'high_risk_case');
  end if;
  if jsonb_typeof(coalesce(feedback_row.change_profile, '{}'::jsonb)) <> 'object' then
    reasons := array_append(reasons, 'change_profile_invalid');
  end if;

  return jsonb_build_object(
    'version', 'email-learning-eligibility-v1',
    'eligible', cardinality(reasons) = 0,
    'blocked_reasons', to_jsonb(reasons),
    'style_only', true,
    'customer_content_reusable', false,
    'fact_learning_allowed', false,
    'prompt_rewrite_allowed', false
  );
end;
$function$;

revoke all on function public.get_email_agent_feedback_learning_eligibility_v1(bigint)
  from public, anon, authenticated;
grant execute on function public.get_email_agent_feedback_learning_eligibility_v1(bigint)
  to service_role;

create or replace function public.review_email_agent_feedback_v2(
  p_feedback_id bigint,
  p_decision text,
  p_note text,
  p_reviewer text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $function$
declare
  feedback_row public.email_agent_feedback%rowtype;
  audit_row public.email_agent_learning_review_audit%rowtype;
  eligibility jsonb;
  clean_decision text := lower(btrim(coalesce(p_decision, '')));
  clean_note text := left(btrim(coalesce(p_note, '')), 2000);
  clean_reviewer text := left(btrim(coalesce(p_reviewer, '')), 200);
  clean_key text := left(btrim(coalesce(p_idempotency_key, '')), 200);
  request_fingerprint text;
  previous_status text;
begin
  if clean_decision not in ('approved', 'rejected', 'ignored') then
    raise exception 'decision must be approved, rejected, or ignored';
  end if;
  if char_length(clean_reviewer) < 2 then
    raise exception 'reviewer identity is required';
  end if;
  if char_length(clean_note) < 8 then
    raise exception 'review note must contain at least 8 characters';
  end if;
  if char_length(clean_key) < 16 then
    raise exception 'idempotency key is required';
  end if;

  request_fingerprint := md5(concat_ws('|', p_feedback_id::text, clean_decision, clean_note, clean_reviewer));
  perform pg_advisory_xact_lock(hashtext('email-learning-review:' || clean_key));

  select audit.*
    into audit_row
  from public.email_agent_learning_review_audit as audit
  where audit.idempotency_key = clean_key;

  if found then
    if audit_row.request_hash <> request_fingerprint then
      raise exception 'idempotency key was already used for another review request';
    end if;
    return jsonb_build_object(
      'updated', false,
      'idempotent_replay', true,
      'feedback_id', audit_row.feedback_id,
      'learning_status', audit_row.new_status,
      'human_reviewed_at', audit_row.created_at,
      'audit_id', audit_row.id
    );
  end if;

  select feedback.*
    into feedback_row
  from public.email_agent_feedback as feedback
  where feedback.id = p_feedback_id
  for update;

  if not found then
    raise exception 'feedback row was not found';
  end if;

  eligibility := public.get_email_agent_feedback_learning_eligibility_v1(p_feedback_id);
  if clean_decision = 'approved' and coalesce((eligibility->>'eligible')::boolean, false) is not true then
    raise exception 'feedback is not eligible for style learning: %', eligibility->'blocked_reasons';
  end if;

  previous_status := feedback_row.learning_status;

  update public.email_agent_feedback
  set learning_status = clean_decision,
      human_review_note = clean_note,
      human_reviewed_by = clean_reviewer,
      human_reviewed_at = now(),
      updated_at = now()
  where id = p_feedback_id;

  insert into public.email_agent_learning_review_audit (
    feedback_id,
    idempotency_key,
    request_hash,
    decision,
    previous_status,
    new_status,
    reviewer,
    review_note,
    eligibility_snapshot
  ) values (
    p_feedback_id,
    clean_key,
    request_fingerprint,
    clean_decision,
    previous_status,
    clean_decision,
    clean_reviewer,
    clean_note,
    eligibility
  )
  returning * into audit_row;

  return jsonb_build_object(
    'updated', true,
    'idempotent_replay', false,
    'feedback_id', p_feedback_id,
    'learning_status', clean_decision,
    'human_reviewed_at', audit_row.created_at,
    'audit_id', audit_row.id,
    'eligibility', eligibility
  );
end;
$function$;

revoke all on function public.review_email_agent_feedback_v2(bigint, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.review_email_agent_feedback_v2(bigint, text, text, text, text)
  to service_role;

-- Force application callers onto the audited v2 gate.
revoke all on function public.review_email_agent_feedback(bigint, text, text, text)
  from service_role;

create or replace function public.get_email_agent_style_profile(
  p_channel text default null,
  p_category text default null,
  p_reply_length_class text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $function$
declare
  sample_count integer := 0;
  median_words integer := null;
  shortened_share numeric := 0;
  expanded_share numeric := 0;
  greeting_change_share numeric := 0;
  closing_change_share numeric := 0;
  recommended_max_words integer := null;
begin
  select
    count(*)::integer,
    percentile_disc(0.5) within group (
      order by (feedback.edit_summary->>'sent_words')::integer
    )::integer,
    coalesce(avg((feedback.edit_labels @> array['shortened']::text[])::integer), 0),
    coalesce(avg((feedback.edit_labels @> array['expanded']::text[])::integer), 0),
    coalesce(avg((feedback.edit_labels @> array['greeting_changed']::text[])::integer), 0),
    coalesce(avg((feedback.edit_labels @> array['closing_changed']::text[])::integer), 0)
  into sample_count, median_words, shortened_share, expanded_share,
       greeting_change_share, closing_change_share
  from public.email_agent_feedback as feedback
  join lateral (
    select log.message_source, log.category, log.reply_length_class, log.risk_level, log.draft_body_text
    from public.email_agent_log as log
    where log.message_id = feedback.source_message_id
      and log.draft_created = true
    order by log.created_at desc
    limit 1
  ) as matched_log on true
  where feedback.is_valid = true
    and feedback.learning_status = 'approved'
    and feedback.collected_at >= now() - interval '90 days'
    and nullif(btrim(coalesce(feedback.sent_body_text, '')), '') is not null
    and nullif(btrim(coalesce(matched_log.draft_body_text, '')), '') is not null
    and nullif(btrim(coalesce(feedback.draft_body_hash, '')), '') is not null
    and nullif(btrim(coalesce(feedback.sent_body_hash, '')), '') is not null
    and coalesce(feedback.edit_summary->>'sent_words', '') ~ '^[1-9][0-9]{0,3}$'
    and feedback.review_priority <> 'high'
    and coalesce(matched_log.risk_level, 'low') <> 'high'
    and not (feedback.edit_labels && array[
      'question_added', 'question_removed', 'amount_changed', 'date_changed',
      'attachment_reference_changed', 'commitment_changed', 'internal_detail_removed',
      'factual_correction', 'manual_rewrite', 'needs_human_review'
    ]::text[])
    and (nullif(p_channel, '') is null or matched_log.message_source = p_channel)
    and (nullif(p_category, '') is null or matched_log.category = p_category)
    and (nullif(p_reply_length_class, '') is null or matched_log.reply_length_class = p_reply_length_class);

  if sample_count >= 5 and median_words is not null then
    recommended_max_words := case coalesce(p_reply_length_class, 'simple')
      when 'ack_only' then greatest(8, least(80, median_words + 8))
      when 'complex' then greatest(60, least(360, median_words + 30))
      else greatest(25, least(180, median_words + 18))
    end;
  end if;

  return jsonb_build_object(
    'version', 'email-style-profile-v2-human-gated',
    'eligible', sample_count >= 5,
    'minimum_approved_samples', 5,
    'approved_sample_count', sample_count,
    'window_days', 90,
    'channel', nullif(p_channel, ''),
    'category', nullif(p_category, ''),
    'reply_length_class', nullif(p_reply_length_class, ''),
    'median_sent_words', median_words,
    'recommended_max_words', recommended_max_words,
    'prefer_shorter', sample_count >= 5 and shortened_share >= 0.60,
    'shortened_share', round(shortened_share, 4),
    'expanded_share', round(expanded_share, 4),
    'greeting_change_share', round(greeting_change_share, 4),
    'closing_change_share', round(closing_change_share, 4),
    'facts_or_customer_content_included', false,
    'fact_learning_allowed', false,
    'automatic_prompt_rewrite_allowed', false
  );
end;
$function$;

revoke all on function public.get_email_agent_style_profile(text, text, text)
  from public, anon, authenticated;
grant execute on function public.get_email_agent_style_profile(text, text, text)
  to service_role;

create table if not exists public.email_support_knowledge_approvals (
  version_id uuid primary key references public.voice_knowledge_versions(id) on delete cascade,
  status text not null default 'pending',
  approved_content_hash text,
  reviewed_by text,
  review_note text,
  reviewed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint email_support_knowledge_approvals_status_check
    check (status in ('pending', 'approved', 'rejected', 'retired')),
  constraint email_support_knowledge_approvals_review_check
    check (
      status = 'pending'
      or (
        char_length(btrim(coalesce(reviewed_by, ''))) between 2 and 200
        and char_length(btrim(coalesce(review_note, ''))) between 8 and 2000
        and reviewed_at is not null
      )
    ),
  constraint email_support_knowledge_approvals_hash_check
    check (status <> 'approved' or nullif(btrim(coalesce(approved_content_hash, '')), '') is not null)
);

create table if not exists public.knowledge_review_audit (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.voice_knowledge_versions(id) on delete restrict,
  review_scope text not null,
  idempotency_key text not null unique,
  request_hash text not null,
  decision text not null,
  previous_status text not null,
  new_status text not null,
  reviewer text not null,
  review_note text not null,
  eligibility_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint knowledge_review_audit_scope_check
    check (review_scope in ('global', 'email_drafting')),
  constraint knowledge_review_audit_decision_check
    check (decision in ('approve', 'request_changes', 'reject', 'retire', 'legacy_backfill')),
  constraint knowledge_review_audit_reviewer_check
    check (char_length(btrim(reviewer)) between 2 and 200),
  constraint knowledge_review_audit_note_check
    check (char_length(btrim(review_note)) between 8 and 2000),
  constraint knowledge_review_audit_idempotency_check
    check (char_length(btrim(idempotency_key)) between 16 and 200)
);

create index if not exists email_support_knowledge_approvals_status_idx
  on public.email_support_knowledge_approvals (status, updated_at desc);
create index if not exists knowledge_review_audit_version_idx
  on public.knowledge_review_audit (version_id, created_at desc);

alter table public.email_support_knowledge_approvals enable row level security;
alter table public.knowledge_review_audit enable row level security;

drop policy if exists email_support_knowledge_approvals_service_role_all
  on public.email_support_knowledge_approvals;
create policy email_support_knowledge_approvals_service_role_all
  on public.email_support_knowledge_approvals
  for all to service_role using (true) with check (true);

drop policy if exists knowledge_review_audit_service_role_all
  on public.knowledge_review_audit;
create policy knowledge_review_audit_service_role_all
  on public.knowledge_review_audit
  for all to service_role using (true) with check (true);

revoke all on table public.email_support_knowledge_approvals, public.knowledge_review_audit
  from public, anon, authenticated;
grant select, insert, update on table public.email_support_knowledge_approvals
  to service_role;
grant select, insert on table public.knowledge_review_audit
  to service_role;

comment on table public.email_support_knowledge_approvals is
  'Separate human gate for knowledge that may be retrieved into customer email drafts.';
comment on table public.knowledge_review_audit is
  'Append-only audit of global and email-specific knowledge review decisions.';

create or replace function public.get_email_support_knowledge_eligibility_v1(
  p_version_id uuid
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $function$
declare
  version_row public.voice_knowledge_versions%rowtype;
  reasons text[] := '{}'::text[];
  chunk_count integer := 0;
begin
  select version.*
    into version_row
  from public.voice_knowledge_versions as version
  where version.id = p_version_id;

  if not found then
    return jsonb_build_object(
      'version', 'email-knowledge-eligibility-v1',
      'eligible', false,
      'blocked_reasons', jsonb_build_array('version_not_found')
    );
  end if;

  select count(*)::integer
    into chunk_count
  from public.voice_knowledge_chunks as chunk
  where chunk.version_id = p_version_id
    and nullif(btrim(chunk.content), '') is not null;

  if version_row.status <> 'approved' then
    reasons := array_append(reasons, 'global_approval_missing');
  end if;
  if not ('email_drafting' = any(version_row.allowed_modes)) then
    reasons := array_append(reasons, 'email_mode_not_allowed');
  end if;
  if version_row.risk_class = 'restricted' then
    reasons := array_append(reasons, 'restricted_knowledge');
  end if;
  if char_length(btrim(coalesce(version_row.content, ''))) < 20 then
    reasons := array_append(reasons, 'content_too_short');
  end if;
  if nullif(btrim(coalesce(version_row.content_hash, '')), '') is null then
    reasons := array_append(reasons, 'content_hash_missing');
  end if;
  if jsonb_typeof(version_row.source_refs) <> 'array'
     or jsonb_array_length(version_row.source_refs) = 0 then
    reasons := array_append(reasons, 'verified_source_missing');
  end if;
  if chunk_count = 0 or chunk_count > 20 then
    reasons := array_append(reasons, 'knowledge_chunks_invalid');
  end if;
  if nullif(btrim(coalesce(version_row.reviewed_by, '')), '') is null
     or version_row.reviewed_at is null then
    reasons := array_append(reasons, 'global_reviewer_missing');
  end if;
  if version_row.valid_from is not null and version_row.valid_from > now() then
    reasons := array_append(reasons, 'not_yet_valid');
  end if;
  if version_row.valid_until is not null and version_row.valid_until <= now() then
    reasons := array_append(reasons, 'knowledge_expired');
  end if;

  return jsonb_build_object(
    'version', 'email-knowledge-eligibility-v1',
    'eligible', cardinality(reasons) = 0,
    'blocked_reasons', to_jsonb(reasons),
    'content_hash', version_row.content_hash,
    'chunk_count', chunk_count,
    'risk_class', version_row.risk_class,
    'customer_send_allowed', false,
    'human_draft_review_required', true
  );
end;
$function$;

revoke all on function public.get_email_support_knowledge_eligibility_v1(uuid)
  from public, anon, authenticated;
grant execute on function public.get_email_support_knowledge_eligibility_v1(uuid)
  to service_role;

create or replace function public.review_voice_knowledge_version_v2(
  p_version_id uuid,
  p_decision text,
  p_reviewer text,
  p_note text,
  p_idempotency_key text
)
returns table (version_id uuid, article_id uuid, status text, audit_id uuid, idempotent_replay boolean)
language plpgsql
security invoker
set search_path = public
as $function$
declare
  version_row public.voice_knowledge_versions%rowtype;
  audit_row public.knowledge_review_audit%rowtype;
  clean_decision text := lower(btrim(coalesce(p_decision, '')));
  clean_reviewer text := left(btrim(coalesce(p_reviewer, '')), 200);
  clean_note text := left(btrim(coalesce(p_note, '')), 2000);
  clean_key text := left(btrim(coalesce(p_idempotency_key, '')), 200);
  request_fingerprint text;
  next_status text;
  reasons text[] := '{}'::text[];
  chunk_count integer := 0;
  email_retired_count integer := 0;
  eligibility jsonb;
begin
  if clean_decision not in ('approve', 'request_changes', 'retire') then
    raise exception 'invalid voice knowledge review decision';
  end if;
  if char_length(clean_reviewer) < 2 then
    raise exception 'reviewer identity is required';
  end if;
  if char_length(clean_note) < 8 then
    raise exception 'review note must contain at least 8 characters';
  end if;
  if char_length(clean_key) < 16 then
    raise exception 'idempotency key is required';
  end if;

  request_fingerprint := md5(concat_ws('|', p_version_id::text, clean_decision, clean_reviewer, clean_note));
  perform pg_advisory_xact_lock(hashtext('knowledge-review:' || clean_key));

  select audit.*
    into audit_row
  from public.knowledge_review_audit as audit
  where audit.idempotency_key = clean_key;

  if found then
    if audit_row.request_hash <> request_fingerprint or audit_row.review_scope <> 'global' then
      raise exception 'idempotency key was already used for another knowledge review request';
    end if;
    select existing.article_id
      into version_row.article_id
    from public.voice_knowledge_versions as existing
    where existing.id = audit_row.version_id;
    return query select audit_row.version_id, version_row.article_id, audit_row.new_status,
      audit_row.id, true;
    return;
  end if;

  select version.*
    into version_row
  from public.voice_knowledge_versions as version
  where version.id = p_version_id
  for update;

  if not found then
    raise exception 'voice knowledge version not found';
  end if;

  if clean_decision = 'approve' then
    select count(*)::integer into chunk_count
    from public.voice_knowledge_chunks as chunk
    where chunk.version_id = p_version_id and nullif(btrim(chunk.content), '') is not null;
    if version_row.status not in ('draft', 'review', 'approved') then
      reasons := array_append(reasons, 'invalid_status_transition');
    end if;
    if version_row.risk_class = 'restricted' then
      reasons := array_append(reasons, 'restricted_knowledge');
    end if;
    if nullif(btrim(coalesce(version_row.content_hash, '')), '') is null then
      reasons := array_append(reasons, 'content_hash_missing');
    end if;
    if jsonb_typeof(version_row.source_refs) <> 'array'
       or jsonb_array_length(version_row.source_refs) = 0 then
      reasons := array_append(reasons, 'verified_source_missing');
    end if;
    if chunk_count = 0 or chunk_count > 20 then
      reasons := array_append(reasons, 'knowledge_chunks_invalid');
    end if;
    if cardinality(reasons) > 0 then
      raise exception 'knowledge version is not eligible for approval: %', to_jsonb(reasons);
    end if;
    next_status := 'approved';

    update public.voice_knowledge_versions as other_version
    set status = 'retired', updated_at = now()
    where other_version.article_id = version_row.article_id
      and other_version.id <> p_version_id
      and other_version.status = 'approved';

    update public.email_support_knowledge_approvals as email_approval
    set status = 'retired',
        reviewed_by = clean_reviewer,
        review_note = 'Automatisch entzogen: Eine neuere Wissensversion wurde allgemein freigegeben.',
        reviewed_at = now(),
        updated_at = now()
    where email_approval.version_id in (
      select other_version.id
      from public.voice_knowledge_versions as other_version
      where other_version.article_id = version_row.article_id
        and other_version.id <> p_version_id
    )
      and email_approval.status = 'approved';
    get diagnostics email_retired_count = row_count;
  elsif clean_decision = 'request_changes' then
    next_status := 'draft';
  else
    next_status := 'retired';
  end if;

  update public.voice_knowledge_versions as version
  set status = next_status,
      reviewed_by = clean_reviewer,
      reviewed_at = now(),
      updated_at = now()
  where version.id = p_version_id;

  if next_status <> 'approved' then
    update public.email_support_knowledge_approvals
    set status = 'retired',
        reviewed_by = clean_reviewer,
        review_note = clean_note,
        reviewed_at = now(),
        updated_at = now()
    where version_id = p_version_id
      and status = 'approved';
    get diagnostics email_retired_count = row_count;
  end if;

  eligibility := jsonb_build_object(
    'version', 'global-knowledge-review-v2',
    'chunk_count', chunk_count,
    'verified_source_present', jsonb_typeof(version_row.source_refs) = 'array'
      and jsonb_array_length(version_row.source_refs) > 0,
    'email_approvals_auto_retired', email_retired_count
  );

  insert into public.knowledge_review_audit (
    version_id, review_scope, idempotency_key, request_hash, decision,
    previous_status, new_status, reviewer, review_note, eligibility_snapshot
  ) values (
    p_version_id, 'global', clean_key, request_fingerprint, clean_decision,
    version_row.status, next_status, clean_reviewer, clean_note, eligibility
  )
  returning * into audit_row;

  return query select p_version_id, version_row.article_id, next_status,
    audit_row.id, false;
end;
$function$;

revoke all on function public.review_voice_knowledge_version_v2(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.review_voice_knowledge_version_v2(uuid, text, text, text, text)
  to service_role;
revoke all on function public.review_voice_knowledge_version(uuid, text, text)
  from service_role;

create or replace function public.review_email_support_knowledge_v1(
  p_version_id uuid,
  p_decision text,
  p_reviewer text,
  p_note text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $function$
declare
  version_row public.voice_knowledge_versions%rowtype;
  approval_row public.email_support_knowledge_approvals%rowtype;
  audit_row public.knowledge_review_audit%rowtype;
  clean_decision text := lower(btrim(coalesce(p_decision, '')));
  clean_reviewer text := left(btrim(coalesce(p_reviewer, '')), 200);
  clean_note text := left(btrim(coalesce(p_note, '')), 2000);
  clean_key text := left(btrim(coalesce(p_idempotency_key, '')), 200);
  request_fingerprint text;
  next_status text;
  previous_status text := 'pending';
  eligibility jsonb;
begin
  if clean_decision not in ('approve', 'reject', 'retire') then
    raise exception 'invalid email knowledge review decision';
  end if;
  if char_length(clean_reviewer) < 2 then
    raise exception 'reviewer identity is required';
  end if;
  if char_length(clean_note) < 8 then
    raise exception 'review note must contain at least 8 characters';
  end if;
  if char_length(clean_key) < 16 then
    raise exception 'idempotency key is required';
  end if;

  request_fingerprint := md5(concat_ws('|', p_version_id::text, clean_decision, clean_reviewer, clean_note));
  perform pg_advisory_xact_lock(hashtext('email-knowledge-review:' || clean_key));

  select audit.*
    into audit_row
  from public.knowledge_review_audit as audit
  where audit.idempotency_key = clean_key;

  if found then
    if audit_row.request_hash <> request_fingerprint or audit_row.review_scope <> 'email_drafting' then
      raise exception 'idempotency key was already used for another email knowledge review request';
    end if;
    return jsonb_build_object(
      'updated', false,
      'idempotent_replay', true,
      'version_id', audit_row.version_id,
      'email_review_status', audit_row.new_status,
      'audit_id', audit_row.id
    );
  end if;

  select version.*
    into version_row
  from public.voice_knowledge_versions as version
  where version.id = p_version_id
  for update;

  if not found then
    raise exception 'voice knowledge version not found';
  end if;

  select approval.*
    into approval_row
  from public.email_support_knowledge_approvals as approval
  where approval.version_id = p_version_id
  for update;
  if found then
    previous_status := approval_row.status;
  end if;

  eligibility := public.get_email_support_knowledge_eligibility_v1(p_version_id);
  if clean_decision = 'approve' and coalesce((eligibility->>'eligible')::boolean, false) is not true then
    raise exception 'knowledge is not eligible for customer email drafts: %', eligibility->'blocked_reasons';
  end if;

  next_status := case clean_decision
    when 'approve' then 'approved'
    when 'reject' then 'rejected'
    else 'retired'
  end;

  insert into public.email_support_knowledge_approvals (
    version_id, status, approved_content_hash, reviewed_by, review_note, reviewed_at, updated_at
  ) values (
    p_version_id,
    next_status,
    case when next_status = 'approved' then version_row.content_hash else null end,
    clean_reviewer,
    clean_note,
    now(),
    now()
  )
  on conflict (version_id) do update
  set status = excluded.status,
      approved_content_hash = excluded.approved_content_hash,
      reviewed_by = excluded.reviewed_by,
      review_note = excluded.review_note,
      reviewed_at = excluded.reviewed_at,
      updated_at = excluded.updated_at;

  insert into public.knowledge_review_audit (
    version_id, review_scope, idempotency_key, request_hash, decision,
    previous_status, new_status, reviewer, review_note, eligibility_snapshot
  ) values (
    p_version_id, 'email_drafting', clean_key, request_fingerprint, clean_decision,
    previous_status, next_status, clean_reviewer, clean_note, eligibility
  )
  returning * into audit_row;

  return jsonb_build_object(
    'updated', true,
    'idempotent_replay', false,
    'version_id', p_version_id,
    'email_review_status', next_status,
    'audit_id', audit_row.id,
    'eligibility', eligibility
  );
end;
$function$;

revoke all on function public.review_email_support_knowledge_v1(uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.review_email_support_knowledge_v1(uuid, text, text, text, text)
  to service_role;

-- Preserve the explicitly user-authorized starter knowledge while placing it
-- behind the new independent email gate. Future versions receive no backfill.
insert into public.email_support_knowledge_approvals (
  version_id, status, approved_content_hash, reviewed_by, review_note, reviewed_at, updated_at
)
select
  version.id,
  'approved',
  version.content_hash,
  coalesce(nullif(btrim(version.reviewed_by), ''), 'legacy-human-review'),
  'Bestandsfreigabe aus der dokumentierten E-Mail-Wissensfreigabe übernommen.',
  coalesce(version.reviewed_at, now()),
  now()
from public.voice_knowledge_versions as version
where version.status = 'approved'
  and 'email_drafting' = any(version.allowed_modes)
  and version.reviewed_by = 'daniel_klesse_user_authorized_2026-07-14'
  and version.risk_class <> 'restricted'
  and jsonb_typeof(version.source_refs) = 'array'
  and jsonb_array_length(version.source_refs) > 0
  and exists (
    select 1 from public.voice_knowledge_chunks as chunk
    where chunk.version_id = version.id
  )
on conflict (version_id) do nothing;

insert into public.knowledge_review_audit (
  version_id, review_scope, idempotency_key, request_hash, decision,
  previous_status, new_status, reviewer, review_note, eligibility_snapshot, created_at
)
select
  approval.version_id,
  'email_drafting',
  'legacy-email-gate:' || approval.version_id::text,
  md5('legacy-email-gate:' || approval.version_id::text),
  'legacy_backfill',
  'pending',
  'approved',
  approval.reviewed_by,
  approval.review_note,
  public.get_email_support_knowledge_eligibility_v1(approval.version_id),
  approval.reviewed_at
from public.email_support_knowledge_approvals as approval
where approval.status = 'approved'
on conflict (idempotency_key) do nothing;

create or replace function public.search_approved_support_knowledge(
  p_query text,
  p_limit integer default 6
)
returns table (
  article_id uuid,
  version_id uuid,
  chunk_id uuid,
  slug text,
  title text,
  content text,
  risk_class text,
  source_refs jsonb,
  rank real
)
language sql
stable
security invoker
set search_path = public
as $function$
  with search_terms as (
    select distinct token
    from regexp_split_to_table(
      regexp_replace(
        lower(left(trim(coalesce(p_query, '')), 240)),
        '[^[:alnum:]äöüß]+',
        ' ',
        'g'
      ),
      '\s+'
    ) as split_term(token)
    where char_length(token) >= 3
    limit 24
  ),
  search_query as (
    select websearch_to_tsquery(
      'german',
      coalesce(string_agg(token, ' OR ' order by token), '')
    ) as ts_query
    from search_terms
  )
  select
    article.id as article_id,
    version.id as version_id,
    chunk.id as chunk_id,
    article.slug,
    version.title,
    chunk.content,
    version.risk_class,
    version.source_refs,
    ts_rank_cd(chunk.search_vector, search_query.ts_query) as rank
  from public.voice_knowledge_chunks as chunk
  join public.voice_knowledge_versions as version on version.id = chunk.version_id
  join public.voice_knowledge_articles as article on article.id = version.article_id
  join public.email_support_knowledge_approvals as email_approval
    on email_approval.version_id = version.id
   and email_approval.status = 'approved'
   and email_approval.approved_content_hash = version.content_hash
  cross join search_query
  where numnode(search_query.ts_query) > 0
    and 'email_drafting' = any(version.allowed_modes)
    and version.status = 'approved'
    and version.risk_class <> 'restricted'
    and (version.valid_from is null or version.valid_from <= now())
    and (version.valid_until is null or version.valid_until > now())
    and chunk.search_vector @@ search_query.ts_query
  order by rank desc, email_approval.reviewed_at desc nulls last,
    version.reviewed_at desc nulls last, chunk.chunk_index asc
  limit least(greatest(coalesce(p_limit, 6), 1), 8);
$function$;

revoke all on function public.search_approved_support_knowledge(text, integer)
  from public, anon, authenticated;
grant execute on function public.search_approved_support_knowledge(text, integer)
  to service_role;

create or replace view public.voice_knowledge_review_overview
with (security_invoker = true)
as
select
  version.id,
  version.article_id,
  article.slug,
  version.version_number,
  version.title,
  version.content,
  version.status,
  version.allowed_modes,
  version.risk_class,
  version.source_refs,
  version.authored_by,
  version.reviewed_by,
  version.reviewed_at,
  version.updated_at,
  coalesce(email_approval.status, 'pending') as email_review_status,
  email_approval.reviewed_by as email_reviewed_by,
  email_approval.reviewed_at as email_reviewed_at,
  email_approval.review_note as email_review_note
from public.voice_knowledge_versions as version
join public.voice_knowledge_articles as article on article.id = version.article_id
left join public.email_support_knowledge_approvals as email_approval
  on email_approval.version_id = version.id;

revoke all on public.voice_knowledge_review_overview
  from public, anon, authenticated;
grant select on public.voice_knowledge_review_overview
  to service_role;

comment on view public.voice_knowledge_review_overview is
  'Internal review queue showing general and separate email-drafting approval state.';
