-- Remove only the one-way reminder-treatment consumer and restore the exact
-- prior provenance-version selector. Runtime classification history and every
-- customer, offer, reminder, task and policy row remain untouched.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

lock table public.segment_policy_versions in share row exclusive mode;
lock table public.segment_quality_gate_versions in share row exclusive mode;
lock table public.segment_policy_rules in share row exclusive mode;
lock table public.request_segmentation_jobs in share row exclusive mode;
lock table public.request_segment_classifications in share row exclusive mode;

do $reminder_treatment_rollback_precondition$
begin
  if to_regprocedure(
       'public.neontrip_get_request_reminder_treatment_decision(uuid)'
     ) is null then
    raise exception using errcode = '55000',
      message = 'request_reminder_treatment_rollback_function_missing';
  end if;

  if exists (
    select 1
    from public.request_segmentation_jobs j
    where j.classifier_version = 'segment_classifier_v7_20260821_treatment_shadow'
      and (
        j.status = 'processing'
        or j.lock_owner is not null
        or j.locked_at is not null
      )
  ) then
    raise exception using errcode = '55000',
      message = 'request_reminder_treatment_rollback_requires_idle_classifier';
  end if;
end;
$reminder_treatment_rollback_precondition$;

drop function public.neontrip_get_request_reminder_treatment_decision(uuid);

do $reminder_treatment_restore_provenance$
declare
  v_definition text;
  v_replaced text;
  v_new text := $new$    and v_provenance->>'validator_version' = case
      when v_active_policy.classifier_version = 'segment_classifier_v7_20260821_treatment_shadow'
        and v_active_policy.prompt_version = 'segment_prompt_v7_20260821_treatment_shadow'
        and v_active_policy.mode = 'shadow'
        then 'n8n_cx8_validator_v4'
      else 'n8n_cx8_validator_v1'
    end$new$;
  v_old text := $old$    and v_provenance->>'validator_version' = 'n8n_cx8_validator_v1'$old$;
begin
  select pg_get_functiondef(
    'public.neontrip_record_request_segment_classification(uuid,uuid,text,text,text,numeric,text,text,text[],jsonb,jsonb,jsonb,text[],text,text,text,text,text)'::regprocedure
  ) into v_definition;

  if (length(v_definition) - length(replace(v_definition, v_new, ''))) / length(v_new) <> 1
     or strpos(v_definition, v_old) <> 0 then
    raise exception using errcode = '55000',
      message = 'request_reminder_treatment_rollback_record_function_drift';
  end if;

  v_replaced := replace(v_definition, v_new, v_old);
  execute v_replaced;

  select pg_get_functiondef(
    'public.neontrip_record_request_segment_classification(uuid,uuid,text,text,text,numeric,text,text,text[],jsonb,jsonb,jsonb,text[],text,text,text,text,text)'::regprocedure
  ) into v_definition;

  if md5(v_definition) <> '4dfc1d420a265ee7c13aa4658dec4e6a' then
    raise exception using errcode = '55000',
      message = 'request_reminder_treatment_rollback_restore_failed';
  end if;
end;
$reminder_treatment_restore_provenance$;

revoke all on function public.neontrip_record_request_segment_classification(
  uuid, uuid, text, text, text, numeric, text, text, text[], jsonb, jsonb,
  jsonb, text[], text, text, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.neontrip_record_request_segment_classification(
  uuid, uuid, text, text, text, numeric, text, text, text[], jsonb, jsonb,
  jsonb, text[], text, text, text, text, text
) to service_role;

do $reminder_treatment_rollback_postcondition$
begin
  if to_regprocedure(
       'public.neontrip_get_request_reminder_treatment_decision(uuid)'
     ) is not null
     or md5(pg_get_functiondef(
       'public.neontrip_record_request_segment_classification(uuid,uuid,text,text,text,numeric,text,text,text[],jsonb,jsonb,jsonb,text[],text,text,text,text,text)'::regprocedure
     )) <> '4dfc1d420a265ee7c13aa4658dec4e6a' then
    raise exception using errcode = '55000',
      message = 'request_reminder_treatment_rollback_postcondition_failed';
  end if;
end;
$reminder_treatment_rollback_postcondition$;

notify pgrst, 'reload schema';

commit;
