import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const base=JSON.parse(readFileSync(new URL('./fixtures/repeat-business-workflow-baseline.json',import.meta.url)));
let operations=[];
if(process.env.REPEAT_PATCH) operations=JSON.parse(readFileSync(process.env.REPEAT_PATCH)).operations;
const wf=structuredClone(base);
for(const op of operations){assert.equal(op.type,'updateNode');const n=wf.nodes.find(n=>n.name===op.nodeName);assert.ok(n);for(const [key,value] of Object.entries(op.updates)){if(key==='parameters.jsonBody')n.parameters.jsonBody=value;else if(key==='parameters.jsCode')n.parameters.jsCode=value;else assert.fail('Unexpected change');}}
const node=name=>wf.nodes.find(n=>n.name===name);
const jsonBody=node('MarkRepeatBusinessUnknown').parameters.jsonBody;
const evaluate=new Function('$json','$','$prevNode','return ('+jsonBody.slice(3,-2).trim()+')');
const ref={id:'immutable-outreach',claim_token:'fixture-claim'};
const $=name=>{assert.equal(name,'ReserveRepeatBusiness');return {first:()=>({json:ref})};};
const pre=['ValidateReservation','CheckShopifyLive','ValidateShopifyAndConsent','CheckTrelloLive','BuildValidatedMikaMail'];
for(const name of pre){
 const p=JSON.parse(evaluate({error:{message:'shopify_live_check_failed; token=never-store-this'}},$,{name}));
 assert.equal(p.p_id,ref.id);assert.equal(p.p_claim_token,ref.claim_token);
 assert.equal(p.p_outcome,'preflight_failed',name+' must be classified before any draft write');
 assert.equal(p.p_message.source_node,name);assert.equal(p.p_message.error_code,'shopify_live_check_failed');
 assert.ok(!JSON.stringify(p).includes('never-store-this'),'Raw errors cannot enter durable evidence');
 assert.equal(wf.connections[name].main[1][0].node,'MarkRepeatBusinessUnknown');
}
for(const name of ['CreateRepeatBusinessDraft','AuthorizeRepeatBusinessSend','ValidateSendAuthorization','SendRepeatBusinessDraft','ReadSentMessage','ReadSentItemsFolder','ValidateSentEvidence','unknown-node']){
 const p=JSON.parse(evaluate({error:'timeout'},$,{name}));
 assert.equal(p.p_outcome,'unknown',name+' must preserve provider uncertainty');
 assert.equal(p.p_reason,'provider_or_validation_failed_no_retry');
}
const stop=new Function('$input',node('StopRepeatBusinessSafely').parameters.jsCode);
assert.throws(()=>stop({first:()=>({json:{status:'preflight_failed'}})}),/Vorprüfung/);
assert.throws(()=>stop({first:()=>({json:{status:'unknown'}})}),/Versandstatus unklar/);
const allowed=new Set(['MarkRepeatBusinessUnknown','StopRepeatBusinessSafely']);
for(let i=0;i<base.nodes.length;i++){if(!allowed.has(base.nodes[i].name))assert.deepEqual(wf.nodes[i],base.nodes[i],'Unrelated node unchanged');else assert.deepEqual(wf.nodes[i].credentials,base.nodes[i].credentials);}
assert.deepEqual(wf.connections,base.connections);assert.deepEqual(wf.settings,base.settings);assert.equal(wf.active,true);
console.log('PASS: pre-draft classification, provider-write uncertainty, immutable claim binding, sanitized evidence, visible errors, unchanged graph/configuration');

const alarm=JSON.parse(readFileSync(new URL('../workflows/repeat-business/alert-recipient.patch.json',import.meta.url)));
const recipient=new Function('$json','return ('+alarm.operations[0].updates['parameters.toRecipients'].slice(3,-2).trim()+')');
assert.equal(recipient({source_workflow_id:'cW08nxn9ANfGFEou'}),'support@neontrip.de');
assert.equal(recipient({source_workflow_id:'u48KZyTcU2J9pw2P'}),'support@neontrip.de');
assert.equal(recipient({source_workflow_id:'other-workflow'}),'info@NeonTrip.de');
assert.equal(recipient({metadata:{affected_workflow_ids:['cW08nxn9ANfGFEou']}}),'support@neontrip.de');
console.log('PASS: Repeat Business alarm recipient; existing workflow recipients retained');
