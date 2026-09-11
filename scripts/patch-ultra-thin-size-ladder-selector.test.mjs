import test from 'node:test';
import assert from 'node:assert/strict';
import { previousGuard, patchUltraThinSelector, prepareUltraThinSelectorUpdate, workflowId, nodeName } from './patch-ultra-thin-size-ladder-selector.mjs';

test('selector admits Ultra Thin and preserves neighboring product exclusions', () => {
  const accepts = new Function('name', patchUltraThinSelector(previousGuard) + '\nreturn true;');
  for (const name of ['Ultra-thin acrylic light box', 'Ultra Thin Acrylic', 'Ultra Thin', 'LED Leuchtkasten Slim', 'Slim LED Lightbox', 'LED Neon Flex']) {
    assert.equal(accepts(name), true, name);
  }
  for (const name of ['Acrylic Lightbox', 'Double-sided Lightbox', 'LED Leuchtkasten', 'Full Glow', '3D Frontlit', 'Ultra Thin + Full Glow']) {
    assert.equal(accepts(name), false, name);
  }
});

test('update is restricted to the known selector and rejects source drift', () => {
  const source = '// existing alignment and selection\n' + previousGuard + '\n// existing cursor';
  const update = prepareUltraThinSelectorUpdate({ id: workflowId, nodes: [{
    id: 'selector-id', name: nodeName, parameters: { mode: 'runOnceForAllItems', jsCode: source },
  }] });
  assert.equal(update.nodeId, 'selector-id');
  assert.equal(update.updates.parameters.mode, 'runOnceForAllItems');
  assert.match(update.updates.parameters.jsCode, /^\/\/ existing alignment and selection/);
  assert.match(update.updates.parameters.jsCode, /existing cursor$/);
  assert.throws(() => patchUltraThinSelector('// source changed'));
  assert.throws(() => patchUltraThinSelector(previousGuard + previousGuard));
  assert.throws(() => prepareUltraThinSelectorUpdate({ id: 'other', nodes: [] }));
});
