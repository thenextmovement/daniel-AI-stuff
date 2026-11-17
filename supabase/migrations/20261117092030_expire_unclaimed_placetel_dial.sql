create or replace function public.claim_voice_placetel_recording()
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.voice_placetel_calls%rowtype;
begin
  -- A reservation that was never claimed cannot have reached Placetel.
  select q.* into c from public.voice_placetel_calls q
    where q.dispatch_status='reserved' and q.reserved_at <= now()-interval '90 seconds'
    order by q.reserved_at,q.session_id limit 1 for update of q skip locked;
  if found then
    update public.voice_placetel_calls set dispatch_status='rejected',recording_status='expired',failure_reported=true
      where session_id=c.session_id;
    update public.voice_call_sessions set status='failed',capture_status='interrupted',ended_at=now(),updated_at=now()
      where id=c.session_id and status in ('created','live');
    return jsonb_build_object('session_id',c.session_id,'expired_reservation',true,'notify',true,'status','rejected');
  end if;
  select q.* into c from public.voice_placetel_calls q join public.voice_call_sessions s on s.id=q.session_id
    where q.dispatch_status in ('dispatched','accepted','uncertain') and q.recording_status in ('pending','failed','missing')
      and q.next_check<=now() and (q.lease_until is null or q.lease_until<=now())
      and s.consent_status='confirmed' and s.transcript_storage_enabled and s.mode<>'internal_test' and s.bound_request_id is not null
      and s.status in ('created','live','completed')
    order by q.next_check,q.session_id limit 1 for update of q skip locked;
  if not found then return null; end if;
  update public.voice_placetel_calls set lease_id=gen_random_uuid(),lease_until=now()+interval '20 minutes'
    where session_id=c.session_id returning * into c;
  return jsonb_build_object('session_id',c.session_id,'phone',c.phone,'dialed_at',c.dialed_at,'lease_id',c.lease_id,
    'source_phone',c.source_phone,'provider_id',c.provider_id);
end $$;
