-- Obtain routing mode only from the server-bound OPS session.
create function public.claim_voice_placetel_dial_mode(p_dispatch_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare claim jsonb; direct boolean;
begin
  claim := public.claim_voice_placetel_dial(p_dispatch_key);
  if claim->>'dispatch' = 'true' then
    select coalesce((s.context_snapshot->>'placetel_direct')::boolean,false) into strict direct
    from public.voice_call_sessions s where s.id=(claim->>'session_id')::uuid;
    return claim || jsonb_build_object('direct',direct);
  end if;
  return claim;
end $$;
revoke all on function public.claim_voice_placetel_dial_mode(uuid) from public,anon,authenticated;
grant execute on function public.claim_voice_placetel_dial_mode(uuid) to service_role;
