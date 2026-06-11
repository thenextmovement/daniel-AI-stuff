-- Harden internal sales task and offer-event tables.
--
-- Preflight / dry-run checks:
-- select relname, relrowsecurity from pg_class where relname in ('sales_tasks','ops_offer_events');
-- select schemaname, tablename, policyname, roles, cmd from pg_policies where tablename in ('sales_tasks','ops_offer_events');
-- select table_name, grantee, privilege_type from information_schema.role_table_grants
--   where table_schema = 'public' and table_name in ('sales_tasks','ops_offer_events')
--   order by table_name, grantee, privilege_type;
--
-- Backup/export hint before applying in production:
-- pg_dump --data-only --table=public.sales_tasks --table=public.ops_offer_events "$DATABASE_URL" > sales_tasks_ops_offer_events_backup.sql
--
-- Rollback:
-- see supabase/rollbacks/20260611190000_harden_sales_tasks_offer_events_rls_rollback.sql.

alter table public.sales_tasks enable row level security;
alter table public.ops_offer_events enable row level security;

drop policy if exists sales_tasks_service_role_all on public.sales_tasks;
create policy sales_tasks_service_role_all
  on public.sales_tasks
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists ops_offer_events_service_role_all on public.ops_offer_events;
create policy ops_offer_events_service_role_all
  on public.ops_offer_events
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.sales_tasks from anon, authenticated;
revoke all on table public.ops_offer_events from anon, authenticated;

grant select, insert, update, delete on table public.sales_tasks to service_role;
grant select, insert, update, delete on table public.ops_offer_events to service_role;

revoke all on function public.ops_record_offer_sent(
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
) from public, anon, authenticated;

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
) to service_role;

-- Post-checks:
-- select relname, relrowsecurity from pg_class where relname in ('sales_tasks','ops_offer_events');
-- select tablename, policyname, roles, cmd from pg_policies where tablename in ('sales_tasks','ops_offer_events');
-- select table_name, grantee, privilege_type from information_schema.role_table_grants
--   where table_schema = 'public' and table_name in ('sales_tasks','ops_offer_events')
--   order by table_name, grantee, privilege_type;
-- select p.proname, r.rolname, has_function_privilege(r.rolname, p.oid, 'EXECUTE') as can_execute
--   from pg_proc p cross join pg_roles r
--   where p.proname = 'ops_record_offer_sent' and r.rolname in ('anon','authenticated','service_role')
--   order by r.rolname;
