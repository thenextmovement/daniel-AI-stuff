import assert from "node:assert/strict";
import test from "node:test";
import {
  billingDocumentNumber, billingSnapshotHash, buildBillingCaseInput, classifyBillingTax,
  derivePortalToken, portalTokenHash, safeTokenHashMatches,
} from "../../src/lib/ops/billing/domain";

test("document numbers follow Shopify and revision rules", () => {
  assert.equal(billingDocumentNumber("PROFORMA", "#NEONT5012"), "PF-NEONT5012");
  assert.equal(billingDocumentNumber("PROFORMA", "NEONT5012", 1), "PF-NEONT5012-1");
  assert.equal(billingDocumentNumber("INVOICE", "#NEONT5012"), "#NEONT5012");
  assert.equal(billingDocumentNumber("CREDIT", "#NEONT5012"), "GS-NEONT5012");
  assert.equal(billingDocumentNumber("CANCELLATION", "#NEONT5012", 2), "ST-NEONT5012-2");
  assert.throws(() => billingDocumentNumber("INVOICE", "#NEONT5012", 1));
});

test("tax classification covers Germany, Austria and Switzerland", () => {
  assert.equal(classifyBillingTax({ deliveryCountry: "Deutschland" }).taxExempt, false);
  assert.equal(classifyBillingTax({
    deliveryCountry: "AT", vatId: "ATU12345678",
    vatValidation: { checked: true, valid: true, countryCode: "AT" },
  }).reviewStatus, "VERIFIED");
  const warning = classifyBillingTax({
    deliveryCountry: "Österreich", vatId: "ATU12345678",
    vatValidation: { checked: false, valid: false, countryCode: "AT" },
  });
  assert.equal(warning.taxExempt, true);
  assert.equal(warning.reviewStatus, "REVIEW_REQUIRED");
  assert.equal(classifyBillingTax({ deliveryCountry: "Schweiz" }).treatment, "EXPORT_THIRD_COUNTRY");
});

test("billing intake is cent exact and defaults to prepayment", () => {
  const result = buildBillingCaseInput({
    source: "neontrip-offers", sourceEventId: "offer:1:shopify:1", sourceOfferId: "offer-1",
    sourceAcceptanceId: "accept-1", shopifyOrderId: "gid://shopify/Order/1", shopifyOrderName: "#NEONT5012",
    customer: { email: "test@example.com" }, billingAddress: { country: "DE" },
    deliveryAddress: { country: "DE" }, lineItems: [],
    totals: { subtotalNet: 8.4, vatAmount: 1.6, totalGross: 10, currency: "EUR" },
  });
  assert.equal(result.caseRecord.payment_method, "VORKASSE");
  assert.equal(result.caseRecord.total_gross_cents, 1000);
  assert.throws(() => buildBillingCaseInput({
    source: "test", sourceEventId: "bad", shopifyOrderId: "1", shopifyOrderName: "#NEONT1",
    customer: {}, billingAddress: {}, deliveryAddress: { country: "DE" }, lineItems: [],
    totals: { subtotalNet: 8.4, vatAmount: 1.59, totalGross: 10, currency: "EUR" },
  }));
});

test("snapshot hashing is stable and portal tokens are opaque", () => {
  assert.equal(billingSnapshotHash({ b: 2, a: 1 }), billingSnapshotHash({ a: 1, b: 2 }));
  const token = derivePortalToken({ secret: "x".repeat(64), shopifyOrderId: "gid://shopify/Order/1" });
  const hash = portalTokenHash(token);
  assert.equal(safeTokenHashMatches(token, hash), true);
  assert.equal(safeTokenHashMatches(`${token}x`, hash), false);
});
