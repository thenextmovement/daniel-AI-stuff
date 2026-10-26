-- One historical attempt only. Apply after the projection migration.
-- This records an observed abort, not a successful quality check or delivery.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$
declare r public.workflow_audit_log; n integer;
begin
 select * into strict r from public.workflow_audit_log where id='17df6902-c5e1-18d0-8e04-b568552b9730' for update;
 if r.workflow_name is distinct from 'NEONTRIP - Quote Ready QC Check v3' or r.action is distinct from 'qc_auto_repair_v1'
 or r.document_id is distinct from '6adf159dd4f7aadbd2908cdb'
 or r.created_at is distinct from '2026-10-26T09:00:52.251544Z'::timestamptz
 or r.metadata->>'execution_id' is distinct from '10379086'
 or r.metadata->>'source_key' is distinct from 'qc_auto_repair_v1:6adf159dd4f7aadbd2908cdb:6adf159dd4f7aadbd2908dd2:no-pdf'
 then raise exception 'QC_HISTORICAL_BINDING_DRIFT';end if;
 if r.status='blocked' and r.error_message='QC_CARD_MOVED_OR_MISMATCH'
 and r.metadata->>'repair_key'='qc-moved-10379086-v1'
 and r.metadata->>'final_status'='ABORTED_CARD_MOVED'
 and exists(select from public.company_brain_workflow_attempts where id='571aa0d2-9be6-418b-aab1-3928a08b7ff7' and source_audit_id=r.id and execution_id='10379086' and state='blocked' and terminal_at is not null)
 then return;end if;
 if r.status is distinct from 'processing' or r.error_message is not null
 or r.metadata is distinct from '{"card_id":"6adf159dd4f7aadbd2908cdb","source_key":"qc_auto_repair_v1:6adf159dd4f7aadbd2908cdb:6adf159dd4f7aadbd2908dd2:no-pdf","execution_id":"10379086","before_fields":{"size_1":"100x43cm","price_1":"617","size_2":null,"price_2":null,"size_3":null,"price_3":null,"size_4":null,"price_4":null},"initial_errors":["Variante 1 PREIS: Quelle=298, CF=617","Variante 1 GROESSE: Quelle=50x21.5cm, CF=100x43cm"],"pdf_attachment_id":null,"image_attachment_id":"6adf159dd4f7aadbd2908dd2"}'::jsonb
 then raise exception 'QC_HISTORICAL_STATE_DRIFT';end if;
 update public.workflow_audit_log set status='blocked',error_message='QC_CARD_MOVED_OR_MISMATCH',
 metadata=metadata||jsonb_build_object('final_status','ABORTED_CARD_MOVED','expected_list_id','659ffc4e5f8bffd67fe38265',
 'observed_list_id','6a18389f5e45294188451924','observed_board_id','63d10c34105771f01ccf4296',
 'correction_writes_attempted',false,'recheck_performed',false,
 'repair_key','qc-moved-10379086-v1','trello_move_action_id','6adf16c74f23473f1119a32c',
 'trello_move_at','2026-10-26T09:00:55.192Z','reconciled_at',clock_timestamp())
 where id=r.id and status='processing' and metadata=r.metadata;
 get diagnostics n=row_count;
 if n<>1 then raise exception 'QC_HISTORICAL_UPDATE_UNCONFIRMED';end if;
end $$;
commit;
