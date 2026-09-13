-- NEONTRIP: route former private follow-ups through the existing small-business
-- weekday treatment. Preserve cadence tiers, counters, classification authority,
-- messages, queue identities and all send guards. No row writes or sends.
do $stop_private_followup_weekends$
declare
  target oid := to_regprocedure('public.neontrip_get_followup_queue_cadence_decision(uuid)');
  before_definition text;
  after_definition text;
  before_acl text;
  old_block constant text := $old$      (
        cadence_tier = 'frequent'
        and source_authority in ('manual', 'ai_shadow')
        and resolved_segment = 'NT-8'
        and coalesce(resolved_scale, '') not in ('medium', 'large', 'enterprise')
      ) as weekend_allowed,$old$;
  new_block constant text := $new$      false as weekend_allowed,$new$;
begin
  if target is null then
    raise exception using errcode = '55000', message = 'followup_cadence_missing';
  end if;
  before_definition := pg_get_functiondef(target);
  if md5(before_definition) <> '0e01a0bf2b507621985304cbfe8da46f' then
    raise exception using errcode = '55000', message = 'followup_cadence_source_drift';
  end if;
  if exists (select 1 from public.followup_delivery_attempts where status = 'processing') then
    raise exception using errcode = '55000', message = 'followup_cadence_requires_idle_delivery';
  end if;
  if has_function_privilege('anon', target, 'EXECUTE')
     or has_function_privilege('authenticated', target, 'EXECUTE')
     or not has_function_privilege('service_role', target, 'EXECUTE') then
    raise exception using errcode = '55000', message = 'followup_cadence_acl_drift';
  end if;
  select proacl::text into before_acl from pg_proc where oid = target;
  if (length(before_definition) - length(replace(before_definition, old_block, '')))
       / length(old_block) <> 1 then
    raise exception using errcode = '55000', message = 'followup_private_weekend_block_not_unique';
  end if;
  after_definition := replace(before_definition, old_block, new_block);
  execute after_definition;
  if pg_get_functiondef(target) is distinct from after_definition
     or (select proacl::text from pg_proc where oid = target) is distinct from before_acl then
    raise exception using errcode = '55000', message = 'followup_cadence_unexpected_diff';
  end if;
end;
$stop_private_followup_weekends$;
