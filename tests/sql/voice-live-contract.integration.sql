\set ON_ERROR_STOP on
begin;
do $$
declare pid uuid; mid uuid; cid uuid; consent uuid; tid uuid; aid uuid; snapshot jsonb;
begin
 select id into pid from voice_prompt_versions limit 1;
 select id into mid from voice_model_releases where model_id='gpt-live-1' limit 1;
 insert into voice_call_campaigns(name,mode,prompt_version_id,created_by)
 values('Fixture','lead_qualification',pid,'fixture') returning id into cid;
 insert into voice_contact_consents(request_id,phone_e164,phone_hash,purposes,consent_wording,form_version,source,source_ref,evidence_hash,granted_at,evidence_retain_until,idempotency_key)
 values('internal-test:11111111-1111-4111-8111-111111111111','+491110000001','fixture',array['lead_qualification'],'Interner Test inklusive Speicherung des Telefontranskripts.','fixture','internal_test_authorization','fixture','fixture-hash',now(),now()+interval '6 years','fixture-consent') returning id into consent;
 insert into voice_call_targets(campaign_id,request_id,consent_id,phone_e164,phone_hash,idempotency_key,call_brief,context_request_id,transcript_consent)
 values(cid,'internal-test:11111111-1111-4111-8111-111111111111',consent,'+491110000001','fixture','fixture-target','Lieferadresse erfragen','REQ-CONTEXT','{"confirmed":true,"operator":"fixture"}') returning id into tid;
 insert into voice_call_attempts(target_id,attempt_number,model_release_id,prompt_version_id,provider,context_snapshot,model_snapshot,prompt_snapshot,idempotency_key)
 values(tid,1,mid,pid,'twilio','{"request_id":"internal-test:11111111-1111-4111-8111-111111111111"}','{}','{}','fixture-attempt') returning id into aid;
 update voice_call_targets set call_brief='Später geändert',context_request_id='REQ-OTHER' where id=tid;
 select context_snapshot into snapshot from voice_call_attempts where id=aid;
 if snapshot->>'call_brief'<>'Lieferadresse erfragen' or snapshot->>'context_request_id'<>'REQ-CONTEXT' or (snapshot->'transcript_consent'->>'confirmed')::boolean is not true then raise exception 'attempt binding was not frozen'; end if;
end $$;
rollback;
