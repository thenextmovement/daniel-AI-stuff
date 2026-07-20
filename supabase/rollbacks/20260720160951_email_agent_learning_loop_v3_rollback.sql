-- Non-destructive rollback: preserve review audit and improvement metadata.
revoke all on function public.review_email_agent_feedback_v3(bigint, text, text[], text, text, text)
  from service_role;
revoke all on function public.get_email_agent_style_profile_v3(text, text, text)
  from service_role;
revoke all on function public.get_email_agent_learning_quality_v3()
  from service_role;

grant execute on function public.review_email_agent_feedback_v2(bigint, text, text, text, text)
  to service_role;

drop view if exists public.email_agent_learning_review_overview_v3;
drop function if exists public.get_email_agent_learning_quality_v3();
drop function if exists public.get_email_agent_style_profile_v3(text, text, text);
drop function if exists public.review_email_agent_feedback_v3(bigint, text, text[], text, text, text);

comment on table public.email_agent_improvement_candidates is
  'Retained after rollback to preserve audited human review metadata. No runtime caller remains enabled.';
