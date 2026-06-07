drop trigger if exists ops_copilot_threads_updated_at on public.ops_copilot_threads;

drop policy if exists ops_copilot_tool_calls_service_role_all on public.ops_copilot_tool_calls;
drop policy if exists ops_copilot_messages_service_role_all on public.ops_copilot_messages;
drop policy if exists ops_copilot_threads_service_role_all on public.ops_copilot_threads;

drop table if exists public.ops_copilot_tool_calls;
drop table if exists public.ops_copilot_messages;
drop table if exists public.ops_copilot_threads;
