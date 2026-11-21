import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { guardCode, patchWorkflow } from './board-guard.mjs';

const cardId='6adf61b57c4288abebd49c63';
const candidate={card_id:cardId,correlation_id:'quote_analysis_v1:'+cardId,previous_change_log:[]};
const live={id:cardId,idBoard:'63d10c34105771f01ccf4296',idList:'64ca588f8bd547afc087a6ea',closed:false};
function run(card, failure=false, row=candidate) { return runResponse({statusCode:200,body:card},failure,row); }
function runResponse(response, failure=false, row=candidate) {
  const context={ $input:{first:()=>({json:response})}, $:name=>({first:()=>({json:name==='Prepare Description Failure Status'?{card_id:cardId,failure_message:'original network error'}:row})}) };
  return vm.runInNewContext('(function(){'+guardCode(failure)+'})()', context);
}
function fixture(){
 return {id:'EtEpzMp10EmaqXIS',active:true,versionId:'v1',nodes:[
  {id:'candidate',name:'Select Eligible Candidate',parameters:{jsCode:'original'},type:'n8n-nodes-base.code'},
  {id:'description-failed-label-clear',name:'Trello: Clear Description Failed Label',parameters:{method:'DELETE'},credentials:{trelloApi:{id:'existing-reference',name:'existing'}},type:'n8n-nodes-base.httpRequest'},
  {id:'description-processing-label-add',name:'Trello: Add Description Processing Label',alwaysOutputData:true,onError:'continueErrorOutput',parameters:{method:'POST'},type:'n8n-nodes-base.httpRequest'},
  {id:'description-failure-status-prepare',name:'Prepare Description Failure Status',parameters:{jsCode:'original'},type:'n8n-nodes-base.code'},
  {id:'description-processing-label-remove-failure',name:'Trello: Remove Description Processing Label on Failure',parameters:{method:'DELETE'},type:'n8n-nodes-base.httpRequest'},
  {id:'unrelated',name:'Recovery and customer path',parameters:{untouched:true},credentials:{other:{id:'other'}}}
 ],connections:{
  'Select Eligible Candidate':{main:[[{node:'Trello: Clear Description Failed Label',type:'main',index:0}]]},
  'Prepare Description Failure Status':{main:[[{node:'Trello: Remove Description Processing Label on Failure',type:'main',index:0}]]},
  'Trello: Add Description Processing Label':{main:[[{node:'Learning Memory: Confirmed Corrections',type:'main',index:0}],[{node:'Prepare Description Failure Status',type:'main',index:0}]]},
  'Recovery and customer path':{main:[[]]}
 },settings:{timezone:'Europe/Berlin',saveDataErrorExecution:'all',executionTimeout:1200}};
}
test('eligible card preserves exact candidate and paired item',()=>{
 const output=JSON.parse(JSON.stringify(run(live)));
 assert.deepEqual(output,[{json:candidate,pairedItem:{item:0}}]);
});
test('historical move to supplier board stops before label writes',()=>{
 assert.throws(()=>run({...live,idBoard:'62bae9b97705e7419ed64593',idList:'62bae9baad49a30c72fdb690'}),/QUOTE_CARD_MOVED_OR_CLOSED/);
});
test('same-board manual list move also blocks',()=>assert.throws(()=>run({...live,idList:'63d10c34105771f01ccf42a0'}),/QUOTE_CARD_MOVED_OR_CLOSED/));
test('closed card blocks',()=>assert.throws(()=>run({...live,closed:true}),/QUOTE_CARD_MOVED_OR_CLOSED/));
test('mismatched, missing, array or failed reads are unconfirmed, never moved or healthy',()=>{
 for(const bad of [{...live,id:'aaaaaaaaaaaaaaaaaaaaaaaa'},{...live,closed:undefined},{...live,idList:undefined},[],{error:'timeout'},null]){
  assert.throws(()=>run(bad),/QUOTE_CARD_CONTEXT_UNCONFIRMED/);
 }
});
test('invalid candidate fails closed',()=>assert.throws(()=>run(live,false,{card_id:'../../other'}),/QUOTE_CARD_CONTEXT_UNCONFIRMED/));
test('failure guard preserves original error on valid card',()=>{
 assert.equal(run(live,true)[0].json.failure_message,'original network error');
});
test('failure guard on moved card retains original failure in terminal error',()=>{
 assert.throws(()=>run({...live,idBoard:'62bae9b97705e7419ed64593'},true),e=>/QUOTE_CARD_MOVED_OR_CLOSED/.test(e.message)&&e.message.includes('original network error'));
});
test('failure guard on failed read retains original failure',()=>{
 assert.throws(()=>run({error:'unavailable'},true),e=>/QUOTE_CARD_CONTEXT_UNCONFIRMED/.test(e.message)&&e.message.includes('original network error'));
});
test('fresh checks inserted before both label paths',()=>{
 const w=patchWorkflow(fixture());
 for(const [from,read,guard,to] of [
 ['Select Eligible Candidate','Trello: Read Initial Label Context','Guard Initial Label Context','Trello: Clear Description Failed Label'],
 ['Prepare Description Failure Status','Trello: Read Failure Label Context','Guard Failure Label Context','Trello: Remove Description Processing Label on Failure']
 ]){
  assert.equal(w.connections[from].main[0][0].node,read);
  assert.equal(w.connections[read].main[0][0].node,guard);
  assert.equal(w.connections[guard].main[0][0].node,to);
  const n=w.nodes.find(x=>x.name===read);
  assert.equal(n.parameters.method,'GET');
  assert.equal(n.onError,'continueRegularOutput');
  assert.equal(n.parameters.queryParameters.parameters[0].value,'id,idBoard,idList,closed');
  assert.deepEqual(n.credentials,{trelloApi:{id:'existing-reference',name:'existing'}});
 }
});
test('failed processing label cannot also emit success and alerts use existing route',()=>{
 const w=patchWorkflow(fixture());
 assert.equal(w.nodes.find(n=>n.id==='description-processing-label-add').alwaysOutputData,false);
 assert.equal(w.settings.errorWorkflow,'ArT3LN25Mb1PAuBE');
});
test('patch preserves unrelated nodes, credential references, activation, settings and branches',()=>{
 const before=fixture(), copy=structuredClone(before), after=patchWorkflow(before);
 assert.deepEqual(before,copy);
 assert.equal(after.active,true);assert.equal(after.versionId,before.versionId);
 for(const n of before.nodes){
  assert.deepEqual(after.nodes.find(a=>a.id===n.id),n.id==='description-processing-label-add'?{...n,alwaysOutputData:false}:n);
 }
 assert.deepEqual(after.settings,{...before.settings,errorWorkflow:'ArT3LN25Mb1PAuBE'});
 for(const [name,c] of Object.entries(before.connections))if(!['Select Eligible Candidate','Prepare Description Failure Status'].includes(name))assert.deepEqual(after.connections[name],c);
 assert.equal(after.nodes.length,before.nodes.length+4);
});
test('unexpected workflow or changed edges/alert route are rejected',()=>{
 let w=fixture();w.id='wrong';assert.throws(()=>patchWorkflow(w));
 w=fixture();w.connections['Select Eligible Candidate'].main[0].push({node:'Other',type:'main',index:0});assert.throws(()=>patchWorkflow(w));
 w=fixture();w.settings.errorWorkflow='different';assert.throws(()=>patchWorkflow(w));
});
test('repeat patch is rejected to prevent duplicate node installation',()=>{
 assert.throws(()=>patchWorkflow(patchWorkflow(fixture())));
});

function httpOutput(body, node) {
 // HTTP Request 4.x emits one full-response envelope; body-only arrays are split.
 return node.parameters.options.response.response.fullResponse
   ? [{json:{body,statusCode:200,headers:{},statusMessage:'OK'}}]
   : (Array.isArray(body)?body:[body]).map(json=>({json}));
}
test('empty HTTP array reaches each guard and cannot silently succeed',()=>{
 const w=patchWorkflow(fixture());
 for(const [name,failure] of [['Trello: Read Initial Label Context',false],['Trello: Read Failure Label Context',true]]) {
  const node=w.nodes.find(n=>n.name===name), items=httpOutput([],node);
  assert.equal(items.length,1,'Empty HTTP response must still deliver a guard input');
  assert.throws(()=>runResponse(items[0].json,failure),e=>/QUOTE_CARD_CONTEXT_UNCONFIRMED/.test(e.message)&&(!failure||e.message.includes('original network error')));
 }
});
test('HTTP envelope rejects errors, non-200 statuses and malformed bodies',()=>{
 for(const response of [{error:'timeout'},{statusCode:502,body:live},{statusCode:204,body:null},{statusCode:200,body:[live]},live,{}]){
  assert.throws(()=>runResponse(response,true),e=>/QUOTE_CARD_CONTEXT_UNCONFIRMED/.test(e.message)&&e.message.includes('original network error'));
 }
});
