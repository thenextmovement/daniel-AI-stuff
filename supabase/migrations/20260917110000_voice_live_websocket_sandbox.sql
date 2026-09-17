create or replace function public.approve_voice_model_sandbox(
  p_release_id uuid,
  p_actor text,
  p_idempotency_key text
)
returns table (release_id uuid, eval_status text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_release public.voice_model_releases%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext('voice_model_sandbox:' || p_release_id::text));
  if exists (select 1 from public.voice_platform_audit_log where idempotency_key = p_idempotency_key) then
    return query select p_release_id, coalesce((select model.eval_status from public.voice_model_releases model where model.id = p_release_id), 'pending');
    return;
  end if;
  select * into v_release from public.voice_model_releases where id = p_release_id for update;
  if v_release.id is null or v_release.lifecycle not in ('available', 'candidate') then
    raise exception 'model release cannot be approved for sandbox';
  end if;
  if v_release.eval_status not in ('pending', 'contract_passed') then
    raise exception 'failed or production-evaluated release needs a new immutable release';
  end if;
  -- A primary Live WebSocket carries audio and delegated tools on one connection;
  -- it does not have a SIP sideband. Both paths still require explicit approval.
  if v_release.provider <> 'openai'
     or coalesce((v_release.capabilities ->> 'speech_to_speech')::boolean, false) is not true
     or coalesce((v_release.capabilities ->> 'function_tools')::boolean, false) is not true
     or not (
       (v_release.transport = 'sip'
        and coalesce((v_release.capabilities ->> 'sideband')::boolean, false))
       or (v_release.transport = 'websocket'
        and v_release.model_id = 'gpt-live-1'
        and coalesce(v_release.session_config ->> 'protocol', '') = 'live'
        and coalesce((v_release.capabilities ->> 'full_duplex')::boolean, false)
        and coalesce((v_release.capabilities ->> 'transcript_events')::boolean, false))
     ) then
    raise exception 'required sandbox capabilities are missing';
  end if;
  update public.voice_model_releases
  set eval_status = 'contract_passed', updated_at = now()
  where id = p_release_id;
  insert into public.voice_platform_audit_log (actor, action, target_type, target_id, idempotency_key, metadata)
  values (p_actor, 'model_sandbox_contract_approved', 'voice_model_release', p_release_id::text, p_idempotency_key,
    jsonb_build_object('provider', v_release.provider, 'model_id', v_release.model_id, 'transport', v_release.transport));
  return query select p_release_id, 'contract_passed'::text;
end;
$$;

revoke all on function public.approve_voice_model_sandbox(uuid, text, text) from public, anon, authenticated;
grant execute on function public.approve_voice_model_sandbox(uuid, text, text) to service_role;
