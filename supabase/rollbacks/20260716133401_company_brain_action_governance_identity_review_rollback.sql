drop function if exists public.approve_company_brain_action_run(uuid, text, text);

drop table if exists public.company_identity_review_queue;
drop table if exists public.company_brain_action_approvals;
drop table if exists public.company_brain_action_runs;
drop table if exists public.company_brain_action_policies;
drop table if exists public.company_brain_actor_roles;

drop function if exists public.guard_company_brain_action_approval();
drop function if exists public.guard_company_brain_action_run_input();
