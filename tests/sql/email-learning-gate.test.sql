set role service_role;

insert into public.email_agent_log (
  message_id, draft_created, message_source, category, reply_length_class, risk_level, draft_body_text
) values
  ('message-safe', true, 'external_email', 'acknowledgement', 'ack_only', 'low', 'Hallo Anna, vielen Dank. Viele Grüße'),
  ('message-blocked', true, 'external_email', 'pricing', 'complex', 'high', 'Hallo Anna, der Preis beträgt 100 Euro. Viele Grüße');

insert into public.email_agent_feedback (
  source_message_id, sent_message_id, draft_body_hash, sent_body_hash, sent_body_text,
  edit_ratio, edit_summary, edit_labels, change_profile, review_priority
) values
  ('message-safe', 'sent-safe', 'draft-safe-hash', 'sent-safe-hash', 'Hallo Anna, danke. Viele Grüße',
   0.15, '{"sent_words":5}'::jsonb, array['shortened']::text[], '{}'::jsonb, 'normal'),
  ('message-blocked', 'sent-blocked', 'draft-blocked-hash', 'sent-blocked-hash', 'Hallo Anna, der Preis beträgt 120 Euro. Viele Grüße',
   0.25, '{"sent_words":9}'::jsonb, array['amount_changed','factual_correction']::text[], '{}'::jsonb, 'high');

do $$
declare
  safe_id bigint;
  blocked_id bigint;
  safe_eligibility jsonb;
  blocked_eligibility jsonb;
  review_result jsonb;
  replay_result jsonb;
  blocked_failed boolean := false;
begin
  select id into safe_id from public.email_agent_feedback where sent_message_id = 'sent-safe';
  select id into blocked_id from public.email_agent_feedback where sent_message_id = 'sent-blocked';
  safe_eligibility := public.get_email_agent_feedback_learning_eligibility_v1(safe_id);
  blocked_eligibility := public.get_email_agent_feedback_learning_eligibility_v1(blocked_id);

  if (safe_eligibility->>'eligible')::boolean is not true then
    raise exception 'safe feedback should be eligible: %', safe_eligibility;
  end if;
  if (blocked_eligibility->>'eligible')::boolean is not false
     or not (blocked_eligibility->'blocked_reasons' ? 'fact_or_intent_change_detected')
     or not (blocked_eligibility->'blocked_reasons' ? 'high_risk_case') then
    raise exception 'blocked feedback reasons missing: %', blocked_eligibility;
  end if;

  review_result := public.review_email_agent_feedback_v2(
    safe_id, 'approved', 'Als knappe Stilvorlage geprüft.', 'Fabienne Test',
    '11111111-1111-4111-8111-111111111111'
  );
  replay_result := public.review_email_agent_feedback_v2(
    safe_id, 'approved', 'Als knappe Stilvorlage geprüft.', 'Fabienne Test',
    '11111111-1111-4111-8111-111111111111'
  );
  if (review_result->>'updated')::boolean is not true
     or (replay_result->>'idempotent_replay')::boolean is not true then
    raise exception 'feedback review idempotency failed: %, %', review_result, replay_result;
  end if;

  begin
    perform public.review_email_agent_feedback_v2(
      blocked_id, 'approved', 'Darf wegen Faktenänderung nicht lernen.', 'Fabienne Test',
      '22222222-2222-4222-8222-222222222222'
    );
  exception when others then
    blocked_failed := true;
  end;
  if blocked_failed is not true then
    raise exception 'blocked feedback approval unexpectedly succeeded';
  end if;
end;
$$;

insert into public.voice_knowledge_articles (id, slug, created_by)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'email-test-knowledge', 'fixture');

insert into public.voice_knowledge_versions (
  id, article_id, version_number, title, content, status, allowed_modes, risk_class,
  source_refs, content_hash, authored_by
) values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  1,
  'Geprüfte Montageauskunft',
  'Die konkrete Montageart muss immer anhand des aktuellen Angebots geprüft werden.',
  'review',
  array['email_drafting']::text[],
  'standard',
  '[{"label":"Interne Produktfreigabe"}]'::jsonb,
  'fixture-content-hash-v1',
  'Fixture Autor'
);

insert into public.voice_knowledge_chunks (version_id, chunk_index, content)
values (
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  0,
  'Die konkrete Montageart muss immer anhand des aktuellen Angebots geprüft werden.'
);

do $$
declare
  global_result record;
  email_result jsonb;
  email_replay jsonb;
  match_count integer;
begin
  select * into global_result
  from public.review_voice_knowledge_version_v2(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'approve',
    'Fabienne Test',
    'Inhalt und Quelle sind nachvollziehbar geprüft.',
    '33333333-3333-4333-8333-333333333333'
  );
  if global_result.status <> 'approved' or global_result.idempotent_replay is not false then
    raise exception 'global knowledge approval failed: %', global_result;
  end if;

  email_result := public.review_email_support_knowledge_v1(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'approve',
    'Fabienne Test',
    'Für E-Mail-Entwürfe mit Human Gate geprüft.',
    '44444444-4444-4444-8444-444444444444'
  );
  email_replay := public.review_email_support_knowledge_v1(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'approve',
    'Fabienne Test',
    'Für E-Mail-Entwürfe mit Human Gate geprüft.',
    '44444444-4444-4444-8444-444444444444'
  );
  if email_result->>'email_review_status' <> 'approved'
     or (email_replay->>'idempotent_replay')::boolean is not true then
    raise exception 'email knowledge approval failed: %, %', email_result, email_replay;
  end if;

  select count(*) into match_count
  from public.search_approved_support_knowledge('Montageart Angebot', 6);
  if match_count < 1 then
    raise exception 'approved email knowledge was not retrievable';
  end if;

  update public.voice_knowledge_versions
  set content_hash = 'changed-after-email-approval'
  where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  select count(*) into match_count
  from public.search_approved_support_knowledge('Montageart Angebot', 6);
  if match_count <> 0 then
    raise exception 'content hash drift should fail closed';
  end if;
end;
$$;

reset role;

select
  (select count(*) from public.email_agent_learning_review_audit) as feedback_audit_rows,
  (select count(*) from public.knowledge_review_audit) as knowledge_audit_rows,
  (select count(*) from public.email_support_knowledge_approvals where status = 'approved') as approved_email_knowledge_rows;
