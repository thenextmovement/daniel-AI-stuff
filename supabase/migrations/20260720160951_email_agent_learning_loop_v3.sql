alter table public.email_agent_feedback
  add column if not exists review_reason_codes text[] not null default '{}'::text[];

alter table public.email_agent_learning_review_audit
  add column if not exists reason_codes text[] not null default '{}'::text[];

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.email_agent_feedback'::regclass
      and conname = 'email_agent_feedback_review_reason_codes_check'
  ) then
    alter table public.email_agent_feedback
      add constraint email_agent_feedback_review_reason_codes_check
      check (
        cardinality(review_reason_codes) <= 8
        and review_reason_codes <@ array[
          'too_long', 'too_short', 'wrong_tone', 'wrong_greeting', 'wrong_closing',
          'poor_structure', 'direct_answer_first', 'avoid_repetition', 'minor_formatting',
          'insufficient_research', 'factual_error', 'attachment_missed',
          'price_or_offer_error', 'unnecessary_internal_deferral',
          'missing_customer_question', 'unsupported_commitment', 'other'
        ]::text[]
      );
  end if;
end;
$$;

create table if not exists public.email_agent_improvement_candidates (
  id uuid primary key default gen_random_uuid(),
  feedback_id bigint not null unique references public.email_agent_feedback(id) on delete restrict,
  candidate_type text not null,
  status text not null default 'pending',
  reason_codes text[] not null,
  reviewer text not null,
  review_note text not null,
  contains_customer_content boolean not null default false,
  resolution_note text,
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_agent_improvement_candidates_type_check
    check (candidate_type in ('knowledge', 'resolver', 'policy', 'manual_review')),
  constraint email_agent_improvement_candidates_status_check
    check (status in ('pending', 'resolved', 'rejected')),
  constraint email_agent_improvement_candidates_reason_codes_check
    check (cardinality(reason_codes) between 1 and 8),
  constraint email_agent_improvement_candidates_reviewer_check
    check (char_length(btrim(reviewer)) between 2 and 200),
  constraint email_agent_improvement_candidates_note_check
    check (char_length(btrim(review_note)) between 8 and 2000),
  constraint email_agent_improvement_candidates_no_customer_content_check
    check (contains_customer_content = false),
  constraint email_agent_improvement_candidates_resolution_check
    check (
      status = 'pending'
      or (
        char_length(btrim(coalesce(resolution_note, ''))) between 8 and 2000
        and char_length(btrim(coalesce(resolved_by, ''))) between 2 and 200
        and resolved_at is not null
      )
    )
);

create index if not exists email_agent_improvement_candidates_queue_idx
  on public.email_agent_improvement_candidates (status, candidate_type, created_at desc);

alter table public.email_agent_improvement_candidates enable row level security;

drop policy if exists email_agent_improvement_candidates_service_role_all
  on public.email_agent_improvement_candidates;
create policy email_agent_improvement_candidates_service_role_all
  on public.email_agent_improvement_candidates
  for all to service_role using (true) with check (true);

revoke all on table public.email_agent_improvement_candidates
  from public, anon, authenticated;
grant select, insert, update on table public.email_agent_improvement_candidates
  to service_role;

comment on table public.email_agent_improvement_candidates is
  'Metadata-only queue for human-reviewed email-agent knowledge, resolver, and policy improvements. It never stores copied customer content and never changes prompts automatically.';

create or replace function public.review_email_agent_feedback_v3(
  p_feedback_id bigint,
  p_decision text,
  p_reason_codes text[],
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
  clean_reasons text[] := '{}'::text[];
  allowed_reasons constant text[] := array[
    'too_long', 'too_short', 'wrong_tone', 'wrong_greeting', 'wrong_closing',
    'poor_structure', 'direct_answer_first', 'avoid_repetition', 'minor_formatting',
    'insufficient_research', 'factual_error', 'attachment_missed',
    'price_or_offer_error', 'unnecessary_internal_deferral',
    'missing_customer_question', 'unsupported_commitment', 'other'
  ]::text[];
  content_or_process_reasons constant text[] := array[
    'insufficient_research', 'factual_error', 'attachment_missed',
    'price_or_offer_error', 'unnecessary_internal_deferral',
    'missing_customer_question', 'unsupported_commitment', 'other'
  ]::text[];
  request_fingerprint text;
  previous_status text;
  candidate_type_value text;
  candidate_id_value uuid;
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
  if p_reason_codes is null
     or cardinality(p_reason_codes) < 1
     or cardinality(p_reason_codes) > 8
     or not (p_reason_codes <@ allowed_reasons) then
    raise exception 'one to eight allowed review reason codes are required';
  end if;

  select coalesce(array_agg(reason order by reason), '{}'::text[])
    into clean_reasons
  from (
    select distinct btrim(value) as reason
    from unnest(p_reason_codes) as value
    where nullif(btrim(value), '') is not null
  ) normalized;

  if cardinality(clean_reasons) < 1 or cardinality(clean_reasons) > 8 then
    raise exception 'one to eight distinct review reason codes are required';
  end if;
  if clean_decision = 'approved' and clean_reasons && content_or_process_reasons then
    raise exception 'content, research, policy, or factual corrections cannot be approved for style learning';
  end if;

  request_fingerprint := md5(concat_ws(
    '|', p_feedback_id::text, clean_decision, array_to_string(clean_reasons, ','),
    clean_note, clean_reviewer
  ));
  perform pg_advisory_xact_lock(hashtext('email-learning-review-v3:' || clean_key));

  select audit.*
    into audit_row
  from public.email_agent_learning_review_audit as audit
  where audit.idempotency_key = clean_key;

  if found then
    if audit_row.request_hash <> request_fingerprint then
      raise exception 'idempotency key was already used for another review request';
    end if;
    select candidate.id
      into candidate_id_value
    from public.email_agent_improvement_candidates as candidate
    where candidate.feedback_id = audit_row.feedback_id;
    return jsonb_build_object(
      'updated', false,
      'idempotent_replay', true,
      'feedback_id', audit_row.feedback_id,
      'learning_status', audit_row.new_status,
      'reason_codes', to_jsonb(audit_row.reason_codes),
      'human_reviewed_at', audit_row.created_at,
      'audit_id', audit_row.id,
      'improvement_candidate_id', candidate_id_value
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
  if clean_decision = 'approved'
     and coalesce((eligibility->>'eligible')::boolean, false) is not true then
    raise exception 'feedback is not eligible for style learning: %', eligibility->'blocked_reasons';
  end if;

  previous_status := feedback_row.learning_status;

  update public.email_agent_feedback
  set learning_status = clean_decision,
      review_reason_codes = clean_reasons,
      human_review_note = clean_note,
      human_reviewed_by = clean_reviewer,
      human_reviewed_at = now(),
      updated_at = now()
  where id = p_feedback_id;

  insert into public.email_agent_learning_review_audit (
    feedback_id, idempotency_key, request_hash, decision, previous_status,
    new_status, reviewer, review_note, reason_codes, eligibility_snapshot
  ) values (
    p_feedback_id, clean_key, request_fingerprint, clean_decision, previous_status,
    clean_decision, clean_reviewer, clean_note, clean_reasons, eligibility
  )
  returning * into audit_row;

  if clean_reasons && content_or_process_reasons then
    candidate_type_value := case
      when 'factual_error' = any(clean_reasons) then 'knowledge'
      when clean_reasons && array['insufficient_research', 'attachment_missed', 'price_or_offer_error']::text[] then 'resolver'
      when clean_reasons && array['unnecessary_internal_deferral', 'missing_customer_question', 'unsupported_commitment']::text[] then 'policy'
      else 'manual_review'
    end;

    insert into public.email_agent_improvement_candidates (
      feedback_id, candidate_type, status, reason_codes, reviewer,
      review_note, contains_customer_content, updated_at
    ) values (
      p_feedback_id, candidate_type_value, 'pending', clean_reasons,
      clean_reviewer, clean_note, false, now()
    )
    on conflict (feedback_id) do update
    set candidate_type = excluded.candidate_type,
        status = 'pending',
        reason_codes = excluded.reason_codes,
        reviewer = excluded.reviewer,
        review_note = excluded.review_note,
        contains_customer_content = false,
        resolution_note = null,
        resolved_by = null,
        resolved_at = null,
        updated_at = now()
    returning id into candidate_id_value;
  end if;

  return jsonb_build_object(
    'updated', true,
    'idempotent_replay', false,
    'feedback_id', p_feedback_id,
    'learning_status', clean_decision,
    'reason_codes', to_jsonb(clean_reasons),
    'human_reviewed_at', audit_row.created_at,
    'audit_id', audit_row.id,
    'eligibility', eligibility,
    'improvement_candidate_id', candidate_id_value,
    'automatic_prompt_rewrite_allowed', false
  );
end;
$function$;

revoke all on function public.review_email_agent_feedback_v3(bigint, text, text[], text, text, text)
  from public, anon, authenticated;
grant execute on function public.review_email_agent_feedback_v3(bigint, text, text[], text, text, text)
  to service_role;

-- Force application callers onto the reason-coded, audited v3 review gate.
revoke all on function public.review_email_agent_feedback_v2(bigint, text, text, text, text)
  from service_role;

create or replace function public.get_email_agent_style_profile_v3(
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
  selected_scope text := 'global';
  sample_count integer := 0;
  median_words integer := null;
  median_paragraphs integer := null;
  shortened_share numeric := 0;
  expanded_share numeric := 0;
  greeting_change_share numeric := 0;
  closing_change_share numeric := 0;
  too_long_share numeric := 0;
  direct_first_share numeric := 0;
  repetition_share numeric := 0;
  viele_gruesse_share numeric := 0;
  beste_gruesse_share numeric := 0;
  recommended_max_words integer := null;
  recommended_max_paragraphs integer := null;
  preferred_closing text := null;
begin
  with eligible_feedback as (
    select
      feedback.*,
      matched_log.message_source,
      matched_log.category,
      matched_log.reply_length_class,
      matched_log.risk_level,
      greatest(1, least(8, coalesce(
        case
          when coalesce(feedback.edit_summary->>'sent_paragraphs', '') ~ '^[1-8]$'
            then (feedback.edit_summary->>'sent_paragraphs')::integer
          else null
        end,
        greatest(1, cardinality(regexp_split_to_array(btrim(feedback.sent_body_text), E'\\n[[:space:]]*\\n')) - 2)
      ))) as sent_paragraphs
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
      and not (feedback.review_reason_codes && array[
        'insufficient_research', 'factual_error', 'attachment_missed',
        'price_or_offer_error', 'unnecessary_internal_deferral',
        'missing_customer_question', 'unsupported_commitment', 'other'
      ]::text[])
  ), scopes as (
    select 'category'::text as scope_key, 1 as priority
    where nullif(p_channel, '') is not null and nullif(p_category, '') is not null
    union all
    select 'channel', 2
    where nullif(p_channel, '') is not null
    union all
    select 'global', 3
  ), selected as (
    select
      scope.scope_key,
      scope.priority,
      stats.*
    from scopes as scope
    cross join lateral (
      select
        count(*)::integer as sample_count,
        percentile_disc(0.5) within group (
          order by (feedback.edit_summary->>'sent_words')::integer
        )::integer as median_words,
        percentile_disc(0.5) within group (
          order by feedback.sent_paragraphs
        )::integer as median_paragraphs,
        coalesce(avg((feedback.edit_labels @> array['shortened']::text[])::integer), 0) as shortened_share,
        coalesce(avg((feedback.edit_labels @> array['expanded']::text[])::integer), 0) as expanded_share,
        coalesce(avg((feedback.edit_labels @> array['greeting_changed']::text[])::integer), 0) as greeting_change_share,
        coalesce(avg((feedback.edit_labels @> array['closing_changed']::text[])::integer), 0) as closing_change_share,
        coalesce(avg((feedback.review_reason_codes @> array['too_long']::text[])::integer), 0) as too_long_share,
        coalesce(avg((feedback.review_reason_codes @> array['direct_answer_first']::text[])::integer), 0) as direct_first_share,
        coalesce(avg((feedback.review_reason_codes @> array['avoid_repetition']::text[])::integer), 0) as repetition_share,
        coalesce(avg((feedback.sent_body_text ~* E'Viele Gr[uü][sß]e[[:space:]]*$')::integer), 0) as viele_gruesse_share,
        coalesce(avg((feedback.sent_body_text ~* E'Beste Gr[uü][sß]e[[:space:]]*$')::integer), 0) as beste_gruesse_share
      from eligible_feedback as feedback
      where (nullif(p_reply_length_class, '') is null or feedback.reply_length_class = p_reply_length_class)
        and (scope.scope_key = 'global' or feedback.message_source = p_channel)
        and (scope.scope_key <> 'category' or feedback.category = p_category)
    ) as stats
    order by (stats.sample_count >= 5) desc, scope.priority
    limit 1
  )
  select
    scope_key, selected.sample_count, selected.median_words, selected.median_paragraphs,
    selected.shortened_share, selected.expanded_share, selected.greeting_change_share,
    selected.closing_change_share, selected.too_long_share, selected.direct_first_share,
    selected.repetition_share, selected.viele_gruesse_share, selected.beste_gruesse_share
  into
    selected_scope, sample_count, median_words, median_paragraphs,
    shortened_share, expanded_share, greeting_change_share,
    closing_change_share, too_long_share, direct_first_share,
    repetition_share, viele_gruesse_share, beste_gruesse_share
  from selected;

  if sample_count >= 5 and median_words is not null then
    recommended_max_words := case coalesce(p_reply_length_class, 'simple')
      when 'ack_only' then greatest(8, least(80, median_words + 8))
      when 'complex' then greatest(60, least(360, median_words + 30))
      else greatest(25, least(180, median_words + 18))
    end;
    recommended_max_paragraphs := case coalesce(p_reply_length_class, 'simple')
      when 'ack_only' then greatest(1, least(2, coalesce(median_paragraphs, 1)))
      when 'complex' then greatest(2, least(5, coalesce(median_paragraphs, 3) + 1))
      else greatest(1, least(3, coalesce(median_paragraphs, 2)))
    end;
    preferred_closing := case
      when beste_gruesse_share >= 0.60 then 'Beste Grüße'
      when viele_gruesse_share >= 0.60 then 'Viele Grüße'
      else null
    end;
  end if;

  return jsonb_build_object(
    'version', 'email-style-profile-v3-human-gated',
    'eligible', sample_count >= 5,
    'minimum_approved_samples', 5,
    'approved_sample_count', sample_count,
    'window_days', 90,
    'scope', selected_scope,
    'channel', nullif(p_channel, ''),
    'category', nullif(p_category, ''),
    'reply_length_class', nullif(p_reply_length_class, ''),
    'median_sent_words', median_words,
    'median_sent_paragraphs', median_paragraphs,
    'recommended_max_words', recommended_max_words,
    'recommended_max_paragraphs', recommended_max_paragraphs,
    'preferred_closing', preferred_closing,
    'prefer_shorter', sample_count >= 5 and (shortened_share >= 0.60 or too_long_share >= 0.40),
    'prefer_direct_answer', sample_count >= 5 and direct_first_share >= 0.40,
    'avoid_restatement', sample_count >= 5 and repetition_share >= 0.40,
    'shortened_share', round(shortened_share, 4),
    'expanded_share', round(expanded_share, 4),
    'greeting_change_share', round(greeting_change_share, 4),
    'closing_change_share', round(closing_change_share, 4),
    'facts_or_customer_content_included', false,
    'fact_learning_allowed', false,
    'automatic_prompt_rewrite_allowed', false,
    'human_approval_required', true
  );
end;
$function$;

revoke all on function public.get_email_agent_style_profile_v3(text, text, text)
  from public, anon, authenticated;
grant execute on function public.get_email_agent_style_profile_v3(text, text, text)
  to service_role;

create or replace view public.email_agent_learning_review_overview_v3
with (security_invoker = true)
as
select
  overview.*,
  coalesce(feedback.review_reason_codes, '{}'::text[]) as review_reason_codes,
  candidate.id as improvement_candidate_id,
  candidate.candidate_type as improvement_candidate_type,
  candidate.status as improvement_candidate_status,
  candidate.created_at as improvement_candidate_created_at
from public.email_agent_review_overview as overview
left join public.email_agent_feedback as feedback
  on feedback.id = overview.feedback_id
left join public.email_agent_improvement_candidates as candidate
  on candidate.feedback_id = overview.feedback_id;

revoke all on public.email_agent_learning_review_overview_v3
  from public, anon, authenticated;
grant select on public.email_agent_learning_review_overview_v3
  to service_role;

comment on view public.email_agent_learning_review_overview_v3 is
  'Internal human-review projection with reason-coded style learning and metadata-only improvement routing.';

create or replace function public.get_email_agent_learning_quality_v3()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $function$
  with feedback_counts as (
    select
      count(*) filter (where is_valid = true)::integer as total,
      count(*) filter (where is_valid = true and learning_status = 'pending')::integer as pending,
      count(*) filter (where is_valid = true and learning_status = 'approved')::integer as approved,
      count(*) filter (where is_valid = true and learning_status = 'rejected')::integer as rejected,
      count(*) filter (where is_valid = true and learning_status = 'ignored')::integer as ignored
    from public.email_agent_feedback
  ), reason_counts as (
    select coalesce(jsonb_object_agg(reason, reason_count), '{}'::jsonb) as values
    from (
      select reason, count(*)::integer as reason_count
      from public.email_agent_feedback as feedback
      cross join lateral unnest(feedback.review_reason_codes) as reason
      where feedback.is_valid = true
      group by reason
      order by reason
    ) grouped
  ), improvement_counts as (
    select
      count(*) filter (where status = 'pending')::integer as pending,
      count(*) filter (where status = 'pending' and candidate_type = 'knowledge')::integer as knowledge,
      count(*) filter (where status = 'pending' and candidate_type = 'resolver')::integer as resolver,
      count(*) filter (where status = 'pending' and candidate_type = 'policy')::integer as policy,
      count(*) filter (where status = 'pending' and candidate_type = 'manual_review')::integer as manual_review
    from public.email_agent_improvement_candidates
  ), quality_counts as (
    select
      count(*)::integer as evaluated,
      count(*) filter (
        where coalesce((context_snapshot#>>'{quality_gate,passed}')::boolean, false) = true
      )::integer as passed,
      count(*) filter (
        where jsonb_array_length(
          case when jsonb_typeof(context_snapshot#>'{quality_gate,soft_flags}') = 'array'
            then context_snapshot#>'{quality_gate,soft_flags}' else '[]'::jsonb end
        ) > 0
      )::integer as soft_flagged
    from public.email_agent_log
    where created_at >= now() - interval '7 days'
      and context_snapshot#>>'{quality_gate,version}' = 'email-draft-quality-gate-v3'
  )
  select jsonb_build_object(
    'version', 'email-agent-learning-quality-v3',
    'feedback', jsonb_build_object(
      'total', feedback_counts.total,
      'pending', feedback_counts.pending,
      'approved', feedback_counts.approved,
      'rejected', feedback_counts.rejected,
      'ignored', feedback_counts.ignored,
      'reason_counts', reason_counts.values
    ),
    'style_profile', public.get_email_agent_style_profile_v3(null, null, null),
    'improvement_candidates', jsonb_build_object(
      'pending', improvement_counts.pending,
      'knowledge', improvement_counts.knowledge,
      'resolver', improvement_counts.resolver,
      'policy', improvement_counts.policy,
      'manual_review', improvement_counts.manual_review,
      'customer_content_stored', false
    ),
    'quality_gate_7d', jsonb_build_object(
      'evaluated', quality_counts.evaluated,
      'passed', quality_counts.passed,
      'soft_flagged', quality_counts.soft_flagged
    ),
    'automatic_prompt_rewrite_allowed', false,
    'fact_learning_allowed', false,
    'automatic_send_allowed', false,
    'human_approval_required', true
  )
  from feedback_counts, reason_counts, improvement_counts, quality_counts;
$function$;

revoke all on function public.get_email_agent_learning_quality_v3()
  from public, anon, authenticated;
grant execute on function public.get_email_agent_learning_quality_v3()
  to service_role;

comment on function public.get_email_agent_learning_quality_v3() is
  'Aggregate, PII-free operational metrics for the human-gated email learning loop.';
