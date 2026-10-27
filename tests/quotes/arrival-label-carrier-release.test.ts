import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCardDhlTracking, assessDhlRelease } from '../../src/lib/ops/arrival-labels/tracking';
import { loadCarrierReleasedArrivals, assertCarrierReleaseForCase } from '../../src/lib/ops/arrival-labels/carrier-release';
import { findTrelloCardForTracking } from '../../src/lib/ops/arrival-labels/domain';

const now = Date.parse('2026-10-07T13:00:00Z');
const event = (text: string, time = '2026-10-07T10:00:00Z', location = 'LEIPZIG - GERMANY') => ({ carrier_status_text: text, event_time: time, event_location: location });
const arrived = event('Arrived at DHL Sort Facility');
const cleared = event('Clearance processing complete', '2026-10-07T10:10:00Z');
const assess = (events: ReturnType<typeof event>[], checked = '2026-10-07T12:00:00Z', reason: string | null = null) => assessDhlRelease({ events, lastCheckedAt: checked, statusReason: reason }, now);

test('tracking supports title, field, agreement, and preserves leading zeroes', () => {
  assert.equal(resolveCardDhlTracking('#NEONT123 | 0012345678', null).trackingNumber, '0012345678');
  assert.equal(resolveCardDhlTracking('#NEONT123', 'DHL 0012345678').trackingNumber, '0012345678');
  assert.equal(resolveCardDhlTracking('DHL 0012345678 | #NEONT123', '0012345678').trackingNumber, '0012345678');
});
test('tracking conflict, multiple numbers, malformed field and foreign carrier fail closed', () => {
  for (const [title, field] of [['DHL 0012345678','1123456789'], ['0012345678 / 1123456789',''], ['0012345678','DHL missing'], ['0012345678','FedEx 0012345678']]) {
    assert.equal(resolveCardDhlTracking(title, field).trackingNumber, null);
  }
  assert.equal(resolveCardDhlTracking('Phone +491234567890 / #NEONT123', '').trackingNumber, null);
});
test('physical German arrival plus completed German clearance qualifies', () => {
  assert.equal(assess([arrived, cleared]).allowed, true);
  assert.equal(assess([cleared, arrived]).allowed, true);
});
test('customs pre-advice, registered label and destination text do not prove arrival', () => {
  for (const e of [event('Customs clearance status updated. Process may start while in transit'),event('Shipment information received'),event('Destination Germany', undefined, 'SHENZHEN - CHINA')]) {
    assert.equal(assess([e, cleared]).allowed, false);
  }
});
test('foreign clearance and German arrival without clearance stay blocked', () => {
  assert.equal(assess([arrived]).allowed, false);
  assert.equal(assess([arrived, {...cleared, event_location:'HONG KONG'}]).allowed, false);
});
test('later hold, renewed customs or return blocks', () => {
  for (const text of ['Shipment on hold', 'Clearance event', 'Customs clearance status updated', 'Returned to shipper', 'Exception']) {
    assert.equal(assess([arrived, cleared, event(text, '2026-10-07T11:00:00Z')]).allowed, false);
  }
});
const genericCustomsUpdate = 'Customs clearance status updated. Note - The Customs clearance process may start while the shipment is in transit to the destination.';
test('standard customs update resolves only after strictly later German processing or departure', () => {
  const update = event(genericCustomsUpdate, '2026-10-07T11:00:00Z');
  for (const text of ['Processed at LEIPZIG - GERMANY', 'Shipment has departed from a DHL facility LEIPZIG - GERMANY']) {
    const movement = event(text, '2026-10-07T11:30:00Z');
    assert.equal(assess([arrived, cleared, update, movement]).allowed, true);
    assert.equal(assess([movement, update, cleared, arrived]).allowed, true);
  }
});
test('generic update without subsequent qualifying German movement remains blocked', () => {
  const update = event(genericCustomsUpdate, '2026-10-07T11:00:00Z');
  for (const movement of [
    event('Processed at LEIPZIG', '2026-10-07T10:30:00Z'),
    event('Processed at LEIPZIG', '2026-10-07T11:00:00Z'),
    event('Processed at HONG KONG', '2026-10-07T11:30:00Z', 'HK'),
    event('Arrived at DHL Sort Facility', '2026-10-07T11:30:00Z'),
    event('Out with courier for delivery', '2026-10-07T11:30:00Z'),
  ]) assert.equal(assess([arrived, cleared, update, movement]).allowed, false);
});
test('movement never overrides real holds, unknown customs updates or supplemental instructions', () => {
  const movement = event('Processed at LEIPZIG', '2026-10-07T11:30:00Z');
  for (const text of ['Shipment on hold', 'Clearance event', 'Customs clearance status updated', 'Returned to shipper', 'Exception', genericCustomsUpdate + ' Importer must provide documents.']) {
    assert.equal(assess([arrived, cleared, event(text, '2026-10-07T11:00:00Z'), movement]).allowed, false);
  }
  assert.equal(assess([arrived, cleared, event('Shipment on hold', '2026-10-07T10:30:00Z'), event(genericCustomsUpdate, '2026-10-07T11:00:00Z'), movement]).allowed, false);
  assert.equal(assess([arrived, cleared, movement, event(genericCustomsUpdate, '2026-10-07T12:00:00Z')]).allowed, false);
  assert.equal(assess([arrived, event(genericCustomsUpdate, '2026-10-07T11:00:00Z'), movement]).allowed, false);
});
test('a later complete clearance with physical processing resolves an earlier hold', () => {
  assert.equal(assess([event('Shipment on hold', '2026-10-07T09:00:00Z'), arrived, cleared]).allowed, true);
});
test('stale poll, tracking error, missing/invalid dates and future evidence do not release', () => {
  assert.equal(assess([arrived,cleared], '2026-10-05T10:00:00Z').allowed, false);
  assert.equal(assess([arrived,cleared], undefined, 'tracking_api_error:17track').allowed, false);
  assert.equal(assess([arrived,cleared], 'invalid').allowed, false);
  assert.equal(assess([arrived,{...cleared,event_time:'invalid'}]).allowed, false);
  assert.equal(assess([arrived,{...cleared,event_time:'2026-10-08T10:00:00Z'}]).allowed, false);
});
test('raw event text takes precedence over broad delivered normalization', () => {
  assert.equal(assess([{...event('Shipment information received'), normalized_status:'delivered'} as ReturnType<typeof event>, cleared]).allowed, false);
});

test('card resolver finds a custom-field-only number and rejects title/field conflict', () => {
  const card = {id:'card1',name:'#NEONT123',url:'https://trello.example.invalid/card',trackingField:'DHL 0012345678'};
  assert.equal(findTrelloCardForTracking([card], '0012345678').card?.id,'card1');
  assert.equal(findTrelloCardForTracking([{...card,name:'1123456789'}], '0012345678').card,null);
});

async function integration(options: {multi?:boolean; present?:boolean; persist?:boolean; wrongCard?:boolean; duplicate?:boolean; released?:boolean; listId?:string; foreignBoard?:boolean; assertion?:boolean; changedTracking?:boolean; conflictingTracking?:boolean; manualList?:boolean; missingCard?:boolean; archivedCard?:boolean; duplicateLiveCard?:boolean; missingList?:boolean} = {}) {
  const previousFetch = globalThis.fetch;
  const trelloEnvNames = ['TRELLO_API_KEY','TRELLO_TOKEN','ARRIVAL_LABEL_TRELLO_BOARD_ID'] as const;
  const previousTrelloEnv = Object.fromEntries(trelloEnvNames.map(key=>[key,process.env[key]]));
  process.env.TRELLO_API_KEY='test-key'; process.env.TRELLO_TOKEN='test-token';
  process.env.ARRIVAL_LABEL_TRELLO_BOARD_ID='62bae9b97705e7419ed64593';
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL='https://database.example.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='test-only';
  const calls: string[] = []; const writes:unknown[]=[];
  globalThis.fetch = async (input,init) => {
    const url = new URL(String(input)); calls.push(url.pathname);
    if (url.hostname==='api.trello.com') {
      if (url.pathname.endsWith('/customFields')) return Response.json([{id:'tracking',name:'Tracking number'}]);
      if (url.pathname.endsWith('/lists')) return Response.json(options.missingList ? [] : [{id:'list1',name:options.manualList?'Problem with Sign':'Create Invoice (With Tracking)'}]);
      if (url.pathname.endsWith('/cards')) {
        const card = {id:'card1',name:options.conflictingTracking?'DHL 1123456789':'#NEONT123',url:'https://trello.com/c/abcdefgh',idBoard:options.foreignBoard?'foreign':'62bae9b97705e7419ed64593',idList:'list1',closed:options.archivedCard||false,customFieldItems:[{idCustomField:'tracking',value:{text:options.changedTracking?'DHL 1123456789':'DHL 0012345678'}}]};
        return Response.json(options.missingCard?[]:options.duplicateLiveCard?[card,{...card,id:'card2'}]:[card]);
      }
      throw new Error('Unexpected Trello endpoint');
    }
    if (url.pathname.endsWith('arrival_label_first_parcels')) return Response.json([]);
    if (url.pathname.endsWith('arrival_label_cases')) return Response.json([{incoming_dhl_tracking_number:'0012345678',trello_card_id:'card1'}]);
    if (url.pathname.endsWith('inbound_shipments')) return Response.json(options.present === false ? [] : [{id:'shipment1',trello_card_id:options.wrongCard?'old-card':'card1',tracking_number:'0012345678',last_checked_at:new Date().toISOString(),status_reason:null}]);
    if (url.pathname.endsWith('inbound_tracking_events')) return Response.json(options.released === false ? [] : [event('Arrived at DHL Sort Facility',new Date(Date.now()-3600000).toISOString()),event('Clearance processing complete',new Date(Date.now()-3000000).toISOString())]);
    if (url.pathname.endsWith('inbound_record_trello_candidates')) {writes.push(JSON.parse(String(init?.body)));return Response.json([]);}
    throw new Error('Unexpected request');
  };
  try {
    const card = {id:'card1',name:'#NEONT123',trackingField:options.multi?'DHL 0012345678, DHL 1123456789, DHL 2234567890':'DHL 0012345678',url:'https://trello.example.invalid/card1',boardId:options.foreignBoard?'foreign':'62bae9b97705e7419ed64593',listId:options.listId || '69ff17bfab2afaaf96f7033a'};
    if (options.assertion) { await assertCarrierReleaseForCase('case1'); return {arrivals:[],calls,writes}; }
    const arrivals = await loadCarrierReleasedArrivals(options.duplicate ? [card,{...card,id:'card2'}]:[card], '2026-10-07',options.persist || false);
    return {arrivals,calls,writes};
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of trelloEnvNames) {
      if (previousTrelloEnv[key]===undefined) delete process.env[key]; else process.env[key]=previousTrelloEnv[key];
    }
    if (previousUrl===undefined) delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=previousUrl;
    if (previousKey===undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=previousKey;
  }
}
test('known shipment remains eligible after moving to Create Invoice without reenrollment', async () => {
  const r=await integration({listId:'69ef8a5b2e64cf224dd5746e',persist:true});
  assert.equal(r.arrivals.length,1);assert.deepEqual(r.arrivals[0].sourceKinds,['carrier_tracking']);assert.equal(r.writes.length,0);
});
test('new three-list shipment is enrolled once but never released before real events', async () => {
  const r=await integration({present:false,persist:true});
  assert.equal(r.arrivals.length,0);assert.equal(r.writes.length,1);
  assert.equal((r.writes[0] as {p_payload:{shipments:{trackingRaw:string}[]}}).p_payload.shipments[0].trackingRaw,'DHL 0012345678');
  assert.equal((await integration({present:false})).writes.length,0);
  assert.equal((await integration({present:false,persist:true,listId:'unapproved-list'})).writes.length,0);
  const catchup = await integration({present:false,persist:true,listId:'69ef8a5b2e64cf224dd5746e'});
  assert.equal(catchup.writes.length,1);assert.equal(catchup.arrivals.length,0);
});
test('ambiguous card, foreign board, stale card association and missing events do not release', async () => {
  for (const option of [{wrongCard:true},{duplicate:true},{released:false},{foreignBoard:true}]) assert.equal((await integration(option)).arrivals.length,0);
});
test('dispatch rechecks carrier evidence and blocks when it was withdrawn', async () => {
  await integration({assertion:true});
  await assert.rejects(integration({assertion:true,released:false}),/Zollfreigabe/);
  await assert.rejects(integration({assertion:true,wrongCard:true}),/Zollfreigabe/);
});

test('dispatch stops when the live Trello tracking or card no longer matches the planned shipment', async () => {
  for (const option of [{changedTracking:true},{conflictingTracking:true},{missingCard:true},{archivedCard:true},{duplicateLiveCard:true},{foreignBoard:true}]) {
    await assert.rejects(integration({assertion:true,...option}),/Trello/);
  }
});
test('dispatch respects a newly selected manual Trello list and unavailable list evidence', async () => {
  await assert.rejects(integration({assertion:true,manualList:true}),/Trello/);
  await assert.rejects(integration({assertion:true,missingList:true}),/Trello/);
});

const three = 'DHL 0012345678, DHL 1123456789, DHL 2234567890';
test('multiple parcels use exactly the first field number, preserving the ordered set', () => {
  const resolved = resolveCardDhlTracking('#NEONT123', three);
  assert.equal(resolved.trackingNumber, '0012345678');
  assert.deepEqual(resolved.trackingNumbers, ['0012345678','1123456789','2234567890']);
  assert.equal(resolveCardDhlTracking('1123456789 | #NEONT123', three).trackingNumber, '0012345678');
  assert.equal(resolveCardDhlTracking('3345678901 | #NEONT123', three).trackingNumber, null);
  assert.equal(resolveCardDhlTracking('#NEONT123', three + ', FedEx 3345678901').trackingNumber, null);
  assert.equal(resolveCardDhlTracking('#NEONT123', three + ', 123').trackingNumber, null);
});
test('a secondary number on another card blocks ambiguous primary ownership', () => {
  const card = {id:'one',name:'#NEONT123',url:'https://trello.example.invalid/one',trackingField:three};
  assert.equal(findTrelloCardForTracking([card], '0012345678').card?.id, 'one');
  assert.equal(findTrelloCardForTracking([card], '1123456789').card, null);
  assert.equal(findTrelloCardForTracking([card,{...card,id:'two',trackingField:'DHL 3345678901, DHL 0012345678'}], '0012345678').card, null);
});

test('only the first package own carrier evidence can release a multi-package card', async () => {
  const released = await integration({multi:true});
  assert.deepEqual(released.arrivals.map(a=>a.trackingNumber),['0012345678']);
  assert.equal((await integration({multi:true,released:false})).arrivals.length,0);
});


test('confirmed German delivery resolves older holds and supplemental details after customs release', () => {
  const delivered = event('Delivered', '2026-10-07T12:00:00Z', 'DE');
  for (const text of ['Shipment has departed from a DHL facility LEIPZIG - GERMANY [Unreviewed carrier details]', genericCustomsUpdate, 'Shipment on hold']) {
    const old = event(text, '2026-10-07T11:00:00Z', 'DE');
    assert.equal(assess([arrived, cleared, old, delivered]).allowed, true);
    assert.equal(assess([delivered, old, cleared, arrived]).allowed, true);
  }
});
test('delivery does not bypass missing clearance, foreign delivery, stale data or newer unresolved evidence', () => {
  const delivered = event('Delivered', '2026-10-07T12:00:00Z', 'DE');
  const old = event('Shipment on hold', '2026-10-07T11:00:00Z', 'DE');
  assert.equal(assess([arrived, old, delivered]).allowed, false);
  assert.equal(assess([arrived, cleared, old, {...delivered, event_location:'BE'}]).allowed, false);
  assert.equal(assess([arrived, cleared, old, delivered], '2026-10-05T12:00:00Z').allowed, false);
  for (const time of ['2026-10-07T12:00:00Z', '2026-10-07T12:30:00Z']) {
    assert.equal(assess([arrived, cleared, old, delivered, event('Returned to shipper', time)]).allowed, false);
    assert.equal(assess([arrived, cleared, old, delivered, event('Delivered [Unreviewed carrier details]', time)]).allowed, false);
  }
  for (const text of ['Delivered to customs', 'Not delivered', 'Partial delivery', 'Delivered [Unreviewed carrier details]']) {
    assert.equal(assess([arrived, cleared, old, {...delivered, carrier_status_text:text}]).allowed, false);
  }
});


test('ordinary supplemental transit details resolve on a later clean German physical scan', () => {
  const old = event('Shipment has departed from a DHL facility LEIPZIG - GERMANY [Unreviewed carrier details]', '2026-10-07T11:00:00Z', 'DE');
  const next = event('Arrived at DHL Delivery Facility RATINGEN - GERMANY', '2026-10-07T11:30:00Z', 'DE');
  assert.equal(assess([arrived, cleared, old, next]).allowed, true);
  assert.equal(assess([next, old, cleared, arrived]).allowed, true);
  for (const plain of ['Arrived at DHL Sort Facility', 'Processed at']) {
    assert.equal(assess([arrived, cleared, {...old, carrier_status_text:plain+' [Unreviewed carrier details]'}, next]).allowed, true);
    assert.equal(assess([arrived, cleared, old, {...next, carrier_status_text:plain}]).allowed, true);
  }
  assert.equal(assess([arrived, cleared, old, {...next, carrier_status_text:'Out with courier for delivery'}]).allowed, true);
  assert.equal(assess([arrived, cleared, old, {...next, carrier_status_text:'Not delivered'}]).allowed, false);

  for (const text of ['Shipment on hold [Unreviewed carrier details]', genericCustomsUpdate + ' [Unreviewed carrier details]', 'Shipment has departed from a DHL facility - contact DHL [Unreviewed carrier details]']) {
    assert.equal(assess([arrived, cleared, {...old, carrier_status_text:text}, next]).allowed, false);
  }
  assert.equal(assess([arrived, cleared, old, {...next, event_time:old.event_time}]).allowed, false);
  assert.equal(assess([arrived, cleared, old, {...next, event_location:'BE'}]).allowed, false);
  assert.equal(assess([arrived, cleared, old, {...next, carrier_status_text:next.carrier_status_text+' [Unreviewed carrier details]'}]).allowed, false);
});
