begin;

drop function if exists public.claim_dunning_insolvency_check(
  text, text, timestamptz, text, jsonb, text
);

drop table if exists public.dunning_insolvency_checks;

commit;
