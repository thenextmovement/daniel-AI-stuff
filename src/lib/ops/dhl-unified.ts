import { createHash } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { resolveCardDhlTracking } from './arrival-labels/tracking';
import { LEO_INTAKE_LISTS } from './arrival-labels/carrier-release';
import { ARRIVAL_LABEL_DEFAULT_TRELLO_BOARD_ID, type TrelloCardEvidence } from './arrival-labels/domain';

type Obj = Record<string, any>;
const obj = (v: unknown): Obj => v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const text = (v: unknown) => typeof v === 'string' ? v.trim() : '';
export type DhlShipmentLink = {id:string;tracking_number:string;trello_card_id:string|null};
export type DhlCandidate = {trackingNumber:string;shipmentId:string|null;card:TrelloCardEvidence};
export type DhlIssue = {code:string;trelloUrl:string};
// Only unambiguous local time zones used on the known inbound route. Unknown/multi-zone
// countries need a timestamp with an explicit offset; never infer time from the server.
const zones: Record<string,string> = {DE:'Europe/Berlin',CN:'Asia/Shanghai',HK:'Asia/Hong_Kong',MO:'Asia/Macau',TW:'Asia/Taipei',SG:'Asia/Singapore',AE:'Asia/Dubai',BH:'Asia/Bahrain'};

function eventTime(raw: string, country: string, now: number) {
  let instant: Temporal.Instant;
  try {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(raw)) throw new Error();
    if (/(Z|[+-]\d{2}:\d{2})$/.test(raw)) instant=Temporal.Instant.from(raw);
    else {
      if (!zones[country]) throw new Error('dhl_event_timezone_unknown');
      instant=Temporal.PlainDateTime.from(raw,{overflow:'reject'}).toZonedDateTime(zones[country],{disambiguation:'reject'}).toInstant();
    }
    if (instant.epochMilliseconds>now) throw new Error();
  } catch(error) {
    if(error instanceof Error && error.message==='dhl_event_timezone_unknown') throw error;
    throw new Error('dhl_event_time_invalid');
  }
  return instant.toString();
}

export function normalizeDhlUnified(trackingNumber: string, payload: unknown, now=Date.now()) {
  if(!/^\d{10}$/.test(trackingNumber)) throw new Error('dhl_tracking_invalid');
  const shipments=obj(payload).shipments;
  if(!Array.isArray(shipments)||shipments.length!==1||obj(shipments[0]).id!==trackingNumber||obj(shipments[0]).service!=='express') throw new Error('dhl_shipment_identity_invalid');
  const shipment=obj(shipments[0]);
  if(!Array.isArray(shipment.events)||!shipment.events.length||shipment.events.length>=250) throw new Error('dhl_events_missing_or_truncated');
  const source=[...shipment.events];
  if(shipment.status) source.push(shipment.status);
  const unique=new Map<string,{eventKey:string;carrierEventId:null;statusCode:string|null;statusText:string;eventTime:string;eventLocation:string|null;rawEvent:Obj}>();
  for(const value of source) {
    const e=obj(value),address=obj(obj(e.location).address),country=text(address.countryCode).toUpperCase();
    const description=text(e.description);
    if(!description) throw new Error('dhl_event_description_missing');
    // Preserve the existence, not private contents, of instructions the gate cannot assess.
    const supplementalDetails = [e.remark,e.nextSteps].some(v => v != null && (typeof v !== 'string' || v.trim().length > 0));
    const statusText = description + (supplementalDetails ? ' [Unreviewed carrier details]' : '');
    const timestamp=eventTime(text(e.timestamp),country,now);
    // Country evidence must come only from the carrier country code, never a city name.
    const location=/^[A-Z]{2}$/.test(country)?country:null;
    const code=text(e.statusCode)||null;
    const key='dhl-unified:'+createHash('sha256').update(JSON.stringify([trackingNumber,timestamp,location,text(address.addressLocality),code,statusText])).digest('hex');
    unique.set(key,{eventKey:key,carrierEventId:null,statusCode:code,statusText,eventTime:timestamp,eventLocation:location,
      rawEvent:{timestamp,statusCode:code,description,supplementalDetails,location:{address:{addressLocality:text(address.addressLocality),countryCode:country}}}});
  }
  const events=[...unique.values()].sort((a,b)=>Date.parse(a.eventTime)-Date.parse(b.eventTime));
  return {carrier:'dhl',trackingNumber,events,rawResponse:{provider:'dhl-unified',id:trackingNumber,service:'express',events:events.map(e=>e.rawEvent)}};
}

export async function fetchDhlUnified(trackingNumber:string,key:string,fetcher:typeof fetch=fetch,now?:number) {
  if(!/^\d{10}$/.test(trackingNumber)) throw new Error('dhl_tracking_invalid');
  if(!key.trim()) throw new Error('dhl_api_key_missing');
  const url=new URL('https://api-eu.dhl.com/track/shipments');
  url.searchParams.set('trackingNumber',trackingNumber);url.searchParams.set('service','express');url.searchParams.set('language','en');
  let response:Response;
  try {response=await fetcher(url,{method:'GET',headers:{'DHL-API-Key':key,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(20000),cache:'no-store'});}
  catch {throw new Error('dhl_network_error');}
  if(!response.ok) throw new Error(`dhl_http_${response.status}`);
  let payload:unknown;
  try {const raw=await response.text();if(raw.length>2_000_000) throw new Error();payload=JSON.parse(raw);}
  catch {throw new Error('dhl_invalid_json');}
  return normalizeDhlUnified(trackingNumber,payload,now??Date.now());
}

export function berlinPollSlot(now=Date.now()):string|null {
  const local=Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO('Europe/Berlin');
  if(local.hour<9) return null;
  return `${local.toPlainDate()}/${local.hour>=23?'23':local.hour>=18?'18':'09'}`;
}

export function planDhlChecks(cards:TrelloCardEvidence[],shipments:DhlShipmentLink[]) {
  const candidates:DhlCandidate[]=[],issues:DhlIssue[]=[];
  const groups=new Map<string,TrelloCardEvidence[]>();
  const blockedNumbers=new Set<string>();
  const shipped='6347e09cb326e6014856bc3b';
  for(const card of cards) {
    if(card.boardId!==ARRIVAL_LABEL_DEFAULT_TRELLO_BOARD_ID) continue;
    const resolved=resolveCardDhlTracking(card.name,card.trackingField);
    if(resolved.reason) {
      if(LEO_INTAKE_LISTS.has(card.listId||'')||card.listId===shipped) issues.push({code:resolved.reason,trelloUrl:card.url});
      // A contradictory duplicate cannot be ignored when another card looks valid.
      for(const n of `${card.name} ${card.trackingField||''}`.match(/(?<!\d)\d{10}(?!\d)/g)||[]) blockedNumbers.add(n);
    }
    if(resolved.trackingNumber) groups.set(resolved.trackingNumber,[...(groups.get(resolved.trackingNumber)||[]),card]);
  }
  for(const [trackingNumber,matching] of groups) {
    const card=matching[0];
    if(matching.length!==1||blockedNumbers.has(trackingNumber)) {issues.push({code:'duplicate_or_conflicting_card',trelloUrl:card.url});continue;}
    const existing=shipments.filter(s=>s.tracking_number===trackingNumber);
    if(existing.length>1||(existing.length===1&&existing[0].trello_card_id!==card.id)) {issues.push({code:'shipment_card_mismatch',trelloUrl:card.url});continue;}
    if(!LEO_INTAKE_LISTS.has(card.listId||'')&&!(card.listId===shipped&&existing.length===1)) continue;
    candidates.push({trackingNumber,shipmentId:existing[0]?.id||null,card});
  }
  return {candidates,issues};
}
