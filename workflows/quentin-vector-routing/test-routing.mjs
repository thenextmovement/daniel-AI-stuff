import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, classifyTitle, normalizeBackboard, priceMismatch, withDeviationSuffix, planBackboards } from './routing.mjs';

test('LED Neon and Neon Flex always win and route to Abdul', () => {
  for (const title of ['LED Neon Flex Lightbox', 'LED-Neon 3D Backlit', 'Neon Flex Full Glow']) {
    const result = classifyTitle(title);
    assert.equal(result.kind, 'led-neon-flex');
    assert.equal(result.destinationListId, CONFIG.abdulListId);
  }
});

test('specialist products route directly to Quote Ready', () => {
  for (const title of [
    '3D Backlit', 'Backlit Letters', '3D Frontlit', 'Frontlit Letters', '3D NonLit', 'NonLit Letters',
    '3D Letters', '3D-Marquee', 'Light Box', 'Lightbox', 'Ultra Thin Acrylic', 'Neon Halo',
    'Full Glow', 'Marquee', 'Marque Letters selfstanding',
  ]) {
    assert.equal(classifyTitle(title).destinationListId, CONFIG.quoteReadyListId, title);
  }
});

test('every non-specialist title defaults to LED Neon Flex and Abdul', () => {
  for (const title of ['Acrylic logo only', 'Christian Dirks 120x29cm', '', 'Custom sign cut to shape']) {
    const result = classifyTitle(title);
    assert.equal(result.kind, 'led-neon-flex', title);
    assert.equal(result.destinationListId, CONFIG.abdulListId, title);
    assert.equal(result.defaulted, true, title);
  }
});

test('backboard translations are exact German customer-facing values', () => {
  assert.equal(normalizeBackboard('Cut to shape', 'led-neon-flex'), 'Formzuschnitt');
  assert.equal(normalizeBackboard('Cut to letter', 'led-neon-flex'), 'Feinzuschnitt');
  assert.equal(normalizeBackboard('Cut to board', 'led-neon-flex'), 'Rechteckiger Zuschnitt');
  assert.equal(normalizeBackboard('Cut to rectangle', 'led-neon-flex'), 'Rechteckiger Zuschnitt');
  assert.equal(normalizeBackboard('Loose Letters', '3d-frontlit'), 'Einzelne Buchstaben');
  assert.equal(normalizeBackboard('Cut to shape', 'lightbox'), '');
});

test('four variants retain supplied reading order', () => {
  const variants = Array.from({ length: 4 }, () => ({ backboard_raw: 'Cut to shape' }));
  assert.deepEqual(planBackboards('led-neon-flex', variants).slots, Array(4).fill('Formzuschnitt'));
});

test('prices compare against extracted Total and suffix is idempotent', () => {
  assert.equal(priceMismatch('117', 117), false);
  assert.equal(priceMismatch('116', 117), true);
  const once = withDeviationSuffix('Card', true);
  assert.equal(withDeviationSuffix(once, true), once);
});
