alter table public.email_agent_log
  add column context_snapshot jsonb not null default '{}'::jsonb;

create view public.email_agent_review_overview
with (security_invoker = true)
as
select
  log.id as log_id,
  log.message_id as source_message_id,
  feedback.id as feedback_id
from public.email_agent_log as log
left join public.email_agent_feedback as feedback
  on feedback.source_message_id = log.message_id
where log.draft_created = true;

revoke all on public.email_agent_review_overview from public, anon, authenticated;
grant select on public.email_agent_review_overview to service_role;
