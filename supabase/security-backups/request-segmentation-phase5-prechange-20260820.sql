-- NEONTRIP Phase-5 PII-free prechange snapshot.
-- Read-only. No request IDs, customer IDs, names, domains, email addresses,
-- free text, Evidence URLs, or other customer data are selected.
-- Expected live baseline on 2026-08-20:
--   active policy/gate: Phase-2 v2 / classifier-v3 / prompt-v4
--   immutable Gold: 4 (NT-3=2, NT-4=1, NT-8=1)
--   exact Gold evaluation: 4 abstentions, 0 accepted, 0 missing
--   candidate v4 jobs/classifications/cache/master authority/approvals: 0

select
  p.version,
  p.active,
  p.mode,
  p.taxonomy_version,
  p.classifier_version,
  p.prompt_version,
  p.quality_gate_version
from public.segment_policy_versions p
order by p.created_at, p.version;

select
  q.version,
  q.active,
  q.taxonomy_version,
  q.classifier_version,
  q.prompt_version,
  q.min_unique_gold_total,
  q.min_gold_per_segment,
  q.min_precision_per_predicted_class,
  q.min_recall_per_actual_class,
  q.min_accepted_coverage,
  q.required_mapping_integrity,
  q.max_provenance_violations,
  q.manual_activation_required
from public.segment_quality_gate_versions q
order by q.created_at, q.version;

select
  r.policy_version,
  count(*)::integer as rule_count,
  count(*) filter (
    where r.automation_enabled
       or r.needs_human_review
       or r.price_factor is not null
       or r.max_followups <> 0
       or r.first_call_after_minutes is not null
       or r.call_sequence <> '[]'::jsonb
       or r.email_sequence <> '[]'::jsonb
  )::integer as non_inert_rule_count
from public.segment_policy_rules r
where r.policy_version in (
  'nt_policy_v2_20260819_cx8_shadow',
  'nt_policy_v3_20260820_cx8_shadow'
)
group by r.policy_version
order by r.policy_version;

select
  g.taxonomy_version,
  g.labeling_version,
  g.labeled_segment,
  count(*)::integer as immutable_gold_count
from public.request_segmentation_gold_adjudications g
group by g.taxonomy_version, g.labeling_version, g.labeled_segment
order by g.taxonomy_version, g.labeling_version, g.labeled_segment;

select
  j.taxonomy_version,
  j.classifier_version,
  j.prompt_version,
  j.status,
  lower(coalesce(j.metadata->>'evaluation_only', 'false')) = 'true' as evaluation_only,
  count(*)::integer as job_count
from public.request_segmentation_jobs j
where j.taxonomy_version is not null
group by
  j.taxonomy_version,
  j.classifier_version,
  j.prompt_version,
  j.status,
  lower(coalesce(j.metadata->>'evaluation_only', 'false')) = 'true'
order by 1, 2, 3, 4, 5;

select
  c.taxonomy_version,
  c.classifier_version,
  c.prompt_version,
  c.status,
  count(*)::integer as classification_count,
  count(*) filter (where c.status = 'accepted')::integer as accepted_count,
  count(*) filter (where c.evidence_provenance_valid)::integer as provenance_valid_count,
  count(*) filter (where c.mapping_integrity)::integer as mapping_valid_count
from public.request_segment_classifications c
where c.taxonomy_version is not null
group by c.taxonomy_version, c.classifier_version, c.prompt_version, c.status
order by 1, 2, 3, 4;

select
  s.taxonomy_version,
  s.classifier_version,
  s.prompt_version,
  s.quality_gate_version,
  s.unique_gold_examples,
  s.evaluated_examples,
  s.accepted_predictions,
  s.correct_predictions,
  s.wrong_segment_predictions,
  s.abstained_predictions,
  s.missing_predictions,
  s.accepted_coverage,
  s.overall_precision_on_accepted,
  s.accepted_mapping_violations,
  s.accepted_provenance_violations
from public.request_segmentation_v2_quality_summary s;

select
  'candidate_runtime_rows'::text as check_name,
  (select count(*) from public.request_segmentation_jobs j
    where j.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
      and j.classifier_version = 'segment_classifier_v4_20260820_cx8'
      and j.prompt_version = 'segment_prompt_v4_20260819_cx8')::integer as jobs,
  (select count(*) from public.request_segment_classifications c
    where c.taxonomy_version = 'nt_taxonomy_v2_20260819_cx8'
      and c.classifier_version = 'segment_classifier_v4_20260820_cx8'
      and c.prompt_version = 'segment_prompt_v4_20260819_cx8')::integer as classifications,
  (select count(*) from public.segment_research_cache c
    where c.summary_json->>'taxonomy_version' = 'nt_taxonomy_v2_20260819_cx8'
      and c.summary_json->>'classifier_version' = 'segment_classifier_v4_20260820_cx8'
      and c.summary_json->>'prompt_version' = 'segment_prompt_v4_20260819_cx8')::integer as cache_rows,
  (select count(*) from public.master_requests mr
    where mr.segment_policy_version = 'nt_policy_v3_20260820_cx8_shadow')::integer as master_authority_rows,
  (select count(*) from public.request_segmentation_activation_approvals a
    where a.policy_version = 'nt_policy_v3_20260820_cx8_shadow'
       or a.quality_gate_version = 'nt_quality_gate_v3_20260820_cx8')::integer as approval_rows;

select
  p.oid::regprocedure::text as function_signature,
  p.prosecdef as security_definer,
  md5(pg_get_functiondef(p.oid)) as definition_md5,
  coalesce(
    array_agg(distinct coalesce(grantee.rolname, 'PUBLIC'))
      filter (where acl.privilege_type = 'EXECUTE'),
    '{}'::text[]
  ) as execute_grantees
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
left join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl on true
left join pg_roles grantee on grantee.oid = acl.grantee
where n.nspname = 'public'
  and p.proname in (
    'neontrip_adjudicate_request_segmentation_gold',
    'neontrip_enqueue_request_segmentation_evaluation',
    'neontrip_get_request_segmentation_review_context',
    'neontrip_record_request_segment_classification',
    'neontrip_upsert_segment_research_cache_from_classification'
  )
group by p.oid, p.prosecdef
order by p.oid::regprocedure::text;

select
  c.relname as view_name,
  coalesce((c.reloptions @> array['security_invoker=true']), false) as security_invoker
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'v'
  and c.relname like 'request_segmentation_v%\_%' escape '\'
order by c.relname;
