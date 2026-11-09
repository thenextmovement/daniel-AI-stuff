import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('accepted Shopify customer-phone regression suite', () => {
  const result = spawnSync(process.execPath, ['--test', 'workflows/shopify-phone-corroboration/phone-corroboration.test.mjs'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
