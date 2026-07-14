drop function if exists public.record_email_agent_feedback(text, text, text, text, text, text, numeric, jsonb);
drop function if exists public.fail_email_agent_message(text, jsonb, boolean);
drop function if exists public.complete_email_agent_message(text, jsonb);
drop function if exists public.resolve_email_agent_customer_context(text, timestamptz, boolean, integer);
drop function if exists public.claim_email_agent_message(text, text, text, text, integer);

delete from public.voice_knowledge_chunks
where version_id in (
  select version.id
  from public.voice_knowledge_versions as version
  join public.voice_knowledge_articles as article on article.id = version.article_id
  where article.slug in (
    'email-support-attachment-evidence',
    'email-support-concise-replies',
    'email-support-production-commitments',
    'email-support-organization-context'
  )
  and version.authored_by = 'codex_from_user_authorized_policy'
);

delete from public.voice_knowledge_versions
where article_id in (
  select id from public.voice_knowledge_articles
  where slug in (
    'email-support-attachment-evidence',
    'email-support-concise-replies',
    'email-support-production-commitments',
    'email-support-organization-context'
  )
)
and authored_by = 'codex_from_user_authorized_policy';

delete from public.voice_knowledge_articles as article
where article.slug in (
  'email-support-attachment-evidence',
  'email-support-concise-replies',
  'email-support-production-commitments',
  'email-support-organization-context'
)
and not exists (
  select 1 from public.voice_knowledge_versions as version
  where version.article_id = article.id
);

drop table if exists public.email_agent_feedback;

drop index if exists public.email_agent_log_conversation_created_idx;
drop index if exists public.email_agent_log_review_status_created_idx;

alter table public.email_agent_log
  drop constraint if exists email_agent_log_edit_ratio_check,
  drop constraint if exists email_agent_log_review_status_check,
  drop constraint if exists email_agent_log_risk_level_check,
  drop constraint if exists email_agent_log_reply_length_class_check,
  drop column if exists updated_at,
  drop column if exists reviewed_at,
  drop column if exists edit_ratio,
  drop column if exists final_body_hash,
  drop column if exists final_message_id,
  drop column if exists review_status,
  drop column if exists draft_body_text,
  drop column if exists draft_body_hash,
  drop column if exists context_snapshot,
  drop column if exists validation_reasons,
  drop column if exists risk_level,
  drop column if exists reply_length_class,
  drop column if exists latest_message_fingerprint,
  drop column if exists message_source,
  drop column if exists internet_message_id,
  drop column if exists request_id;

drop index if exists public.email_locks_retry_due_idx;
drop index if exists public.email_locks_internet_message_id_key;

alter table public.email_locks
  drop constraint if exists email_locks_attempt_count_check,
  drop constraint if exists email_locks_status_check,
  drop column if exists updated_at,
  drop column if exists draft_id,
  drop column if exists last_error,
  drop column if exists next_retry_at,
  drop column if exists lease_until,
  drop column if exists attempt_count,
  drop column if exists status,
  drop column if exists conversation_id,
  drop column if exists internet_message_id,
  drop column if exists message_id;
