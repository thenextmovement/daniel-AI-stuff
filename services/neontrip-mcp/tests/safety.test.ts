import assert from "node:assert/strict";
import test from "node:test";
import {
  assertAutomationMayAccept,
  assertRequestedChangesHash,
  attachReviewFingerprints,
  findBillingChange,
  findPendingChange,
  requestedChangesHash,
} from "../src/safety.js";
import type { Identity } from "../src/types.js";

const automation: Identity = {
  clientId: "billing-test",
  actor: "billing-test@neontrip",
  role: "billing_automation",
  tokenSha256: "",
  scopes: ["system:read", "billing:read", "billing:change:accept"],
  expiresAt: Math.floor(Date.now() / 1000) + 3_600,
};

test("requested-change fingerprints are stable across object key order", () => {
  assert.equal(
    requestedChangesHash({ invoiceEmail: "a@example.test", billingAddress: { city: "Berlin", zip: "10115" } }),
    requestedChangesHash({ billingAddress: { zip: "10115", city: "Berlin" }, invoiceEmail: "a@example.test" }),
  );
});

test("stale requested-change fingerprints are rejected", () => {
  assert.throws(() => assertRequestedChangesHash({ projectNumber: "NEW" }, "0".repeat(64)), /verändert/);
});

test("automation can accept routine metadata but not identity, country, VAT or amount changes", () => {
  assert.doesNotThrow(() => assertAutomationMayAccept(automation, {
    projectNumber: "P-2026-9",
    billingAddress: { street: "Neuweg 2", zip: "10115", city: "Berlin" },
  }));
  for (const changes of [
    { vatId: "DE123456789" },
    { invoiceEmail: "rechnung@example.test" },
    { billingAddress: { company: "Andere GmbH" } },
    { deliveryAddress: { country: "AT" } },
    { totalGross: 1 },
  ]) {
    assert.throws(() => assertAutomationMayAccept(automation, changes), /Prüfung|Felder/);
  }
});

test("only the exact pending change is returned and exposed with a fingerprint", () => {
  const detail = { changes: [{ id: "change-1", status: "PENDING", requested_changes: { projectNumber: "42" } }] };
  assert.equal(findPendingChange(detail, "change-1").id, "change-1");
  const enriched = attachReviewFingerprints(detail) as { mcpReview: { changeFingerprints: Array<{ requestedChangesSha256: string }> } };
  assert.equal(enriched.mcpReview.changeFingerprints[0]?.requestedChangesSha256.length, 64);
  const applied = { changes: [{ ...detail.changes[0], status: "APPLIED" }] };
  assert.equal(findBillingChange(applied, "change-1").status, "APPLIED");
  assert.throws(() => findPendingChange(applied, "change-1"), /nicht mehr offen/);
});
