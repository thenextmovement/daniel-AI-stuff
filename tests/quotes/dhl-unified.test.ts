import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeDhlUnified, fetchDhlUnified, planDhlChecks, berlinPollSlot } from '../../src/lib/ops/dhl-unified';
import { assessDhlRelease } from '../../src/lib/ops/arrival-labels/tracking';

const number = '0012345678';
const now = Date.parse('2026-10-07T13:00:00Z');
const event = (description: string, timestamp = '2026-10-07T12:00:00', countryCode = 'DE') => ({
  timestamp, statusCode: 'transit', description, location: {address: {addressLocality:'LEIPZIG',countryCode}},
});
const body = (events = [event('Arrived at DHL Sort Facility'),event('Clearance processing complete','2026-10-07T12:10:00')]) => ({shipments:[{id:number,service:'express',events}]});
const card = (id='card1',listId='69ff17bfab2afaaf96f7033a',trackingField:string|null=null) => ({id,name:`#NEONT123 ${number}`,url:`https://trello.com/c/${id}`,boardId:'62bae9b97705e7419ed64593',listId,listName:'Prepare Shipping',trackingField});

test('real DHL event locations and local timestamps feed the existing release gate',()=>{
  const result=normalizeDhlUnified(number,body(),now);
  assert.equal(result.events[0].eventTime,'2026-10-07T10:00:00Z');
  assert.equal(result.events[0].eventLocation,'DE');
  assert.equal(assessDhlRelease({events:result.events.map(e=>({event_time:e.eventTime,event_location:e.eventLocation,carrier_status_text:e.statusText})),lastCheckedAt:'2026-10-07T12:30:00Z',statusReason:null},now).allowed,true);
});
test('wrong, multiple and absent shipment identities cannot inherit another shipment history',()=>{
  for(const b of [{shipments:[]},{shipments:[{...body().shipments[0],id:'9912345678'}]},{shipments:[body().shipments[0],body().shipments[0]]}]) assert.throws(()=>normalizeDhlUnified(number,b,now),/identity/);
});
test('missing, future, impossible and ambiguous event times are never replaced by now',()=>{
  for(const timestamp of ['', 'bad', '2026-02-30T12:00:00Z','2026-10-08T12:00:00Z','2026-10-25T02:30:00']) assert.throws(()=>normalizeDhlUnified(number,body([event('Arrived at DHL',timestamp)]),now),/time/);
  assert.throws(()=>normalizeDhlUnified(number,body([event('Processed at','2026-10-07T10:00:00','US')]),now),/timezone/);
});
test('China timestamps are converted with China time, explicit offsets preserved',()=>{
  const r=normalizeDhlUnified(number,body([event('Processed at','2026-10-07T12:00:00','CN'),event('Processed at','2026-10-07T12:00:00+02:00')]),now);
  assert.deepEqual(r.events.map(e=>e.eventTime),['2026-10-07T04:00:00Z','2026-10-07T10:00:00Z']);
});
test('event keys deduplicate repeats but distinguish location and repeated checkpoints',()=>{
  const a=event('Processed at');const b={...a,location:{address:{addressLocality:'FRANKFURT',countryCode:'DE'}}};
  const r=normalizeDhlUnified(number,body([a,a,b]),now);
  assert.equal(r.events.length,2);assert.notEqual(r.events[0].eventKey,r.events[1].eventKey);
  assert.equal(normalizeDhlUnified(number,body([a]),now).events[0].eventKey,r.events[0].eventKey);
});
test('later DHL status hold is retained even when absent from history',()=>{
  const b=body();Object.assign(b.shipments[0],{status:event('Shipment on hold','2026-10-07T12:20:00')});
  const r=normalizeDhlUnified(number,b,now);
  assert.equal(r.events.length,3);
  assert.equal(assessDhlRelease({events:r.events.map(e=>({event_time:e.eventTime,event_location:e.eventLocation,carrier_status_text:e.statusText})),lastCheckedAt:'2026-10-07T12:30:00Z',statusReason:null},now).allowed,false);
});
test('empty or malformed history fails closed and private shipment addresses are omitted',()=>{
  assert.throws(()=>normalizeDhlUnified(number,body([]),now),/events/);
  const b=body();Object.assign(b.shipments[0],{receiver:{name:'PRIVATE CUSTOMER',address:'PRIVATE ADDRESS'}});
  const r=normalizeDhlUnified(number,b,now);assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);
});
test('DHL request uses header auth, express and English without redirect or retry',async()=>{
  let calls=0;
  const result=await fetchDhlUnified(number,'test-secret',async(input,init)=>{
    calls++;const u=new URL(String(input));assert.equal(u.origin,'https://api-eu.dhl.com');assert.equal(u.searchParams.get('trackingNumber'),number);assert.equal(u.searchParams.get('service'),'express');assert.equal(u.searchParams.get('language'),'en');assert.equal(new Headers(init?.headers).get('DHL-API-Key'),'test-secret');assert.equal(init?.redirect,'error');return Response.json(body());
  },now);
  assert.equal(result.events.length,2);assert.equal(calls,1);
});
test('auth/quota/network/invalid JSON failures never include response bodies or keys',async()=>{
  for(const status of [401,403,404,429,503]) await assert.rejects(()=>fetchDhlUnified(number,'test-secret',async()=>new Response('private-token',{status}),now),e=>e instanceof Error && e.message===`dhl_http_${status}`);
  await assert.rejects(()=>fetchDhlUnified(number,'test-secret',async()=>{throw new Error('private-token');},now),/dhl_network_error/);
  await assert.rejects(()=>fetchDhlUnified(number,'test-secret',async()=>new Response('private-token'),now),/dhl_invalid_json/);
});
test('Berlin polling slots handle summer/winter time and do not poll at night',()=>{
  for(const [date,expected] of [['2026-10-07T06:59:59Z',null],['2026-10-07T07:00:00Z','2026-10-07/09'],['2026-10-07T16:00:00Z','2026-10-07/18'],['2026-12-07T08:00:00Z','2026-12-07/09'],['2026-12-07T17:00:00Z','2026-12-07/18'],['2026-10-07T20:59:59Z','2026-10-07/18'],['2026-10-07T21:00:00Z','2026-10-07/23'],['2026-12-07T22:00:00Z','2026-12-07/23'],['2026-10-07T22:00:00Z',null]]) assert.equal(berlinPollSlot(Date.parse(date!)),expected);
});
test('intake accepts all three lists and Create Invoice catch-up with title or field',()=>{
  for(const list of ['6347e0971a7efc0482e6c3fe','6544ca38c328c64bbcabf4e8','69ff17bfab2afaaf96f7033a','69ef8a5b2e64cf224dd5746e']) {
    const c=card('card1',list,`DHL ${number}`);c.name='#NEONT123';assert.equal(planDhlChecks([c],[]).candidates[0].trackingNumber,number);
  }
});
test('foreign boards, manual lists, duplicate cards, title conflicts and old mappings block',()=>{
  assert.equal(planDhlChecks([{...card(),boardId:'foreign'}],[]).candidates.length,0);
  assert.equal(planDhlChecks([card('card1','6347e0a2f062500084675062')],[{id:'s1',tracking_number:number,trello_card_id:'card1'}]).candidates.length,0);
  for(const [cards,shipments] of [[[card(),card('card2')],[]],[[card('card1',undefined,'9912345678')],[]],[[card()],[{id:'s1',tracking_number:number,trello_card_id:'old'}]]] as any) {
    const r=planDhlChecks(cards,shipments);assert.equal(r.candidates.length,0);assert.ok(r.issues.length);
  }
});
test('existing shipment continues in Sign Shipped but unrelated old shipments are not polled',()=>{
  const r=planDhlChecks([card('card1','6347e09cb326e6014856bc3b')],[{id:'s1',tracking_number:number,trello_card_id:'card1'},{id:'s2',tracking_number:'9912345678',trello_card_id:'old'}]);
  assert.equal(r.candidates.length,1);assert.equal(r.candidates[0].shipmentId,'s1');
});

test('non-German localities containing de never grant Germany release',()=>{
  const events=[event('Arrived at DHL Sort Facility','2026-10-07T10:00:00Z','BR'),event('Clearance processing complete','2026-10-07T10:10:00Z','BR')];
  for(const e of events)e.location.address.addressLocality='RIO DE JANEIRO';
  const r=normalizeDhlUnified(number,body(events),now);
  assert.equal(assessDhlRelease({events:r.events.map(e=>({event_time:e.eventTime,event_location:e.eventLocation,carrier_status_text:e.statusText})),lastCheckedAt:'2026-10-07T12:30:00Z',statusReason:null},now).allowed,false);
});

test('supplemental carrier instructions survive normalization as a private-safe blocking marker',()=>{
  const rr='Customs clearance status updated. Note - The Customs clearance process may start while the shipment is in transit to the destination.';
  const arrival=event('Arrived at DHL Sort Facility','2026-10-07T11:00:00');
  const clearance=event('Clearance processing complete','2026-10-07T11:10:00');
  const update=event(rr,'2026-10-07T11:20:00');
  const movement=event('Processed at LEIPZIG','2026-10-07T11:30:00');
  const allow=(events:unknown[])=>{
    const r=normalizeDhlUnified(number,{shipments:[{id:number,service:'express',events}]},now);
    assert.doesNotMatch(JSON.stringify(r),/PRIVATE INSTRUCTIONS/);
    return assessDhlRelease({events:r.events.map(e=>({event_time:e.eventTime,event_location:e.eventLocation,carrier_status_text:e.statusText})),lastCheckedAt:'2026-10-07T12:30:00Z',statusReason:null},now).allowed;
  };
  for(const key of ['remark','nextSteps']) {
    assert.equal(allow([arrival,clearance,{...update,[key]:'PRIVATE INSTRUCTIONS: import documents required'},movement]),false);
    assert.equal(allow([arrival,clearance,update,{...movement,[key]:'PRIVATE INSTRUCTIONS'}]),false);
    assert.equal(allow([arrival,{...clearance,[key]:'PRIVATE INSTRUCTIONS'},movement]),false);
    // Earlier annotations must not poison later explicit, unannotated clearance.
    assert.equal(allow([{...arrival,[key]:'PRIVATE INSTRUCTIONS'},clearance,movement]),true);
    assert.equal(allow([arrival,clearance,{...update,[key]:'   '},movement]),true);
  }
});


const deliveredShipment=()=>({id:'s1',tracking_number:number,trello_card_id:'card1',status:'delivered',status_reason:null,
  delivered_at:'2026-10-06T12:00:00Z',last_checked_at:'2026-10-07T12:00:00Z',
  tracking_provider:'dhl-unified',response_provider:'dhl-unified',response_id:number,response_service:'express'});
const completedCase=()=>({incoming_dhl_tracking_number:number,trello_card_id:'card1',status:'completed',manual_review_reason:null,
  delivery_note_required:false,delivery_note_status:'not_required',purchase_jobs:[{status:'completed'}],print_jobs:[{status:'printed'}]});

test('confirmed DHL deliveries stop polling only after matching label work is complete',()=>{
  const result=planDhlChecks([card()],[deliveredShipment()],[completedCase()]);
  assert.equal(result.candidates.length,0);assert.equal(result.completedCount,1);assert.deepEqual(result.issues,[]);
});

test('legacy delivery flags, mismatched responses and incomplete evidence keep polling',()=>{
  for(const change of [
    {status:'in_transit'}, {status_reason:'tracking_api_error:dhl_http_429'}, {delivered_at:null}, {delivered_at:'invalid'},
    {delivered_at:'2026-10-08T12:00:00Z'}, {last_checked_at:null}, {last_checked_at:'2999-01-01T00:00:00Z'},
    {tracking_provider:'17track'}, {response_provider:'17track'}, {response_id:'9912345678'}, {response_service:null},
  ]) {
    const result=planDhlChecks([card()],[{...deliveredShipment(),...change}],[completedCase()]);
    assert.equal(result.candidates.length,1,JSON.stringify(change));assert.equal(result.completedCount,0);
  }
});

test('reopened, ambiguous or unfinished downstream work retains fresh DHL checks',()=>{
  for(const change of [
    {status:'existing_label'}, {status:'manual_review'}, {manual_review_reason:'review'}, {trello_card_id:'different'},
    {incoming_dhl_tracking_number:'9912345678'}, {delivery_note_required:true},
    {purchase_jobs:[{status:'completed'},{status:'queued'}]}, {print_jobs:[{status:'printed'},{status:'submitted'}]},
    {purchase_jobs:undefined}, {print_jobs:[]},
  ]) assert.equal(planDhlChecks([card()],[deliveredShipment()],[{...completedCase(),...change}]).candidates.length,1,JSON.stringify(change));
  assert.equal(planDhlChecks([card()],[deliveredShipment()],[]).candidates.length,1);
  assert.equal(planDhlChecks([card()],[deliveredShipment()],[completedCase(),{...completedCase(),status:'manual_review'}]).candidates.length,1);
});

test('completion cannot hide a conflicting card or shipment identity',()=>{
  for(const cards of [[card(),card('card2')],[{...card(),trackingField:'9912345678'}]]) {
    const result=planDhlChecks(cards,[deliveredShipment()],[completedCase()]);
    assert.equal(result.completedCount,0);assert.ok(result.issues.length);
  }
  const result=planDhlChecks([card()],[{...deliveredShipment(),trello_card_id:'old'}],[completedCase()]);
  assert.equal(result.completedCount,0);assert.equal(result.issues[0].code,'shipment_card_mismatch');
});
