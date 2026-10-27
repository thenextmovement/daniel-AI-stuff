import { supabaseRequest, supabaseRpc } from '@/lib/quotes/supabase-rest';
import type { TrelloCardEvidence } from './domain';
import { assessDhlRelease, type DhlReleaseEvent } from './tracking';
import { resolveShipmentTracking, replacementStartedAfterDelivery } from './shipment-round';

type Selection = { trello_card_id: string; tracking_numbers: string[]; previous_tracking_numbers?: string[]; blocked_reason: string | null };
export async function loadFirstParcelSelection(cardId: string, tracking?: string) {
  const rows = await supabaseRequest<Selection[]>('arrival_label_first_parcels', undefined, {
    select: 'trello_card_id,tracking_numbers,previous_tracking_numbers,blocked_reason', trello_card_id: `eq.${cardId}`, order: 'created_at.asc',
  });
  return (tracking ? rows.find(row => row.tracking_numbers.includes(tracking)) : null) || rows[0] || null;
}
function selectionHold(selection: Selection | null, numbers: string[], previous: string[] = []) {
  if (selection?.blocked_reason) return selection.blocked_reason;
  if (selection && (JSON.stringify(selection.tracking_numbers) !== JSON.stringify(numbers)
    || JSON.stringify(selection.previous_tracking_numbers || []) !== JSON.stringify(previous))) {
    return 'DHL-Paketliste wurde nach der festen Auswahl geaendert; manuell pruefen, kein weiterer automatischer Kauf.';
  }
  return null;
}
export async function prepareFirstParcelSelection(card: TrelloCardEvidence, tracking: string) {
  const resolved = resolveShipmentTracking(card);
  if (resolved.trackingNumber !== tracking) return 'Nur die erste DHL-Nummer ist automatisch erlaubt.';
  if (card.replacementRound) {
    const shipments = await supabaseRequest<{id:string;trello_card_id:string;last_checked_at:string|null;status_reason:string|null}[]>('inbound_shipments', undefined, {
      select:'id,trello_card_id,last_checked_at,status_reason',carrier:'eq.dhl',tracking_number:`eq.${tracking}`,limit:2,
    });
    const shipment=shipments.length===1&&shipments[0].trello_card_id===card.id?shipments[0]:null;
    const events=shipment?await supabaseRequest<DhlReleaseEvent[]>('inbound_tracking_events',undefined,{
      select:'event_time,event_location,carrier_status_text',shipment_id:`eq.${shipment.id}`,carrier:'eq.dhl',order:'event_time.desc',limit:250,
    }):[];
    if(!shipment||events.length>=250||!replacementStartedAfterDelivery(card.replacementRound,events)
      ||!assessDhlRelease({events,lastCheckedAt:shipment.last_checked_at,statusReason:shipment.status_reason}).allowed) {
      return 'Ersatzsendung ist nach der frueheren Ankunft noch nicht eindeutig durch DHL freigegeben; manuell pruefen.';
    }
  }
  const needsPin = resolved.trackingNumbers.length > 1 || Boolean(card.replacementRound);
  const selection = needsPin
    ? (await supabaseRpc<Selection[]>('arrival_labels_pin_first_parcel', {
      p_card_id: card.id, p_tracking_numbers: resolved.trackingNumbers,
      p_previous_tracking_numbers: card.replacementRound?.previousTrackingNumbers || [],
    }))[0]
    : await loadFirstParcelSelection(card.id, tracking);
  if (needsPin && !selection) throw new Error('Feste Paketauswahl konnte nicht gespeichert werden.');
  return selectionHold(selection, resolved.trackingNumbers, card.replacementRound?.previousTrackingNumbers);
}
export async function assertFirstParcelDispatch(card: TrelloCardEvidence, tracking: string) {
  const resolved = resolveShipmentTracking(card);
  const selection = await loadFirstParcelSelection(card.id, tracking);
  const hold = selectionHold(selection, resolved.trackingNumbers, card.replacementRound?.previousTrackingNumbers);
  if (hold || resolved.trackingNumber !== tracking || ((resolved.trackingNumbers.length > 1 || card.replacementRound) && !selection)) {
    throw new Error(hold || 'Feste erste Paketauswahl fehlt; kein Dispatch.');
  }
}
export async function firstParcelCountForCase(caseId: string, tracking: string) {
  const cases = await supabaseRequest<{trello_card_id: string | null}[]>('arrival_label_cases', undefined, {
    select: 'trello_card_id', id: `eq.${caseId}`, limit: 1,
  });
  if (!cases[0]) throw new Error('Label-Fall fehlt.');
  const selection = cases[0].trello_card_id ? await loadFirstParcelSelection(cases[0].trello_card_id, tracking) : null;
  if (selection && (selection.blocked_reason || selection.tracking_numbers[0] !== tracking)) {
    throw new Error('Label passt nicht zur festen Paketauswahl.');
  }
  return selection?.tracking_numbers.length || 1;
}
