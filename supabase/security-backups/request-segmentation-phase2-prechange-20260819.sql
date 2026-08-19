-- NEONTRIP request segmentation Phase-2 pre-change snapshot.
-- Supabase project: klibiejfisijpagzkxls
-- Captured read-only at: 2026-08-19T19:40:43Z
-- Source commit before this uncommitted migration: 51f02a2
--
-- No customer rows, domains, email addresses, or other PII are included.
-- Values below are schema metadata or aggregate counts only.
--
-- Live aggregate prestate:
--   active_policy={version:nt_policy_v1_20260520_shadow,mode:shadow}
--   active_policy_rules=18; automation_enabled_rules=0
--   segment_definitions=18
--   request_segmentation_jobs=1210; processing_jobs=0
--   job_statuses={completed:821,needs_review:364,cancelled:5,failed:20}
--   retryable_failed_jobs=0 (all 20 failed rows had attempts>=max_attempts)
--   request_segment_classifications=1190
--   legacy_request_segmentation_gold_labels=14
--   activation_approvals=0; active_activation_approvals=0
--
-- Existing data is legacy/unversioned. The following Phase-2 columns/tables did
-- not exist at capture time; therefore this snapshot contains no CX8 row data:
--   segment_taxonomy_versions
--   segment_taxonomy_definitions
--   segment_context_definitions
--   segment_quality_gate_versions
--   request_segmentation_gold_adjudications
--   *.taxonomy_version / classifier-version tuple extensions described by the
--   main migration.
--
-- Exact uniqueness contracts before Phase 2:
--   request_segmentation_jobs_request_id_input_hash_key
--     UNIQUE (request_id, input_hash)
--   request_segment_classificatio_request_id_input_hash_classif_key
--     UNIQUE (request_id, input_hash, classifier_version)
--
-- Exact existing service RPC signatures and ACL at capture time. Every listed
-- function had ACL `postgres=X/postgres, service_role=X/postgres` and no
-- anon/authenticated execute grant:
--   neontrip_enqueue_request_segmentation(uuid,text,integer)
--   neontrip_claim_request_segmentation_jobs(integer,text,integer)
--   neontrip_claim_request_segmentation_jobs_by_source(text,integer,text,integer)
--   neontrip_upsert_segment_research_cache_from_classification(
--     uuid,text,text,text,jsonb,jsonb,jsonb,text,text)
--   neontrip_get_request_segmentation_payload(uuid)
--   neontrip_set_manual_request_segment(uuid,text,text,jsonb,text)
--   neontrip_record_request_segment_classification(
--     uuid,uuid,text,text,text,numeric,text,text,text[],jsonb,jsonb,jsonb,
--     text[],text,text,text,text,text)
--   neontrip_stage_request_segmentation_historical_backfill(integer,timestamptz,integer)
--   neontrip_release_request_segmentation_historical_backfill(integer)
--   neontrip_approve_request_segmentation_activation(text,text,timestamptz)
--   neontrip_get_request_segmentation_automation_decision(uuid)
--
-- The Stage and Release RPCs above are existing live controlled-backfill paths,
-- not Phase-2 inventions. Stage used the exact job unique constraint that Phase
-- 2 must replace, so its version-aware replacement is a compatibility repair.
-- Neither migration invokes Stage/Release or creates a backfill job.
--
-- Exact relevant table security prestate:
--   segment_policy_versions: RLS on, service_role ALL policy
--   segment_policy_rules: RLS on, service_role ALL policy
--   request_segmentation_jobs: RLS on, service_role ALL policy
--   request_segment_classifications: RLS on, service_role ALL policy
--   request_segmentation_activation_approvals: RLS on, service_role ALL policy
--   master_requests: RLS on, existing organization-scoped public policies
-- All six tables retained their pre-existing table ACLs; Phase 2 does not
-- broaden them. New tables/views/RPCs are explicitly service-role-only.
--
-- Existing diagnostic views remain legacy/unversioned and are not redefined:
--   request_segmentation_gold_evaluation
--   request_segmentation_confusion_matrix
--   request_segmentation_quality_summary
--   request_segmentation_segment_quality_summary
--   request_segmentation_activation_gate_status
--   request_segmentation_activation_approval_status
--   request_segmentation_production_readiness
-- Phase 2 creates separate request_segmentation_v2_* views so historical data
-- cannot be reinterpreted.
--
-- Rollback paths:
-- A. Exact pre-runtime schema restore is permitted only before any versioned
--    runtime state exists. The mandatory fail-fast precondition is reproduced
--    below. The self-contained executable artifact is:
--    supabase/rollbacks/20260819183219_request_segmentation_phase2_full_pre_runtime_rollback.sql
--    It embeds the exact live Phase-1 function definitions/ACLs captured on
--    2026-08-19 and restores both exact UNIQUE constraints. Never force this
--    path after runtime.
-- B. After any CX8 runtime state exists, use the non-destructive operational
--    rollback artifact. It flips v2 inactive/v1 active and deliberately retains
--    every additive column/table and all v3/Gold audit evidence.
--
-- Mandatory Path-A precondition (PII-free counts only). This block is intended
-- to be run inside the full-restore transaction after the Phase-2 schema exists.
do $versioned_runtime_rows_must_be_zero$
declare
  v_jobs bigint;
  v_classifications bigint;
  v_gold bigint;
  v_master bigint;
  v_approvals bigint;
begin
  select count(*) into v_jobs
  from public.request_segmentation_jobs
  where taxonomy_version is not null;

  select count(*) into v_classifications
  from public.request_segment_classifications
  where taxonomy_version is not null;

  select count(*) into v_gold
  from public.request_segmentation_gold_adjudications;

  select count(*) into v_master
  from public.master_requests
  where segment_taxonomy_version is not null;

  select count(*) into v_approvals
  from public.request_segmentation_activation_approvals
  where taxonomy_version is not null;

  if v_jobs <> 0
     or v_classifications <> 0
     or v_gold <> 0
     or v_master <> 0
     or v_approvals <> 0 then
    raise exception using
      errcode = '55000',
      message = 'versioned_runtime_rows_must_be_zero',
      detail = format(
        'jobs=%s classifications=%s gold=%s master=%s approvals=%s',
        v_jobs, v_classifications, v_gold, v_master, v_approvals
      );
  end if;
end;
$versioned_runtime_rows_must_be_zero$;
