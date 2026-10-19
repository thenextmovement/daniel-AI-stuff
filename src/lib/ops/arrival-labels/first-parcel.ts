import { supabaseRequest, supabaseRpc } from '@/lib/quotes/supabase-rest';
import type { TrelloCardEvidence } from './domain';
import { resolveCardDhlTracking } from './tracking';

type Selection = { trello_card_id: string; tracking_numbers: string[]; blocked_reason: string | null };
export async function loadFirstParcelSelection(cardId: string) {
  const rows = await supabaseRequest<Selection[]>('arrival_label_first_parcels', undefined, {
    select: 'trello_card_id,tracking_numbers,blocked_reason', trello_card_id: `eq.${cardId}`, limit: 1,
  });
  return rows[0] || null;
}
function selectionHold(selection: Selection | null, numbers: string[]) {
  if (selection?.blocked_reason) return selection.blocked_reason;
  if (selection && JSON.stringify(selection.tracking_numbers) !== JSON.stringify(numbers)) {
    return 'DHL-Paketliste wurde nach der festen Auswahl geaendert; manuell pruefen, kein weiterer automatischer Kauf.';
  }
  return null;
}
export async function prepareFirstParcelSelection(card: TrelloCardEvidence, tracking: string) {
  const resolved = resolveCardDhlTracking(card.name, card.trackingField);
  if (resolved.trackingNumber !== tracking) return 'Nur die erste DHL-Nummer ist automatisch erlaubt.';
  const selection = resolved.trackingNumbers.length > 1
    ? (await supabaseRpc<Selection[]>('arrival_labels_pin_first_parcel', {
      p_card_id: card.id, p_tracking_numbers: resolved.trackingNumbers,
    }))[0]
    : await loadFirstParcelSelection(card.id);
  if (resolved.trackingNumbers.length > 1 && !selection) throw new Error('Feste Paketauswahl konnte nicht gespeichert werden.');
  return selectionHold(selection, resolved.trackingNumbers);
}
export async function assertFirstParcelDispatch(card: TrelloCardEvidence, tracking: string) {
  const resolved = resolveCardDhlTracking(card.name, card.trackingField);
  const selection = await loadFirstParcelSelection(card.id);
  const hold = selectionHold(selection, resolved.trackingNumbers);
  if (hold || resolved.trackingNumber !== tracking || (resolved.trackingNumbers.length > 1 && !selection)) {
    throw new Error(hold || 'Feste erste Paketauswahl fehlt; kein Dispatch.');
  }
}
export async function firstParcelCountForCase(caseId: string, tracking: string) {
  const cases = await supabaseRequest<{trello_card_id: string | null}[]>('arrival_label_cases', undefined, {
    select: 'trello_card_id', id: `eq.${caseId}`, limit: 1,
  });
  if (!cases[0]) throw new Error('Label-Fall fehlt.');
  const selection = cases[0].trello_card_id ? await loadFirstParcelSelection(cases[0].trello_card_id) : null;
  if (selection && (selection.blocked_reason || selection.tracking_numbers[0] !== tracking)) {
    throw new Error('Label passt nicht zur festen Paketauswahl.');
  }
  return selection?.tracking_numbers.length || 1;
}
