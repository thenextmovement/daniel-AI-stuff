import type { TrelloCardEvidence } from './domain';
import { resolveCardDhlTracking, type DhlReleaseEvent } from './tracking';

export type ReplacementRound = {
  previousTrackingNumbers: string[];
  trackingNumbers: string[];
  previousArrivedAt: string;
  arrivalActionId: string;
  addedAt: string;
  trackingActionId: string;
};
export type ShipmentAction = {id:string;date:string;type:string;data:{
  card?:{id?:string};listAfter?:{id?:string};customField?:{id?:string};
  old?:{value?:{text?:string}|null};customFieldItem?:{value?:{text?:string}};
}};
const same = (a:string[],b:string[]) => JSON.stringify(a)===JSON.stringify(b);
const numbers = (value?:string) => resolveCardDhlTracking('',value).trackingNumbers;

// A historic Sign Arrived move confirms the earlier round. An append after that
// move is only a candidate: DHL pickup chronology is checked separately at release.
export function deriveReplacementRound(card:TrelloCardEvidence,actions:ShipmentAction[],fieldId:string,now=Date.now()):ReplacementRound|null {
  const current=resolveCardDhlTracking(card.name,card.trackingField);
  if(current.reason||current.trackingNumbers.length<2) return null;
  const history=actions.filter(a=>a.data.card?.id===card.id&&Number.isFinite(Date.parse(a.date))&&Date.parse(a.date)<=now)
    .sort((a,b)=>Date.parse(b.date)-Date.parse(a.date));
  const changes=history.filter(a=>a.type==='updateCustomFieldItem'&&a.data.customField?.id===fieldId);
  if(!changes.length||!same(numbers(changes[0].data.customFieldItem?.value?.text),current.trackingNumbers)) return null;
  for(const change of changes) {
    const before=numbers(change.data.old?.value?.text),after=numbers(change.data.customFieldItem?.value?.text);
    if(!before.length||after.length<=before.length||!same(after.slice(0,before.length),before)
      ||!same(current.trackingNumbers.slice(0,after.length),after)) continue;
    const arrival=history.find(a=>a.type==='updateCard'&&a.data.listAfter?.id==='646c788ae63245624b6d6a7a'&&Date.parse(a.date)<Date.parse(change.date)
      &&same(numbers(changes.find(c=>Date.parse(c.date)<Date.parse(a.date))?.data.customFieldItem?.value?.text),before));
    if(!arrival) continue;
    // No removal/reorder/replacement between the arrival, append and current field.
    const later=changes.filter(a=>Date.parse(a.date)>=Date.parse(arrival.date)).slice().reverse();
    let expected=before;
    if(later.some(a=>{
      const old=numbers(a.data.old?.value?.text),next=numbers(a.data.customFieldItem?.value?.text);
      const invalid=!same(old,expected)||next.length<old.length||!same(next.slice(0,old.length),old);
      expected=next;return invalid;
    })||!same(expected,current.trackingNumbers)) continue;
    return {previousTrackingNumbers:before,trackingNumbers:current.trackingNumbers.slice(before.length),
      previousArrivedAt:arrival.date,arrivalActionId:arrival.id,addedAt:change.date,trackingActionId:change.id};
  }
  return null;
}

export function resolveShipmentTracking(card:TrelloCardEvidence) {
  const original=resolveCardDhlTracking(card.name,card.trackingField),round=card.replacementRound;
  if(card.trackingHistoryError) return {trackingNumber:null,trackingNumbers:[] as string[],reason:'tracking_history_unavailable'};
  if(!round||original.reason) return original;
  if(!round.previousTrackingNumbers.length||!round.trackingNumbers.length
    ||!same(original.trackingNumbers,[...round.previousTrackingNumbers,...round.trackingNumbers])) {
    return {trackingNumber:null,trackingNumbers:[] as string[],reason:'replacement_tracking_changed'};
  }
  return {trackingNumber:round.trackingNumbers[0],trackingNumbers:round.trackingNumbers,reason:null};
}

export function replacementStartedAfterDelivery(round:ReplacementRound,events:DhlReleaseEvent[]) {
  const delivered=Date.parse(round.previousArrivedAt),added=Date.parse(round.addedAt);
  if(!Number.isFinite(delivered)||!Number.isFinite(added)||added<=delivered||!events.length) return false;
  // Require pickup, not merely a late destination scan from a truncated old trip.
  // Earlier pre-advice also keeps an ambiguous, late-entered parcel in manual review.
  return events.every(e=>Number.isFinite(Date.parse(e.event_time))&&Date.parse(e.event_time)>delivered)
    &&events.some(e=>/^(?:shipment picked up|sendung abgeholt)[.]?(?: \[Unreviewed carrier details\])?$/i.test(e.carrier_status_text||''));
}
