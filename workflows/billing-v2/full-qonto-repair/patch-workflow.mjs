import {createHash} from 'node:crypto';
import {runtimeSource,REPAIR} from './payment-recovery.mjs';
export const WORKFLOW='K9poQw3a1DOO16Vd';
const fail='Prepare Projection Failure';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function buildPatch(baseline,expectedHash) {
  if(baseline.id!==WORKFLOW||baseline.active!==true||hash([baseline.nodes,baseline.connections,baseline.settings])!==expectedHash) throw new Error('PROJECTION_BASELINE_CHANGED');
  const w=structuredClone(baseline),node=name=>w.nodes.find(n=>n.name===name);
  const connections=targets=>({main:targets.map(names=>names.map(name=>({node:name,type:'main',index:0})))});
  const add=(name,type,parameters,targets,extra={})=>{
    const n={id:'full-qonto-'+name.toLowerCase().replace(/[^a-z0-9]+/g,'-'),name,type,typeVersion:type.endsWith('.if')?2.2:type.endsWith('.code')?2:4.2,position:[1800+w.nodes.length*30,1000],parameters,...extra};
    if(node(name))throw new Error('REPAIR_NODE_EXISTS');w.nodes.push(n);w.connections[name]=connections(targets);return n;
  };
  const branch=(name,expression,yes,no)=>add(name,'n8n-nodes-base.if',{conditions:{options:{caseSensitive:true,leftValue:'',typeValidation:'strict',version:2},conditions:[{id:'full-qonto-condition',leftValue:expression,rightValue:true,operator:{type:'boolean',operation:'true',singleValue:true}}],combinator:'and'},options:{}},[[yes],[no]]);
  const get=(name,url,next,credentials)=>add(name,'n8n-nodes-base.httpRequest',{method:'GET',url,authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',options:{timeout:10000,response:{response:{fullResponse:true,responseFormat:'json'}}}},[[next],[fail]],{credentials,onError:'continueErrorOutput',retryOnFail:false});
  const code=(name,jsCode,next)=>add(name,'n8n-nodes-base.code',{mode:'runOnceForAllItems',jsCode},[[next],[fail]],{onError:'continueErrorOutput'});
  const easybill=node('Easybill Record Payment');
  if(easybill.retryOnFail===true)throw new Error('PAYMENT_POST_RETRIES_UNSAFE');
  const ctx="$('Normalize Projection Job').first().json",api="'https://api.easybill.de/rest/v1/";
  const doc="={{ "+api+"documents/' + "+ctx+".job.payload.documentId }}";
  const payments="={{ "+api+"document-payments?limit=100&page=1&document_id=' + "+ctx+".job.payload.documentId }}";
  branch('Repair Full Qonto?',"={{ !!$json.job.payload.repairFullPayment }}",'Repair: Validate','Collective Easybill?');
  code('Repair: Validate',runtimeSource+"\nconst ctx="+ctx+";scope(ctx);return [{json:ctx}];",'Repair: Read Invoice');
  get('Repair: Read Invoice',doc,'Repair: Read Payments',easybill.credentials);
  get('Repair: Read Payments',payments,'Repair: Read Proforma',easybill.credentials);
  get('Repair: Read Proforma',"={{ "+api+"documents/' + "+ctx+".job.payload.proformaId }}",'Repair: Read Proforma Payments',easybill.credentials);
  get('Repair: Read Proforma Payments',"={{ "+api+"document-payments?limit=100&page=1&document_id=' + "+ctx+".job.payload.proformaId }}",'Repair: Read Webhooks',easybill.credentials);
  get('Repair: Read Webhooks','https://api.easybill.de/rest/v1/webhooks?limit=100&page=1','Repair: Read Ledger',easybill.credentials);
  get('Repair: Read Ledger',"={{ 'https://klibiejfisijpagzkxls.supabase.co/rest/v1/billing_payments?select=id,billing_case_id,provider,provider_transaction_id,amount_cents,currency,match_status,booked_at,easybill_projection_status,billing_cases(id,shopify_order_name,total_gross_cents,currency,status,paid_at,tax_review_status,cancelled_at,refunded_at,billing_documents(document_type,easybill_document_id,status,sent_at))&billing_case_id=eq.' + "+ctx+".billingCase.id }}",'Repair: Decide',{httpHeaderAuth:{id:'NTtNxoBGGzJCQi9u',name:'Header Auth account 2 | SUPABASE'}});
  code('Repair: Decide',runtimeSource+"\nreturn [{json:decide("+ctx+",{invoice:$('Repair: Read Invoice').first().json,payments:$('Repair: Read Payments').first().json,proforma:$('Repair: Read Proforma').first().json,proformaPayments:$('Repair: Read Proforma Payments').first().json,hooks:$('Repair: Read Webhooks').first().json,ledger:$json})}];",'Repair Payment Needed?');
  branch('Repair Payment Needed?',"={{ $json.alreadyDone === false }}",'Easybill Record Payment','Prepare Projection Success');
  branch('Repair Verify?',"={{ !!"+ctx+".job.payload.repairFullPayment }}",'Repair: Read Final Invoice','Prepare Projection Success');
  get('Repair: Read Final Invoice',doc,'Repair: Read Final Payments',easybill.credentials);
  get('Repair: Read Final Payments',payments,'Repair: Confirm',easybill.credentials);
  code('Repair: Confirm',runtimeSource+"\nreturn [{json:confirm("+ctx+",$('Easybill Record Payment').first().json,$('Repair: Read Final Invoice').first().json,$json)}];",'Prepare Projection Success');
  w.connections['Easybill Payment'].main[0]=connections([['Repair Full Qonto?']]).main[0];
  w.connections['Easybill Record Payment'].main[0]=connections([['Repair Verify?']]).main[0];
  const original=easybill.parameters.jsonBody;
  if(!original.includes('notice:$json.job.payload.manualPaidQontoProof?'))throw new Error('PAYMENT_BODY_CHANGED');
  easybill.parameters.jsonBody=original.replace('notice:$json.job.payload.manualPaidQontoProof?',"notice:$json.job.payload.repairFullPayment==='"+REPAIR+"'?('Qonto-ID '+$json.job.payload.providerTransactionId+'; NEONTRIP no-email repair 20261026'):$json.job.payload.manualPaidQontoProof?");
  node('Prepare Projection Success').parameters.jsCode='{\n'+runtimeSource+`
const repairCtx=$('Normalize Projection Job').first().json;
if(repairCtx.job.payload.repairFullPayment){
  const s=scope(repairCtx);
  if($json.repairPaymentVerified!==true||!$json.easybillPaymentId)fail('UNVERIFIED_COMPLETION');
  return [{json:{jobId:repairCtx.job.id,leaseToken:repairCtx.job.lease_token,success:true,result:{worker:'n8n-payment-projection-v2',projection:repairCtx.job.job_type,repairFullPayment:REPAIR,qontoId:s.qontoId,easybillPaymentId:$json.easybillPaymentId,reused:$json.alreadyDone===true,customerEmailSuppressed:true}}}];
}
}\n`+node('Prepare Projection Success').parameters.jsCode;
  const operations=[];
  for(const n of w.nodes) {
    const before=baseline.nodes.find(b=>b.id===n.id);
    if(!before)operations.push({type:'addNode',node:n});
    else if(JSON.stringify(before)!==JSON.stringify(n))operations.push({type:'updateNode',nodeId:n.id,updates:{parameters:n.parameters}});
  }
  // Explicit connection operations; no replaceConnections or unrelated rewiring.
  for(const [name,c] of Object.entries(w.connections)) for(let i=0;i<c.main.length;i++){
    const old=baseline.connections[name]?.main?.[i]||[],next=c.main[i];
    for(const e of old)if(!next.some(x=>JSON.stringify(x)===JSON.stringify(e)))operations.push({type:'removeConnection',source:name,target:e.node,sourceIndex:i,targetIndex:e.index});
    for(const e of next)if(!old.some(x=>JSON.stringify(x)===JSON.stringify(e)))operations.push({type:'addConnection',source:name,target:e.node,sourceIndex:i,targetIndex:e.index});
  }
  return {workflow:w,operations};
}
export function patchAlarm(baseline) {
  if(baseline.id!=='M4uG1HAtN9Zggxww'||baseline.active!==true)throw new Error('ALARM_BASELINE');
  const n=baseline.nodes.find(n=>n.name==='Send Prepared Alert Email');
  const old=n?.parameters.toRecipients;
  if(!old?.includes("'bvRcF5Xaj3eGY0J4']")||!old.includes("? 'support@neontrip.de' : 'info@NeonTrip.de'"))throw new Error('ALARM_ROUTE_CHANGED');
  return {type:'updateNode',nodeId:n.id,updates:{'parameters.toRecipients':old.replace("'bvRcF5Xaj3eGY0J4']","'bvRcF5Xaj3eGY0J4', 'K9poQw3a1DOO16Vd']")}};
}
export const baselineHash=w=>hash([w.nodes,w.connections,w.settings]);
