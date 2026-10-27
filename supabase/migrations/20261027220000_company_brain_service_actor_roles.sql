begin;
alter table public.company_brain_actor_roles drop constraint company_brain_actor_roles_email_check;
alter table public.company_brain_actor_roles add constraint company_brain_actor_roles_email_check check (
  actor_email = lower(btrim(actor_email))
  and (
    actor_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or actor_email ~ '^[0-9a-f]{32}[.]access$'
  )
);
comment on constraint company_brain_actor_roles_email_check on public.company_brain_actor_roles is 'Normalized email or verified Cloudflare Access service-token common_name. This format check grants no role by itself.';
commit;
