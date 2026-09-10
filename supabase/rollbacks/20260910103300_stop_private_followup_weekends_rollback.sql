-- Exact rollback for the former-private weekday treatment; never touches rows.
-- Applying this restores private weekend eligibility and needs explicit approval.
do $restore_private_followup_weekends$
declare
  target oid := to_regprocedure('public.neontrip_get_followup_queue_cadence_decision(uuid)');
  current_definition text;
  restored_definition text;
  before_acl text;
  old_block constant text := $old$      false as weekend_allowed,$old$;
  new_block constant text := $new$      (
        cadence_tier = 'frequent'
        and source_authority in ('manual', 'ai_shadow')
        and resolved_segment = 'NT-8'
        and coalesce(resolved_scale, '') not in ('medium', 'large', 'enterprise')
      ) as weekend_allowed,$new$;
begin
  if target is null then
    raise exception using errcode = '55000', message = 'followup_cadence_missing';
  end if;
  current_definition := pg_get_functiondef(target);
  if md5(current_definition) <> '7d26968effd57fce22fa23d884d8f1db' then
    raise exception using errcode = '55000', message = 'followup_cadence_rollback_source_drift';
  end if;
  if exists (select 1 from public.followup_delivery_attempts where status = 'processing') then
    raise exception using errcode = '55000', message = 'followup_cadence_requires_idle_delivery';
  end if;
  select proacl::text into before_acl from pg_proc where oid = target;
  restored_definition := replace(current_definition, old_block, new_block);
  if md5(restored_definition) <> '7b81bf6b3fa457e4cc0974b2f948ae9d' then
    raise exception using errcode = '55000', message = 'followup_cadence_rollback_diff';
  end if;
  execute restored_definition;
  if pg_get_functiondef(target) is distinct from restored_definition
     or (select proacl::text from pg_proc where oid = target) is distinct from before_acl then
    raise exception using errcode = '55000', message = 'followup_cadence_rollback_unexpected_diff';
  end if;
end;
$restore_private_followup_weekends$;
