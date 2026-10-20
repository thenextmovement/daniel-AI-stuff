import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const candidate = JSON.parse(readFileSync(new URL('../workflows/google-ads-offline-deal-revenue/paid-purchase-updates.json', import.meta.url)));
const producer = candidate.updates[0].operations.find(o => o.nodeName === 'Filter & Prepare Rows').updates['parameters.jsCode'];
const uploader = candidate.updates[1].operations.find(o => o.nodeName === 'Build Upload Payload').updates['parameters.jsCode'];
const run = (code, input, config = {}) => vm.runInNewContext(`(function(){${code}})()`, {
  $input: { all: () => input.map(json => ({ json })) },
  $: name => { assert.equal(name, 'Config'); return { first: () => ({ json: config }) }; },
  $workflow: { id: 'workflow-fixture' }, $execution: { id: 'execution-fixture' },
});
test('existing producer supports configurator without inventing request or customer contact data', () => {
  const [row] = run(producer, [{
    shopify_order_number: '#101', paid_business_key: 'shopify:101',
    conversion_value: 100, conversion_time: '2026-10-20T12:00:00Z',
    request_resolution_source: 'configurator_checkout', time_source: 'billing_cases.paid_at',
    value_source: 'billing_cases.subtotal_net_cents', gclid: 'G'.repeat(30),
  }]);
  assert.equal(row.json.request_id, null); assert.equal(row.json.email, null);
  assert.equal(row.json.paid_business_key, 'shopify:101');
  assert.equal(row.json.conversion_name, 'Offline: Deal gewonnen');
  assert.throws(() => run(producer, [{ shopify_order_number: '#101', paid_business_key: 'shopify:101' }]));
});
test('same ledger ID is the provider order ID on replay, with stored consent for click-only conversion', () => {
  const input = [{ conversion_id: 'ledger-id-fixture', claim_token: 'lease-fixture',
    conversion_name: 'Offline: Deal gewonnen', conversion_time: '2026-10-20T12:00:00Z', conversion_value: 100,
    gclid: 'G'.repeat(30), consent_ad_user_data: 'granted', consent_ad_personalization: 'granted' }];
  const config = { conversionActions: { 'Deal gewonnen': 'customers/4396424947/conversionActions/fixture' } };
  const a = run(uploader, input, config)[0].json, b = run(uploader, input, config)[0].json;
  assert.equal(a.payload.conversions[0].orderId, b.payload.conversions[0].orderId);
  assert.equal(a.payload.conversions[0].consent.adUserData, 'GRANTED');
  assert.equal(a.payload.conversions[0].userIdentifiers, undefined);
  assert.equal(a.payload.conversions.length, 1);
});
test('only four existing nodes change; no schedule, trigger, credential or adjustment edits', () => {
  assert.equal(candidate.updates.flatMap(w => w.operations).length, 4);
  for (const operation of candidate.updates.flatMap(w => w.operations)) {
    assert.equal(operation.type, 'updateNode');
    assert.deepEqual(Object.keys(operation.updates), [operation.nodeName.includes('Payload') || operation.nodeName.includes('Prepare')
      ? 'parameters.jsCode' : 'parameters.url']);
  }
});
