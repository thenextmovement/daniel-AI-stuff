import { findEndedDial } from './matching.mjs';

const nodes = [], connections = {};
function add(name, type, typeVersion, parameters, credentials) {
  nodes.push({id:name.replaceAll(' ', '-'),name,type:'n8n-nodes-base.'+type,typeVersion,parameters,
    position:[nodes.length*210,0],...(credentials ? {credentials} : {})});
}
function link(...names) {
  for (let i=1; i<names.length; i++) connections[names[i-1]]={main:[[{node:names[i],type:'main',index:0}]]};
}
const db = {httpHeaderAuth:{id:'NTtNxoBGGzJCQi9u',name:'Header Auth account 2 | SUPABASE'}};
const phone = {httpHeaderAuth:{id:'iiRl1hr1hSKpdfq7',name:'Placetel 2'}};
const auth = {authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth'};
const options = {timeout:7000,redirect:{redirect:{followRedirects:false}},response:{response:{fullResponse:true}}};
const rpc = 'https://klibiejfisijpagzkxls.supabase.co/rest/v1/rpc/';
function post(name, path, body) {
  add(name,'httpRequest',4.2,{method:'POST',url:rpc+path,...auth,sendBody:true,specifyBody:'json',jsonBody:body,options},db);
}
add('OPS Status','webhook',2,{path:'ops-placetel-call-end-v1',httpMethod:'POST',responseMode:'onReceived',options:{}});
add('Validate key','code',2,{jsCode:"const key=$json.body?.key;return typeof key==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key) ? [{json:{key}}] : [];"});
add('Background','scheduleTrigger',1.2,{rule:{interval:[{field:'minutes',minutesInterval:1}]}});
add('Background check','code',2,{jsCode:'return [{json:{key:null}}];'});
post('Claim check','claim_voice_placetel_end_check','={{ {p_key:$json.key} }}');
add('Eligible reservation','code',2,{jsCode:"const c=$json.body;return c?.session_id && /^\\d+$/.test(String(c.target_id)) ? [{json:c}] : [];"});
add('Read SIP identity','httpRequest',4.2,{url:"={{ 'https://api.placetel.de/v2/sip_users/' + $json.target_id }}",...auth,options},phone);
add('Billing dates','code',2,{jsCode:`const dial=Date.parse($('Eligible reservation').first().json.dialed_at);
const fmt=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'});
return [...new Set([dial-5000,dial+120000].map(t=>fmt.format(t)))].map(date=>({json:{date}}));`});
add('Read completed calls','httpRequest',4.2,{url:'https://api.placetel.de/v2/call_detail_records',...auth,sendQuery:true,
  queryParameters:{parameters:[{name:'date',value:'={{ $json.date }}'},{name:'per_page',value:'500'}]},
  options:{...options,pagination:{pagination:{paginationMode:'updateAParameterInEachRequest',parameters:{parameters:[{type:'qs',name:'page',value:'={{ $pageCount + 1 }}'}]},
    paginationCompleteWhen:'other',completeExpression:'={{ $response.body.length < 500 }}',limitPagesFetched:true,maxRequests:20}}}},phone);
add('Verify outbound call','code',2,{jsCode:findEndedDial.toString()+`
const pages=$input.all().map(item=>item.json.body);
if (!Array.isArray(pages.at(-1)) || pages.at(-1).length>=500 || pages.length>=20) throw Error('Unvollständige Placetel-Verbindungsliste.');
const result=findEndedDial($('Eligible reservation').first().json,$('Read SIP identity').first().json.body,pages);
return result ? [{json:result}] : [];`});
post('Confirm end','confirm_voice_placetel_end','={{ $json }}');
link('OPS Status','Validate key','Claim check');
link('Background','Background check','Claim check');
link('Claim check','Eligible reservation','Read SIP identity','Billing dates','Read completed calls','Verify outbound call','Confirm end');
export const workflow = {name:'OPS – Placetel Gesprächsende bestätigen',nodes,connections,settings:{
  executionOrder:'v1',errorWorkflow:'M4uG1HAtN9Zggxww',saveDataErrorExecution:'none',saveDataSuccessExecution:'none',saveManualExecutions:false,
  saveExecutionProgress:false,executionTimeout:55,timezone:'Europe/Berlin'}};
