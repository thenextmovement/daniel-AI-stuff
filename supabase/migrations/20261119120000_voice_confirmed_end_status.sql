create or replace function public.confirm_voice_placetel_end(p_session uuid,p_phone text,p_started timestamptz,p_duration integer)
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
  if c.provider_ended_at is not null and c.provider_ended_at<>ended then return false; end if;
  update public.voice_placetel_calls set provider_ended_at=ended,
    next_check=case when recording_status in ('pending','missing') then least(next_check,now()) else next_check end where session_id=c.session_id;
  -- Call completion is independent from recording/transcript completion.
  update public.voice_call_sessions set status='completed',ended_at=ended,updated_at=now()
    where id=c.session_id and status in ('created','live');
  return true;
end $$;


-- Repair only provider-confirmed direct calls; do not manufacture transcript status.
update public.voice_call_sessions s set status='completed',ended_at=c.provider_ended_at,updated_at=now()
from public.voice_placetel_calls c where c.session_id=s.id and c.dispatch_status='accepted'
  and c.provider_ended_at is not null and s.status in ('created','live')
  and s.context_snapshot->>'placetel_direct'='true' and s.bound_request_id is not null;
