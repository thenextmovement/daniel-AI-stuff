import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCopyMarker, findSourceRegistryTarget, hasExactSelfMarker, parseCopyMarker } from './copy-marker.mjs';

const comment = text => ({ data: { text } });

test('round-trips exact source and target IDs', () => {
  assert.deepEqual(parseCopyMarker(buildCopyMarker('source-a', 'target-a')), { sourceId: 'source-a', targetId: 'target-a' });
});
test('manual Kopie comments never count', () => {
  assert.equal(parseCopyMarker('Kopie'), null);
  assert.equal(findSourceRegistryTarget([comment('Kopie')], 'source-a'), '');
});
test('a copied stale marker is rejected on another target', () => {
  assert.equal(hasExactSelfMarker([comment(buildCopyMarker('source-a', 'target-a'))], 'source-a', 'manual-copy-b'), false);
});
test('only the exact source registry entry is accepted', () => {
  const actions = [comment(buildCopyMarker('other', 'target-x')), comment(buildCopyMarker('source-a', 'target-a'))];
  assert.equal(findSourceRegistryTarget(actions, 'source-a'), 'target-a');
});
test('the exact self-marker suppresses an automatic duplicate', () => {
  assert.equal(hasExactSelfMarker([comment(buildCopyMarker('source-a', 'target-a'))], 'source-a', 'target-a'), true);
});
