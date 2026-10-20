import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const code = readFileSync(new URL('../tracking/shopify/measurement-consent.pixel.js', import.meta.url), 'utf8');
test('Shopify privacy pixel sends only revoke capability, never a purchase, PII or grant', async () => {
  const handlers = {}, calls = [];
  let privacyUpdate;
  vm.runInNewContext(code, {
    init: { customerPrivacy: { marketingAllowed: true, analyticsProcessingAllowed: true } },
    api: { customerPrivacy: { subscribe: (name, fn) => { assert.equal(name, 'visitorConsentCollected'); privacyUpdate = fn; } } },
    analytics: { subscribe: (name, fn) => { handlers[name] = fn; } },
    fetch: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, json: async () => ({ revoked: true }) }; },
  });
  const event = { data: { checkout: { email: 'never-send@example.invalid', totalPrice: 999,
    attributes: [{ key: 'NEONTRIP Entwurf', value: 'a'.repeat(64) }, { key: 'NEONTRIP Messwiderruf', value: 'b'.repeat(64) }] } } };
  handlers.checkout_started(event); assert.equal(calls.length, 0);
  privacyUpdate({ customerPrivacy: { marketingAllowed: false, analyticsProcessingAllowed: true } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://angebote.neontrip.de/api/public/configurator/measurement-consent');
  assert.deepEqual(calls[0].body, { checkoutId: 'a'.repeat(64), token: 'b'.repeat(64), revoke: true });
  handlers.checkout_completed(event);
  privacyUpdate({ customerPrivacy: { marketingAllowed: false } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1);
});
