alter table public.email_agent_feedback
  add column if not exists is_valid boolean not null default true,
  add column if not exists invalid_reason text;

comment on column public.email_agent_feedback.is_valid is
  'False only for measurements known to be invalid; keep rows for reversible audit history.';

update public.email_agent_feedback
set is_valid = false,
    invalid_reason = 'collector_preflight_3104543_legacy_rows_without_draft_body'
where collected_at >= '2026-07-14T12:50:00Z'
  and collected_at < '2026-07-14T12:50:20Z'
  and coalesce(edit_summary->>'collector_version', '') = 'email-feedback-v1';

create index if not exists idx_email_agent_feedback_valid_collected
  on public.email_agent_feedback (collected_at desc)
  where is_valid;
