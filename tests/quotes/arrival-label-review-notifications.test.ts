import assert from "node:assert/strict";
import test from "node:test";
import type { ArrivalCaseDecision } from "../../src/lib/ops/arrival-labels/domain";
import {
  ARRIVAL_REVIEW_RECIPIENT,
  buildArrivalReviewNotification,
  isTrustedShopifyAdminUrl,
  validateArrivalReviewNotification,
} from "../../src/lib/ops/arrival-labels/review-notifications";

function blockedDecision(note = "Abholer; Details unter https://evil.example/phish"): ArrivalCaseDecision {
  return {
    idempotencyKey: "shopify:gid://shopify/Order/100:dhl:1234567890",
    trackingNumber: "1234567890",
    lastSix: "567890",
    expectedArrival: "2026-07-20 (due_today)",
    trelloCard: { id: "0123456789abcdef01234567", name: "1234567890 | #NEONT100", url: "https://trello.com/c/abc123/order" },
    shopifyOrder: {
      id: "gid://shopify/Order/100",
      name: "#NEONT100",
      adminUrl: "https://neontrip.myshopify.com/admin/orders/100",
      customerName: "Ada Beispiel",
      note,
      customAttributes: [],
      tags: [],
      lineItems: [{ title: "Neonschild", quantity: 1 }],
      shippingLines: [{ title: "Standard Versand", code: "standard" }],
      fulfillments: [],
    },
    shippingClass: "standard",
    selectedDpdProduct: null,
    existingDpdTracking: null,
    status: "manual_review",
    manualReviewReason: "Shopify enthaelt einen Abhol- oder Ladenlokal-Hinweis.",
    relevantOrderNote: note,
    reasons: ["pickup_instruction", "non_standard_shopify_note"],
  };
}

test("blocked cases produce a fixed-recipient plain-text review mail with trusted Shopify link", () => {
  const notification = buildArrivalReviewNotification(blockedDecision());
  assert.ok(notification);
  assert.equal(notification.recipientEmail, ARRIVAL_REVIEW_RECIPIENT);
  assert.equal(notification.shopifyOrderUrl, "https://neontrip.myshopify.com/admin/orders/100");
  assert.match(notification.bodyText, /kein neues Versandetikett gekauft und kein Druckauftrag erzeugt/);
  assert.match(notification.bodyText, /https:\/\/neontrip[.]myshopify[.]com\/admin\/orders\/100/);
  assert.doesNotMatch(notification.bodyText, /evil[.]example/);
  assert.match(notification.bodyText, /\[Link entfernt\]/);
  assert.doesNotThrow(() => validateArrivalReviewNotification(notification));
});

test("review notification keys are replay-stable and change when the untrusted note changes", () => {
  const first = buildArrivalReviewNotification(blockedDecision());
  const replay = buildArrivalReviewNotification(blockedDecision());
  const changed = buildArrivalReviewNotification(blockedDecision("Selbstabholer"));
  assert.equal(first?.notificationKey, replay?.notificationKey);
  assert.notEqual(first?.notificationKey, changed?.notificationKey);
});

test("trusted link validation and fixed recipient fail closed", () => {
  assert.equal(isTrustedShopifyAdminUrl("https://neontrip.myshopify.com/admin/orders/100"), true);
  assert.equal(isTrustedShopifyAdminUrl("https://neontrip.myshopify.com.evil.example/admin/orders/100"), false);
  const valid = buildArrivalReviewNotification(blockedDecision());
  assert.ok(valid);
  assert.throws(() => validateArrivalReviewNotification({ ...valid, recipientEmail: "attacker@example.com" as "info@neontrip.de" }), /Empfaenger/);
});

test("planned and existing-label cases do not create review notifications", () => {
  assert.equal(buildArrivalReviewNotification({ ...blockedDecision(), status: "label_planned", manualReviewReason: null }), null);
  assert.equal(buildArrivalReviewNotification({ ...blockedDecision(), status: "existing_label", manualReviewReason: null }), null);
});
