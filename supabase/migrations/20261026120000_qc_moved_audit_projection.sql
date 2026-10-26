-- Only the verified moved-card QC abort is projected on UPDATE.
-- Original audit INSERT projections and every other workflow remain unchanged.
create or replace function public.project_qc_moved_audit()
returns trigger language plpgsql security definer set search_path=pg_catalog,public
as $$
declare affected integer; recorded_at timestamptz:=clock_timestamp();
begin
 if new.workflow_name is distinct from old.workflow_name
 or new.action is distinct from old.action or new.document_id is distinct from old.document_id
 or new.metadata->>'execution_id' is distinct from old.metadata->>'execution_id'
 or new.metadata->>'source_key' is distinct from old.metadata->>'source_key'
 or new.metadata->>'card_id' is distinct from old.document_id
 or coalesce(new.metadata->>'execution_id','')=''
 or coalesce(new.metadata->>'source_key','')=''
 or new.metadata->>'expected_list_id' is distinct from '659ffc4e5f8bffd67fe38265'
 or new.metadata->>'observed_board_id' is distinct from '63d10c34105771f01ccf4296'
 or coalesce(new.metadata->>'observed_list_id','') in ('','659ffc4e5f8bffd67fe38265')
 or new.metadata->'correction_writes_attempted' is distinct from 'false'::jsonb
 or new.metadata->'recheck_performed' is distinct from 'false'::jsonb
 then raise exception 'QC_MOVED_CONTEXT_INVALID';end if;
 update public.company_brain_workflow_attempts
 set state='blocked',issue_code='QC_CARD_MOVED_OR_MISMATCH',
     terminal_at=recorded_at,last_event_at=recorded_at,
     metadata=metadata||jsonb_build_object('final_status','ABORTED_CARD_MOVED',
       'error_message',new.error_message,'observed_list_id',new.metadata->>'observed_list_id',
       'correction_writes_attempted',false,'recheck_performed',false)
 where attempt_key='workflow-audit:'||new.id::text
   and source_audit_id=new.id and workflow_name=new.workflow_name
   and action='qc_auto_repair_v1' and state='running' and terminal_at is null
   and execution_id=new.metadata->>'execution_id'
   and trello_card_id=new.document_id;
 get diagnostics affected=row_count;
 if affected<>1 then raise exception 'QC_MOVED_ATTEMPT_UNCONFIRMED: %',new.id;end if;
 return new;
end $$;
revoke all on function public.project_qc_moved_audit() from public,anon,authenticated;
drop trigger if exists trg_qc_moved_audit_projection on public.workflow_audit_log;
create trigger trg_qc_moved_audit_projection after update of status on public.workflow_audit_log
for each row when (
 old.workflow_name='NEONTRIP - Quote Ready QC Check v3'
 and old.action='qc_auto_repair_v1' and old.status='processing'
 and new.status='blocked' and new.error_message='QC_CARD_MOVED_OR_MISMATCH'
 and new.metadata->>'final_status'='ABORTED_CARD_MOVED'
) execute function public.project_qc_moved_audit();
