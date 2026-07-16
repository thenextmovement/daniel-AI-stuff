drop function if exists public.record_email_agent_feedback_from_index_v1(
  bigint, text, text, text, text, text, text, text, text, numeric, jsonb, text[], jsonb, text
);
drop function if exists public.get_email_agent_feedback_candidates_v1(integer);
drop function if exists public.record_email_agent_sent_sync_result_v1(
  text, text, text, integer, integer, text, text, jsonb, text, text, boolean
);
drop function if exists public.begin_email_agent_sent_sync_v1(text, text);

drop table if exists public.email_agent_mail_sync_runs;
drop table if exists public.email_agent_sent_index;
drop table if exists public.email_agent_mail_sync_state;
