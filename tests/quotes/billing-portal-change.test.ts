import assert from "node:assert/strict";
import test from "node:test";
import { sanitizePortalChangeBody } from "../../src/lib/ops/billing/portal-change";

test("billing portal accepts only bounded invoice and delivery fields", () => {
  const result = sanitizePortalChangeBody({
    billingAddress: { company: "Muster GmbH", street: "Musterweg 1", zip: "1010", city: "Wien", country: "AT" },
    vatId: "ATU12345678",
    invoiceEmail: "Invoice@Example.com",
    projectNumber: "PROJ-2026-0815 / Messe & Süd (AT)",
    requesterEmail: "kunde@example.com",
  });
  assert.equal(result.changes.invoiceEmail, "invoice@example.com");
  assert.equal(result.changes.projectNumber, "PROJ-2026-0815 / Messe & Süd (AT)");
  assert.deepEqual(result.changes.billingAddress, { company: "Muster GmbH", street: "Musterweg 1", zip: "1010", city: "Wien", country: "AT" });
});

test("billing portal rejects arbitrary nested and root properties", () => {
  assert.throws(() => sanitizePortalChangeBody({ billingAddress: { company: "Muster", totalGross: 1 } }), /invalid_portal_change/);
  assert.throws(() => sanitizePortalChangeBody({ product: "anderes Produkt" }), /invalid_portal_change/);
  assert.throws(() => sanitizePortalChangeBody({ invoiceEmail: "not-an-email" }), /invalid_portal_change/);
  assert.throws(() => sanitizePortalChangeBody({ invoiceEmail: "" }), /invalid_portal_change/);
  assert.throws(() => sanitizePortalChangeBody({ projectNumber: "<script>" }), /invalid_portal_change/);
});
