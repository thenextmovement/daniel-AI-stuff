import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const workflow = JSON.parse(fs.readFileSync(path.join(root, "generated/easybill-document-worker-v2.inactive.json"), "utf8"));
const shopifyAdapter = JSON.parse(fs.readFileSync(path.join(root, "generated/shopify-event-adapter-v2.inactive.json"), "utf8"));
const paymentAdapter = JSON.parse(fs.readFileSync(path.join(root, "generated/payment-match-adapter-v2.inactive.json"), "utf8"));
const paymentProjection = JSON.parse(fs.readFileSync(path.join(root, "generated/payment-projection-worker-v2.inactive.json"), "utf8"));
const vatReview = JSON.parse(fs.readFileSync(path.join(root, "generated/vat-review-alert-worker-v2.inactive.json"), "utf8"));
const proformaVoid = JSON.parse(fs.readFileSync(path.join(root, "generated/easybill-proforma-void-worker-v2.inactive.json"), "utf8"));
const shopifyOrderIntake = JSON.parse(fs.readFileSync(path.join(root, "generated/shopify-order-intake-adapter-v2.inactive.json"), "utf8"));
const byName = new Map(workflow.nodes.map((node) => [node.name, node]));

test("billing workflow remains inactive and lease-driven", () => {
  assert.equal(workflow.active, false);
  assert.match(JSON.stringify(byName.get("Claim Billing Job")), /billing\/jobs\/claim/);
  assert.match(JSON.stringify(byName.get("Complete Billing Job")), /billing\/jobs/);
  assert.match(byName.get("Billing Worker Config").parameters.jsCode, /https:\/\/ops\.neontrip\.de/);
  assert.equal(byName.get("Complete Billing Job").onError, "stopWorkflow");
  assert.equal(workflow.settings.errorWorkflow, "M4uG1HAtN9Zggxww");
});

test("Easybill adapter uses supported document and VAT mappings", () => {
  const source = byName.get("Prepare Easybill Command").parameters.jsCode;
  for (const value of ["PROFORMA_INVOICE", "INVOICE", "CREDIT", "STORNO", "'IG'", "'AL'", "'NULL'"]) assert.match(source, new RegExp(value));
  assert.match(source, /Zahlbar sofort/);
  assert.match(source, /Produktion vor Fertigstellung pausiert/);
  assert.match(source, /buyer_reference:projectNumber/);
  assert.match(source, /Projektnummer:/);
  assert.match(source, /billingCase\.customer_email/);
  assert.match(source, /emailPayload:\{to:invoiceEmail/);
  assert.match(source, /Auftragsbestätigung/);
  assert.match(source, /billing_portal_url_missing/);
  assert.match(source, /Änderungen ausschließlich zu Ihren Rechnungsdaten/);
  assert.match(source, /Änderungen im Rechnungsportal ändern weder den Auftrag/);
});

test("all Easybill mutations have an explicit error completion path", () => {
  for (const name of ["Easybill Find Customer", "Easybill Create Customer", "Easybill Update Existing Customer", "Easybill Find Document", "Easybill Create Document", "Easybill Finalize Document", "Easybill Load Finalized Document", "Easybill Send Document Email"]) {
    assert.equal(byName.get(name).onError, "continueErrorOutput");
    assert.match(JSON.stringify(workflow.connections[name]), /Prepare Failed Completion/);
  }
  assert.match(byName.get("Raise Urgent Billing Error").parameters.jsCode, /Fehler Rechnung Shopify\/Easybill/);
});

test("billing documents are sent once to the invoice email after finalization", () => {
  assert.match(JSON.stringify(byName.get("Easybill Send Document Email")), /documents\/.*\/send\/email/);
  assert.match(JSON.stringify(byName.get("Easybill Send Document Email")), /emailPayload/);
  assert.match(byName.get("Prepare Document Email").parameters.jsCode, /last_postbox_id/);
  assert.match(JSON.stringify(workflow.connections["Document Email Already Sent"]), /Prepare Successful Completion/);
  assert.match(JSON.stringify(workflow.connections["Existing Document Is Draft"]), /Easybill Finalize Document/);
});

test("Easybill customer tax state is refreshed for every order before document creation", () => {
  assert.match(JSON.stringify(byName.get("Easybill Update Existing Customer")), /customerPayload/);
  assert.match(JSON.stringify(workflow.connections["Create Customer Needed"]), /Easybill Update Existing Customer/);
  assert.match(JSON.stringify(workflow.connections["Use Updated Customer"]), /Customer Ready/);
});

test("workflow contains credential placeholders but no secret material", () => {
  const source = JSON.stringify(workflow);
  assert.match(source, /CONFIGURE_EASYBILL_BEARER/);
  assert.match(source, /CONFIGURE_BILLING_WORKER_BEARER/);
  assert.doesNotMatch(source, /Bearer [A-Za-z0-9_-]{20,}/);
});

test("financial event adapters are passive sub-workflows with cent guards", () => {
  for (const adapter of [shopifyAdapter, paymentAdapter]) {
    assert.equal(adapter.active, false);
    assert.equal(adapter.nodes[0].type, "n8n-nodes-base.executeWorkflowTrigger");
    assert.equal(adapter.settings.callerPolicy, "workflowsFromSameOwner");
  }
  assert.match(JSON.stringify(shopifyAdapter), /ORDER_DELIVERED/);
  assert.match(JSON.stringify(shopifyAdapter), /allLineItemsDelivered/);
  assert.match(JSON.stringify(shopifyAdapter), /REFUND_CREATED/);
  assert.match(JSON.stringify(shopifyAdapter), /refund_cents_mismatch/);
  assert.match(JSON.stringify(paymentAdapter), /providerTransactionId/);
});

test("payment projection checks Shopify before marking paid and records Easybill payment", () => {
  const source = JSON.stringify(paymentProjection);
  assert.equal(paymentProjection.active, false);
  assert.match(source, /PROJECT_PAYMENT_SHOPIFY/);
  assert.match(source, /PROJECT_PAYMENT_EASYBILL/);
  assert.match(source, /orderMarkAsPaid/);
  assert.match(source, /canMarkAsPaid/);
  assert.match(source, /document-payments/);
  assert.match(source, /galaxybuzzdk\.myshopify\.com/);
  assert.match(source, /CONFIGURE_NEONTRIP_SHOPIFY_ADMIN/);
});

test("VAT review worker produces the internal summary with direct Ops and VIES links", () => {
  const source = JSON.stringify(vatReview);
  assert.equal(vatReview.active, false);
  assert.match(source, /Umsatzsteuer-ID passt nicht zur Firma/);
  assert.match(source, /ops\/rechnungen\?caseId=/);
  assert.match(source, /taxation_customs\/vies/);
  assert.match(source, /als netto oder brutto freigeben/);
  assert.equal(vatReview.settings.errorWorkflow, "M4uG1HAtN9Zggxww");
});

test("pre-invoice Shopify cancellation voids the Easybill Pro-forma without an accounting invoice cancellation", () => {
  const source = JSON.stringify(proformaVoid);
  assert.equal(proformaVoid.active, false);
  assert.match(source, /VOID_PROFORMA/);
  assert.match(source, /documents\/.*\/cancel/);
  assert.match(source, /CONFIGURE_EASYBILL_BEARER/);
  assert.doesNotMatch(source, /CREATE_CANCELLATION/);
});

test("all Shopify orders can enter the same signed BillingCase intake", () => {
  const source = JSON.stringify(shopifyOrderIntake);
  assert.equal(shopifyOrderIntake.active, false);
  assert.equal(shopifyOrderIntake.nodes[0].type, "n8n-nodes-base.executeWorkflowTrigger");
  assert.match(source, /BILLING_WEBHOOK_SECRET/);
  assert.match(source, /X-Neontrip-Signature/);
  assert.match(source, /\/api\/internal\/billing\/cases/);
  assert.match(source, /#NEONT/);
});
