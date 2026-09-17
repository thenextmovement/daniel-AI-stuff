begin;
alter table public.voice_call_attempts add column control_owner text not null default 'ai'
 check(control_owner in ('ai','stopping','handoff','human'));
create table public.voice_ai_handoffs(
 id uuid primary key default gen_random_uuid(),
 attempt_id uuid not null references public.voice_call_attempts(id),
 session_id uuid not null references public.voice_call_sessions(id),
 staff_id uuid not null references public.voice_staff(id),
 device_id uuid not null references public.voice_staff_devices(id),
 request_key uuid not null,
 customer_call_sid text not null check(customer_call_sid ~ '^CA[0-9a-fA-F]{32}$'),
 phone text not null check(phone ~ '^[+][1-9][0-9]{6,14}$'),
 agent_call_sid text unique check(agent_call_sid ~ '^CA[0-9a-fA-F]{32}$'),
 conference_sid text unique check(conference_sid ~ '^CF[0-9a-fA-F]{32}$'),
 state text not null default 'preparing' check(state in ('preparing','ready','redirecting','connected','cancelled','failed')),
 agent_joined boolean not null default false,
 redirect_claimed_at timestamptz,
 connected_at timestamptz,
 capture_id uuid references public.voice_phone_captures(id),
 cleanup_pending boolean not null default false,
 cleanup_customer boolean not null default false,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '60 seconds',
 ended_at timestamptz,
 updated_at timestamptz not null default now(),
 unique(device_id,request_key)
);
create unique index voice_ai_handoff_one_attempt on public.voice_ai_handoffs(attempt_id) where ended_at is null or cleanup_pending;
create unique index voice_ai_handoff_one_staff on public.voice_ai_handoffs(staff_id) where ended_at is null or cleanup_pending;
create table public.voice_ai_handoff_events(
 handoff_id uuid not null references public.voice_ai_handoffs(id),
 event_key text not null check(char_length(event_key) between 1 and 160),
 kind text not null,
 created_at timestamptz not null default now(),
 primary key(handoff_id,event_key)
);
alter table public.voice_ai_handoffs enable row level security;
alter table public.voice_ai_handoff_events enable row level security;
revoke all on public.voice_ai_handoffs,public.voice_ai_handoff_events from public,anon,authenticated;
grant select,insert,update,delete on public.voice_ai_handoffs,public.voice_ai_handoff_events to service_role;
create policy voice_ai_handoffs_service on public.voice_ai_handoffs for all to service_role using(true) with check(true);
create policy voice_ai_handoff_events_service on public.voice_ai_handoff_events for all to service_role using(true) with check(true);

-- Existing staff entry points lock the target profile. The same lock in begin
-- prevents a simultaneous outgoing call, incoming acceptance or warm transfer.
create function public.voice_ai_handoff_staff_busy() returns trigger
 language plpgsql security definer set search_path='' as $$
declare staff uuid;session uuid;
begin
 if tg_table_name='voice_phone_calls' then staff:=new.staff_id;session:=new.id;
 else staff:=new.to_staff_id;session:=null;end if;
 if exists(select 1 from public.voice_ai_handoffs h where h.staff_id=staff and (h.ended_at is null or h.cleanup_pending)
  and h.session_id is distinct from session) then raise exception 'phone_staff_busy';end if;
 return new;
end $$;
create trigger voice_ai_handoff_call_busy before insert or update of staff_id on public.voice_phone_calls
 for each row execute function public.voice_ai_handoff_staff_busy();
create trigger voice_ai_handoff_transfer_busy before insert or update of to_staff_id on public.voice_phone_transfers
 for each row execute function public.voice_ai_handoff_staff_busy();
revoke all on function public.voice_ai_handoff_staff_busy() from public,anon,authenticated,service_role;

create function public.begin_voice_ai_handoff(p_attempt_id uuid,p_device_id uuid,p_request_key uuid,p_allowed_phones text[])
 returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.voice_call_attempts%rowtype;s public.voice_call_sessions%rowtype;t public.voice_call_targets%rowtype;
 d public.voice_staff_devices%rowtype;person public.voice_staff%rowtype;h public.voice_ai_handoffs%rowtype;
begin
 select * into a from public.voice_call_attempts where id=p_attempt_id for update;
 if not found then raise exception 'ai_handoff_not_available';end if;
 select staff_id into d.staff_id from public.voice_staff_devices where id=p_device_id;
 select * into person from public.voice_staff where id=d.staff_id and enabled for update;
 if not found then raise exception 'phone_identity_required';end if;
 select * into d from public.voice_staff_devices where id=p_device_id and staff_id=person.id and revoked_at is null and expires_at>now()+interval '1 minute';
 if not found or (d.enrolled_via='personal_access' and d.access_email is distinct from person.access_email) then raise exception 'phone_identity_required';end if;
 select * into h from public.voice_ai_handoffs where device_id=d.id and request_key=p_request_key;
 if found then
  if h.attempt_id<>p_attempt_id then raise exception 'ai_handoff_replay_conflict';end if;
  return to_jsonb(h);
 end if;
 if not d.registered or d.last_seen_at is null or d.last_seen_at<now()-interval '45 seconds' or d.last_seen_at>now()+interval '5 seconds' then raise exception 'ai_handoff_phone_not_ready';end if;
 select * into s from public.voice_call_sessions where attempt_id=a.id for update;
 select * into t from public.voice_call_targets where id=a.target_id;
 if a.status<>'live' or a.ended_at is not null or a.control_owner<>'ai' or a.provider<>'twilio'
  or a.provider_call_id is null or a.provider_call_id !~ '^CA[0-9a-fA-F]{32}$'
  or a.model_snapshot->>'model_id' is distinct from 'gpt-live-1'
  or a.context_snapshot->>'allowlist_only' is distinct from 'true'
  or s.id is null or s.status<>'live' or s.ended_at is not null or s.ai_ended_at is not null
  or s.mode<>'internal_test' or s.consent_status<>'confirmed' or not s.transcript_storage_enabled
  or (t.phone_e164=any(p_allowed_phones)) is not true or t.status<>'live'
  or not exists(select 1 from public.voice_call_events e where e.attempt_id=a.id and e.event_type='media.connected' and e.payload->>'call_id'=a.provider_call_id)
 then raise exception 'ai_handoff_not_available';end if;
 if exists(select 1 from public.voice_phone_calls where staff_id=person.id and (ended_at is null or cleanup_pending))
  or exists(select 1 from public.voice_phone_transfers where to_staff_id=person.id and (ended_at is null or cleanup_pending))
  or exists(select 1 from public.voice_ai_handoffs where (staff_id=person.id or attempt_id=a.id) and (ended_at is null or cleanup_pending))
 then raise exception 'phone_staff_busy';end if;
 insert into public.voice_ai_handoffs(attempt_id,session_id,staff_id,device_id,request_key,customer_call_sid,phone)
 values(a.id,s.id,person.id,d.id,p_request_key,a.provider_call_id,t.phone_e164) returning * into h;
 return to_jsonb(h);
end $$;

-- Stop and redirection compete on the exact attempt, before either provider
-- mutation. The caller must use the returned SID, never a client-supplied SID.
create function public.claim_voice_ai_stop(p_attempt_id uuid)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.voice_call_attempts%rowtype;
begin
 select * into a from public.voice_call_attempts where id=p_attempt_id for update;
 if not found then raise exception 'voice call attempt not found';end if;
 if a.control_owner in ('handoff','human') then
  return jsonb_build_object('allowed',false,'owner',a.control_owner);
 end if;
 update public.voice_call_attempts set control_owner='stopping',updated_at=now() where id=a.id;
 return jsonb_build_object('allowed',true,'owner','stopping','providerCallId',a.provider_call_id,'openAiCallId',a.openai_call_id);
end $$;

create function public.advance_voice_ai_handoff(p_id uuid,p_key text,p_kind text,p_call_sid text default null,
 p_conference_sid text default null,p_device_id uuid default null,p_updated_at timestamptz default null)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare h public.voice_ai_handoffs%rowtype;a public.voice_call_attempts%rowtype;s public.voice_call_sessions%rowtype;
 c public.voice_phone_calls%rowtype;attempt uuid;person uuid;redirect boolean:=false;bound boolean:=false;identity_valid boolean;
begin
 select attempt_id,staff_id into attempt,person from public.voice_ai_handoffs where id=p_id;
 select * into a from public.voice_call_attempts where id=attempt for update;
 perform 1 from public.voice_staff where id=person for update;
 select * into h from public.voice_ai_handoffs where id=p_id for update;
 if not found then raise exception 'ai_handoff_not_found';end if;
 if p_kind not in ('bind','agent_join','agent_leave','conference_end','redirect','customer_join','customer_leave','cancel','expire','failed','cleanup') then raise exception 'ai_handoff_event_invalid';end if;
 if p_device_id is not null and h.device_id<>p_device_id then raise exception 'ai_handoff_owner_required';end if;
 identity_valid:=exists(select 1 from public.voice_staff_devices d join public.voice_staff p on p.id=d.staff_id
  where d.id=h.device_id and p.id=h.staff_id and p.enabled and d.revoked_at is null and d.expires_at>now()
   and (d.enrolled_via<>'personal_access' or d.access_email is not distinct from p.access_email));

 if p_conference_sid is not null and (p_conference_sid !~ '^CF[0-9a-fA-F]{32}$' or (h.conference_sid is not null and h.conference_sid<>p_conference_sid)) then raise exception 'phone_conference_conflict';end if;
 if p_kind='bind' then
  if p_device_id is distinct from h.device_id or p_call_sid is null or p_call_sid !~ '^CA[0-9a-fA-F]{32}$'
   or p_call_sid=h.customer_call_sid or (h.agent_call_sid is not null and h.agent_call_sid<>p_call_sid) then raise exception 'phone_leg_conflict';end if;
 elsif p_kind in ('agent_join','agent_leave') then
  if h.agent_call_sid is null or p_call_sid is distinct from h.agent_call_sid or (p_kind='agent_join' and p_conference_sid is null) then raise exception 'phone_leg_conflict';end if;
 elsif p_kind in ('customer_join','customer_leave') then
  if p_call_sid is distinct from h.customer_call_sid or (p_kind='customer_join' and p_conference_sid is null) then raise exception 'phone_leg_conflict';end if;
 end if;
 insert into public.voice_ai_handoff_events(handoff_id,event_key,kind) values(h.id,p_key,p_kind) on conflict do nothing;
 if not found then return jsonb_build_object('handoff',to_jsonb(h),'redirect',false,
  'join',p_kind='bind' and identity_valid and h.ended_at is null and h.expires_at>now() and h.state in ('preparing','ready'),'duplicate',true);end if;
 if p_kind='cleanup' then
  if p_updated_at is not null and h.updated_at=p_updated_at and h.ended_at is not null and h.state<>'connected' then
   update public.voice_ai_handoffs set cleanup_pending=false,updated_at=now() where id=h.id returning * into h;
   if h.cleanup_customer then
    if exists(select 1 from public.voice_phone_calls where id=h.session_id and (ended_at is null or cleanup_pending)) then raise exception 'ai_handoff_cleanup_unconfirmed';end if;
    update public.voice_call_attempts set control_owner='stopping',updated_at=now() where id=a.id;
    perform public.finalize_voice_call_attempt_before_ai_handoff(a.id,'failed','technical_failure',
     'Die Übernahme wurde nicht bestätigt; der Telefonanbieter hat die Bereinigung bestätigt.',null,null,'{}',null,true,false,false,false,
     'provider_recovery_required','Handoff was not confirmed');
   end if;

  end if;
 elsif h.state='connected' then
  -- Normal call/transfer ownership handles all subsequent participant events.
  null;
 else
  if p_kind='bind' then
   h.agent_call_sid:=p_call_sid;bound:=true;
   if h.ended_at is not null then h.cleanup_pending:=true;end if;
  end if;
  if h.ended_at is null then
   if p_kind in ('bind','agent_join','redirect','customer_join') and not identity_valid
   then h.state:='cancelled';h.ended_at:=now();
   elsif p_kind='bind' and h.expires_at<=now() then h.state:='cancelled';h.ended_at:=now();
   elsif p_kind='agent_join' and h.state in ('preparing','ready') then
    h.agent_joined:=true;h.conference_sid:=coalesce(h.conference_sid,p_conference_sid);h.state:='ready';
   elsif p_kind='redirect' and h.state='ready' then
    select * into s from public.voice_call_sessions where id=h.session_id for update;
    if a.control_owner='ai' and a.status='live' and a.ended_at is null and s.status='live' and s.ended_at is null and s.ai_ended_at is null and h.agent_joined and h.expires_at>now() then
     update public.voice_call_attempts set control_owner='handoff',updated_at=now() where id=a.id;
     h.state:='redirecting';h.redirect_claimed_at:=now();h.expires_at:=now()+interval '30 seconds';redirect:=true;
     -- Only now does the human call ledger own the existing customer leg.
     -- The stream is reserved as dispatching for inclusion before the handoff
     -- announcement in the one provider redirect, not a second stream POST.
     insert into public.voice_phone_calls(id,device_id,staff_id,request_key,phone,request_id,state,agent_call_sid,customer_call_sid,conference_sid,
      customer_dispatch,agent_joined,customer_joined)
      values(s.id,h.device_id,h.staff_id,h.request_key,h.phone,s.bound_request_id,'connecting',h.agent_call_sid,h.customer_call_sid,h.conference_sid,
       'acknowledged',true,false) returning * into c;
     insert into public.voice_phone_captures(call_id,request_key,customer_call_sid,approved_by_staff_id,approved_by_device_id,state)
      values(c.id,h.id,h.customer_call_sid,h.staff_id,h.device_id,'dispatching') returning id into h.capture_id;
     update public.voice_call_sessions set capture_status='capturing',
      context_snapshot=context_snapshot||jsonb_build_object('ai_handoff_id',h.id,'transcription_model','gpt-live-transcribe','transcript_source','customer_call_both_tracks') where id=s.id;
    else h.state:='cancelled';h.ended_at:=now();end if;
   elsif p_kind='customer_join' and h.state='redirecting' then
    select * into s from public.voice_call_sessions where id=h.session_id for update;
    if a.control_owner<>'handoff' or not h.agent_joined or s.ended_at is not null then h.state:='failed';h.ended_at:=now();
    else
     update public.voice_phone_calls set state='connected',customer_joined=true,updated_at=now()
      where id=s.id and ended_at is null returning * into c;
     if not found then raise exception 'ai_handoff_call_ended';end if;
     update public.voice_call_sessions set operator_name=(select display_name from public.voice_staff where id=h.staff_id),
      context_snapshot=context_snapshot||jsonb_build_object('staff_id',h.staff_id),updated_at=now() where id=s.id;
     h.state:='connected';h.connected_at:=now();h.ended_at:=now();h.cleanup_pending:=false;
     update public.voice_call_attempts set control_owner='human',updated_at=now() where id=a.id;
     perform public.finalize_voice_call_attempt_before_ai_handoff(a.id,'handed_off','needs_human_followup',
      'Ein Mitarbeiter hat den bestehenden Anruf übernommen.',null,null,'{}',null,true,true);
    end if;
   elsif p_kind in ('cancel','expire') then
    -- Cancellation before redirection affects only the waiting employee. Once
    -- dispatch is claimed, wait for its bounded outcome instead of pretending
    -- the caller has safely returned to the old AI stream.
    if h.redirect_claimed_at is null and (p_kind='cancel' or h.expires_at<=now()) then h.state:='cancelled';h.ended_at:=now();
    elsif p_kind='expire' and h.expires_at<=now() then h.state:='failed';h.ended_at:=now();end if;
   elsif p_kind in ('agent_leave','conference_end','customer_leave','failed') then
    h.state:='failed';h.ended_at:=now();
   end if;
  end if;
  if h.ended_at is not null and h.state<>'connected' then
   h.cleanup_pending:=h.agent_call_sid is not null or h.redirect_claimed_at is not null;
   h.cleanup_customer:=h.redirect_claimed_at is not null;
   if h.cleanup_customer then
    perform public.apply_voice_phone_event(h.session_id,'handoff:failed:'||h.id,'cancel');
   end if;

  end if;
  update public.voice_ai_handoffs set state=h.state,agent_call_sid=h.agent_call_sid,conference_sid=h.conference_sid,agent_joined=h.agent_joined,
   redirect_claimed_at=h.redirect_claimed_at,connected_at=h.connected_at,capture_id=h.capture_id,expires_at=h.expires_at,
   ended_at=h.ended_at,cleanup_pending=h.cleanup_pending,cleanup_customer=h.cleanup_customer,updated_at=now() where id=h.id returning * into h;
 end if;
 return jsonb_build_object('handoff',to_jsonb(h),'redirect',redirect,
  'join',bound and h.ended_at is null and h.state in ('preparing','ready'),'duplicate',false);
end $$;

-- A detached AI socket is expected during redirection. Its generic close result
-- may not decide the outcome before the signed human/customer join is known.
alter function public.finalize_voice_call_attempt(uuid,text,text,text,text,text,text[],timestamptz,boolean,boolean,boolean,boolean,text,text)
 rename to finalize_voice_call_attempt_before_ai_handoff;
revoke all on function public.finalize_voice_call_attempt_before_ai_handoff(uuid,text,text,text,text,text,text[],timestamptz,boolean,boolean,boolean,boolean,text,text) from public,anon,authenticated,service_role;
create function public.finalize_voice_call_attempt(
 p_attempt_id uuid,p_terminal_status text,p_outcome_code text,p_summary_for_human text,
 p_customer_intent text default null,p_product_interest text default null,p_objections text[] default '{}',
 p_callback_at timestamptz default null,p_handoff_requested boolean default false,p_handoff_completed boolean default false,
 p_customer_requested_stop boolean default false,p_unsafe_or_unsupported_request boolean default false,
 p_failure_code text default null,p_failure_detail text default null)
 returns table(attempt_id uuid,target_status text,duplicate boolean) language plpgsql security definer set search_path='' as $$
declare a public.voice_call_attempts%rowtype;
begin
 select * into a from public.voice_call_attempts where id=p_attempt_id for update;
 if a.control_owner in ('handoff','human') then
  return query select a.id,t.status,true from public.voice_call_targets t where t.id=a.target_id;
  return;
 end if;
 return query select * from public.finalize_voice_call_attempt_before_ai_handoff(
  p_attempt_id,p_terminal_status,p_outcome_code,p_summary_for_human,p_customer_intent,p_product_interest,p_objections,
  p_callback_at,p_handoff_requested,p_handoff_completed,p_customer_requested_stop,p_unsafe_or_unsupported_request,p_failure_code,p_failure_detail);
end $$;
revoke all on function public.begin_voice_ai_handoff(uuid,uuid,uuid,text[]),public.claim_voice_ai_stop(uuid),
 public.advance_voice_ai_handoff(uuid,text,text,text,text,uuid,timestamptz),
 public.finalize_voice_call_attempt(uuid,text,text,text,text,text,text[],timestamptz,boolean,boolean,boolean,boolean,text,text) from public,anon,authenticated;
grant execute on function public.begin_voice_ai_handoff(uuid,uuid,uuid,text[]),public.claim_voice_ai_stop(uuid),
 public.advance_voice_ai_handoff(uuid,text,text,text,text,uuid,timestamptz),
 public.finalize_voice_call_attempt(uuid,text,text,text,text,text,text[],timestamptz,boolean,boolean,boolean,boolean,text,text) to service_role;

create or replace function public.persist_voice_runtime_transcript(p_attempt_id uuid,p_segments jsonb,p_finish text default null)
 returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.voice_call_sessions%rowtype;a public.voice_call_attempts%rowtype;item jsonb;coverage text;human boolean;
begin
 select * into s from public.voice_call_sessions where attempt_id=p_attempt_id for update;
 if not found then raise exception 'transcript_session_missing';end if;
 select * into a from public.voice_call_attempts where id=p_attempt_id;
 if not found then raise exception 'voice call attempt not found';end if;
 if (s.ai_ended_at is not null and s.ai_ended_at<now()-interval '5 minutes')
  or (a.ended_at is not null and a.ended_at<now()-interval '5 minutes') then raise exception 'transcript_session_closed';end if;
 if p_segments is null or jsonb_typeof(p_segments)<>'array' or jsonb_array_length(p_segments)>50 then raise exception 'invalid_transcript_batch';end if;
 if p_finish is not null and p_finish not in ('complete','interrupted') then raise exception 'invalid_transcript_finish';end if;
 for item in select value from jsonb_array_elements(p_segments) loop
  -- Human stream IDs are capture-UUID:track:item. A late AI write cannot claim
  -- their namespace or introduce an employee utterance.
  if (item->>'speaker' in ('customer','assistant')) is not true or
   coalesce(item->>'id','') ~ '^[0-9a-fA-F-]{36}:(inbound|outbound):'
   then raise exception 'runtime_transcript_speaker_binding';end if;
 end loop;
 perform public.persist_voice_transcript(s.id,s.transcript_write_token_hash,p_segments,null);
 human:=a.control_owner in ('handoff','human') or exists(select 1 from public.voice_phone_calls where id=s.id);
 update public.voice_call_sessions set
  ai_capture_status=case when ai_capture_status='interrupted' or p_finish='interrupted' then 'interrupted'
   when p_finish='complete' then 'complete' else coalesce(ai_capture_status,'capturing') end,
  ai_ended_at=coalesce(ai_ended_at,case when p_finish is not null then now() else a.ended_at end),
  status=case when not human and ended_at is null then
   case when a.status in ('completed','failed','cancelled','handed_off') then case when a.status='handed_off' then 'completed' else a.status end
    when p_finish='complete' then 'completed' when p_finish='interrupted' then 'cancelled' else status end else status end,
  ended_at=case when not human then coalesce(ended_at,a.ended_at,case when p_finish is not null then now() end) else ended_at end
 where id=s.id;
 coverage:=public.refresh_voice_ai_capture(s.id);
 return jsonb_build_object('saved',true,'captureStatus',coverage,'humanContinuation',human);
end $$;

commit;
