-- Re-open only legacy rows changed by the matching migration.
update public.email_agent_log
set review_status = 'pending_review',
    updated_at = now()
where review_status = 'discarded'
  and draft_body_text is null;
