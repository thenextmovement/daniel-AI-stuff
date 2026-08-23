import assert from "node:assert/strict";
import test from "node:test";
import { billingChangeBaselines } from "../../src/lib/ops/billing/change-history";

function address(street: string) {
  return { company: "NEONTRIP Test", street, zip: "1020", city: "Wien", country: "AT" };
}

test("reconstructs immutable previous values for applied and rejected billing changes", () => {
  const changes = [
    { id: "change-6", created_at: "2026-08-23T20:20:00.000Z", status: "REJECTED", requested_changes: { billingAddress: address("Lassallestraße 19") } },
    { id: "change-5", created_at: "2026-08-23T20:17:00.000Z", status: "APPLIED", requested_changes: { billingAddress: address("Lassallestraße 17") }, applied_changes: { billingAddress: address("Lassallestraße 18") } },
    { id: "change-4", created_at: "2026-08-23T20:13:00.000Z", status: "APPLIED", requested_changes: { billingAddress: address("Lassallestraße 16") }, applied_changes: { billingAddress: address("Lassallestraße 16") } },
    { id: "change-3", created_at: "2026-08-23T20:10:00.000Z", status: "REJECTED", requested_changes: { billingAddress: address("Lassallestraße 15") } },
    { id: "change-2", created_at: "2026-08-23T20:05:00.000Z", status: "APPLIED", requested_changes: { billingAddress: address("Lassallestraße 13") }, applied_changes: { billingAddress: address("Lassallestraße 14") } },
    { id: "change-1", created_at: "2026-08-23T20:00:00.000Z", status: "APPLIED", requested_changes: { billingAddress: address("Lassallestraße 12") }, applied_changes: { billingAddress: address("Lassallestraße 12") } },
  ];
  const events = [
    ["change-1", "Lassallestraße 9"],
    ["change-2", "Lassallestraße 12"],
    ["change-4", "Lassallestraße 14"],
    ["change-5", "Lassallestraße 16"],
  ].map(([changeRequestId, street], index) => ({
    id: `event-${index}`,
    event_type: "APPLY_CHANGE_REQUEST",
    payload: {
      changeRequestId,
      old: {
        billingAddress: address(street),
        customerEmail: "info@riesenobjekte.de",
        projectNumber: "NEONTRIP-E2E-AT-PORTAL-2026-08-22",
        vatId: null,
      },
    },
  }));

  const result = billingChangeBaselines(changes, events, {
    billing_address: address("Lassallestraße 18"),
    customer_email: "info@riesenobjekte.de",
    project_number: "NEONTRIP-E2E-AT-PORTAL-2026-08-22",
    vat_id: "ATU00000000",
  });

  assert.equal(result["change-1"].billingAddress.street, "Lassallestraße 9");
  assert.equal(result["change-2"].billingAddress.street, "Lassallestraße 12");
  assert.equal(result["change-3"].billingAddress.street, "Lassallestraße 14");
  assert.equal(result["change-4"].billingAddress.street, "Lassallestraße 14");
  assert.equal(result["change-5"].billingAddress.street, "Lassallestraße 16");
  assert.equal(result["change-6"].billingAddress.street, "Lassallestraße 18");
  assert.equal(result["change-6"].invoiceEmail, "info@riesenobjekte.de");
  assert.equal(result["change-6"].vatId, null);
});
