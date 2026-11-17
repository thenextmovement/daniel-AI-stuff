import {test} from 'node:test';
import assert from 'node:assert/strict';
import {findEndedDial} from './matching.mjs';
import {workflow} from './workflow.mjs';
const c={session_id:'case',dialed_at:'2026-11-17T11:04:02Z',phone:'+491700000000',target_id:'4',employee_id:'7',extension:'11'};
const sip={id:4,webuser_id:7,did:'11',sipuid:'777100@fpbx.de',domain:'fpbx.de'};
const record={description:'mobile / Germany - SIP Dialout ',from:'777100',to:'01700000000',received_at:'2026-11-17T12:04:05+01:00',length:35};
const verify=(rows,now=Date.parse('2026-11-17T11:04:40Z'))=>findEndedDial(c,sip,[rows],now);
test('confirms a settled personal SIP dialout without audio',()=>{
  assert.equal(verify([record,{...record,description:'Call Recording'}]).p_duration,35);
  assert.equal(verify([record],Date.parse('2026-11-17T11:04:39Z')),null);
});
test('rejects other calls, uncertain times and duplicate dialouts',()=>{
  for(const change of [{description:'Call Recording'},{from:'778100'},{to:'01703333333'},{received_at:'2026-11-17T12:06:05+01:00'},{length:-1}])
    assert.equal(verify([{...record,...change}]),null);
  assert.equal(verify([record,record]),null);
  assert.throws(()=>findEndedDial(c,{...sip,webuser_id:9},[[record]]));
});
test('public webhook cannot request the scheduled global check',()=>{
  const validate=new Function('$json',workflow.nodes.find(n=>n.name==='Validate key').parameters.jsCode);
  assert.deepEqual(validate({body:{key:null}}),[]);
  assert.deepEqual(validate({body:{key:'bad'}}),[]);
  assert.equal(workflow.nodes.find(n=>n.name==='OPS Status').parameters.responseMode,'onReceived');
});
