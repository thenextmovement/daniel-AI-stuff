import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {buildFormatterPatch, buildSourcePatch, candidateCode} from './patch.mjs';

const baseline = JSON.parse(readFileSync(new URL('./fixtures/baseline.json', import.meta.url)));
const clone = v => JSON.parse(JSON.stringify(v));
const epoch = Date.parse('2026-10-27T12:00:00Z');
function run(code, input, {now=epoch, state={}}={}) {
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  return clone(runInNewContext('(function(){' + code + '\n})()', {
    Date:Clock, $input:{first:()=>({json:input}), all:()=>[{json:input}]},
    $:name=>({first:()=>({json:name==='Error Trigger' ? input : {emailRecipient:'support@neontrip.de,rh@neontrip.de'}})}),
    $getWorkflowStaticData:()=>state
  }));
}
const sample = (overrides={}) => ({
  workflow:{id:baseline.source.id, name:'untrusted-source-name'},
  execution:{id:'10499999', url:'https://evil.invalid/payload', lastNodeExecuted:'Render 2D PNG',
    error:{message:'500 - raw upstream response secret-sentinel', description:'private-sentinel', stack:'stack-sentinel'}},
  ...overrides
});
const format = input => run(candidateCode, input)[0].json;
function snapshot(stamp, nodes) {
  const w={...clone(stamp), nodes:clone(nodes), connections:{}};
  w.activeVersion={versionId:w.activeVersionId,nodes:clone(w.nodes),connections:{}};
  return w;
}
const other={id:'untouched',name:'untouched',type:'test-node',credentials:{ref:{id:'credential-sentinel'}},parameters:{keep:'unchanged'}};
function snapshots() {
  return {
    formatter:snapshot(baseline.formatter,[
      clone(baseline.formatterNode), {...baseline.whatsappNode}, clone(baseline.emailNode),
      clone(baseline.throttleNode),clone(other)
    ]),
    gate:snapshot(baseline.gate,[clone(baseline.gateNode)]),
    source:snapshot(baseline.source,[clone(other)])
  };
}
function candidateFormatter(original) {
  const w=clone(original);
  w.versionId=w.activeVersionId='published-candidate-v1';
  w.nodes.find(n=>n.id===baseline.formatterNode.id).parameters.jsCode=candidateCode;
  w.activeVersion={versionId:w.versionId,nodes:clone(w.nodes),connections:clone(w.connections)};
  return w;
}
test('scoped alert is support-only with fixed identity and a locally constructed execution link',()=>{
  const out=format(sample());
  assert.equal(out.emailRecipient,'support@neontrip.de');
  assert.equal(out.workflowId,baseline.source.id);
  assert.equal(out.executionUrl,'https://fuajob.online/workflow/rBggMnVkWwiVXXXO/executions/10499999');
  assert.equal(out.errorMessage,'CONFIGURATOR_ASSET_HTTP_500');
  for(const text of ['evil.invalid','untrusted-source-name','secret-sentinel','private-sentinel','stack-sentinel','rh@'])
    assert.equal(JSON.stringify(out).includes(text),false);
});
test('HTML, unknown error objects, node names and invalid IDs never enter output',()=>{
  const input=sample();
  input.execution={id:'"><script>id-sentinel</script>',url:'javascript:evil',lastNodeExecuted:'<img src=x onerror=evil>',
    error:{message:{payload:'private-sentinel'},description:'<script>private</script>',stack:'secret-stack'}};
  const out=format(input);
  assert.equal(out.errorMessage,'CONFIGURATOR_ASSET_EXECUTION_FAILED');
  assert.equal(out.lastNode,'Unbekannter Schritt');
  assert.equal(out.executionId,'');
  assert.equal(out.executionUrl,'https://fuajob.online/workflow/rBggMnVkWwiVXXXO');
  assert.doesNotMatch(JSON.stringify(out),/script|onerror|sentinel|javascript|secret-stack/);
});
test('only allowlisted node names survive; all twelve workflow steps have defined labels',()=>{
  for(const name of baseline.sourceNodeNames){
    const input=sample();input.execution.lastNodeExecuted=name;
    assert.equal(format(input).lastNode,name);
  }
  const input=sample();input.execution.lastNodeExecuted='New unknown <node>';
  assert.equal(format(input).lastNode,'Unbekannter Schritt');
});
test('known error classes remain distinguishable without passing raw details',()=>{
  for(const [error,expected] of [
    [{httpCode:429,message:'private'},'HTTP_429'],
    [{statusCode:503,message:'private'},'HTTP_503'],
    [{message:'HTTP 401 private'},'HTTP_401'],
    [{message:'Task timed out private'},'TIMEOUT'],
    [{message:'getaddrinfo EAI_AGAIN private'},'CONNECTION_FAILED'],
    [{message:'<script>private</script>'},'EXECUTION_FAILED'],
    [{httpCode:'500"><img>',message:'private'},'EXECUTION_FAILED']
  ]){
    const input=sample();input.execution.error=error;
    const out=format(input);
    assert.equal(out.errorMessage,'CONFIGURATOR_ASSET_'+expected);
    assert.equal(JSON.stringify(out).includes('private'),false);
  }
});
test('missing execution context produces a safe workflow-only alert',()=>{
  const out=format({workflow:{id:baseline.source.id}});
  assert.equal(out.emailRecipient,'support@neontrip.de');
  assert.equal(out.lastNode,'Unbekannter Schritt');
  assert.equal(out.executionId,'');
});
test('foreign source formatting and recipients remain exactly unchanged',()=>{
  for(const id of ['other','FyZCGkPNoA6EQI3N','m6VJ0hvDT7I40xy0','sEP7CFh1qr6EpO0V','HzMgctp78bcMq44A','oA57luKTeHEE06uN']){
    const input=sample({workflow:{id,name:'Existing workflow'}});
    assert.deepEqual(run(candidateCode,input),run(baseline.formatterNode.parameters.jsCode,input));
  }
});
test('shared gate still approves first occurrence and bundles identical class/node for exactly1440min',()=>{
  const state={},alert=format(sample()),gate=baseline.gateNode.parameters.jsCode;
  const first=run(gate,alert,{state,now:epoch});
  assert.equal(first.length,1);
  assert.equal(first[0].json.emailRecipient,'support@neontrip.de');
  assert.equal(first[0].json.gateDedupeWindowMinutes,1440);
  assert.equal(run(gate,{...alert,executionId:'10500000'},{state,now:epoch+5*60*1000}).length,0);
  assert.equal(run(gate,alert,{state,now:epoch+24*60*60*1000-1}).length,0);
  const next=run(gate,alert,{state,now:epoch+24*60*60*1000});
  assert.equal(next.length,1);
  assert.equal(next[0].json.gateSuppressedSinceLastSend,2);
});
test('different stage or classified failure is not hidden by an earlier gate entry',()=>{
  const state={},gate=baseline.gateNode.parameters.jsCode;
  run(gate,format(sample()),{state});
  const stage=sample();stage.execution.lastNodeExecuted='Store PNG';
  const status=sample();status.execution.error={httpCode:429};
  assert.equal(run(gate,format(stage),{state,now:epoch+1}).length,1);
  assert.equal(run(gate,format(status),{state,now:epoch+2}).length,1);
});
test('shadow adapter receives sanitized fields and no payload/customer data',()=>{
  const alert=format(sample());
  const shadow=run(baseline.shadowPrepareSource,alert)[0].json;
  assert.equal(shadow.source_workflow_id,baseline.source.id);
  assert.equal(shadow.metadata.error_message,'CONFIGURATOR_ASSET_HTTP_500');
  assert.doesNotMatch(JSON.stringify(shadow),/sentinel|evil.invalid|untrusted-source-name/);
});
test('formatter patch has exactly one parameter update and never changes its input',()=>{
  const {formatter,gate}=snapshots(),before=clone(formatter);
  const p=buildFormatterPatch(formatter,gate);
  assert.deepEqual(formatter,before);
  assert.deepEqual(p.operations,[{type:'updateNode',nodeId:'format-error',updates:{'parameters.jsCode':candidateCode}}]);
  const after=clone(formatter);after.nodes.find(n=>n.id==='format-error').parameters.jsCode=candidateCode;
  after.nodes.find(n=>n.id==='format-error').parameters.jsCode=baseline.formatterNode.parameters.jsCode;
  assert.deepEqual(after,before);
  assert.equal(formatter.nodes.find(n=>n.id===baseline.whatsappNode.id).disabled,true);
});
test('formatter CAS rejects version, published content, settings, recipient, WA and gate drift',()=>{
  const changes=[
    s=>s.formatter.versionId='drift',
    s=>s.formatter.activeVersionId='drift',
    s=>s.formatter.active=false,
    s=>s.formatter.activeVersion.nodes[0].parameters.jsCode='drift',
    s=>s.formatter.settings.executionOrder='drift',
    s=>s.formatter.nodes.find(n=>n.id==='format-error').parameters.jsCode='drift',
    s=>s.formatter.nodes.find(n=>n.id===baseline.whatsappNode.id).disabled=false,
    s=>s.formatter.nodes.find(n=>n.id===baseline.emailNode.id).parameters.toRecipients='customer@example.invalid',
    s=>s.gate.activeVersionId='drift',
    s=>s.gate.nodes[0].parameters.jsCode='changed cooldown'
  ];
  for(const change of changes){const s=snapshots();change(s);assert.throws(()=>buildFormatterPatch(s.formatter,s.gate),/BASELINE_DRIFT/);}
});
test('source assignment is gated on the verified published formatter candidate',()=>{
  const s=snapshots();
  assert.throws(()=>buildSourcePatch(s.source,s.formatter,s.gate,s.formatter.versionId,s.formatter),/BASELINE_DRIFT/);
  const applied=candidateFormatter(s.formatter);
  assert.throws(()=>buildSourcePatch(s.source,applied,s.gate,'wrong-version',s.formatter),/BASELINE_DRIFT/);
  const before=clone(s.source);
  const p=buildSourcePatch(s.source,applied,s.gate,applied.versionId,s.formatter);
  assert.deepEqual(p.operations,[{type:'updateSettings',settings:{errorWorkflow:baseline.formatter.id}}]);
  assert.deepEqual(s.source,before);
  const result={...clone(s.source),settings:{...s.source.settings,...p.operations[0].settings}};
  delete result.settings.errorWorkflow;
  assert.deepEqual(result,before);
});
test('source CAS rejects source or dependency drift and does not allow stale reapplication',()=>{
  for(const change of [
    s=>s.source.versionId='drift',
    s=>s.source.activeVersionId='drift',
    s=>s.source.active=false,
    s=>s.source.settings.errorWorkflow='another-workflow',
    s=>s.gate.active=false,
    s=>s.formatter.settings.callerPolicy='other-policy',
    s=>s.formatter.nodes.find(n=>n.id==='format-error').parameters.jsCode+='changed'
  ]){
    const s=snapshots(),before=clone(s.formatter);s.formatter=candidateFormatter(s.formatter);change(s);
    assert.throws(()=>buildSourcePatch(s.source,s.formatter,s.gate,'published-candidate-v1',before),/BASELINE_DRIFT/);
  }
});
test('source assignment rejects any foreign node, credential or connection change after formatter publication',()=>{
  for(const change of [
    w=>w.nodes.find(n=>n.id==='untouched').parameters.keep='drift',
    w=>w.nodes.find(n=>n.id==='untouched').credentials.ref.id='drift',
    w=>w.connections.extra={main:[[]]},
    w=>w.name='drift',
    w=>w.pinData={injected:'drift'}
  ]){
    const s=snapshots(),after=candidateFormatter(s.formatter);change(after);
    after.activeVersion={versionId:after.versionId,nodes:clone(after.nodes),connections:clone(after.connections)};
    assert.throws(()=>buildSourcePatch(s.source,after,s.gate,after.versionId,s.formatter),/BASELINE_DRIFT/);
  }
});
