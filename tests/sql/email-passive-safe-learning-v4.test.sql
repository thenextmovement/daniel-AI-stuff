set role service_role;

insert into public.email_agent_log (
  message_id, draft_created, message_source, category, reply_length_class,
  risk_level, draft_body_text, context_snapshot
)
select
  'passive-safe-' || value,
  true,
  'whatsapp_relay',
  'passive_test',
  'simple',
  'low',
  'Hallo Anna,' || E'\n\n' || 'vielen Dank. Der Vorgang ist erledigt.' || E'\n\n' || 'Viele Grüße',
  '{}'::jsonb
from generate_series(1, 3) as value;

insert into public.email_agent_feedback (
  source_message_id, sent_message_id, draft_body_hash, sent_body_hash,
  sent_body_text, edit_ratio, edit_summary, edit_labels, change_profile,
  review_priority
)
select
  'passive-safe-' || value,
  'passive-safe-sent-' || value,
  'passive-draft-' || value,
  'passive-sent-' || value,
  'Hallo Anna,' || E'\n\n' || 'Der Vorgang ist erledigt.' || E'\n\n' || 'Viele Grüße',
  0.20,
  jsonb_build_object('sent_words', 62 + value, 'sent_paragraphs', 1),
  array['shortened']::text[],
  jsonb_build_object('semantic_deltas', jsonb_build_object(
    'question_delta', 0,
    'amounts_changed', false,
    'dates_changed', false,
    'attachment_references_changed', false,
    'commitment_changed', false,
    'internal_detail_removed', false
  )),
  'low'
from generate_series(1, 3) as value;

insert into public.email_agent_log (
  message_id, draft_created, message_source, category, reply_length_class,
  risk_level, draft_body_text, context_snapshot
) values
  ('passive-deferral', true, 'whatsapp_relay', 'passive_test', 'simple', 'low',
   'Hallo Anna, wir klären das intern und melden uns später. Viele Grüße', '{}'::jsonb),
  ('passive-amount', true, 'whatsapp_relay', 'passive_test', 'simple', 'low',
   'Hallo Anna, der Betrag ist 100 Euro. Viele Grüße', '{}'::jsonb),
  ('passive-rejected', true, 'whatsapp_relay', 'passive_test', 'simple', 'low',
   'Hallo Anna, der Vorgang ist erledigt. Viele Grüße', '{}'::jsonb);

insert into public.email_agent_feedback (
  source_message_id, sent_message_id, draft_body_hash, sent_body_hash,
  sent_body_text, edit_ratio, edit_summary, edit_labels, change_profile,
  review_priority, learning_status
) values
  ('passive-deferral', 'passive-deferral-sent', 'pd1', 'ps1',
   'Hallo Anna, wir klären das intern und melden uns später. Viele Grüße', 0.10,
   '{"sent_words":60,"sent_paragraphs":1}'::jsonb, array['minor_formatting']::text[], '{}'::jsonb, 'low', 'pending'),
  ('passive-amount', 'passive-amount-sent', 'pd2', 'ps2',
   'Hallo Anna, der Betrag ist 120 Euro. Viele Grüße', 0.10,
   '{"sent_words":60,"sent_paragraphs":1}'::jsonb, array['amount_changed']::text[],
   '{"semantic_deltas":{"question_delta":0,"amounts_changed":true}}'::jsonb, 'low', 'pending'),
  ('passive-rejected', 'passive-rejected-sent', 'pd3', 'ps3',
   'Hallo Anna, der Vorgang ist erledigt. Viele Grüße', 0.10,
   '{"sent_words":60,"sent_paragraphs":1}'::jsonb, array['minor_formatting']::text[], '{}'::jsonb, 'low', 'rejected');

do $$
declare
  profile jsonb;
  metrics jsonb;
begin
  profile := public.get_email_agent_style_profile_v4('whatsapp_relay', 'passive_test', 'simple');
  if profile->>'version' <> 'email-style-profile-v4-passive-safe'
     or profile->>'learning_mode' <> 'passive_deterministic'
     or (profile->>'eligible')::boolean is not true
     or (profile->>'safe_sample_count')::integer <> 3
     or (profile->>'automatic_sample_count')::integer <> 3
     or (profile->>'human_sample_count')::integer <> 0
     or (profile->>'recommended_max_words')::integer <> 74
     or (profile->>'recommended_max_paragraphs')::integer <> 1
     or (profile->>'manual_review_required_for_safe_style')::boolean is not false
     or (profile->>'automatic_send_allowed')::boolean is not false then
    raise exception 'unexpected passive style profile: %', profile;
  end if;

  metrics := public.get_email_agent_learning_quality_v4();
  if metrics->>'version' <> 'email-agent-learning-quality-v4'
     or (metrics#>>'{passive_learning,automatic_samples}')::integer < 3
     or (metrics#>>'{passive_learning,blocked_samples}')::integer < 3
     or (metrics->>'manual_review_required_for_safe_style')::boolean is not false
     or (metrics->>'customer_send_human_approval_required')::boolean is not true then
    raise exception 'unexpected passive learning metrics: %', metrics;
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'email_agent_auto_style_eligibility_v1'
      and column_name in ('draft_body_text', 'sent_body_text', 'body_preview')
  ) then
    raise exception 'passive eligibility view exposes customer content';
  end if;
  if (select count(*) from public.email_agent_auto_style_eligibility_v1
      where category = 'passive_test' and automatic_style_eligible = true) <> 3 then
    raise exception 'unsafe passive samples were not excluded';
  end if;
end;
$$;

reset role;

select
  public.get_email_agent_style_profile_v4('whatsapp_relay', 'passive_test', 'simple') as style_profile,
  public.get_email_agent_learning_quality_v4() as quality_metrics;
