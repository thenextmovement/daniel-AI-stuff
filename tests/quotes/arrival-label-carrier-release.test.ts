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

async function integration(options: {present?:boolean; persist?:boolean; wrongCard?:boolean; duplicate?:boolean; released?:boolean; listId?:string; foreignBoard?:boolean; assertion?:boolean} = {}) {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL='https://database.example.invalid';process.env.SUPABASE_SERVICE_ROLE_KEY='test-only';
  const calls: string[] = []; const writes:unknown[]=[];
  globalThis.fetch = async (input,init) => {
    const url = new URL(String(input)); calls.push(url.pathname);
    if (url.pathname.endsWith('arrival_label_cases')) return Response.json([{incoming_dhl_tracking_number:'0012345678',trello_card_id:'card1'}]);
    if (url.pathname.endsWith('inbound_shipments')) return Response.json(options.present === false ? [] : [{id:'shipment1',trello_card_id:options.wrongCard?'old-card':'card1',tracking_number:'0012345678',last_checked_at:new Date().toISOString(),status_reason:null}]);
    if (url.pathname.endsWith('inbound_tracking_events')) return Response.json(options.released === false ? [] : [event('Arrived at DHL Sort Facility',new Date(Date.now()-3600000).toISOString()),event('Clearance processing complete',new Date(Date.now()-3000000).toISOString())]);
    if (url.pathname.endsWith('inbound_record_trello_candidates')) {writes.push(JSON.parse(String(init?.body)));return Response.json([]);}
    throw new Error('Unexpected request');
  };
  try {
    const card = {id:'card1',name:'#NEONT123',trackingField:'DHL 0012345678',url:'https://trello.example.invalid/card1',boardId:options.foreignBoard?'foreign':'62bae9b97705e7419ed64593',listId:options.listId || '69ff17bfab2afaaf96f7033a'};
    if (options.assertion) { await assertCarrierReleaseForCase('case1'); return {arrivals:[],calls,writes}; }
    const arrivals = await loadCarrierReleasedArrivals(options.duplicate ? [card,{...card,id:'card2'}]:[card], '2026-10-07',options.persist || false);
    return {arrivals,calls,writes};
  } finally {
    globalThis.fetch = previousFetch;
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
