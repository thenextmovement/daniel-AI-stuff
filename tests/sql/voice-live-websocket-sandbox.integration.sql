\set ON_ERROR_STOP on
begin;
set local role service_role;
do $$
declare
  v_id uuid;
  v_bad jsonb;
  v_status text;
  v_caps jsonb := '{"speech_to_speech":true,"function_tools":true,"full_duplex":true,"transcript_events":true}';
  v_key text;
begin
  insert into public.voice_model_releases (release_key, model_id, transport, voice, session_config, capabilities, enabled)
  values ('sql-live-websocket', 'gpt-live-1', 'websocket', 'marin', '{"protocol":"live","delegation_model":"gpt-5.6-terra"}', v_caps, false)
  returning id into v_id;
  -- Missing capabilities/protocol, older models and unsupported transports stay blocked.
  for v_bad in select value from jsonb_array_elements('[
    {"remove":"speech_to_speech"},{"remove":"function_tools"},{"remove":"full_duplex"},{"remove":"transcript_events"},
    {"protocol":"realtime"},{"model":"gpt-realtime-2.1"},{"transport":"webrtc"},{"transport":"sip"}
  ]') loop
    update public.voice_model_releases set
      capabilities = case when v_bad ? 'remove' then v_caps - (v_bad->>'remove') else v_caps end,
      session_config = jsonb_build_object('protocol', coalesce(v_bad->>'protocol', 'live')),
      model_id = coalesce(v_bad->>'model', 'gpt-live-1'),
      transport = coalesce(v_bad->>'transport', 'websocket')
    where id = v_id;
    begin
      perform public.approve_voice_model_sandbox(v_id, 'sql-test', 'reject:' || v_bad::text);
      raise exception 'invalid contract accepted: %', v_bad;
    exception when others then
      if sqlerrm <> 'required sandbox capabilities are missing' then raise; end if;
    end;
  end loop;
  update public.voice_model_releases set capabilities = v_caps, session_config = '{"protocol":"live"}',
    model_id = 'gpt-live-1', transport = 'websocket' where id = v_id;
  select eval_status into v_status from public.approve_voice_model_sandbox(v_id, 'sql-test', 'sql-live-approve');
  if v_status <> 'contract_passed' then raise exception 'Live contract not approved'; end if;
  perform public.approve_voice_model_sandbox(v_id, 'sql-test', 'sql-live-approve');
  if (select count(*) from public.voice_platform_audit_log where idempotency_key = 'sql-live-approve') <> 1 then
    raise exception 'approval replay duplicated audit';
  end if;
  if not exists(select 1 from public.voice_model_releases where id = v_id and enabled = false
    and lifecycle = 'available' and approved_at is null and eval_status = 'contract_passed') then
    raise exception 'sandbox approval implicitly enabled or promoted model';
  end if;
  begin
    update public.voice_model_releases set lifecycle = 'production' where id = v_id;
    raise exception 'sandbox contract became production';
  exception when check_violation then null;
  end;
  update public.voice_model_releases set eval_status = 'failed' where id = v_id;
  begin
    perform public.approve_voice_model_sandbox(v_id, 'sql-test', 'sql-live-failed');
    raise exception 'failed model accepted';
  exception when others then
    if sqlerrm <> 'failed or production-evaluated release needs a new immutable release' then raise; end if;
  end;
  -- Preserve the existing SIP contract; no Live-only fields are needed there.
  update public.voice_model_releases set eval_status = 'pending', transport = 'sip', model_id = 'gpt-realtime-2.1',
    capabilities = '{"speech_to_speech":true,"function_tools":true,"sideband":true}', session_config = '{}'
  where id = v_id;
  perform public.approve_voice_model_sandbox(v_id, 'sql-test', 'sql-sip-approve');
  if has_function_privilege('anon', 'public.approve_voice_model_sandbox(uuid,text,text)', 'execute')
    or has_function_privilege('authenticated', 'public.approve_voice_model_sandbox(uuid,text,text)', 'execute') then
    raise exception 'sandbox approval exposed to client roles';
  end if;
end;
$$;
rollback;
