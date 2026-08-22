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
    invoiceEmail: "Buchhaltung@Example.com", projectNumber: "PROJ-2026-0815",
    customer: { email: "test@example.com" }, billingAddress: { country: "DE" },
    deliveryAddress: { country: "DE" }, lineItems: [],
    totals: { subtotalNet: 8.4, vatAmount: 1.6, totalGross: 10, currency: "EUR" },
  });
  assert.equal(result.caseRecord.payment_method, "VORKASSE");
  assert.equal(result.caseRecord.total_gross_cents, 1000);
  assert.equal(result.caseRecord.customer_email, "buchhaltung@example.com");
  assert.equal(result.caseRecord.customer.email, "test@example.com");
  assert.equal(result.caseRecord.customer.invoiceEmail, "buchhaltung@example.com");
  assert.equal(result.caseRecord.project_number, "PROJ-2026-0815");
  assert.equal(result.caseRecord.billing_address.invoiceEmail, "buchhaltung@example.com");
  assert.equal(result.caseRecord.billing_address.projectNumber, "PROJ-2026-0815");
  assert.equal(result.snapshot.invoiceEmail, "buchhaltung@example.com");
  assert.equal(result.snapshot.projectNumber, "PROJ-2026-0815");
  assert.throws(() => buildBillingCaseInput({
    source: "test", sourceEventId: "bad", shopifyOrderId: "1", shopifyOrderName: "#NEONT1",
    customer: {}, billingAddress: {}, deliveryAddress: { country: "DE" }, lineItems: [],
    totals: { subtotalNet: 8.4, vatAmount: 1.59, totalGross: 10, currency: "EUR" },
  }));
});

test("billing intake rejects invalid invoice destinations and project numbers", () => {
  const valid = {
    source: "test", sourceEventId: "event-1", shopifyOrderId: "1", shopifyOrderName: "#NEONT1",
    customer: { email: "test@example.com" }, billingAddress: { country: "DE" },
    deliveryAddress: { country: "DE" }, lineItems: [],
    totals: { subtotalNet: 8.4, vatAmount: 1.6, totalGross: 10, currency: "EUR" },
  };
  assert.equal(buildBillingCaseInput({ ...valid, projectNumber: "P-123 / Messe & Süd (AT)" }).caseRecord.project_number, "P-123 / Messe & Süd (AT)");
  const fallback = buildBillingCaseInput({ ...valid, invoiceEmail: null });
  assert.equal(fallback.caseRecord.customer_email, "test@example.com");
  assert.equal(fallback.caseRecord.customer.email, "test@example.com");
  assert.equal(fallback.caseRecord.customer.invoiceEmail, "test@example.com");
  const invoiceOnly = buildBillingCaseInput({ ...valid, customer: {}, invoiceEmail: "rechnung@example.com" });
  assert.equal(invoiceOnly.caseRecord.customer_email, "rechnung@example.com");
  assert.equal(invoiceOnly.caseRecord.customer.invoiceEmail, "rechnung@example.com");
  const validInvoiceWithStaleCustomer = buildBillingCaseInput({ ...valid, customer: { email: "keine-email" }, invoiceEmail: "rechnung@example.com" });
  assert.equal(validInvoiceWithStaleCustomer.caseRecord.customer_email, "rechnung@example.com");
  assert.equal(validInvoiceWithStaleCustomer.caseRecord.customer.email, "keine-email");
  assert.throws(() => buildBillingCaseInput({ ...valid, customer: { email: "keine-email" }, invoiceEmail: null }));
  assert.throws(() => buildBillingCaseInput({ ...valid, invoiceEmail: "keine-email" }));
  assert.throws(() => buildBillingCaseInput({ ...valid, projectNumber: "PROJ\nINJECTION" }));
});

test("snapshot hashing is stable and portal tokens are opaque", () => {
  assert.equal(billingSnapshotHash({ b: 2, a: 1 }), billingSnapshotHash({ a: 1, b: 2 }));
  const token = derivePortalToken({ secret: "x".repeat(64), shopifyOrderId: "gid://shopify/Order/1" });
  const hash = portalTokenHash(token);
  assert.equal(safeTokenHashMatches(token, hash), true);
  assert.equal(safeTokenHashMatches(`${token}x`, hash), false);
});
