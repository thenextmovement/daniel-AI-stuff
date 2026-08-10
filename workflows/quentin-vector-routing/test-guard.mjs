import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { findMissingMoves, expectedDestination, GUARD } from './guard.mjs';
import { CONFIG } from './routing.mjs';

const now = Date.parse('2026-08-10T12:00:00.000Z');
const move = (overrides = {}) => ({
  id: 'event-1',
  type: 'updateCard',
  date: '2026-08-10T11:50:00.000Z',
  data: {
    board: { id: CONFIG.quentinBoardId },
    listAfter: { id: CONFIG.vectorListId },
    card: { id: 'card-1', shortLink: 'abc123', name: 'Full Glow | Example' },
  },
  ...overrides,
});

test('only overdue unmatched Vector moves are returned', () => {
  const result = findMissingMoves({ moves: [move()], copies: [], now });
  assert.equal(result.length, 1);
  assert.equal(result[0].cardUrl, 'https://trello.com/c/abc123');
  assert.equal(result[0].expectedListId, CONFIG.quoteReadyListId);
});

test('a matching destination copy after the move suppresses fallback', () => {
  const copies = [{
    type: 'copyCard',
    date: '2026-08-10T11:50:10.000Z',
    data: { cardSource: { id: 'card-1' }, list: { id: CONFIG.quoteReadyListId } },
  }];
  assert.deepEqual(findMissingMoves({ moves: [move()], copies, now }), []);
});

test('an old copy or wrong destination does not hide a missing route', () => {
  const copies = [
    { type: 'copyCard', date: '2026-08-10T11:49:00.000Z', data: { cardSource: { id: 'card-1' }, list: { id: CONFIG.quoteReadyListId } } },
    { type: 'copyCard', date: '2026-08-10T11:51:00.000Z', data: { cardSource: { id: 'card-1' }, list: { id: CONFIG.abdulListId } } },
  ];
  assert.equal(findMissingMoves({ moves: [move()], copies, now }).length, 1);
});

test('five-minute grace period prevents races with the primary workflow', () => {
  const recent = move({ date: new Date(now - GUARD.delayMs + 1).toISOString() });
  assert.deepEqual(findMissingMoves({ moves: [recent], copies: [], now }), []);
});

test('multiple unmatched moves of the same source card create one latest recovery', () => {
  const older = move({ id: 'event-old', date: '2026-08-10T11:40:00.000Z' });
  const newer = move({ id: 'event-new', date: '2026-08-10T11:50:00.000Z' });
  const result = findMissingMoves({ moves: [older, newer], copies: [], now });
  assert.deepEqual(result.map(item => item.eventId), ['event-new']);
});

test('fallback classification stays identical to primary routing', () => {
  assert.equal(expectedDestination('LED Neon Flex Full Glow'), CONFIG.abdulListId);
  assert.equal(expectedDestination('Lightbox'), CONFIG.quoteReadyListId);
  assert.equal(expectedDestination('Neutral custom sign'), CONFIG.abdulListId);
});

test('generated emergency alert code compiles in the n8n JavaScript runtime', () => {
  const workflow = JSON.parse(readFileSync(new URL('./generated/quentin-vector-routing-error-alert-v1.json', import.meta.url), 'utf8'));
  const code = workflow.nodes.find(node => node.name === 'Build Emergency Alert').parameters.jsCode;
  assert.doesNotThrow(() => new Function(code));
});
