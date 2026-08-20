-- NEONTRIP Phase-5 non-destructive operational rollback.
-- Use only after the v4 worker has no processing job. This flips the active
-- shadow contract back to Phase 2 and preserves every candidate job,
-- classification, immutable Gold row, and additive evaluation view.
-- After this transaction the still-published v4 claim must return [] before
-- the reviewed n8n reverse to the v3 worker is published.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

lock table public.segment_quality_gate_versions in share row exclusive mode;
lock table public.segment_policy_versions in access exclusive mode;
lock table public.segment_policy_rules in share row exclusive mode;
lock table public.request_segmentation_jobs in share row exclusive mode;

do $phase5_operational_rollback_precondition$
declare
  v_candidate_active_policy integer;
  v_candidate_active_quality integer;
  v_old_inactive_policy integer;
  v_old_inactive_quality integer;
  v_global_active_policy_count integer;
  v_global_active_quality_count integer;
  v_processing_candidate_jobs integer;
  v_candidate_rule_count integer;
  v_non_inert_candidate_rules integer;
begin
  select count(*) into v_global_active_policy_count
  from public.segment_policy_versions
  where active;

  select count(*) into v_global_active_quality_count
  from public.segment_quality_gate_versions
  where active;

  select count(*) into v_candidate_active_policy
  from public.segment_policy_versions p
  where p.version = 'nt_policy_v3_20260820_cx8_shadow'
    and p.active
    and p.mode = 'shadow'
    and p.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and p.classifier_version = 'segment_classifier_v4_20260820_cx8'
    and p.prompt_version = 'segment_prompt_v4_20260819_cx8'
    and p.quality_gate_version = 'nt_quality_gate_v3_20260820_cx8';

  select count(*) into v_candidate_active_quality
  from public.segment_quality_gate_versions q
  where q.version = 'nt_quality_gate_v3_20260820_cx8'
    and q.active
    and q.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and q.classifier_version = 'segment_classifier_v4_20260820_cx8'
    and q.prompt_version = 'segment_prompt_v4_20260819_cx8';

  select count(*) into v_old_inactive_policy
  from public.segment_policy_versions p
  where p.version = 'nt_policy_v2_20260819_cx8_shadow'
    and not p.active
    and p.mode = 'shadow'
    and p.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and p.classifier_version = 'segment_classifier_v3_20260819_cx8'
    and p.prompt_version = 'segment_prompt_v4_20260819_cx8'
    and p.quality_gate_version = 'nt_quality_gate_v2_20260819_cx8';

  select count(*) into v_old_inactive_quality
  from public.segment_quality_gate_versions q
  where q.version = 'nt_quality_gate_v2_20260819_cx8'
    and not q.active
    and q.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and q.classifier_version = 'segment_classifier_v3_20260819_cx8'
    and q.prompt_version = 'segment_prompt_v4_20260819_cx8';

  select count(*) into v_processing_candidate_jobs
  from public.request_segmentation_jobs j
  where j.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and j.classifier_version = 'segment_classifier_v4_20260820_cx8'
    and j.prompt_version = 'segment_prompt_v4_20260819_cx8'
    and j.status = 'processing';

  select
    count(*),
    count(*) filter (
      where r.automation_enabled
         or r.needs_human_review
         or r.price_factor is not null
         or r.max_followups <> 0
         or r.first_call_after_minutes is not null
         or r.call_sequence <> '[]'::jsonb
         or r.email_sequence <> '[]'::jsonb
    )
  into v_candidate_rule_count, v_non_inert_candidate_rules
  from public.segment_policy_rules r
  where r.policy_version = 'nt_policy_v3_20260820_cx8_shadow'
    and r.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8';

  if v_candidate_active_policy <> 1
     or v_candidate_active_quality <> 1
     or v_old_inactive_policy <> 1
     or v_old_inactive_quality <> 1
     or v_global_active_policy_count <> 1
     or v_global_active_quality_count <> 1
     or v_candidate_rule_count <> 8
     or v_non_inert_candidate_rules <> 0 then
    raise exception using
      errcode = '55000',
      message = 'phase5_operational_rollback_contract_precondition_failed',
      detail = format(
        'candidate_policy=%s candidate_quality=%s old_policy=%s old_quality=%s active_policies=%s active_gates=%s rules=%s non_inert=%s',
        v_candidate_active_policy, v_candidate_active_quality,
        v_old_inactive_policy, v_old_inactive_quality,
        v_global_active_policy_count, v_global_active_quality_count,
        v_candidate_rule_count, v_non_inert_candidate_rules
      );
  end if;

  if v_processing_candidate_jobs <> 0 then
    raise exception using
      errcode = '55000',
      message = 'phase5_operational_rollback_candidate_jobs_still_processing',
      detail = format('processing_candidate_jobs=%s', v_processing_candidate_jobs);
  end if;
end;
$phase5_operational_rollback_precondition$;

update public.segment_quality_gate_versions
set active = false
where version = 'nt_quality_gate_v3_20260820_cx8';

update public.segment_policy_versions
set active = false
where version = 'nt_policy_v3_20260820_cx8_shadow';

update public.segment_quality_gate_versions
set active = true
where version = 'nt_quality_gate_v2_20260819_cx8';

update public.segment_policy_versions
set active = true
where version = 'nt_policy_v2_20260819_cx8_shadow';

do $phase5_operational_rollback_postcondition$
declare
  v_old_active_policy integer;
  v_old_active_quality integer;
  v_candidate_active_count integer;
  v_global_active_policy_count integer;
  v_global_active_quality_count integer;
begin
  select count(*) into v_global_active_policy_count
  from public.segment_policy_versions
  where active;

  select count(*) into v_global_active_quality_count
  from public.segment_quality_gate_versions
  where active;

  select count(*) into v_old_active_policy
  from public.segment_policy_versions p
  where p.active
    and p.version = 'nt_policy_v2_20260819_cx8_shadow'
    and p.mode = 'shadow'
    and p.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and p.classifier_version = 'segment_classifier_v3_20260819_cx8'
    and p.prompt_version = 'segment_prompt_v4_20260819_cx8'
    and p.quality_gate_version = 'nt_quality_gate_v2_20260819_cx8';

  select count(*) into v_old_active_quality
  from public.segment_quality_gate_versions q
  where q.active
    and q.version = 'nt_quality_gate_v2_20260819_cx8'
    and q.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and q.classifier_version = 'segment_classifier_v3_20260819_cx8'
    and q.prompt_version = 'segment_prompt_v4_20260819_cx8';

  select
    (select count(*) from public.segment_policy_versions
      where version = 'nt_policy_v3_20260820_cx8_shadow' and active)
    + (select count(*) from public.segment_quality_gate_versions
      where version = 'nt_quality_gate_v3_20260820_cx8' and active)
  into v_candidate_active_count;

  if v_old_active_policy <> 1
     or v_old_active_quality <> 1
     or v_candidate_active_count <> 0 then
    raise exception using
      errcode = '55000',
      message = 'phase5_operational_rollback_postcondition_failed',
      detail = format(
        'old_policy=%s old_quality=%s active_candidate_objects=%s all_active_policies=%s all_active_gates=%s',
        v_old_active_policy, v_old_active_quality, v_candidate_active_count,
        v_global_active_policy_count, v_global_active_quality_count
      );
  end if;

  if v_global_active_policy_count <> 1 or v_global_active_quality_count <> 1 then
    raise exception using
      errcode = '55000',
      message = 'phase5_operational_rollback_postcondition_failed',
      detail = format(
        'all_active_policies=%s all_active_gates=%s',
        v_global_active_policy_count, v_global_active_quality_count
      );
  end if;
end;
$phase5_operational_rollback_postcondition$;

commit;
