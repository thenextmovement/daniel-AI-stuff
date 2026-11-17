alter table public.voice_placetel_calls
  add column provider_ended_at timestamptz,
  add column provider_checked_at timestamptz;

create function public.claim_voice_placetel_end_check(p_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.voice_placetel_calls%rowtype; st public.voice_staff%rowtype;
begin
  select q.* into c from public.voice_placetel_calls q
    join public.voice_call_sessions s on s.id=q.session_id
    where q.provider_ended_at is null and q.dispatch_status='accepted' and q.dialed_at > now()-interval '24 hours'
      and s.context_snapshot->>'placetel_direct'='true' and s.bound_request_id is not null
      and (p_key is null or q.dispatch_key=p_key)
      and (q.provider_checked_at is null or q.provider_checked_at < now()-
        case when p_key is not null then interval '4 seconds' else interval '1 minute' end)
    order by q.provider_checked_at nulls first,q.dialed_at desc limit 1 for update of q skip locked;
  if not found then return null; end if;
  select * into strict st from public.voice_staff where id=c.staff_id;
  update public.voice_placetel_calls set provider_checked_at=now() where session_id=c.session_id;
  return jsonb_build_object('session_id',c.session_id,'phone',c.phone,'dialed_at',c.dialed_at,
    'target_id',st.placetel_target_id,'employee_id',st.placetel_employee_id,'extension',st.extension);
end $$;

create function public.confirm_voice_placetel_end(p_session uuid,p_phone text,p_started timestamptz,p_duration integer)
returns boolean language plpgsql security definer set search_path='' as $$
declare c public.voice_placetel_calls%rowtype; ended timestamptz;
begin
  select * into strict c from public.voice_placetel_calls where session_id=p_session for update;
  ended:=p_started+make_interval(secs=>p_duration);
  if c.dispatch_status<>'accepted' or c.dialed_at is null or c.phone is distinct from p_phone
    or p_started is null or p_started not between c.dialed_at-interval '5 seconds' and c.dialed_at+interval '120 seconds'
    or p_duration is null or p_duration not between 0 and 86400 or ended>now()
    or not exists(select from public.voice_call_sessions s where s.id=c.session_id
         and s.bound_request_id is not null and s.context_snapshot->>'placetel_direct'='true')
    then return false; end if;
  if exists(select from public.voice_placetel_calls q where q.session_id<>c.session_id and q.staff_id=c.staff_id
    and q.phone=c.phone and q.dispatch_status<>'rejected'
    and p_started between q.dialed_at-interval '5 seconds' and q.dialed_at+interval '120 seconds')
    then return false; end if;
  if c.provider_ended_at is not null then return c.provider_ended_at=ended; end if;
  update public.voice_placetel_calls set provider_ended_at=ended where session_id=c.session_id;
  return true;
end $$;

revoke all on function public.claim_voice_placetel_end_check(uuid),public.confirm_voice_placetel_end(uuid,text,timestamptz,integer) from public,anon,authenticated;
grant execute on function public.claim_voice_placetel_end_check(uuid),public.confirm_voice_placetel_end(uuid,text,timestamptz,integer) to service_role;
