\i /tmp/hot-stages.sql
DO $$
declare s public.voice_hot_lead_state;r uuid='22222222-2222-4222-8222-222222222222';c uuid='11111111-1111-4111-8111-111111111111';a uuid='33333333-3333-4333-8333-333333333333';
begin
 s:=save_voice_hot_lead_v2(r,c,'not_reached',now(),null,null,2,1::smallint,a,now());
 assert s.status='not_reached' and s.outcomes->>'1'='not_reached';
 s:=save_voice_hot_lead_v2(r,c,'not_reached',now(),null,null,2,1::smallint,a,now());
 assert s.revision=3;
 assert (select count(*) from voice_hot_lead_actions)=1;
 begin
 perform save_voice_hot_lead_v2(r,c,'reached',now(),null,null,2,2::smallint,gen_random_uuid(),now());
 raise exception 'stale write accepted';
 exception when raise_exception then if sqlerrm<>'hot_lead_revision_conflict' then raise; end if;end;
 s:=save_voice_hot_lead_v2(r,c,'scheduled',now(),current_date+2,null,3,2::smallint,gen_random_uuid(),now());
 s:=save_voice_hot_lead_v2(r,c,'reached',now(),null,null,4,2::smallint,gen_random_uuid(),now());
 assert s.outcomes->>'2'='reached';
 assert s.status='scheduled' and s.stage=3 and s.due_date=current_date+2,'schedule chosen during call must survive result';
 s:=save_voice_hot_lead_v2(r,c,'ignored',now(),null,null,5,3::smallint,gen_random_uuid(),now());
 assert s.status='ignored';
 begin
 perform save_voice_hot_lead_v2(r,c,'scheduled',now(),current_date+2,null,6,3::smallint,gen_random_uuid(),now());
 raise exception 'ignored resurrected';
 exception when raise_exception then if sqlerrm<>'hot_lead_requires_reactivation' then raise;end if;end;
 assert not has_table_privilege('anon','voice_hot_lead_actions','select');
 assert (select count(*) from sales_call_results)=0;
end $$;
DO $$
declare s public.voice_hot_lead_state;r uuid='22222222-2222-4222-8222-222222222222';c uuid='11111111-1111-4111-8111-111111111111';
begin
 update voice_hot_lead_state set status='scheduled',stage=1,due_date=current_date,handled_at=now()-interval '1 hour',outcomes='{}' where request_id=r;
 s:=save_voice_hot_lead_v2(r,c,'reached',now(),null,null,6,1::smallint,gen_random_uuid(),now());
 assert s.status='reached' and s.due_date is null and s.stage=1,'consumed retry must not remain scheduled';
 update voice_hot_lead_state set status='scheduled',stage=2,due_date=current_date,handled_at=now()-interval '1 hour' where request_id=r;
 s:=save_voice_hot_lead_v2(r,c,'reached',now(),null,null,7,2::smallint,gen_random_uuid(),now());
 assert s.status='reached' and s.due_date is null,'offer retry must require new followup date';
end $$;
