-- Emergency rollback for 20260818160058_harden_legacy_internal_tables_rls.sql.
-- This intentionally restores the previous insecure API grants and disables
-- RLS. Use only to recover a confirmed production break while the caller is
-- being moved back to service_role.

do $rollback$
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
        'drop policy if exists internal_service_role_all on %I.%I',
        'public',
        target_table
      );
      execute format(
        'alter table %I.%I disable row level security',
        'public',
        target_table
      );
      execute format(
        'grant all on table %I.%I to anon, authenticated, service_role',
        'public',
        target_table
      );
    end if;
  end loop;
end
$rollback$;

do $rollback$
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
        'grant execute on function %s to PUBLIC, anon, authenticated, service_role',
        target_function
      );
    end if;
  end loop;
end
$rollback$;
