\set ON_ERROR_STOP on

do $$
declare
  v_prompt_id uuid;
  v_follow_prompt_id uuid;
  v_model_id uuid;
  v_consent_id uuid;
  v_consent_2_id uuid;
  v_consent_3_id uuid;
  v_consent_4_id uuid;
  v_campaign_id uuid;
  v_target_id uuid;
  v_target_3_id uuid;
  v_target_4_id uuid;
  v_attempt_id uuid;
  v_event_id uuid;
  v_duplicate boolean;
  v_eligible boolean;
  v_count integer;
begin
  update public.voice_model_releases
  set eval_status = 'contract_passed', eval_score = null, approved_by = null, approved_at = null, enabled = true
  where model_id = 'gpt-realtime-2.1'
  returning id into v_model_id;

  update public.voice_prompt_versions
  set status = 'approved', approved_by = 'sql-test', approved_at = now()
  where mode = 'lead_qualification'
  returning id into v_prompt_id;

  update public.voice_prompt_versions
  set status = 'approved', approved_by = 'sql-test', approved_at = now()
  where mode = 'follow_up'
  returning id into v_follow_prompt_id;

  insert into public.voice_contact_consents (
    request_id, phone_e164, phone_hash, purposes, status, consent_wording, form_version,
    source, source_ref, evidence_hash, granted_at, evidence_retain_until, idempotency_key
  ) values (
    'REQ-SQL-1', '+4915111111111', 'phone-hash-1', array['lead_qualification'], 'granted',
    'Ausdrueckliche Testeinwilligung fuer einen KI-gestuetzten Telefonkontakt.', 'sql-v1',
    'sql-test', 'submission-1', 'evidence-1', now() - interval '6 years', now(), 'consent-1'
  ) returning id into v_consent_id;

  insert into public.voice_test_allowlist (phone_e164, phone_hash, label, approved_by)
  values ('+4915111111111', 'phone-hash-1', 'SQL Test', 'sql-test');

  insert into public.voice_call_campaigns (
    name, mode, status, model_channel, prompt_version_id, allowlist_only,
    contact_window_start, contact_window_end, allowed_weekdays,
    created_by, activated_by, activated_at
  ) values (
    'SQL Sandbox', 'lead_qualification', 'active', 'candidate', v_prompt_id, true,
    '00:00', '23:59', array[1, 2, 3, 4, 5, 6, 7]::smallint[],
    'sql-test', 'sql-test', now()
  ) returning id into v_campaign_id;

  insert into public.voice_call_targets (
    campaign_id, request_id, consent_id, phone_e164, phone_hash, idempotency_key
  ) values (
    v_campaign_id, 'REQ-SQL-1', v_consent_id, '+4915111111111', 'phone-hash-1', 'target-1'
  ) returning id into v_target_id;

  update public.voice_runtime_settings
  set global_enabled = true, internal_test_calls_enabled = true, customer_calls_enabled = false, max_concurrent_calls = 1;

  select attempt_id into v_attempt_id from public.claim_next_voice_call('sql-worker', 120);
  if v_attempt_id is null then raise exception 'eligible call was not claimed'; end if;
  if not exists (
    select 1 from public.voice_contact_consents
    where id = v_consent_id and evidence_retain_until >= now() + interval '4 years 11 months'
  ) then
    raise exception 'consent evidence retention was not extended after use';
  end if;
  select eligible into v_eligible from public.check_voice_call_attempt_eligibility(v_attempt_id);
  if not v_eligible then raise exception 'freshly claimed call failed the second eligibility gate'; end if;
  select count(*) into v_count from public.claim_next_voice_call('sql-worker-2', 120);
  if v_count <> 0 then raise exception 'concurrency gate allowed a second claim'; end if;

  select event_id, duplicate into v_event_id, v_duplicate
  from public.record_voice_call_event(v_attempt_id, 'runtime', 'sql.test', 'event-1');
  if v_duplicate then raise exception 'first event was marked duplicate'; end if;
  select event_id, duplicate into v_event_id, v_duplicate
  from public.record_voice_call_event(v_attempt_id, 'runtime', 'sql.test', 'event-1');
  if not v_duplicate then raise exception 'duplicate event was not detected'; end if;

  perform public.finalize_voice_call_attempt(
    v_attempt_id, 'completed', 'qualified_lead', 'SQL integration result',
    'qualified', 'neon sign', array[]::text[], null, false, false, false, false, null, null
  );
  select duplicate into v_duplicate from public.finalize_voice_call_attempt(
    v_attempt_id, 'completed', 'qualified_lead', 'SQL integration result',
    'qualified', 'neon sign', array[]::text[], null, false, false, false, false, null, null
  );
  if not v_duplicate then raise exception 'duplicate finalization was not detected'; end if;

  insert into public.voice_call_targets (
    campaign_id, request_id, consent_id, phone_e164, phone_hash, idempotency_key
  ) values (
    v_campaign_id, 'REQ-WRONG', v_consent_id, '+4915111111111', 'phone-hash-1', 'target-wrong-consent'
  );
  select count(*) into v_count from public.claim_next_voice_call('sql-worker', 120);
  if v_count <> 0 then raise exception 'request-bound consent gate failed'; end if;

  delete from public.voice_call_targets where idempotency_key = 'target-wrong-consent';
  insert into public.voice_contact_consents (
    request_id, phone_e164, phone_hash, purposes, status, consent_wording, form_version,
    source, source_ref, evidence_hash, granted_at, evidence_retain_until, idempotency_key
  ) values (
    'REQ-SQL-2', '+4915111111111', 'phone-hash-1', array['lead_qualification'], 'granted',
    'Ausdrueckliche zweite Testeinwilligung fuer einen KI-gestuetzten Telefonkontakt.', 'sql-v1',
    'sql-test', 'submission-2', 'evidence-2', now() - interval '1 minute', now() + interval '5 years', 'consent-2'
  ) returning id into v_consent_2_id;
  insert into public.voice_call_targets (
    campaign_id, request_id, consent_id, phone_e164, phone_hash, idempotency_key
  ) values (
    v_campaign_id, 'REQ-SQL-2', v_consent_2_id, '+4915111111111', 'phone-hash-1', 'target-2'
  );
  update public.voice_model_releases set enabled = false where id = v_model_id;
  select count(*) into v_count from public.claim_next_voice_call('sql-worker', 120);
  if v_count <> 0 then raise exception 'model kill switch failed'; end if;

  update public.voice_model_releases set enabled = true where id = v_model_id;
  select attempt_id into v_attempt_id from public.claim_next_voice_call('sql-worker', 120);
  if v_attempt_id is null then raise exception 'retry target was not claimed after model re-enable'; end if;
  perform public.finalize_voice_call_attempt(
    v_attempt_id, 'completed', 'do_not_call', 'Customer requested an immediate stop',
    null, null, array[]::text[], null, false, false, true, false, null, null
  );
  if not exists (select 1 from public.voice_do_not_call where request_id = 'REQ-SQL-2' and active) then
    raise exception 'customer stop did not create a DNC record';
  end if;
  if not exists (select 1 from public.voice_call_targets where idempotency_key = 'target-2' and status = 'blocked') then
    raise exception 'customer stop did not block the target';
  end if;

  insert into public.voice_contact_consents (
    request_id, phone_e164, phone_hash, purposes, status, consent_wording, form_version,
    source, source_ref, evidence_hash, granted_at, evidence_retain_until, idempotency_key
  ) values (
    'REQ-SQL-3', '+4915222222222', 'phone-hash-3', array['lead_qualification'], 'granted',
    'Ausdrueckliche dritte Testeinwilligung fuer einen KI-gestuetzten Telefonkontakt.', 'sql-v1',
    'sql-test', 'submission-3', 'evidence-3', now() - interval '1 minute', now() + interval '5 years', 'consent-3'
  ) returning id into v_consent_3_id;
  insert into public.voice_test_allowlist (phone_e164, phone_hash, label, approved_by)
  values ('+4915222222222', 'phone-hash-3', 'SQL Provider Recovery', 'sql-test');
  insert into public.voice_call_targets (
    campaign_id, request_id, consent_id, phone_e164, phone_hash, idempotency_key
  ) values (
    v_campaign_id, 'REQ-SQL-3', v_consent_3_id, '+4915222222222', 'phone-hash-3', 'target-3'
  ) returning id into v_target_3_id;
  select attempt_id into v_attempt_id from public.claim_next_voice_call('sql-worker', 120);
  if v_attempt_id is null then raise exception 'provider recovery target was not claimed'; end if;
  perform public.finalize_voice_call_attempt(
    v_attempt_id, 'failed', 'technical_failure', 'Provider create result is uncertain',
    null, null, array[]::text[], null, false, false, false, false,
    'telephony_start_uncertain', 'test uncertainty'
  );
  if not exists (
    select 1 from public.voice_call_targets
    where id = v_target_3_id and status = 'blocked' and blocked_reason = 'manual_provider_reconciliation_required'
  ) then
    raise exception 'uncertain provider create was allowed to retry automatically';
  end if;
  perform public.resolve_voice_provider_uncertainty(
    v_target_3_id, 'confirmed_no_call', 'sql-test', 'provider-resolution-3'
  );
  if not exists (
    select 1 from public.voice_call_targets
    where id = v_target_3_id and status = 'retry' and blocked_reason is null
  ) then
    raise exception 'provider reconciliation did not atomically requeue the confirmed no-call target';
  end if;
  if not exists (
    select 1 from public.voice_platform_audit_log
    where idempotency_key = 'provider-resolution-3' and action = 'provider_uncertainty_resolved'
  ) then
    raise exception 'provider reconciliation was not audited';
  end if;
  select duplicate into v_duplicate from public.resolve_voice_provider_uncertainty(
    v_target_3_id, 'confirmed_no_call', 'sql-test', 'provider-resolution-3'
  );
  if not v_duplicate then raise exception 'provider reconciliation replay was not idempotent'; end if;
  update public.voice_call_targets set status = 'cancelled' where id = v_target_3_id;

  insert into public.voice_contact_consents (
    request_id, phone_e164, phone_hash, purposes, status, consent_wording, form_version,
    source, source_ref, evidence_hash, granted_at, evidence_retain_until, idempotency_key
  ) values (
    'REQ-SQL-4', '+4915333333333', 'phone-hash-4', array['lead_qualification'], 'granted',
    'Ausdrueckliche vierte Testeinwilligung fuer einen KI-gestuetzten Telefonkontakt.', 'sql-v1',
    'sql-test', 'submission-4', 'evidence-4', now() - interval '1 minute', now() + interval '5 years', 'consent-4'
  ) returning id into v_consent_4_id;
  insert into public.voice_test_allowlist (phone_e164, phone_hash, label, approved_by)
  values ('+4915333333333', 'phone-hash-4', 'SQL Consent Withdrawal', 'sql-test');
  insert into public.voice_call_targets (
    campaign_id, request_id, consent_id, phone_e164, phone_hash, idempotency_key
  ) values (
    v_campaign_id, 'REQ-SQL-4', v_consent_4_id, '+4915333333333', 'phone-hash-4', 'target-4'
  ) returning id into v_target_4_id;
  select attempt_id into v_attempt_id from public.claim_next_voice_call('sql-worker', 120);
  if v_attempt_id is null then raise exception 'consent withdrawal target was not claimed'; end if;
  update public.voice_call_targets
  set status = 'blocked', blocked_reason = 'consent_withdrawn', claimed_by = null, claimed_until = null
  where id = v_target_4_id;
  perform public.finalize_voice_call_attempt(
    v_attempt_id, 'cancelled', 'not_reached', 'Consent was withdrawn during the active attempt',
    null, null, array[]::text[], null, false, false, false, false, 'consent_withdrawn', null
  );
  if not exists (
    select 1 from public.voice_call_targets
    where id = v_target_4_id and status = 'blocked' and blocked_reason = 'consent_withdrawn'
  ) then
    raise exception 'attempt finalization overwrote a consent-withdrawal block';
  end if;

  begin
    perform public.record_voice_model_evaluation(
      v_model_id, 'too-short-suite', 'short-eval-must-fail', 1, 1, 0, 100, 'passed', '{}'::jsonb,
      jsonb_build_object(
        'lead_qualification', jsonb_build_object('id', v_prompt_id::text),
        'follow_up', jsonb_build_object('id', v_follow_prompt_id::text)
      ),
      'sql-test'
    );
    raise exception 'short evaluation was accepted';
  exception when others then
    if sqlerrm = 'short evaluation was accepted' or position('at least 50' in sqlerrm) = 0 then raise; end if;
  end;

  update public.voice_model_releases
  set enabled = true, lifecycle = 'production', eval_status = 'passed', eval_score = 95,
      approved_by = 'sql-test', approved_at = now(),
      evaluated_prompt_manifest = jsonb_build_object(
        'lead_qualification', jsonb_build_object('id', v_prompt_id::text, 'version', 1),
        'follow_up', jsonb_build_object('id', v_follow_prompt_id::text, 'version', 1)
      )
  where id = v_model_id;
  perform public.approve_voice_model_sandbox(
    (select id from public.voice_model_releases where model_id = 'gpt-realtime-1.5'),
    'sql-test', 'sandbox-contract-1'
  );
  update public.voice_model_releases
  set lifecycle = 'rollback', eval_status = 'passed', eval_score = 90, approved_by = 'sql-test', approved_at = now(), enabled = true,
      evaluated_prompt_manifest = jsonb_build_object(
        'lead_qualification', jsonb_build_object('id', v_prompt_id::text, 'version', 1),
        'follow_up', jsonb_build_object('id', v_follow_prompt_id::text, 'version', 1)
      )
  where model_id = 'gpt-realtime-1.5';
  perform public.rollback_voice_model_release('sql-test', 'rollback-test-1');
  if not exists (select 1 from public.voice_model_releases where model_id = 'gpt-realtime-1.5' and lifecycle = 'production') then
    raise exception 'model rollback failed';
  end if;
end;
$$;
