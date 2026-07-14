-- Legacy rows predate stored draft bodies and cannot produce meaningful edit feedback.
update public.email_agent_log
set review_status = 'discarded',
    updated_at = now()
where review_status = 'pending_review'
  and draft_body_text is null;
