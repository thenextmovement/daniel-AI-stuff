import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
const code=readFileSync(process.env.FORMAT_SOURCE || new URL('./format-error-data.js',import.meta.url),'utf8');
const format=(error,extra={})=>new Function('$',code)(name=>({first:()=>({json:name==='Error Trigger'?{workflow:{id:'FyZCGkPNoA6EQI3N',name:'Bank'},execution:{id:'12317245',lastNodeExecuted:'Supabase: Upsert',error,...extra}}:{emailRecipient:'support@neontrip.de'}})}))[0].json;
test('timeout cause and failed step reach email and persistent incident adapter',()=>{
 const out=format({message:'canceling statement due to statement timeout',description:'Database request failed',code:'57014'});
 assert.equal(out.lastNode,'Supabase: Upsert');
 assert.match(out.errorMessage,/statement timeout/);
 assert.match(out.emailBody,/Supabase: Upsert/);
 assert.match(out.emailBody,/statement timeout/);
 assert.match(out.emailBody,/57014/);
});
test('node fallback and unknown step are explicit',()=>{
 assert.equal(format({message:'timeout',node:{name:'Qonto: Transaktionen'}},{lastNodeExecuted:undefined}).lastNode,'Qonto: Transaktionen');
 assert.equal(format({message:'timeout'},{lastNodeExecuted:undefined}).lastNode,'Unbekannter Schritt');
});
test('secrets and personal identifiers never reach email or incident',()=>{
 const out=format({message:'timeout Authorization: Bearer fake-secret-token api_key=supersecret password=hunter2 contact person@example.com IBAN DE67100101230447004341 https://provider.invalid/?token=xyz',description:'access_token: abcdefsecret cookie: sessionsecret'});
 const serialized=JSON.stringify(out);
 for(const sensitive of ['fake-secret-token','supersecret','hunter2','person@example.com','DE67100101230447004341','abcdefsecret','sessionsecret','provider.invalid']) assert.ok(!serialized.includes(sensitive),sensitive);
 assert.match(out.errorMessage,/timeout/);
});
test('HTML error text is escaped',()=>{
 const out=format({message:'unexpected <img src=x onerror=alert(1)> & bad response'});
 assert.ok(!out.emailBody.includes('<img'));
 assert.match(out.emailBody,/&lt;img/);
});
test('empty and malformed error do not crash the error workflow',()=>{
 for(const error of [{}, {message:{bad:true},description:['bad']},null]){
  const out=format(error);
  assert.ok(out.errorMessage.length);
  assert.ok(out.emailBody.includes('Betroffener Schritt'));
 }
});
test('test marker remains visibly marked and bounded',()=>{
 const out=format({message:'OPS_MIRROR_ALERT_PATH_TEST'});
 assert.match(out.emailSubject,/Test/);
 assert.match(out.emailBody,/Kein echter Ausfall/);
 assert.ok(format({message:'x'.repeat(10000)}).errorMessage.length<=1900);
});


const consumers=JSON.parse(readFileSync(new URL('./consumers.fixture.json',import.meta.url),'utf8'));
const input=values=>({first:()=>({json:values[0]}),all:()=>values.map(json=>({json}))});
test('real incident adapter and router retain cause and step in persistent RPC',()=>{
 const alert=format({message:'canceling statement due to statement timeout',code:'57014'});
 const adapted=new Function('$input',consumers.adapter)(input([alert]))[0].json;
 const persisted=new Function('$input',consumers.router)(input([adapted]))[0].json.rpc_payload;
 assert.equal(persisted.p_metadata.last_node,'Supabase: Upsert');
 assert.match(persisted.p_metadata.error_preview_redacted,/statement timeout/);
 assert.equal(persisted.p_root_cause_code,'dependency_unavailable');
 assert.match(persisted.p_detail,/57014/);
});
test('24-hour gate suppresses same cause but passes another step or cause',()=>{
 const state={};
 const gate=alerts=>new Function('$input','$getWorkflowStaticData',consumers.gate)(input(alerts),()=>state);
 const a=format({message:'statement timeout',code:'57014'});
 assert.equal(gate([a]).length,1);
 assert.equal(gate([a]).length,0);
 assert.equal(gate([format({message:'429 Too many requests'})]).length,1);
 assert.equal(gate([format({message:'statement timeout',code:'57014'},{lastNodeExecuted:'Record Verified Sync'})]).length,1);
});

test('bounded long diagnostics remain complete in permanent preview',()=>{
 const alert=format({message:'timeout '.repeat(150),description:'database unavailable '.repeat(100),code:'57014'});
 const adapted=new Function('$input',consumers.adapter)(input([alert]))[0].json;
 const persisted=new Function('$input',consumers.router)(input([adapted]))[0].json.rpc_payload;
 assert.ok(alert.errorMessage.length<=500);
 assert.match(persisted.p_metadata.error_preview_redacted,/57014/);
});
