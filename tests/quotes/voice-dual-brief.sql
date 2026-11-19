begin;
insert into public.master_customers(id,name,total_orders,notes) values
 ('11111111-1111-4111-8111-111111111111','Fixture A',3,'Nur A'),
 ('22222222-2222-4222-8222-222222222222','Fixture B',1,'GEHEIM-B');
insert into public.master_requests(id,request_id,customer_id,title,status,created_at) values
 ('33333333-3333-4333-8333-333333333333','A-1','11111111-1111-4111-8111-111111111111','Erste Anfrage','closed',now()-interval '1 year'),
 ('44444444-4444-4444-8444-444444444444','A-2','11111111-1111-4111-8111-111111111111','Neue Anfrage','open',now()),
 ('55555555-5555-4555-8555-555555555555','B-1','22222222-2222-4222-8222-222222222222','GEHEIM-B','open',now());
insert into public.voice_call_sessions(id,bound_request_id,started_at,ended_at,summary,summary_updated_at,summary_source,status,mode,consent_status,transcript_storage_enabled) values
 ('66666666-6666-4666-8666-666666666666','A-1',now()-interval '2 days',now()-interval '2 days','Altes Gespräch',now()-interval '2 days','placetel_recording','completed','assist','confirmed',true),
 ('77777777-7777-4777-8777-777777777777','A-2',now(),null,null,null,null,'live','assist','confirmed',true),
 ('88888888-8888-4888-8888-888888888888','B-1',now(),null,'GEHEIM-B',now(),'placetel_recording','completed','assist','confirmed',true);
insert into public.voice_customer_events values
 ('11111111-1111-4111-8111-111111111111','a',now(),'transcript','Test','Nur A','A-1'),
 ('22222222-2222-4222-8222-222222222222','b',now(),'transcript','Test','GEHEIM-B','B-1');
insert into public.workflow_audit_log values
 ('99999999-9999-4999-8999-999999999999','A-1',now(),'customer_records_console','customer_record_note','{"note_kind":"note","note_text":"Ältere wichtige Notiz A"}');
do $$ declare d jsonb; h text; begin
 d:=public.voice_customer_brief_input('11111111-1111-4111-8111-111111111111');
 if d::text like '%GEHEIM-B%' then raise exception 'cross_customer_leak'; end if;
 if jsonb_array_length(d->'sources'->'anfragen')<>2 or d::text not like '%Ältere wichtige Notiz A%' then raise exception 'missing_history'; end if;
 h:=d->>'hash';
 if h !~ '^[a-f0-9]{64}$' then raise exception 'bad_hash'; end if;
 if public.voice_latest_customer_call('11111111-1111-4111-8111-111111111111')->>'id'<>'77777777-7777-4777-8777-777777777777' then raise exception 'not_latest'; end if;
 if public.voice_latest_customer_call('11111111-1111-4111-8111-111111111111')->>'summary' is not null then raise exception 'stale_summary'; end if;
 perform public.save_voice_customer_brief('11111111-1111-4111-8111-111111111111','','Aktuelle Zusammenfassung',h,now());
 if public.voice_customer_brief_input('11111111-1111-4111-8111-111111111111')->>'hash'<>h then raise exception 'self_invalidating'; end if;
 perform public.save_voice_customer_brief('11111111-1111-4111-8111-111111111111','','Veraltete Zusammenfassung',h,now()-interval '1 hour');
 if public.voice_customer_brief_input('11111111-1111-4111-8111-111111111111')->>'previousSummary'<>'Aktuelle Zusammenfassung' then raise exception 'older_overwrite'; end if;
 if public.pending_voice_customer_brief()->>'customerId'<>'22222222-2222-4222-8222-222222222222' then raise exception 'retry_selection'; end if;
 if has_function_privilege('anon','public.voice_customer_brief_input(uuid)','execute') or has_function_privilege('authenticated','public.pending_voice_customer_brief(uuid)','execute') then raise exception 'public_access'; end if;
end $$;
rollback;
