import { assertFirstParcelDispatch } from './first-parcel';
import { supabaseRequest, supabaseRpc } from '@/lib/quotes/supabase-rest';
import { ARRIVAL_LABEL_DEFAULT_TRELLO_BOARD_ID, assessTrelloAutomationGate, findTrelloCardForTracking, type DhlArrival, type TrelloCardEvidence } from './domain';
import { createTrelloClient } from './clients';
import { assessDhlRelease, type DhlReleaseEvent } from './tracking';

import { resolveShipmentTracking, replacementStartedAfterDelivery, type ReplacementRound } from './shipment-round';

// Three intake lists plus Create Invoice catch-up: Vera can move a card between discovery runs.
export const LEO_INTAKE_LISTS = new Set(['6347e0971a7efc0482e6c3fe', '6544ca38c328c64bbcabf4e8', '69ff17bfab2afaaf96f7033a', '69ef8a5b2e64cf224dd5746e']);
export function carrierReleaseEnabled() { return process.env.ARRIVAL_LABEL_CARRIER_RELEASE_ENABLED === 'true'; }
type Shipment = { id: string; tracking_number: string; trello_card_id: string; last_checked_at: string | null; status_reason: string | null };

async function shipmentForTracking(tracking: string) {
  if (!/^\d{10}$/.test(tracking)) throw new Error('Invalid DHL waybill');
  const rows = await supabaseRequest<Shipment[]>('inbound_shipments', undefined, {
    select:'id,tracking_number,trello_card_id,last_checked_at,status_reason', carrier:'eq.dhl', tracking_number:`eq.${tracking}`, limit:2,
  });
  return rows.length === 1 ? rows[0] : null;
}
async function releaseForShipment(shipment: Shipment, round?: ReplacementRound | null) {
  const events = await supabaseRequest<DhlReleaseEvent[]>('inbound_tracking_events', undefined, {
    select:'event_time,event_location,carrier_status_text', shipment_id:`eq.${shipment.id}`, carrier:'eq.dhl', order:'event_time.desc', limit:250,
  });
  // A truncated event history must not silently discard a contradictory event.
  if (events.length >= 250) return {allowed:false, reason:'tracking_history_truncated'};
  if (round && !replacementStartedAfterDelivery(round, events)) return {allowed:false, reason:'replacement_transport_not_after_delivery'};
  return assessDhlRelease({events,lastCheckedAt:shipment.last_checked_at,statusReason:shipment.status_reason});
}

// Uses the existing carrier/tracking unique key and existing label queue.
// Discovery may continue after a card moves; an existing shipment must retain its exact card identity.
export async function loadCarrierReleasedArrivals(cards: TrelloCardEvidence[], localDate: string, persist: boolean): Promise<DhlArrival[]> {
  const candidates = new Map<string,TrelloCardEvidence[]>();
  for (const card of cards) {
    if (card.boardId !== ARRIVAL_LABEL_DEFAULT_TRELLO_BOARD_ID) continue;
    const tracking = resolveShipmentTracking(card).trackingNumber;
    if (tracking) candidates.set(tracking, [...(candidates.get(tracking) || []), card]);
  }
  const arrivals: DhlArrival[] = [];
  for (const [tracking, matchingCards] of candidates) {
    if (matchingCards.length !== 1 || !findTrelloCardForTracking(cards, tracking).card) continue;
    const card = matchingCards[0];
    const shipment = await shipmentForTracking(tracking);
    if (!shipment) {
      if (persist && (LEO_INTAKE_LISTS.has(card.listId || '') || card.replacementRound)) await supabaseRpc('inbound_record_trello_candidates', {p_payload:{shipments:[{
        trelloCardId:card.id,trelloCardName:card.name,trelloCardUrl:card.url,trelloListId:card.listId,trelloListName:card.listName,
        trackingFieldName:'Tracking number / title', trackingRaw:`DHL ${tracking}`,
      }]}});
      continue;
    }
    if (shipment.trello_card_id !== card.id || !(await releaseForShipment(shipment, card.replacementRound)).allowed) continue;
    arrivals.push({trackingNumber:tracking,lastSix:tracking.slice(-6),localDate,deliveryState:'unknown',expectedArrivalAt:null,messageIds:[],sourceKinds:['carrier_tracking'],trelloTrigger:null});
  }
  return arrivals;
}

export async function assertCarrierReleaseForCase(caseId: string) {
  const rows = await supabaseRequest<{incoming_dhl_tracking_number:string; trello_card_id:string}[]>('arrival_label_cases',undefined,{
    select:'incoming_dhl_tracking_number,trello_card_id',id:`eq.${caseId}`,limit:1,
  });
  const row = rows[0];
  const shipment = row && await shipmentForTracking(row.incoming_dhl_tracking_number);
  if (!shipment || shipment.trello_card_id !== row.trello_card_id) {
    throw new Error('Aktuelle Deutschland-/Zollfreigabe fehlt; kein Dispatch.');
  }
  // A queued label may outlive a changed tracking number, archived card or manual hold.
  // Reuse the live board reader to also catch duplicate tracking on another card.
  const cards = await createTrelloClient().listQuentinCards();
  const card = findTrelloCardForTracking(cards, row.incoming_dhl_tracking_number).card;
  if (!card || card.id !== row.trello_card_id || card.boardId !== ARRIVAL_LABEL_DEFAULT_TRELLO_BOARD_ID
    || !card.listId || !card.listName || assessTrelloAutomationGate(card).blocked) {
    throw new Error('Aktuelle Trello-Zuordnung oder Listenfreigabe fehlt; kein Dispatch.');
  }
  if (!(await releaseForShipment(shipment, card.replacementRound)).allowed) throw new Error('Aktuelle Deutschland-/Zollfreigabe oder zeitliche Ersatzsendungszuordnung fehlt; kein Dispatch.');
  await assertFirstParcelDispatch(card, row.incoming_dhl_tracking_number);
}
