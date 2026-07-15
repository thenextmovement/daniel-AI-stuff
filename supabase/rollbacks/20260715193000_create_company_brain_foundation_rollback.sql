drop function if exists public.resolve_company_entity_alias(text, text, text);

drop table if exists public.company_brain_evaluation_cases;
drop table if exists public.company_data_quality_issues;
drop table if exists public.company_entity_state;
drop table if exists public.company_entity_relations;
drop table if exists public.company_evidence;
drop table if exists public.company_events;
drop table if exists public.company_identity_resolution_log;
drop table if exists public.company_entity_aliases;
drop table if exists public.company_entity_registry;
drop table if exists public.company_correlation_contracts;
drop table if exists public.company_workflow_registry;
drop table if exists public.company_source_registry;

drop function if exists public.touch_company_brain_updated_at();
