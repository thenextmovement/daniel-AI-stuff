import assert from 'node:assert/strict';
import test from 'node:test';
import { SupabaseRestError } from '../../src/lib/quotes/supabase-rest';
import { runDhlPollBatch, DhlPrewriteError, type PollState } from '../../src/lib/ops/dhl-polling';
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
  assert.equal(r.candidateCount,2);assert.equal(r.dueCount,2);assert.equal(r.attempted,1);assert.equal(r.deferredCount,1);
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


test('same-time daily batches reuse quota as prior reservations expire during polling',async()=>{
  const attempts:PollState['attempts']=[];
  for(const hour of [7,16,21]) for(let i=0;i<75;i++) attempts.push({
    tracking:String(i).padStart(10,'0'),slot:`2026-10-06/${hour+2}`,
    at:Date.parse(`2026-10-06T${String(hour).padStart(2,'0')}:00:00Z`)+(i+1)*5100,status:'synced',
  });
  const h=harness({attempts}),original=JSON.stringify(attempts);
  const result=await runDhlPollBatch(Array.from({length:75},(_,i)=>candidate(String(i).padStart(10,'0'))),h.state,h.ports,true);
  assert.equal(result.checked,75);assert.equal(result.synced,75);assert.deepEqual(result.issues,[]);
  assert.equal(JSON.stringify(h.state.attempts.slice(0,225)),original);
  for(const saved of h.saved) {
    const entries=(JSON.parse(saved) as PollState).attempts,last=entries.at(-1)!;
    assert.ok(entries.filter(a=>a.at>last.at-86400000).length<=225);
  }
  assert.ok(h.calls.every((time,i)=>i===0||time-h.calls[i-1]>=5100));
  const replay=await runDhlPollBatch(Array.from({length:75},(_,i)=>candidate(String(i).padStart(10,'0'))),h.state,h.ports,true);
  assert.equal(replay.checked,0);assert.equal(h.calls.length,75);
  assert.equal(result.candidateCount,75);assert.equal(result.dueCount,75);assert.equal(result.attempted,75);assert.equal(result.deferredCount,0);
  assert.equal(replay.candidateCount,75);assert.equal(replay.dueCount,0);assert.equal(replay.attempted,0);assert.equal(replay.deferredCount,0);
});

test('quota becoming free shortly after pacing is awaited before reserving',async()=>{
  const attempts:PollState['attempts']=Array.from({length:224},(_,i)=>({tracking:String(i),slot:'old',at:at-3600000,status:'checked'}));
  attempts.push({tracking:'older',slot:'old',at:at-86400000+20000,status:'failed'});
  const h=harness({attempts});
  const result=await runDhlPollBatch([candidate()],h.state,h.ports,false);
  assert.equal(result.checked,1);assert.deepEqual(result.issues,[]);
  assert.equal(h.calls[0],at+20000);
});

test('quota wait is bounded across the whole batch and leaves unattempted shipments deferred',async()=>{
  const attempts:PollState['attempts']=Array.from({length:223},(_,i)=>({tracking:String(i),slot:'old',at:at-3600000,status:'checked'}));
  attempts.push({tracking:'first',slot:'old',at:at-86400000+300000,status:'reserved'},
    {tracking:'second',slot:'old',at:at-86400000+650000,status:'record_uncertain'});
  const h=harness({attempts});
  const result=await runDhlPollBatch([candidate(),candidate('9912345678')],h.state,h.ports,true);
  assert.equal(result.checked,1);assert.equal(result.synced,1);
  assert.equal(h.calls[0],at+300000);assert.ok(h.ports.now()<at+650000);
  assert.deepEqual(result.issues.map(i=>i.code),['dhl_budget_insufficient']);
  assert.equal(h.state.attempts.length,226);
  assert.equal(result.dueCount,2);assert.equal(result.attempted,1);assert.equal(result.deferredCount,1);
});


for(const oversleep of [false,true]) test(`slot rollover after ${oversleep?'quota wait':'pacing'} defers work before another reservation`,async()=>{
  const start=Date.parse('2026-10-07T15:59:40Z'),boundary=Date.parse('2026-10-07T16:00:00Z');
  const attempts:PollState['attempts']=Array.from({length:223},(_,i)=>({tracking:String(i),slot:'old',at:start-3600000,status:'checked'}));
  attempts.push({tracking:'old-first',slot:'old',at:start-86400000+15000,status:'checked'},
    {tracking:'old-second',slot:'old',at:start-86400000+20000,status:'checked'});
  const h=harness({attempts});let clock=start,sleeps=0;
  h.ports.now=()=>clock;
  h.ports.sleep=async(ms:number)=>{clock+=ms;if(oversleep&&++sleeps===2)clock+=6000;};
  h.ports.fetch=async()=>{h.calls.push(clock);return response;};
  const result=await runDhlPollBatch([candidate(),candidate('9912345678')],h.state,h.ports,true);
  assert.equal(result.attempted,oversleep?0:1);assert.equal(result.synced,oversleep?0:1);
  assert.equal(result.dueCount,2);assert.equal(result.deferredCount,oversleep?2:1);
  assert.deepEqual(result.issues.map(i=>i.code),['dhl_poll_slot_changed']);
  assert.ok(h.state.attempts.slice(225).every(a=>a.at<boundary&&a.slot==='2026-10-07/09'));
  const next=await runDhlPollBatch([candidate('9912345678')],h.state,h.ports,true);
  assert.equal(next.attempted,1);assert.equal(h.state.attempts.at(-1)!.slot,'2026-10-07/18');
  const replay=await runDhlPollBatch([candidate('9912345678')],h.state,h.ports,true);
  assert.equal(replay.attempted,0);
});

for(const carrierFailure of [false,true]) test(`prewrite failure preserves quota and stops without claiming write uncertainty (carrier error ${carrierFailure})`,async()=>{
  const h=harness();
  if(carrierFailure) h.ports.fetch=async()=>{h.calls.push(at);throw new Error('dhl_invalid_payload');};
  h.ports.record=async()=>{throw new DhlPrewriteError('tracking_history_unavailable','TimeoutError','board');};
  const r=await runDhlPollBatch([candidate(),candidate('9912345678')],h.state,h.ports,true);
  assert.equal(h.calls.length,1);assert.equal(r.deferredCount,1);assert.equal(r.synced,0);
  assert.equal(h.state.attempts[0].status,'failed');assert.equal(h.state.attempts[0].recordPhase,'prewrite');
  assert.equal(h.state.attempts[0].recordError,'TimeoutError');
  assert.ok(r.issues.some(i=>i.code==='tracking_history_unavailable'));
  assert.ok(!r.issues.some(i=>i.code==='dhl_record_uncertain'));
  await runDhlPollBatch([candidate()],h.state,h.ports,true);assert.equal(h.calls.length,1);
});
test('unknown submitted write retains uncertainty, stops and strips upstream data',async()=>{
  const h=harness();h.ports.record=async()=>{throw new TypeError('https://secret.invalid?token=private');};
  const r=await runDhlPollBatch([candidate(),candidate('9912345678')],h.state,h.ports,true);
  assert.equal(r.deferredCount,1);assert.equal(h.state.attempts[0].status,'record_uncertain');
  assert.equal(h.state.attempts[0].recordPhase,'record');assert.equal(h.state.attempts[0].recordError,'TypeError');
  assert.doesNotMatch(JSON.stringify([h.state,r]),/private|secret/);
  await runDhlPollBatch([candidate()],h.state,h.ports,true);assert.equal(h.calls.length,1);
});

for(const carrierFailure of [false,true]) test(`card-local prewrite failure leaves unrelated tracking eligible (${carrierFailure})`,async()=>{
  const h=harness();let records=0;
  if(carrierFailure) h.ports.fetch=async()=>{h.calls.push(at);throw new Error('dhl_invalid_payload');};
  h.ports.record=async()=>{if(++records===1)throw new DhlPrewriteError('tracking_history_unavailable','http_503','card');};
  const r=await runDhlPollBatch([candidate(),candidate('9912345678')],h.state,h.ports,true);
  assert.equal(h.calls.length,2);assert.equal(records,2);assert.equal(r.deferredCount,0);
  assert.equal(h.state.attempts[0].status,'failed');assert.equal(h.state.attempts[0].recordError,'http_503');
  assert.equal(r.synced,carrierFailure?0:1);
});

test('submitted RPC HTTP status is retained without its private body',async()=>{
  const h=harness();h.ports.record=async()=>{throw new SupabaseRestError('private',502,{token:'private'});};
  await runDhlPollBatch([candidate()],h.state,h.ports,true);
  assert.equal(h.state.attempts[0].recordError,'http_502');assert.equal(h.state.attempts[0].status,'record_uncertain');
  assert.doesNotMatch(JSON.stringify(h.state),/private/);
});
