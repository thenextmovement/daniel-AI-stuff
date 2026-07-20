drop function if exists public.get_email_agent_rollout_gate_v2();
drop function if exists public.get_email_agent_learning_quality_v5();
drop function if exists public.get_email_agent_style_profile_v5(text, text, text);
drop view if exists public.email_agent_auto_style_eligibility_v2;
drop view if exists public.email_agent_feedback_defect_summary_v1;

drop trigger if exists email_agent_feedback_analyze_v5 on public.email_agent_feedback;
drop function if exists public.trigger_analyze_email_agent_feedback_v5();
drop function if exists public.analyze_email_agent_feedback_v5(bigint);
drop table if exists public.email_agent_feedback_analysis_v1;
