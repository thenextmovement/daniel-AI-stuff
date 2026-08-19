-- HOLD: this is deliberately outside supabase/migrations and must never be
-- auto-applied. Apply only after the CX8-aware app and n8n v3 workflow are
-- deployed, v3 has been verified to claim zero jobs while v2 is inactive, all
-- retryable legacy jobs have been explicitly drained/resolved, and the release
-- owner authorizes the policy flip.
--
-- This held artifact changes only which shadow policy is active. It does not
-- enable any segment automation, rewrite master state, enqueue work, cancel
-- jobs, or alter historical definitions/classifications.

begin;

-- Lock versioned configuration in its canonical dependency/write order before
-- validating it. SHARE ROW EXCLUSIVE blocks concurrent configuration DML from
-- changing taxonomy definitions, gate thresholds, or policy rules between the
-- checks and the flip. ACCESS EXCLUSIVE on the policy table then waits for
-- every in-flight enqueue/claim transaction that selected v1 and prevents a
-- new one from doing so until commit. The final job lock prevents a direct job
-- insert/update from racing the drain check. Every lock is transaction-scoped.
lock table public.segment_taxonomy_versions in share row exclusive mode;
lock table public.segment_taxonomy_definitions in share row exclusive mode;
lock table public.segment_quality_gate_versions in share row exclusive mode;
lock table public.segment_policy_versions in access exclusive mode;
lock table public.segment_policy_rules in share row exclusive mode;
lock table public.request_segmentation_jobs in share row exclusive mode;

do $activation_preconditions$
declare
  v_v1 public.segment_policy_versions%rowtype;
  v_v2 public.segment_policy_versions%rowtype;
  v_rule_count integer;
  v_unsafe_rule_count integer;
  v_quality_gate_contract_valid boolean;
  v_pending_v1_jobs integer;
  v_processing_v1_jobs integer;
  v_retryable_failed_v1_jobs integer;
begin
  select * into v_v1
  from public.segment_policy_versions
  where version = 'nt_policy_v1_20260520_shadow'
  for update;

  if not found or not v_v1.active then
    raise exception using
      errcode = '55000',
      message = 'cx8_activation_requires_active_v1_shadow';
  end if;

  select * into v_v2
  from public.segment_policy_versions
  where version = 'nt_policy_v2_20260819_cx8_shadow'
  for update;

  if not found
     or v_v2.active
     or v_v2.mode <> 'shadow'
     or v_v2.taxonomy_version <> 'nt_taxonomy_v2_20260819_cx8'
     or v_v2.classifier_version <> 'segment_classifier_v3_20260819_cx8'
     or v_v2.prompt_version <> 'segment_prompt_v4_20260819_cx8'
     or v_v2.quality_gate_version <> 'nt_quality_gate_v2_20260819_cx8' then
    raise exception using
      errcode = '55000',
      message = 'cx8_activation_policy_contract_missing_or_unexpected';
  end if;

  select
    count(*)::integer,
    count(*) filter (
      where d.segment is null
         or not d.active
         or d.default_s_kategorie is distinct from r.s_kategorie
         or d.required_evidence_code is distinct from case r.segment
           when 'NT-10' then 'verified_public_or_institutional_entity'
           when 'NT-1' then 'verified_physical_project_supplier'
           when 'NT-4' then 'verified_client_project_intermediary'
           when 'NT-3' then 'verified_event_or_media_operator'
           when 'NT-5' then 'verified_multisite_or_franchise'
           when 'NT-6' then 'verified_enterprise'
           when 'NT-8' then 'explicit_private_use'
           when 'NT-9' then 'verified_direct_business'
           else null
         end
         or r.taxonomy_version is distinct from v_v2.taxonomy_version
         or r.automation_enabled
         or r.price_factor is not null
         or r.max_followups <> 0
         or jsonb_array_length(r.call_sequence) <> 0
         or jsonb_array_length(r.email_sequence) <> 0
    )::integer
  into v_rule_count, v_unsafe_rule_count
  from public.segment_policy_rules r
  left join public.segment_taxonomy_definitions d
    on d.taxonomy_version = r.taxonomy_version
   and d.segment = r.segment
  where r.policy_version = v_v2.version;

  if v_rule_count <> 8 or v_unsafe_rule_count <> 0 then
    raise exception using
      errcode = '55000',
      message = 'cx8_activation_rules_not_shadow_safe',
      detail = format('rule_count=%s unsafe_rule_count=%s', v_rule_count, v_unsafe_rule_count);
  end if;

  select exists (
    select 1
    from public.segment_quality_gate_versions q
    where q.version = v_v2.quality_gate_version
      and q.taxonomy_version = v_v2.taxonomy_version
      and q.classifier_version = v_v2.classifier_version
      and q.prompt_version = v_v2.prompt_version
      and q.active
      and q.min_unique_gold_total = 300
      and q.min_gold_per_segment = 25
      and q.min_precision_per_predicted_class = 0.90
      and q.min_recall_per_actual_class = 0.85
      and q.min_accepted_coverage = 0.80
      and q.critical_segments = array['NT-8', 'NT-10']::text[]
      and q.min_critical_precision = 0.95
      and q.required_mapping_integrity = 1.0
      and q.max_provenance_violations = 0
      and q.manual_activation_required
  ) into v_quality_gate_contract_valid;

  if not v_quality_gate_contract_valid then
    raise exception using
      errcode = '55000',
      message = 'cx8_activation_quality_gate_contract_missing_or_unexpected';
  end if;

  -- Do not strand a retryable v1 row by deactivating the only contract that can
  -- claim it. Release operations must first drain or explicitly resolve every
  -- pending/retryable-failed row and wait for every processing row to finish.
  -- Exhausted failed rows are terminal audit history, not claimable work. This
  -- block is read-only and never executes or cancels a job.
  select
    count(*) filter (where j.status = 'pending')::integer,
    count(*) filter (where j.status = 'processing')::integer,
    count(*) filter (where j.status = 'failed' and j.attempts < j.max_attempts)::integer
  into v_pending_v1_jobs, v_processing_v1_jobs, v_retryable_failed_v1_jobs
  from public.request_segmentation_jobs j
  where j.taxonomy_version is null
    and (
      j.status in ('pending', 'processing')
      or (j.status = 'failed' and j.attempts < j.max_attempts)
    );

  if v_pending_v1_jobs <> 0
     or v_processing_v1_jobs <> 0
     or v_retryable_failed_v1_jobs <> 0 then
    raise exception using
      errcode = '55000',
      message = 'cx8_activation_v1_jobs_not_drained',
      detail = format(
        'pending_v1_jobs=%s processing_v1_jobs=%s retryable_failed_v1_jobs=%s',
        v_pending_v1_jobs,
        v_processing_v1_jobs,
        v_retryable_failed_v1_jobs
      );
  end if;
end;
$activation_preconditions$;

update public.segment_policy_versions
set active = false
where version = 'nt_policy_v1_20260520_shadow'
  and active;

update public.segment_policy_versions
set active = true
where version = 'nt_policy_v2_20260819_cx8_shadow'
  and not active;

do $activation_postcondition$
declare
  v_active_versions text[];
begin
  select coalesce(array_agg(version order by version), '{}'::text[])
  into v_active_versions
  from public.segment_policy_versions
  where active;

  if v_active_versions is distinct from array['nt_policy_v2_20260819_cx8_shadow']::text[] then
    raise exception using
      errcode = '55000',
      message = 'cx8_activation_postcondition_failed',
      detail = format('active_versions=%s', v_active_versions);
  end if;
end;
$activation_postcondition$;

commit;
