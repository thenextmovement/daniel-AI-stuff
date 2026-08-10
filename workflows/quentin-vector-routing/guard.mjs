import { classifyTitle, CONFIG } from './routing.mjs';

export const GUARD = Object.freeze({
  managementBoardId: '63d10c34105771f01ccf4296',
  abdulBoardId: '6421a7000117c14498ccb6d0',
  delayMs: 5 * 60 * 1000,
  horizonMs: 24 * 60 * 60 * 1000,
  subject: 'Quentin Board Vector file uploaded fehlgeschlagen',
  emailTo: 'support@neontrip.de',
});

export function cardUrl(card = {}) {
  const key = String(card.shortLink || card.id || '');
  return key ? `https://trello.com/c/${key}` : 'https://trello.com/b/9QNAfkv4/quentin-neon-signs';
}

export function expectedDestination(title) {
  return classifyTitle(title).destinationListId;
}

export function findMissingMoves({ moves = [], copies = [], now = Date.now(), delayMs = GUARD.delayMs, horizonMs = GUARD.horizonMs }) {
  const seenCards = new Set();
  return moves
    .filter(action => {
      const time = Date.parse(action?.date || '');
      const data = action?.data || {};
      return action?.type === 'updateCard'
        && data?.board?.id === CONFIG.quentinBoardId
        && data?.listAfter?.id === CONFIG.vectorListId
        && Number.isFinite(time)
        && now - time >= delayMs
        && now - time <= horizonMs;
    })
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .filter(action => {
      const sourceId = action.data.card?.id;
      if (!action.id || !sourceId || seenCards.has(sourceId)) return false;
      seenCards.add(sourceId);
      const expectedListId = expectedDestination(action.data.card?.name || '');
      return !copies.some(copy => copy?.type === 'copyCard'
        && copy?.data?.cardSource?.id === sourceId
        && copy?.data?.list?.id === expectedListId
        && Date.parse(copy.date || '') >= Date.parse(action.date || ''));
    })
    .map(action => ({
      eventId: String(action.id),
      eventDate: String(action.date),
      cardId: String(action.data.card?.id || ''),
      cardName: String(action.data.card?.name || ''),
      cardUrl: cardUrl(action.data.card),
      expectedListId: expectedDestination(action.data.card?.name || ''),
    }));
}
