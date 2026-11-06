import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { patchContext, patchAlert, buildOperations } from './patch-workflow.mjs';

const baseline = readFileSync(new URL('./baseline-context.js', import.meta.url), 'utf8');
const code = process.env.USE_BASELINE ? baseline : patchContext(baseline);
const nodeRequire = createRequire(import.meta.url);
function payload() {
  const address = { name: 'Test Person', street: 'Teststr. 1', zip: '40219', city: 'Duesseldorf', country: 'Deutschland', phone: '01761-9605701' };
  return {
    source: 'neontrip-offers', event: 'offer.completed', idempotencyKey: 'test-only-phone-case',
    offer: { id: 'test-offer', signedAt: '2026-10-26T14:53:48.849Z', acceptedAt: '2026-10-26T14:53:48.849Z', vatRate: 19 },
    customer: { firstName: 'Test', lastName: 'Person', email: 'test@example.invalid', phone: '17619605701' },
    billingAddress: { ...address }, deliveryAddress: { ...address },
    totals: { subtotalNet: 100, vatAmount: 19, totalGross: 119 },
    lineItems: [{ title: 'Test sign', quantity: 1, unitPriceNet: 100, unitPriceGross: 119, lineNet: 100, lineGross: 119 }]
  };
}
function execute(p = payload(), source = code) {
  const rawBody = JSON.stringify(p);
  const signature = 'sha256=' + createHmac('sha256', 'test-only-secret').update(rawBody).digest('hex');
  const result = runInNewContext('(function(){' + source + '\n})()', {
    $input: { first: () => ({ json: { body: p, rawBody, headers: { 'x-neontrip-signature': signature } } }) },
    $env: { SHOPIFY_SALE_WEBHOOK_SECRET: 'test-only-secret' }, Buffer, require: nodeRequire
  }, { timeout: 1000 });
  return JSON.parse(JSON.stringify(result[0].json));
}

test('same accepted German phone corroborates the customer number missing only its trunk zero', () => {
  const out = execute();
  assert.equal(out.customerBody.customer.phone, '+4917619605701');
  assert.equal(out.contactFallbackUsed, false);
  assert.deepEqual(out.contactOmissions, []);
  assert.equal(out.baseOrder.billing_address.phone, '+4917619605701');
  assert.equal(out.baseOrder.shipping_address.phone, '+4917619605701');
  assert.equal(out.baseOrder.phone, undefined);
  assert.equal(out.baseOrder.send_receipt, false);
  assert.equal(out.baseOrder.send_fulfillment_receipt, false);
  assert.equal(out.baseOrder.financial_status, 'pending');
  assert.equal(out.idempotencyKey, 'test-only-phone-case');
});

for (const [name, mutate] of [
  ['different accepted address number', p => { p.billingAddress.phone = p.deliveryAddress.phone = '01761-9605702'; }],
  ['conflicting accepted address numbers', p => { p.deliveryAddress.phone = '01761-9605702'; }],
  ['no accepted address number', p => { p.billingAddress.phone = p.deliveryAddress.phone = ''; }],
  ['missing explicit country', p => { delete p.billingAddress.country; delete p.deliveryAddress.country; }],
  ['foreign explicit customer country', p => { p.customer.country = 'Romania'; }],
  ['foreign accepted address context', p => { p.billingAddress.country = p.deliveryAddress.country = 'Austria'; }],
  ['extension text', p => { p.customer.phone = '17619605701 ext 1'; }],
  ['malformed plus number', p => { p.customer.phone = '+017619605701'; }],
  ['missing acceptance timestamp', p => { delete p.offer.acceptedAt; delete p.offer.signedAt; }],
  ['invalid acceptance timestamp', p => { p.offer.acceptedAt = p.offer.signedAt = 'not-a-date'; }]
]) test('does not infer a customer number from ' + name, () => {
  const p = payload(); mutate(p); const out = execute(p);
  assert.equal(out.customerBody.customer.phone, undefined);
  assert.ok(out.contactOmissions.includes('phone_invalid'));
  assert.equal(out.baseOrder.phone, undefined);
});

test('empty customer phone does not adopt an address contact', () => {
  const p = payload(); p.customer.phone = '';
  assert.deepEqual(execute(p), execute(p, baseline));
});

for (const phone of ['01761-9605701', '+49 (0)1761 9605701', '004917619605701', '+436641234567']) {
  test('preserves the existing valid contact path for ' + phone, () => {
    const p = payload(); p.customer.phone = phone;
    assert.deepEqual(execute(p), execute(p, baseline));
  });
}

test('does not mutate the signed source snapshot', () => {
  const p = payload(); const before = JSON.stringify(p); execute(p); assert.equal(JSON.stringify(p), before);
});

test('unresolved phone rejection remains an internal support alert', () => {
  const alertSource = patchAlert(readFileSync(new URL('./baseline-alert.js', import.meta.url), 'utf8'));
  const input = { order: { id: 123, name: '#TEST' }, neontripContactFallback: { used: true, offerId: 'test-offer', offerNumber: 'test', details: [{ key: 'phone', label: 'Telefonnummer', value: '17619605701' }] } };
  const result = runInNewContext('(function(){' + alertSource + '\n})()', { $input: { first: () => ({ json: input }) } });
  assert.equal(result[0].json.contactFallbackAlert.shouldSend, true);
  assert.equal(result[0].json.contactFallbackAlert.recipient, 'support@neontrip.de');
});

test('the actual Outlook recipient uses support while preserving all unrelated workflow state', () => {
  const wf = {
    id: 'SEKwtYAVRR7zeKnl', versionId: '8827e6c8-32b8-43de-9595-59096296da8d', active: true,
    settings: { timezone: 'Europe/Berlin' }, connections: { existing: { main: [] } },
    nodes: [
      { name: 'Validate + Build Shopify Order Context', type: 'n8n-nodes-base.code', parameters: { jsCode: baseline } },
      { name: 'Build Contact-Fallback Success Alert', type: 'n8n-nodes-base.code', parameters: { jsCode: readFileSync(new URL('./baseline-alert.js', import.meta.url), 'utf8') } },
      { name: 'Kontakt-Fallback-Mail senden', type: 'n8n-nodes-base.microsoftOutlook', parameters: { toRecipients: 'info@neontrip.de', subject: 'existing', bodyContent: 'existing' }, credentials: { unchanged: { id: 'test-only-credential' } }, retryOnFail: true },
      ...Array.from({ length: 42 }, (_, i) => ({ name: 'unrelated-' + i, parameters: { preserved: true } }))
    ]
  };
  const before = JSON.stringify(wf); const candidate = JSON.parse(before);
  for (const op of buildOperations(wf)) {
    const node = candidate.nodes.find(n => n.name === op.nodeName);
    for (const [key, value] of Object.entries(op.updates)) {
      const parts = key.split('.'); assert.equal(parts.length, 2); node[parts[0]][parts[1]] = value;
    }
  }
  assert.equal(candidate.nodes[2].parameters.toRecipients, 'support@neontrip.de');
  candidate.nodes[0].parameters.jsCode = wf.nodes[0].parameters.jsCode;
  candidate.nodes[1].parameters.jsCode = wf.nodes[1].parameters.jsCode;
  candidate.nodes[2].parameters.toRecipients = wf.nodes[2].parameters.toRecipients;
  assert.deepEqual(candidate, wf);
  assert.equal(JSON.stringify(wf), before);
  assert.throws(() => buildOperations({ ...wf, versionId: 'newer-live-version' }), /baseline_mismatch/);
});
