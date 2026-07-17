drop function if exists public.set_email_agent_rollout_stage_v1(text, text, text, uuid);
drop function if exists public.get_email_agent_rollout_gate_v1();
drop function if exists public.run_email_agent_evaluation_v1(text, text, text, uuid);
drop function if exists public.record_email_agent_gold_prediction_v1(text, text, text, numeric, boolean, text, text, text, text);
drop function if exists public.seed_email_agent_gold_cases_v1(integer, text, text, text, uuid);

drop table if exists public.email_agent_rollout_audit;
drop table if exists public.email_agent_rollout_control;
drop table if exists public.email_agent_evaluation_runs;
drop table if exists public.email_agent_gold_predictions;
drop table if exists public.email_agent_gold_cases;
