import assert from 'node:assert/strict';
import test from 'node:test';
import { runDhlPollBatch, type PollState } from '../../src/lib/ops/dhl-polling';
const at=Date.parse('2026-10-07T07:00:00Z');
const candidate=(trackingNumber='0012345678')=>({trackingNumber,shipmentId:'shipment',card:{id:'card',name:'card',url:'https://trello.com/c/abcdef',boardId:'62bae9b97705e7419ed64593'}});
const response={carrier:'dhl',trackingNumber:'0012345678',events:[],rawResponse:{}};
const fresh=():PollState=>({attempts:[]});
function harness(state=fresh(),fail=false){
  let clock=at;const calls:number[]=[],writes:unknown[]=[],saved:string[]=[];
  return {state,calls,writes,saved,ports:{now:()=>clock,sleep:async(ms:number)=>{clock+=ms;},save:async(s:PollState)=>{saved.push(JSON.stringify(s));},fetch:async()=>{calls.push(clock);if(fail)throw new Error('dhl_http_429');return response;},record:async(payload:unknown)=>{writes.push(payload);}}};
}
test('poll reserves before network, limits spacing, and check mode never writes business data',async()=>{
  const h=harness();await runDhlPollBatch([candidate(),candidate('9912345678')],h.state,h.ports,false);
  assert.equal(h.calls.length,2);assert.ok(h.calls[1]-h.calls[0]>=5100);assert.equal(h.writes.length,0);
  assert.equal(JSON.parse(h.saved[0]).attempts[0].status,'reserved');
});
test('replayed slots and uncertain reservations do not poll again',async()=>{
  const h=harness();await runDhlPollBatch([candidate()],h.state,h.ports,false);await runDhlPollBatch([candidate()],h.state,h.ports,false);assert.equal(h.calls.length,1);
  const s=fresh();s.attempts.push({tracking:'0012345678',slot:'2026-10-07/09',at,status:'reserved'});
  const other=harness(s);const r=await runDhlPollBatch([candidate()],s,other.ports,true);assert.equal(other.calls.length,0);assert.equal(r.issues[0].code,'previous_poll_incomplete');
});
test('auth/quota failure stops the batch, records a safe error, and never sends customer messages',async()=>{
  const h=harness(fresh(),true);const r=await runDhlPollBatch([candidate(),candidate('9912345678')],h.state,h.ports,true);
  assert.equal(h.calls.length,1);assert.equal(h.writes.length,1);assert.equal(r.issues[0].code,'dhl_http_429');assert.equal(h.state.attempts[0].status,'failed');
});
test('rolling quota uses remaining capacity and explicitly reports incomplete coverage',async()=>{
  const h=harness({attempts:Array.from({length:224},(_,i)=>({tracking:String(i),slot:'old',at:at-3600000,status:'checked'}))} as PollState);
  const r=await runDhlPollBatch([candidate(),candidate('9912345678')],h.state,h.ports,false);
  assert.equal(h.calls.length,1);assert.equal(h.state.attempts.length,225);assert.equal(r.issues[0].code,'dhl_budget_insufficient');
});
test('database failure never masquerades as carrier failure or repeats an uncertain write',async()=>{
  const h=harness();h.ports.record=async()=>{throw new Error('private-db-secret');};
  const r=await runDhlPollBatch([candidate()],h.state,h.ports,true);
  assert.equal(h.calls.length,1);assert.equal(h.state.attempts[0].status,'record_uncertain');assert.equal(r.issues[0].code,'dhl_record_uncertain');assert.doesNotMatch(JSON.stringify(r),/private-db-secret/);
});
test('a persisted check does not count as a synced response',async()=>{
  const h=harness();await runDhlPollBatch([candidate()],h.state,h.ports,true);assert.equal(h.writes.length,1);assert.equal(h.state.attempts[0].status,'synced');
});

test('slow reservation persistence cannot collapse actual HTTP spacing',async()=>{
  let clock=at,saves=0;const calls:number[]=[];
  await runDhlPollBatch([candidate(),candidate('9912345678')],fresh(),{
    now:()=>clock,sleep:async ms=>{clock+=ms;},
    save:async()=>{if(++saves===1)clock+=6000;},
    fetch:async()=>{calls.push(clock);return response;},record:async()=>{},
  },false);
  assert.ok(calls[1]-calls[0]>=5100);
});

test('09, 18 and 23 slots each poll once without replay or extra business writes',async()=>{
  const h=harness();let clock=at;h.ports.now=()=>clock;
  for(const hour of [7,16,21]) {
    clock=Date.parse('2026-10-07T'+String(hour).padStart(2,'0')+':00:00Z');
    await runDhlPollBatch([candidate()],h.state,h.ports,false);
    await runDhlPollBatch([candidate()],h.state,h.ports,false);
  }
  assert.equal(h.calls.length,3);
  assert.deepEqual(h.state.attempts.map(a=>a.slot),['2026-10-07/09','2026-10-07/18','2026-10-07/23']);
  assert.equal(h.writes.length,0);
});


test('limited quota prioritizes never checked then least recently attempted shipments',async()=>{
  const a=candidate('1111111111'),b=candidate('2222222222'),c=candidate('3333333333');
  const attempts:PollState['attempts']=Array.from({length:220},(_,i)=>({tracking:String(i),slot:'old',at:at-3600000,status:'checked'}));
  attempts.push({tracking:a.trackingNumber,slot:'older',at:at-7200000,status:'synced'},
    {tracking:a.trackingNumber,slot:'old',at:at-1000,status:'synced'},
    {tracking:b.trackingNumber,slot:'old',at:at-3600000,status:'synced'});
  const h=harness({attempts}),fetched:string[]=[];
  h.ports.fetch=async(n?:string)=>{fetched.push(n!);return response;};
  const r=await runDhlPollBatch([a,b,c],h.state,h.ports,true);
  assert.deepEqual(fetched,[c.trackingNumber,b.trackingNumber]);
  assert.equal(r.synced,2);assert.equal(h.writes.length,2);assert.equal(h.state.attempts.length,225);
  assert.equal(r.issues[0].code,'dhl_budget_insufficient');
  await runDhlPollBatch([a,b,c],h.state,h.ports,true);
  assert.equal(fetched.length,2);
});

test('exhausted budget reserves nothing; expired usage becomes available without state reset',async()=>{
  const h=harness({attempts:Array.from({length:225},(_,i)=>({tracking:String(i),slot:'old',at:at-3600000,status:'checked'}))} as PollState);
  const r=await runDhlPollBatch([candidate()],h.state,h.ports,true);
  assert.equal(r.checked,0);assert.equal(h.saved.length,0);assert.equal(h.writes.length,0);
  h.state.attempts[0].at=at-86400001;
  const next=await runDhlPollBatch([candidate()],h.state,h.ports,true);
  assert.equal(next.synced,1);assert.equal(next.issues.length,0);assert.equal(h.state.attempts.length,226);
});
