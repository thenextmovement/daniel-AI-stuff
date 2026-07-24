import assert from "node:assert/strict";
import test from "node:test";
import { deliveryIdempotencyKey, findOrganizationByEmail, nextDeliveryState, validateOfferExtraction } from "../../src/lib/ops/eu-supplier-quotes";
const organizations = [
  { id: "lum", name: "Luminescence", canonicalDomain: "luminescence.ee", emailDomains: [] },
  { id: "goleks", name: "Goleks", canonicalDomain: "goleks.com", emailDomains: ["mail.goleks.com"] },
];
test("matches any person at a configured supplier domain", () => {
  assert.equal(findOrganizationByEmail(organizations, "other@luminescence.ee").organization?.id, "lum");
  assert.equal(findOrganizationByEmail(organizations, "sales@mail.goleks.com").organization?.id, "goleks");
});
test("does not guess unknown or freemail domains", () => {
  assert.equal(findOrganizationByEmail(organizations, "sales@luminescence.example").matchStatus, "unmatched");
  assert.equal(findOrganizationByEmail(organizations, "sales@gmail.com").organization, null);
});
test("creates stable per-recipient delivery keys", () => {
  assert.equal(deliveryIdempotencyKey("request-1", " SALES@GOLEKS.COM "), "eu-supplier-request:v1:request-1:sales@goleks.com");
});
test("alerts only after terminal failure and sent remains sent", () => {
  assert.deepEqual(nextDeliveryState({ current: "sending", attemptCount: 1, outcome: "retryable_failure" }), { status: "retry_wait", shouldAlert: false });
  assert.deepEqual(nextDeliveryState({ current: "sending", attemptCount: 2, outcome: "retryable_failure" }), { status: "failed", shouldAlert: true });
  assert.deepEqual(nextDeliveryState({ current: "sending", attemptCount: 2, outcome: "retryable_failure", maxAttempts: 9 }), { status: "failed", shouldAlert: true });
  assert.deepEqual(nextDeliveryState({ current: "sent", attemptCount: 1, outcome: "claim" }), { status: "sent", shouldAlert: false });
});
test("validates exact AI extraction schema", () => {
  const result = validateOfferExtraction({ currency: "eur", unit_price: 900, total_price: null, shipping_cost: 275, production_days_min: 21, production_days_max: 28, shipping_days_min: 3, shipping_days_max: 4, valid_until: null, evidence: { unit_price: "Price 900 EUR" }, confidence: 0.94 });
  assert.equal(result.currency, "EUR");
  assert.equal(result.shipping_days_max, 4);
});
test("rejects prompt-injected action fields", () => {
  assert.throws(() => validateOfferExtraction({ currency: "EUR", unit_price: 1, total_price: null, shipping_cost: null, production_days_min: null, production_days_max: null, shipping_days_min: null, shipping_days_max: null, valid_until: null, evidence: {}, confidence: 1, send_email: true }));
});
