-- Emergency rollback for 20260611190000_harden_sales_tasks_offer_events_rls.sql.
-- This intentionally restores the previous broad API grants and disables RLS.
-- Use only if a production API path is broken and after confirming no public client can reach these tables.

drop policy if exists sales_tasks_service_role_all on public.sales_tasks;
drop policy if exists ops_offer_events_service_role_all on public.ops_offer_events;

alter table public.sales_tasks disable row level security;
alter table public.ops_offer_events disable row level security;

grant all on table public.sales_tasks to anon, authenticated, service_role;
grant all on table public.ops_offer_events to anon, authenticated, service_role;

grant execute on function public.ops_record_offer_sent(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz,
  text,
  text,
  text,
  text,
  jsonb
) to anon, authenticated, service_role;
