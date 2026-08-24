-- Restore only the exact pre-repair Treatment minimizer. This intentionally
-- reintroduces the historic standalone-tracking defect and is for emergency
-- rollback of migration 20260824101537 only.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $tracking_redaction_rollback_precondition$
begin
  if md5(pg_get_functiondef(
       'public.neontrip_treatment_redact_segmentation_text(text,integer,text[])'::regprocedure
     )) <> 'd450996670c9e9c6e1d585468c7a547a'
     or (select count(*) from public.segment_policy_versions where active) <> 1
     or (select count(*) from public.segment_quality_gate_versions where active) <> 1
     or not exists (
       select 1
       from public.segment_policy_versions p
       join public.segment_quality_gate_versions q
         on q.version = p.quality_gate_version
       where p.version = 'nt_policy_v6_20260821_treatment_shadow'
         and p.active and p.mode = 'shadow'
         and p.classifier_version = 'segment_classifier_v7_20260821_treatment_shadow'
         and p.prompt_version = 'segment_prompt_v7_20260821_treatment_shadow'
         and q.version = 'nt_quality_gate_v6_20260821_treatment_shadow'
         and q.active
     )
     or exists (
       select 1
       from public.request_segmentation_jobs
       where classifier_version = 'segment_classifier_v7_20260821_treatment_shadow'
         and prompt_version = 'segment_prompt_v7_20260821_treatment_shadow'
         and (status = 'processing' or lock_owner is not null or locked_at is not null)
     ) then
    raise exception using errcode = '55000',
      message = 'treatment_shadow_tracking_redaction_rollback_drift';
  end if;
end;
$tracking_redaction_rollback_precondition$;

create or replace function public.neontrip_treatment_redact_segmentation_text(
  p_value text,
  p_max_length integer,
  p_sensitive_values text[] default '{}'
)
returns text
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  v_output text := coalesce(p_value, '');
  v_sensitive text;
  v_position integer;
  v_limit integer := greatest(1, least(coalesce(p_max_length, 1), 2000));
begin
  foreach v_sensitive in array coalesce(p_sensitive_values, '{}'::text[])
  loop
    v_sensitive := btrim(coalesce(v_sensitive, ''));
    if length(v_sensitive) >= 2 and v_sensitive <> '[#]' then
      loop
        v_position := strpos(lower(v_output), lower(v_sensitive));
        exit when v_position = 0;
        v_output := overlay(v_output placing '[#]' from v_position for length(v_sensitive));
      end loop;
    end if;
  end loop;

  v_output := regexp_replace(
    v_output,
    '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}',
    '[EMAIL]',
    'gi'
  );
  v_output := regexp_replace(v_output, '(https?://|www\.)[^[:space:]]+', '[URL]', 'gi');
  v_output := regexp_replace(
    v_output,
    '\m[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\M',
    '[UUID]',
    'gi'
  );
  v_output := regexp_replace(
    v_output,
    '(\+|00)?[0-9][0-9() ./-]{6,}[0-9]',
    '[PHONE]',
    'g'
  );
  v_output := regexp_replace(v_output, '\m[[:alnum:]_-]{24,}\M', '[OPAQUE-ID]', 'g');
  v_output := btrim(regexp_replace(v_output, '[[:space:]]+', ' ', 'g'));

  return nullif(left(v_output, v_limit), '');
end;
$function$;

comment on function public.neontrip_treatment_redact_segmentation_text(text, integer, text[]) is
  'Internal Treatment-focus Phase-7 minimizer: removes known contact values and generic email, URL, phone, UUID and opaque-ID patterns before a hard text bound. It is not a general anonymizer and is exposed only through the exact evaluation payload RPC.';

revoke all on function public.neontrip_treatment_redact_segmentation_text(text, integer, text[])
  from public, anon, authenticated, service_role;

do $tracking_redaction_rollback_postcondition$
begin
  if md5(pg_get_functiondef(
       'public.neontrip_treatment_redact_segmentation_text(text,integer,text[])'::regprocedure
     )) <> 'fd9cfccc390984564a5091ab39d67612'
     or has_function_privilege(
       'anon',
       'public.neontrip_treatment_redact_segmentation_text(text,integer,text[])',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.neontrip_treatment_redact_segmentation_text(text,integer,text[])',
       'EXECUTE'
     )
     or has_function_privilege(
       'service_role',
       'public.neontrip_treatment_redact_segmentation_text(text,integer,text[])',
       'EXECUTE'
     ) then
    raise exception using errcode = '55000',
      message = 'treatment_shadow_tracking_redaction_rollback_postcondition_failed';
  end if;
end;
$tracking_redaction_rollback_postcondition$;

commit;
