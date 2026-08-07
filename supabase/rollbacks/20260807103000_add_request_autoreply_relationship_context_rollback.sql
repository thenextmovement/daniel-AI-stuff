begin;

revoke all on function public.get_request_autoreply_relationship_context(text, text)
  from public, anon, authenticated, service_role;
drop function if exists public.get_request_autoreply_relationship_context(text, text);

commit;
