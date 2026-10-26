begin;
create or replace function pg_temp.seed_qc(p_status text default 'processing',p_execution text default '123')
returns uuid language plpgsql as $$
declare a uuid:=gen_random_uuid();
begin
 insert into workflow_audit_log values(a,'NEONTRIP - Quote Ready QC Check v3','qc_auto_repair_v1','card-a',p_status,null,now()-interval '1 hour',
 jsonb_build_object('card_id','card-a','execution_id',p_execution,'source_key','source-a','before_fields',jsonb_build_object('price_1','617')));
 return a;
end $$;
create or replace function pg_temp.block_qc(a uuid) returns void language sql as $$
 update workflow_audit_log set status='blocked',error_message='QC_CARD_MOVED_OR_MISMATCH',
 metadata=metadata||'{"final_status":"ABORTED_CARD_MOVED","expected_list_id":"659ffc4e5f8bffd67fe38265","observed_list_id":"video-list","observed_board_id":"63d10c34105771f01ccf4296","correction_writes_attempted":false,"recheck_performed":false}'::jsonb
 where id=a and status='processing';
$$;
do $$
declare a uuid; n int:=0; oldrow jsonb; afterrow jsonb; bad text;
begin
 a:=pg_temp.seed_qc(); perform pg_temp.block_qc(a);
 if not exists(select from company_brain_workflow_attempts where source_audit_id=a and state='blocked' and issue_code='QC_CARD_MOVED_OR_MISMATCH' and terminal_at>=now() and last_event_at>=now() and metadata->>'final_status'='ABORTED_CARD_MOVED') then raise exception 'terminal projection missing';end if;n:=n+1;
 if (select metadata->'before_fields'->>'price_1' from workflow_audit_log where id=a)<>'617' then raise exception 'source lost';end if;n:=n+1;
 select to_jsonb(t) into oldrow from company_brain_workflow_attempts t where source_audit_id=a;
 perform pg_temp.block_qc(a);
 select to_jsonb(t) into afterrow from company_brain_workflow_attempts t where source_audit_id=a;
 if afterrow<>oldrow then raise exception 'duplicate mutation';end if;n:=n+1;
 foreach bad in array array['missing','succeeded','foreign_execution','foreign_card','foreign_source'] loop
  a:=pg_temp.seed_qc();
  if bad='missing' then delete from company_brain_workflow_attempts where source_audit_id=a;
  elsif bad='succeeded' then update company_brain_workflow_attempts set state='succeeded' where source_audit_id=a;
  elsif bad='foreign_execution' then update company_brain_workflow_attempts set execution_id='999' where source_audit_id=a;
  elsif bad='foreign_card' then update company_brain_workflow_attempts set trello_card_id='other' where source_audit_id=a;
  else update company_brain_workflow_attempts set source_audit_id=gen_random_uuid() where source_audit_id=a; end if;
  begin
   perform pg_temp.block_qc(a);raise exception 'EXPECTED_REJECTION';
  exception when others then
   if sqlerrm='EXPECTED_REJECTION' then raise;end if;
   if sqlerrm not like 'QC_MOVED_ATTEMPT_UNCONFIRMED%' then raise;end if;
  end;
  if (select status from workflow_audit_log where id=a)<>'processing' then raise exception 'partial audit commit';end if;n:=n+1;
 end loop;
 a:=pg_temp.seed_qc();
 begin
  update workflow_audit_log set status='blocked',error_message='QC_CARD_MOVED_OR_MISMATCH',metadata=metadata||'{"final_status":"ABORTED_CARD_MOVED","execution_id":"999"}'::jsonb where id=a;
  raise exception 'EXPECTED_REJECTION';
 exception when others then
  if sqlerrm='EXPECTED_REJECTION' or sqlerrm not like 'QC_MOVED_CONTEXT_INVALID%' then raise;end if;
 end;n:=n+1;
 a:=pg_temp.seed_qc();
 update workflow_audit_log set status='success' where id=a;
 if (select state from company_brain_workflow_attempts where source_audit_id=a)<>'running' then raise exception 'unrelated semantics changed';end if;n:=n+1;
 if has_function_privilege('anon','public.project_qc_moved_audit()','execute') or has_function_privilege('authenticated','public.project_qc_moved_audit()','execute') then raise exception 'public executable';end if;n:=n+1;
 raise notice 'PASS % PostgreSQL assertions',n;
end $$;
rollback;
