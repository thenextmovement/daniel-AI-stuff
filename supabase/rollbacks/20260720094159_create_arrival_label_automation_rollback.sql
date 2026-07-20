revoke execute on function public.arrival_labels_claim_case(uuid, text, integer, timestamptz) from service_role;
drop function if exists public.arrival_labels_claim_case(uuid, text, integer, timestamptz);

drop table if exists public.arrival_label_artifacts;
drop table if exists public.arrival_label_events;
drop table if exists public.arrival_label_run_cases;
drop table if exists public.arrival_label_cases;
drop table if exists public.arrival_label_runs;
drop table if exists public.arrival_label_product_config;
