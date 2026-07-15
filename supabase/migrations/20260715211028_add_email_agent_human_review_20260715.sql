create or replace function public.review_email_agent_feedback(
  p_feedback_id bigint,
  p_decision text,
  p_note text default null,
  p_reviewer text default null
)
returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  updated_row public.email_agent_feedback%rowtype;
begin
  if p_decision not in ('approved', 'rejected', 'ignored') then
    raise exception 'decision must be approved, rejected, or ignored';
  end if;

  update public.email_agent_feedback
  set learning_status = p_decision,
      human_review_note = left(nullif(btrim(coalesce(p_note, '')), ''), 2000),
      human_reviewed_by = left(nullif(btrim(coalesce(p_reviewer, '')), ''), 200),
      human_reviewed_at = now(),
      updated_at = now()
  where id = p_feedback_id
    and is_valid = true
  returning * into updated_row;

  if not found then
    raise exception 'valid feedback row was not found';
  end if;

  return jsonb_build_object(
    'updated', true,
    'feedback_id', updated_row.id,
    'learning_status', updated_row.learning_status,
    'human_reviewed_at', updated_row.human_reviewed_at
  );
end;
$function$;

revoke all on function public.review_email_agent_feedback(bigint, text, text, text)
  from public, anon, authenticated;
grant execute on function public.review_email_agent_feedback(bigint, text, text, text)
  to service_role;

create or replace function public.get_email_agent_style_profile(
  p_channel text default null,
  p_category text default null,
  p_reply_length_class text default null
)
returns jsonb
language plpgsql
stable
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
      order by nullif(f.edit_summary->>'sent_words', '')::integer
    )::integer,
    coalesce(avg((f.edit_labels @> array['shortened']::text[])::integer), 0),
    coalesce(avg((f.edit_labels @> array['expanded']::text[])::integer), 0),
    coalesce(avg((f.edit_labels @> array['greeting_changed']::text[])::integer), 0),
    coalesce(avg((f.edit_labels @> array['closing_changed']::text[])::integer), 0)
  into sample_count, median_words, shortened_share, expanded_share,
       greeting_change_share, closing_change_share
  from public.email_agent_feedback f
  join public.email_agent_log l on l.message_id = f.source_message_id
  where f.is_valid = true
    and f.learning_status = 'approved'
    and f.collected_at >= now() - interval '90 days'
    and nullif(f.edit_summary->>'sent_words', '') is not null
    and not (f.edit_labels && array[
      'amount_changed', 'date_changed', 'attachment_reference_changed',
      'commitment_changed', 'internal_detail_removed', 'factual_correction'
    ]::text[])
    and (nullif(p_channel, '') is null or l.message_source = p_channel)
    and (nullif(p_category, '') is null or l.category = p_category)
    and (nullif(p_reply_length_class, '') is null or l.reply_length_class = p_reply_length_class);

  if sample_count >= 3 and median_words is not null then
    recommended_max_words := case coalesce(p_reply_length_class, 'simple')
      when 'ack_only' then greatest(8, least(80, median_words + 8))
      when 'complex' then greatest(60, least(360, median_words + 30))
      else greatest(25, least(180, median_words + 18))
    end;
  end if;

  return jsonb_build_object(
    'version', 'email-style-profile-v1',
    'eligible', sample_count >= 3,
    'approved_sample_count', sample_count,
    'window_days', 90,
    'channel', nullif(p_channel, ''),
    'category', nullif(p_category, ''),
    'reply_length_class', nullif(p_reply_length_class, ''),
    'median_sent_words', median_words,
    'recommended_max_words', recommended_max_words,
    'prefer_shorter', sample_count >= 3 and shortened_share >= 0.60,
    'shortened_share', round(shortened_share, 4),
    'expanded_share', round(expanded_share, 4),
    'greeting_change_share', round(greeting_change_share, 4),
    'closing_change_share', round(closing_change_share, 4),
    'facts_or_customer_content_included', false,
    'automatic_prompt_rewrite_allowed', false
  );
end;
$function$;

revoke all on function public.get_email_agent_style_profile(text, text, text)
  from public, anon, authenticated;
grant execute on function public.get_email_agent_style_profile(text, text, text)
  to service_role;

create or replace view public.email_agent_review_overview
with (security_invoker = true)
as
select
  l.id as log_id,
  l.created_at as draft_created_at,
  l.message_id as source_message_id,
  l.conversation_id,
  l.from_email,
  l.from_name,
  l.subject,
  l.message_source as channel,
  l.category,
  l.risk_level,
  l.reply_length_class,
  l.review_status,
  l.validation_reasons,
  l.draft_id,
  l.draft_body_text,
  l.context_snapshot,
  f.id as feedback_id,
  f.sent_message_id,
  f.sent_internet_message_id,
  f.sent_body_text,
  f.edit_ratio,
  f.edit_labels,
  f.change_profile,
  f.review_priority,
  f.learning_status,
  f.human_review_note,
  f.human_reviewed_by,
  f.human_reviewed_at,
  f.collected_at,
  coalesce(
    l.context_snapshot->'evidence_card',
    jsonb_build_object(
      'version', 'email-evidence-card-v1-fallback',
      'channel', coalesce(l.context_snapshot->>'channel', l.message_source, 'external_email'),
      'customer_match', jsonb_build_object(
        'matched', coalesce((l.context_snapshot#>>'{customer_context,matched}')::boolean, false),
        'basis', coalesce(l.context_snapshot#>>'{customer_context,match_basis}', 'sender_only'),
        'organization', l.context_snapshot#>>'{customer_context,organization_name}',
        'related_email_count', coalesce(jsonb_array_length(
          case when jsonb_typeof(l.context_snapshot#>'{customer_context,related_emails}') = 'array'
            then l.context_snapshot#>'{customer_context,related_emails}' else '[]'::jsonb end
        ), 0)
      ),
      'attachments', jsonb_build_object(
        'actual', coalesce(l.context_snapshot->'actual_attachments', '[]'::jsonb),
        'claimed_types', coalesce(l.context_snapshot->'attachment_claims', '[]'::jsonb),
        'missing_claimed', coalesce(l.context_snapshot->'missing_attachments', '[]'::jsonb)
      ),
      'commerce', jsonb_build_object(
        'resolver_version', l.context_snapshot->>'evidence_resolver_version',
        'selected_shopify_order', l.context_snapshot->'selected_shopify_order',
        'signed_offer', l.context_snapshot->'neontrip_offer',
        'financial_reconciliation', l.context_snapshot->'financial_reconciliation'
      ),
      'knowledge', jsonb_build_object(
        'matched_count', l.knowledge_match_count,
        'version_ids', to_jsonb(l.knowledge_version_ids)
      ),
      'safety', jsonb_build_object(
        'risk_level', l.risk_level,
        'reply_length_class', l.reply_length_class,
        'safe_fallback_used', coalesce((l.context_snapshot->>'safe_fallback_used')::boolean, false),
        'validation_reasons', to_jsonb(l.validation_reasons),
        'human_approval_required', true
      )
    )
  ) as evidence_card
from public.email_agent_log l
left join lateral (
  select f1.*
  from public.email_agent_feedback f1
  where f1.source_message_id = l.message_id
  order by f1.collected_at desc, f1.id desc
  limit 1
) f on true
where l.draft_created = true;

revoke all on public.email_agent_review_overview from public, anon, authenticated;
grant select on public.email_agent_review_overview to service_role;
