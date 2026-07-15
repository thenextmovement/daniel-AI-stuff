alter table public.email_agent_feedback
  add column if not exists sent_internet_message_id text,
  add column if not exists sent_body_text text,
  add column if not exists edit_labels text[] not null default '{}'::text[],
  add column if not exists change_profile jsonb not null default '{}'::jsonb,
  add column if not exists review_priority text not null default 'normal',
  add column if not exists learning_status text not null default 'pending',
  add column if not exists human_review_note text,
  add column if not exists human_reviewed_by text,
  add column if not exists human_reviewed_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.email_agent_feedback'::regclass
      and conname = 'email_agent_feedback_review_priority_check'
  ) then
    alter table public.email_agent_feedback
      add constraint email_agent_feedback_review_priority_check
      check (review_priority in ('low', 'normal', 'high'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.email_agent_feedback'::regclass
      and conname = 'email_agent_feedback_learning_status_check'
  ) then
    alter table public.email_agent_feedback
      add constraint email_agent_feedback_learning_status_check
      check (learning_status in ('pending', 'approved', 'rejected', 'ignored'));
  end if;
end $$;

create index if not exists email_agent_feedback_learning_queue_idx
  on public.email_agent_feedback (learning_status, review_priority, collected_at desc);

create index if not exists email_agent_feedback_sent_internet_message_idx
  on public.email_agent_feedback (sent_internet_message_id)
  where sent_internet_message_id is not null;

create or replace function public.record_email_agent_feedback_v2(
  p_source_message_id text,
  p_conversation_id text,
  p_draft_id text,
  p_sent_message_id text,
  p_sent_internet_message_id text,
  p_draft_body_hash text,
  p_sent_body_hash text,
  p_sent_body_text text,
  p_edit_ratio numeric,
  p_edit_summary jsonb,
  p_edit_labels text[],
  p_change_profile jsonb,
  p_review_priority text
)
returns jsonb
language plpgsql
set search_path = public
as $function$
declare
  review_value text;
  clean_labels text[];
  clean_priority text;
  affected_id bigint;
begin
  if nullif(btrim(coalesce(p_source_message_id, '')), '') is null then
    raise exception 'source_message_id is required';
  end if;
  if nullif(btrim(coalesce(p_sent_message_id, '')), '') is null then
    raise exception 'sent_message_id is required';
  end if;
  if p_edit_ratio is null or p_edit_ratio < 0 or p_edit_ratio > 1 then
    raise exception 'edit_ratio must be between 0 and 1';
  end if;
  if not exists (
    select 1 from public.email_agent_log
    where message_id = p_source_message_id
      and draft_created = true
      and draft_body_text is not null
  ) then
    raise exception 'matching AI draft was not found';
  end if;

  review_value := case when p_edit_ratio <= 0.02 then 'sent_unchanged' else 'sent_edited' end;
  clean_priority := case when p_review_priority in ('low', 'normal', 'high')
    then p_review_priority else 'normal' end;

  select coalesce(array_agg(label order by label), '{}'::text[])
  into clean_labels
  from (
    select distinct label
    from unnest(coalesce(p_edit_labels, '{}'::text[])) as label
    where label in (
      'unchanged', 'minor_formatting', 'shortened', 'expanded', 'greeting_changed',
      'closing_changed', 'question_added', 'question_removed', 'amount_changed',
      'date_changed', 'attachment_reference_changed', 'commitment_changed',
      'internal_detail_removed', 'tone_changed', 'factual_correction',
      'manual_rewrite', 'whatsapp_style', 'needs_human_review'
    )
    limit 20
  ) allowed;

  update public.email_agent_feedback
  set source_message_id = p_source_message_id,
      conversation_id = nullif(p_conversation_id, ''),
      draft_id = nullif(p_draft_id, ''),
      sent_message_id = p_sent_message_id,
      sent_internet_message_id = nullif(p_sent_internet_message_id, ''),
      draft_body_hash = nullif(p_draft_body_hash, ''),
      sent_body_hash = nullif(p_sent_body_hash, ''),
      sent_body_text = left(nullif(p_sent_body_text, ''), 6000),
      edit_ratio = p_edit_ratio,
      edit_summary = coalesce(p_edit_summary, '{}'::jsonb),
      edit_labels = clean_labels,
      change_profile = coalesce(p_change_profile, '{}'::jsonb),
      review_priority = clean_priority,
      is_valid = true,
      invalid_reason = null,
      updated_at = now()
  where sent_message_id = p_sent_message_id
     or (
       nullif(p_sent_internet_message_id, '') is not null
       and sent_internet_message_id = p_sent_internet_message_id
     )
  returning id into affected_id;

  if affected_id is null then
    insert into public.email_agent_feedback (
      source_message_id, conversation_id, draft_id, sent_message_id,
      sent_internet_message_id, draft_body_hash, sent_body_hash, sent_body_text,
      edit_ratio, edit_summary, edit_labels, change_profile, review_priority
    ) values (
      p_source_message_id, nullif(p_conversation_id, ''), nullif(p_draft_id, ''), p_sent_message_id,
      nullif(p_sent_internet_message_id, ''), nullif(p_draft_body_hash, ''),
      nullif(p_sent_body_hash, ''), left(nullif(p_sent_body_text, ''), 6000),
      p_edit_ratio, coalesce(p_edit_summary, '{}'::jsonb), clean_labels,
      coalesce(p_change_profile, '{}'::jsonb), clean_priority
    )
    returning id into affected_id;
  end if;

  update public.email_agent_log
  set review_status = review_value,
      final_message_id = p_sent_message_id,
      final_body_hash = nullif(p_sent_body_hash, ''),
      edit_ratio = p_edit_ratio,
      reviewed_at = now(),
      updated_at = now()
  where message_id = p_source_message_id;

  return jsonb_build_object(
    'recorded', true,
    'feedback_id', affected_id,
    'review_status', review_value,
    'review_priority', clean_priority,
    'edit_labels', to_jsonb(clean_labels)
  );
end;
$function$;

revoke all on function public.record_email_agent_feedback_v2(
  text, text, text, text, text, text, text, text, numeric, jsonb, text[], jsonb, text
) from public, anon, authenticated;
grant execute on function public.record_email_agent_feedback_v2(
  text, text, text, text, text, text, text, text, numeric, jsonb, text[], jsonb, text
) to service_role;

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
  jsonb_build_object(
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
    'attachments', coalesce(l.context_snapshot->'actual_attachments', '[]'::jsonb),
    'claimed_attachments', coalesce(l.context_snapshot->'attachment_claims', '[]'::jsonb),
    'missing_attachments', coalesce(l.context_snapshot->'missing_attachments', '[]'::jsonb),
    'shopify_order', l.context_snapshot->'selected_shopify_order',
    'financial_reconciliation', l.context_snapshot->'financial_reconciliation',
    'knowledge_count', l.knowledge_match_count,
    'validation_reasons', to_jsonb(l.validation_reasons),
    'safe_fallback', coalesce((l.context_snapshot->>'safe_fallback_used')::boolean, false)
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

comment on view public.email_agent_review_overview is
  'Internal-only evidence and human-review queue for AI-generated Outlook drafts. Never exposed in customer-facing drafts.';
