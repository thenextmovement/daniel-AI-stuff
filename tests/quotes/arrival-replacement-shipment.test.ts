import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveReplacementRound, resolveShipmentTracking, replacementStartedAfterDelivery } from '../../src/lib/ops/arrival-labels/shipment-round';
import { findTrelloCardForTracking, assessTrelloAutomationGate } from '../../src/lib/ops/arrival-labels/domain';
import { planDhlChecks } from '../../src/lib/ops/dhl-unified';
import { createTrelloClient } from '../../src/lib/ops/arrival-labels/clients';
import { assertCarrierReleaseForCase, loadCarrierReleasedArrivals } from '../../src/lib/ops/arrival-labels/carrier-release';
import { prepareFirstParcelSelection } from '../../src/lib/ops/arrival-labels/first-parcel';

const old = '9507830776', fresh = '1789586503', second = '2234567890';
const card = {id:'111111111111111111111111', name:`#NEONT4709 | ${old} | ${fresh}`, trackingField:`DHL ${old}| ${fresh}`,
  url:'https://trello.com/c/testonly',boardId:'62bae9b97705e7419ed64593',listId:'6347e0a2f062500084675062',listName:'❗❗❗Problem with SIgn❗❗❗'};
const field = (id:string,date:string,before:string,after:string) => ({id,date,type:'updateCustomFieldItem',data:{card:{id:card.id},customField:{id:'field'},old:{value:{text:before}},customFieldItem:{value:{text:after}}}});
const arrived = {id:'arrived',date:'2026-10-05T11:10:29Z',type:'updateCard',data:{card:{id:card.id,name:`#NEONT4709 | ${old}`},listAfter:{id:'646c788ae63245624b6d6a7a'}}};
const actions = [field('new','2026-10-23T09:22:10Z',old,`${old}|${fresh}`),arrived,field('first','2026-09-28T09:59:28Z','',old)];
const now=Date.parse('2026-10-27T12:00:00Z');
test('later addition after a recorded arrival starts a separate round on the same card',()=>{
  const round=deriveReplacementRound(card,actions,'field',now);
  assert.deepEqual(round?.previousTrackingNumbers,[old]);
  assert.deepEqual(round?.trackingNumbers,[fresh]);
  const replacement={...card,replacementRound:round};
  assert.equal(resolveShipmentTracking(replacement).trackingNumber,fresh);
  assert.equal(findTrelloCardForTracking([replacement],fresh).card?.id,card.id);
  assert.equal(findTrelloCardForTracking([replacement],old).card,null);
  assert.equal(assessTrelloAutomationGate(replacement).blocked,false);
  assert.equal(assessTrelloAutomationGate({...replacement,listName:'Manual review',listId:'other'}).blocked,true);
  assert.equal(planDhlChecks([replacement],[],[],now).candidates[0]?.trackingNumber,fresh);
});
test('a simultaneous batch retains first parcel even when it later reaches Sign Arrived',()=>{
  const history=[arrived,field('both','2026-09-28T09:59:28Z','',`${old}|${fresh}`)];
  assert.equal(deriveReplacementRound(card,history,'field',now),null);
  assert.equal(resolveShipmentTracking(card).trackingNumber,old);
  assert.equal(findTrelloCardForTracking([card],fresh).card,null);
});
test('late entry of a parcel already in transit before the first delivery cannot release a replacement',()=>{
  const round=deriveReplacementRound(card,actions,'field',now)!;
  const events=(time:string)=>[{event_time:time,event_location:'CN',carrier_status_text:'Shipment picked up'}];
  assert.equal(replacementStartedAfterDelivery(round,events('2026-10-23T08:00:00Z')),true);
  for(const time of ['2026-10-04T08:00:00Z',arrived.date,'invalid']) assert.equal(replacementStartedAfterDelivery(round,events(time)),false);
  assert.equal(replacementStartedAfterDelivery(round,[]),false);
  assert.equal(replacementStartedAfterDelivery(round,[{event_time:'2026-10-23T08:00:00Z',event_location:'DE',carrier_status_text:'Delivered'}]),false);
});
test('the first parcel rule also applies within a replacement batch',()=>{
  const multi={...card,trackingField:`${old}|${fresh}|${second}`};
  const round=deriveReplacementRound(multi,[field('both-new','2026-10-23T09:22:10Z',old,`${old}|${fresh}|${second}`),...actions.slice(1)],'field',now);
  assert.deepEqual(round?.trackingNumbers,[fresh,second]);
  assert.equal(findTrelloCardForTracking([{...multi,replacementRound:round}],second).card,null);
});
test('missing arrival, wrong card/field, future, reordered or changed history gives no replacement',()=>{
  for(const history of [actions.filter(a=>a!==arrived),actions.slice(0,2),actions.map(a=>({...a,date:'2027-01-01T00:00:00Z'})),
    actions.map(a=>({...a,data:{...a.data,card:{id:'other'}}})),[field('bad','2026-10-23T09:22:10Z',old,`${fresh}|${old}`),...actions.slice(1)]]) {
    assert.equal(deriveReplacementRound(card,history,'field',now),null);
  }
  assert.equal(deriveReplacementRound(card,actions,'wrong-field',now),null);
  const round=deriveReplacementRound(card,actions,'field',now)!;
  assert.equal(resolveShipmentTracking({...card,replacementRound:round,trackingField:`${fresh}|${old}`}).trackingNumber,null);
});

test('unavailable history on a problem card produces a tracking issue without buying',()=>{
  const result=planDhlChecks([{...card,trackingHistoryError:true}],[],[],now);
  assert.equal(result.candidates.length,0);
  assert.equal(result.issues[0].code,'tracking_history_unavailable');
});

test('live history, carrier proof and permanent round pin are all required through discovery and dispatch',async()=>{
  const names=['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','TRELLO_API_KEY','TRELLO_TOKEN','ARRIVAL_LABEL_TRELLO_BOARD_ID'] as const;
  const saved=names.map(n=>process.env[n]),fetchBefore=globalThis.fetch;
  Object.assign(process.env,{SUPABASE_URL:'https://database.example.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-only',TRELLO_API_KEY:'test-only',TRELLO_TOKEN:'test-only',ARRIVAL_LABEL_TRELLO_BOARD_ID:card.boardId});
  const current=Date.now(),time=(days:number)=>new Date(current-days*86400000).toISOString();
  const history=[field('new',time(2),old,`${old}|${fresh}`),{...arrived,date:time(20)},field('first',time(25),'',old)];
  let staleTrip=false,historyUnavailable=false,pins=0;
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input));
    if(url.hostname==='api.trello.com') {
      if(url.pathname.endsWith('/cards')) return Response.json([{...card,idBoard:card.boardId,idList:card.listId,customFieldItems:[{idCustomField:'field',value:{text:card.trackingField}}]}]);
      if(url.pathname.endsWith('/lists')) return Response.json([{id:card.listId,name:card.listName}]);
      if(url.pathname.endsWith('/customFields')) return Response.json([{id:'field',name:'Tracking number'}]);
      if(url.pathname.endsWith('/actions')) {if(historyUnavailable)return new Response('',{status:403});return Response.json(history);}
    }
    if(url.pathname.endsWith('arrival_label_cases')) return Response.json([{incoming_dhl_tracking_number:fresh,trello_card_id:card.id}]);
    if(url.pathname.endsWith('inbound_shipments')) return Response.json([{id:'shipment',trello_card_id:card.id,tracking_number:fresh,last_checked_at:time(0),status_reason:null}]);
    if(url.pathname.endsWith('inbound_tracking_events')) return Response.json([
      {event_time:time(staleTrip?21:2),event_location:'CN',carrier_status_text:'Shipment picked up'},
      {event_time:time(.2),event_location:'DE',carrier_status_text:'Arrived at DHL Sort Facility'},
      {event_time:time(.1),event_location:'DE',carrier_status_text:'Clearance processing complete'},
    ]);
    const selection={trello_card_id:card.id,tracking_numbers:[fresh],previous_tracking_numbers:[old],blocked_reason:null};
    if(url.pathname.endsWith('rpc/arrival_labels_pin_first_parcel')) {
      const payload=JSON.parse(String(init?.body));assert.deepEqual(payload.p_tracking_numbers,[fresh]);assert.deepEqual(payload.p_previous_tracking_numbers,[old]);pins++;return Response.json([selection]);
    }
    if(url.pathname.endsWith('arrival_label_first_parcels')) return Response.json([selection]);
    throw new Error(`Unexpected test request: ${url.pathname}`);
  };
  try {
    const cards=await createTrelloClient().listQuentinCards();
    assert.equal(cards[0].replacementRound?.trackingNumbers[0],fresh);
    assert.equal((await loadCarrierReleasedArrivals(cards,'2026-10-27',false))[0].trackingNumber,fresh);
    assert.equal(await prepareFirstParcelSelection(cards[0],fresh),null);
    await assertCarrierReleaseForCase('case');
    staleTrip=true;
    assert.deepEqual(await loadCarrierReleasedArrivals(cards,'2026-10-27',false),[]);
    assert.match((await prepareFirstParcelSelection(cards[0],fresh))!,/manuell/);
    assert.equal(pins,1);
    await assert.rejects(assertCarrierReleaseForCase('case'),/Ersatzsendungszuordnung/);
    historyUnavailable=true;
    const unavailable=await createTrelloClient().listQuentinCards();
    assert.equal(planDhlChecks(unavailable,[]).issues[0].code,'tracking_history_unavailable');
    await assert.rejects(assertCarrierReleaseForCase('case'),/Trello/);
  } finally {
    globalThis.fetch=fetchBefore;
    names.forEach((n,i)=>{if(saved[i]===undefined)delete process.env[n];else process.env[n]=saved[i];});
  }
});
