-- Close direct Data API access to legacy internal tables that were created
-- without RLS. Production callers for these tables use service_role; no
-- browser/anon/authenticated table access is required.
--
-- The conditional guards keep the migration replayable in local databases
-- whose historical schema does not contain every legacy/ad-hoc table.
--
-- Rollback:
-- supabase/rollbacks/20260818160058_harden_legacy_internal_tables_rls_rollback.sql

do $migration$
declare
  target_table text;
begin
  foreach target_table in array array[
    'crm_customer_change_log',
    'social_post_schedule',
    'ops_customer_email_message_link_backfill_20260604',
    'ops_customer_contact_cleanup_20260604',
    'crm_inventory_glossary',
    'crm_inventory_categories',
    'crm_inventory_items',
    'crm_inventory_movements',
    'crm_inventory_lock',
    '_qtx_stage',
    'quote_approvals'
  ]
  loop
    if to_regclass(format('%I.%I', 'public', target_table)) is not null then
      execute format(
        'alter table %I.%I enable row level security',
        'public',
        target_table
      );

      execute format(
        'drop policy if exists internal_service_role_all on %I.%I',
        'public',
        target_table
      );
      execute format(
        'create policy internal_service_role_all on %I.%I for all to service_role using (true) with check (true)',
        'public',
        target_table
      );

      -- RLS protects row operations. Revoking the table grants also closes
      -- non-row privileges such as TRUNCATE and REFERENCES.
      execute format(
        'revoke all on table %I.%I from PUBLIC, anon, authenticated',
        'public',
        target_table
      );
      execute format(
        'grant select, insert, update, delete on table %I.%I to service_role',
        'public',
        target_table
      );
    end if;
  end loop;
end
$migration$;

-- These RPCs operate only on the internal tables above. The social-slot RPCs
-- are SECURITY DEFINER, so their execute ACL must be restricted explicitly;
-- RLS alone would not protect that path. Inventory RPCs are restricted to the
-- same proven server-side service_role caller.
do $migration$
declare
  function_signature text;
  target_function regprocedure;
begin
  foreach function_signature in array array[
    'public.adjust_inventory_quantity(uuid,uuid,numeric,text,uuid)',
    'public.get_inventory_consumption(uuid,timestamptz,timestamptz)',
    'public.reserve_next_social_slot(text,text,integer,integer,integer,text)',
    'public.mark_social_slot_scheduled(text,text,jsonb,jsonb)',
    'public.touch_social_post_schedule_updated_at()'
  ]
  loop
    target_function := to_regprocedure(function_signature);
    if target_function is not null then
      execute format(
        'revoke all on function %s from PUBLIC, anon, authenticated',
        target_function
      );
      execute format(
        'grant execute on function %s to service_role',
        target_function
      );
    end if;
  end loop;
end
$migration$;
