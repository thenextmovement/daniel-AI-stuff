-- NEONTRIP Phase-2 operational rollback after any CX8 runtime activity.
--
-- This is intentionally non-destructive: never delete CX8 jobs,
-- classifications, or Gold, and never drop version columns/tables or recreate
-- legacy uniqueness constraints after runtime.
--
-- Mandatory runbook order:
--   1. Apply this SQL to flip the DB policy atomically from v2 to v1.
--   2. Call Claim with the exact v3 taxonomy/classifier/prompt filters and
--      verify that it returns [] because its matching v2 policy is inactive.
--   3. Only after that proof, reverse and publish the n8n v1 workflow.
-- This artifact fails closed while a v2 job is still processing; let that job
-- drain and retry the SQL. The v3 workflow may remain published during the DB
-- flip because the policy lock serializes contract selection, and after commit
-- its exact-version Claim has no matching active policy.

begin;

-- Freeze contract selection and job state for the short drain-check/flip
-- transaction. In-flight workers finish before these locks are acquired; new
-- v3 claim/enqueue transactions wait and then observe v1 active.
lock table public.segment_policy_versions in access exclusive mode;
lock table public.request_segmentation_jobs in share row exclusive mode;

do $operational_rollback_preconditions$
declare
  v_v1_exists boolean;
  v_v2_exists boolean;
  v_processing_v2_jobs integer;
begin
  perform 1
  from public.segment_policy_versions
  where version in (
    'nt_policy_v1_20260520_shadow',
    'nt_policy_v2_20260819_cx8_shadow'
  )
  order by version
  for update;

  select exists (
    select 1 from public.segment_policy_versions
    where version = 'nt_policy_v1_20260520_shadow'
      and mode = 'shadow'
  ) into v_v1_exists;

  select exists (
    select 1 from public.segment_policy_versions
    where version = 'nt_policy_v2_20260819_cx8_shadow'
      and taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
      and classifier_version = 'segment_classifier_v3_20260819_cx8'
      and prompt_version = 'segment_prompt_v4_20260819_cx8'
  ) into v_v2_exists;

  if not v_v1_exists or not v_v2_exists then
    raise exception using
      errcode = '55000',
      message = 'request_segmentation_operational_rollback_contract_missing';
  end if;

  -- Any already processing v2 job must drain before the policy flips. The v3
  -- workflow itself remains published until the post-commit empty-Claim proof.
  -- Pending/failed v2 rows remain retained and auditably suspended; the v1
  -- claimant cannot claim them after rollback.
  select count(*)::integer into v_processing_v2_jobs
  from public.request_segmentation_jobs j
  where j.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
    and j.classifier_version = 'segment_classifier_v3_20260819_cx8'
    and j.prompt_version = 'segment_prompt_v4_20260819_cx8'
    and j.status = 'processing';

  if v_processing_v2_jobs <> 0 then
    raise exception using
      errcode = '55000',
      message = 'request_segmentation_operational_rollback_v2_jobs_still_processing',
      detail = format('processing_v2_jobs=%s', v_processing_v2_jobs);
  end if;
end;
$operational_rollback_preconditions$;

update public.segment_policy_versions
set active = false
where version = 'nt_policy_v2_20260819_cx8_shadow'
  and active;

update public.segment_policy_versions
set active = true
where version = 'nt_policy_v1_20260520_shadow'
  and not active;

do $operational_rollback_postcondition$
declare
  v_active_versions text[];
begin
  select coalesce(array_agg(version order by version), '{}'::text[])
  into v_active_versions
  from public.segment_policy_versions
  where active;

  if v_active_versions is distinct from array['nt_policy_v1_20260520_shadow']::text[] then
    raise exception using
      errcode = '55000',
      message = 'request_segmentation_operational_rollback_postcondition_failed',
      detail = format('active_versions=%s', v_active_versions);
  end if;
end;
$operational_rollback_postcondition$;

commit;

-- Post-rollback invariants (read-only verification):
--   * exact-v3 Claim with all three version filters returns zero rows because
--     its matching v2 policy is inactive;
--   * only after observing that empty Claim result is n8n reversed/published
--     to the v1 workflow;
--   * markerless v1 Claim/Payload/Manual contracts are active again;
--   * every CX8 job/classification/Gold row remains available for audit;
--   * pending/failed CX8 jobs are retained but suspended until an explicitly
--     authorized v2 reactivation; no job is silently cancelled or deleted;
--   * no master row is bulk-remapped or rewritten by this artifact.
