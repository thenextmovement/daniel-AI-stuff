revoke all on function public.accept_landing_request(jsonb, jsonb)
  from public, anon, authenticated, service_role;

drop function if exists public.accept_landing_request(jsonb, jsonb);
