drop index if exists public.idx_email_agent_feedback_valid_collected;

update public.email_agent_feedback
set is_valid = true,
    invalid_reason = null
where invalid_reason = 'collector_preflight_3104543_legacy_rows_without_draft_body';

alter table public.email_agent_feedback
  drop column if exists invalid_reason,
  drop column if exists is_valid;
