revoke all on function public.get_email_agent_learning_quality_v4()
  from service_role;
revoke all on function public.get_email_agent_style_profile_v4(text, text, text)
  from service_role;
revoke all on public.email_agent_auto_style_eligibility_v1
  from service_role;

drop function if exists public.get_email_agent_learning_quality_v4();
drop function if exists public.get_email_agent_style_profile_v4(text, text, text);
drop view if exists public.email_agent_auto_style_eligibility_v1;
