import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const baseline = JSON.parse(readFileSync(new URL('./fixtures/live-guard-baseline.json', import.meta.url)));
const GUARD = 'Guard QC Correction Writes';
const OLD = "if(c.id!==ctx.cardId||c.closed||c.idBoard!==BOARD||c.idList!==LIST)throw new Error('QC_CARD_MOVED_OR_MISMATCH: '+ctx.cardId);";
const REPLACEMENT = `if(c.id!==ctx.cardId||c.closed||c.idBoard!==BOARD||typeof c.idList!=='string'||!c.idList)throw new Error('QC_CARD_MOVED_OR_MISMATCH: '+ctx.cardId);
if(c.idList!==LIST){
  const claim=ctx.auditClaim?.metadata, executionId=String($execution.id);
  if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(ctx.auditId||'')||
     !claim||String(claim.execution_id)!==executionId||claim.card_id!==ctx.cardId||claim.source_key!==ctx.sourceKey)
    throw new Error('QC_MOVED_CLAIM_CONTEXT_INVALID: '+ctx.cardId);
  return {json:{...ctx,hasCorrections:false,correctionChanges:[],qcMovedBeforeCorrection:true,
    qcMovedAudit:{status:'blocked',error_message:'QC_CARD_MOVED_OR_MISMATCH',
      metadata:{...claim,final_status:'ABORTED_CARD_MOVED',expected_list_id:LIST,
        observed_list_id:c.idList,observed_board_id:c.idBoard,correction_writes_attempted:false,
        recheck_performed:false}}},pairedItem:{item:i}};
}`;
export function buildPatch(workflow) {
  const get = name => workflow.nodes.find(n => n.name === name);
  const guard = get(GUARD), record = get('Record QC Repair Result');
  if(workflow.id!==baseline.id||workflow.versionId!==baseline.versionId||
     workflow.active!==true||workflow.activeVersionId!==baseline.activeVersionId||
     workflow.nodes.length!==baseline.nodes.length||
     guard?.parameters.jsCode!==baseline.nodes.find(n=>n.name===GUARD).parameters.jsCode||
     JSON.stringify(workflow.connections)!==JSON.stringify(baseline.connections)||
     JSON.stringify(record?.parameters)!==JSON.stringify(baseline.nodes.find(n=>n.name===record?.name)?.parameters)||
     !record?.credentials?.httpHeaderAuth||
     !guard.parameters.jsCode.includes(OLD)) throw new Error('QC_MOVED_BASELINE_DRIFT');
  const gate = structuredClone(get('Has Validated QC Corrections?'));
  Object.assign(gate, {id:'qc-moved-before-correction', name:'QC Card Moved Before Correction?', position:[guard.position[0]+220,guard.position[1]-160]});
  gate.parameters.conditions.conditions[0].leftValue='={{ $json.qcMovedBeforeCorrection === true }}';
  const audit = structuredClone(record);
  Object.assign(audit, {id:'qc-record-moved-attempt',name:'Record Moved QC Attempt',position:[guard.position[0]+440,guard.position[1]-320],retryOnFail:false,onError:'stopWorkflow'});
  audit.parameters.url+='&action=eq.qc_auto_repair_v1&status=eq.processing&document_id=eq.{{ encodeURIComponent($json.cardId) }}&metadata->>execution_id=eq.{{ encodeURIComponent(String($execution.id)) }}&metadata->>source_key=eq.{{ encodeURIComponent($json.sourceKey) }}';
  audit.parameters.jsonBody='={{ $json.qcMovedAudit }}';
  audit.parameters.options={...audit.parameters.options,response:{response:{fullResponse:true,responseFormat:'json',neverError:false}}};
  const stop = {id:'qc-stop-recorded-moved-attempt',name:'Stop Recorded Moved QC Attempt',type:'n8n-nodes-base.code',typeVersion:2,position:[guard.position[0]+660,guard.position[1]-320],parameters:{mode:'runOnceForAllItems',jsCode:`const confirmed=[];
for(const [i,item] of $input.all().entries()){
  const ctx=$('Guard QC Correction Writes').itemMatching(i).json;
  const response=item.json, rows=response.body;
  const row=Array.isArray(rows)&&rows.length===1?rows[0]:null;
  if(response.statusCode!==200||!ctx.qcMovedBeforeCorrection||!row||row.id!==ctx.auditId||
     row.document_id!==ctx.cardId||row.status!=='blocked'||row.error_message!=='QC_CARD_MOVED_OR_MISMATCH'||
     String(row.metadata?.execution_id)!==String($execution.id)||row.metadata?.source_key!==ctx.sourceKey||
     row.metadata?.final_status!=='ABORTED_CARD_MOVED'||row.metadata?.observed_list_id!==ctx.qcMovedAudit.metadata.observed_list_id)
    throw new Error('QC_MOVED_AUDIT_UNCONFIRMED: '+ctx.cardId);
  confirmed.push(ctx.cardId);
}
if(!confirmed.length)throw new Error('QC_MOVED_AUDIT_UNCONFIRMED: no receipts');
throw new Error('QC_CARD_MOVED_OR_MISMATCH; audit=blocked; cards='+confirmed.slice(0,5).join(',')+'; count='+confirmed.length+'; Karte hat Quote Ready verlassen. Keine Korrektur oder Nachpruefung ausgefuehrt.');`}};
  return {workflowId:workflow.id,expectedVersionId:workflow.versionId,expectedActiveVersionId:workflow.activeVersionId,expectedActive:true,operations:[
    {type:'updateNode',nodeId:guard.id,updates:{parameters:{...guard.parameters,jsCode:guard.parameters.jsCode.replace(OLD,REPLACEMENT)}}},
    ...[gate,audit,stop].map(node=>({type:'addNode',node})),
    {type:'removeConnection',source:GUARD,target:'Has Validated QC Corrections?'},
    {type:'addConnection',source:GUARD,target:gate.name},
    {type:'addConnection',source:gate.name,sourceIndex:0,target:audit.name},
    {type:'addConnection',source:gate.name,sourceIndex:1,target:'Has Validated QC Corrections?'},
    {type:'addConnection',source:audit.name,target:stop.name}
  ]};
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  process.stdout.write(JSON.stringify(buildPatch(JSON.parse(readFileSync(process.argv[2]||0,'utf8'))),null,2)+'\n');
}
