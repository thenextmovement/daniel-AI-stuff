import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const workflow = JSON.parse(fs.readFileSync(path.join(root, "generated/easybill-document-worker-v2.inactive.json"), "utf8"));
const shopifyAdapter = JSON.parse(fs.readFileSync(path.join(root, "generated/shopify-event-adapter-v2.inactive.json"), "utf8"));
const paymentAdapter = JSON.parse(fs.readFileSync(path.join(root, "generated/payment-match-adapter-v2.inactive.json"), "utf8"));
const paymentProjection = JSON.parse(fs.readFileSync(path.join(root, "generated/payment-projection-worker-v2.inactive.json"), "utf8"));
const shopifyTaxSync = JSON.parse(fs.readFileSync(path.join(root, "generated/shopify-tax-sync-worker-v2.inactive.json"), "utf8"));
const vatReview = JSON.parse(fs.readFileSync(path.join(root, "generated/vat-review-alert-worker-v2.inactive.json"), "utf8"));
const proformaVoid = JSON.parse(fs.readFileSync(path.join(root, "generated/easybill-proforma-void-worker-v2.inactive.json"), "utf8"));
const shopifyOrderIntake = JSON.parse(fs.readFileSync(path.join(root, "generated/shopify-order-intake-adapter-v2.inactive.json"), "utf8"));
const byName = new Map(workflow.nodes.map((node) => [node.name, node]));
const customerDelivery = JSON.parse(fs.readFileSync(path.join(root, "generated/customer-document-delivery-worker-v2.inactive.json"), "utf8"));
const customerDeliveryByName = new Map(customerDelivery.nodes.map((node) => [node.name, node]));
const customerDeliveryMigration = fs.readFileSync(path.join(root, "../../supabase/migrations/20260821153000_queue_billing_customer_delivery.sql"), "utf8");
const shopifyTaxSyncMigration = fs.readFileSync(path.join(root, "../../supabase/migrations/20260822003000_sync_vat_decision_to_shopify_before_proforma.sql"), "utf8");

async function runPrepareEasybillCommand(lineItems, billingOverrides = {}) {
  const source = byName.get("Prepare Easybill Command").parameters.jsCode;
  return vm.runInNewContext(`(async()=>{${source}})()`, {
    $json: {
      body: {
        claimed: {
          job: {
            id: "test-job",
            idempotency_key: "billing:test",
            job_type: "CREATE_PROFORMA",
            payload: {
              documentNumber: "PF-NEONT9999",
              portalUrl: "https://rechnung.neontrip.de/test-token",
              revision: 0,
            },
          },
          billingCase: {
            billing_address: { country: "DE" },
            customer: { email: "rechnung@example.com", name: "Test Kunde" },
            customer_email: "rechnung@example.com",
            delivery_address: { country: "DE" },
            line_items: lineItems,
            payment_method: "VORKASSE",
            shopify_order_name: "#NEONT9999",
            subtotal_net_cents: 10000,
            tax_exempt: false,
            tax_treatment: "DE_STANDARD",
            vat_cents: 1900,
            ...billingOverrides,
          },
        },
      },
    },
  });
}

test("billing workflow remains inactive and lease-driven", () => {
  assert.equal(workflow.active, false);
  assert.equal(byName.get("Every Minute").typeVersion, 1.3);
  assert.match(byName.get("Prepare Easybill Command").parameters.jsCode, /\(\$json\.body \?\? \$json\)\.claimed/);
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
  assert.match(source, /billing_portal_url_missing/);
  assert.doesNotMatch(source, /number:String\(item\.id/);
});

test("Easybill positions use titles only and normalize shipping labels", async () => {
  const [prepared] = await runPrepareEasybillCommand([
    {
      title: "LED Neonschild – Testdesign",
      description: "Größe: 50 x 45cm\nLeuchtfarbe: Warmweiß",
      section: "LED-Leuchtschild",
      unitPriceNet: 100,
    },
    {
      title: "Dimmer mit Bluetooth und Fernbedienung",
      description: "Helligkeit bequem per App oder Fernbedienung steuern.",
      section: "Zusatzoptionen",
      unitPriceNet: 19,
    },
    {
      title: "Liefertermin Standardlieferung",
      description: "Gratis Standardlieferung ab ca. 15 Tagen.\nGewählter Termin: 10.9.2026 (+15 Tage)",
      section: "Versand",
      unitPriceNet: 0,
    },
    {
      title: "Express-Produktion 7 Tage",
      description: "Gewählter Termin: 31.8.2026 (+7 Tage)",
      section: "Versand",
      unitPriceNet: 125,
    },
    {
      title: "Eilauftrag 3 Tage",
      description: "Priorisierte Produktion.\nGewählter Termin: 27.8.2026 (+3 Tage)",
      section: "Versand",
      unitPriceNet: 250,
    },
  ]);

  assert.deepEqual(Array.from(prepared.json.documentPayload.items, (item) => item.description), [
    "LED Neonschild – Testdesign",
    "Dimmer mit Bluetooth und Fernbedienung",
    "Standardlieferung",
    "Express",
    "Eilauftrag",
  ]);
});

test("German standard-tax documents keep exactly 19 percent despite cent rounding", async () => {
  const [prepared] = await runPrepareEasybillCommand(
    [{ title: "LED Neonschild", section: "LED-Leuchtschild", unitPriceNet: 60.5 }],
    { subtotal_net_cents: 6050, vat_cents: 1150 },
  );

  assert.equal(prepared.json.documentPayload.items[0].vat_percent, 19);
});

test("invoice cancellations use Easybill's cancel endpoint idempotently", () => {
  assert.match(JSON.stringify(byName.get("Easybill Cancel Invoice")), /documents\/.*\/cancel/);
  assert.match(JSON.stringify(workflow.connections["Cancellation Job"]), /Easybill Load Original Invoice/);
  assert.match(JSON.stringify(workflow.connections["Original Invoice Already Cancelled"]), /Easybill Load Finalized Document/);
  assert.doesNotMatch(JSON.stringify(workflow.connections["Cancellation Job"]), /Easybill Create Document/);
});

test("all Easybill mutations have an explicit error completion path", () => {
  for (const name of ["Easybill Find Customer", "Easybill Create Customer", "Easybill Update Existing Customer", "Easybill Load Original Invoice", "Easybill Cancel Invoice", "Easybill Find Document", "Easybill Create Document", "Easybill Finalize Document", "Easybill Load Finalized Document"]) {
    assert.equal(byName.get(name).onError, "continueErrorOutput");
    assert.match(JSON.stringify(workflow.connections[name]), /Prepare Failed Completion/);
  }
  assert.match(byName.get("Prepare Failed Completion").parameters.jsCode, /Prepare Easybill Command'\)\.all\(\)/);
  assert.match(byName.get("Prepare Failed Completion").parameters.jsCode, /Claim Billing Job'\)\.all\(\)/);
  assert.match(byName.get("Raise Urgent Billing Error").parameters.jsCode, /Fehler Rechnung Shopify\/Easybill/);
});

test("billing documents are finalized without automatic customer email", () => {
  const source = JSON.stringify(workflow);
  assert.equal(byName.has("Easybill Send Document Email"), false);
  assert.doesNotMatch(source, /\/send\/email/);
  assert.match(byName.get("Prepare Document Completion").parameters.jsCode, /last_postbox_id/);
  assert.match(byName.get("Prepare Successful Completion").parameters.jsCode, /customerEmailSuppressed:true/);
  assert.match(byName.get("Prepare Successful Completion").parameters.jsCode, /sent:Boolean\(ctx\.emailWasAlreadySent\)/);
  assert.match(JSON.stringify(workflow.connections["Prepare Document Completion"]), /Prepare Successful Completion/);
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
  assert.equal(paymentProjection.nodes[0].typeVersion, 1.3);
  assert.match(source, /PROJECT_PAYMENT_SHOPIFY/);
  assert.match(source, /PROJECT_PAYMENT_EASYBILL/);
  assert.match(source, /orderMarkAsPaid/);
  assert.match(source, /canMarkAsPaid/);
  assert.match(source, /document-payments/);
  assert.match(source, /galaxybuzzdk\.myshopify\.com/);
  assert.match(source, /CONFIGURE_NEONTRIP_SHOPIFY_ADMIN/);
});

test("Billing v2 workflows fall back to the verified production Ops URL", () => {
  for (const candidate of [
    shopifyAdapter,
    paymentAdapter,
    paymentProjection,
    shopifyTaxSync,
    vatReview,
    proformaVoid,
    shopifyOrderIntake,
  ]) {
    assert.match(JSON.stringify(candidate), /https:\/\/ops\.neontrip\.de/);
  }
});

test("Shopify tax sync is lease-driven, fail-closed and never emails customers", () => {
  const source = JSON.stringify(shopifyTaxSync);
  assert.equal(shopifyTaxSync.active, false);
  assert.equal(shopifyTaxSync.nodes[0].typeVersion, 1.3);
  assert.match(source, /SYNC_SHOPIFY_TAX/);
  assert.match(source, /orderEditBegin/);
  assert.match(source, /orderEditSetQuantity/);
  assert.match(source, /orderEditAddCustomItem/);
  assert.match(source, /orderEditCommit/);
  assert.match(source, /notifyCustomer/);
  assert.match(source, /false/);
  assert.match(source, /EU_REVERSE_CHARGE_EXEMPTION_RULE/);
  assert.match(source, /NEONTRIP-LIEFERADRESSE/);
  assert.match(source, /LIEFERADRESSE GEÄNDERT/);
  assert.match(source, /Lieferhinweis/);
  assert.match(source, /firstName/);
  assert.match(source, /order \{ id note \}/);
  assert.match(source, /shopify_tax_sync_order_paid_or_fulfilled/);
  assert.match(source, /shopify_tax_sync_total_mismatch/);
  assert.match(source, /CONFIGURE_NEONTRIP_SHOPIFY_ADMIN/);
  assert.doesNotMatch(source, /send\/email/);
  assert.equal(shopifyTaxSync.settings.errorWorkflow, "M4uG1HAtN9Zggxww");
});

test("confirmed VAT changes queue Easybill only after Shopify tax sync succeeds", () => {
  assert.match(shopifyTaxSyncMigration, /VAT_REVIEW_CONFIRMED/);
  assert.match(shopifyTaxSyncMigration, /SYNC_SHOPIFY_TAX/);
  assert.match(shopifyTaxSyncMigration, /VAT_REVIEW_SHOPIFY_SYNCED/);
  assert.match(shopifyTaxSyncMigration, /status = 'DONE'/);
  assert.match(shopifyTaxSyncMigration, /CREATE_PROFORMA/);
});

test("VAT review worker produces the internal summary with direct Ops and VIES links", () => {
  const source = JSON.stringify(vatReview);
  assert.equal(vatReview.active, false);
  assert.equal(vatReview.nodes[0].typeVersion, 1.3);
  assert.match(source, /Umsatzsteuer-ID passt nicht zur Firma/);
  assert.match(source, /ops\/rechnungen\?caseId=/);
  assert.match(source, /taxation_customs\/vies/);
  assert.match(source, /als netto oder brutto freigeben/);
  assert.equal(vatReview.settings.errorWorkflow, "M4uG1HAtN9Zggxww");
});

test("Pro-forma void worker never creates an accounting cancellation itself", () => {
  const source = JSON.stringify(proformaVoid);
  assert.equal(proformaVoid.active, false);
  assert.equal(proformaVoid.nodes[0].typeVersion, 1.3);
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
test("customer delivery worker is isolated, generated inactive and validates recipients idempotently", async () => {
  assert.equal(customerDelivery.active, false);
  assert.equal(customerDeliveryByName.get("Every Minute").typeVersion, 1.3);
  assert.match(JSON.stringify(customerDeliveryByName.get("Claim Customer Delivery Job")), /SEND_CUSTOMER_DOCUMENT/);
  assert.match(JSON.stringify(customerDeliveryByName.get("Easybill Send Customer Document")), /\/send\/email/);
  assert.match(JSON.stringify(customerDeliveryByName.get("Easybill Send Customer Document")), /send_with_attachment/);
  assert.match(JSON.stringify(customerDeliveryByName.get("Easybill Send Customer Document")), /document_file_type/);
  assert.match(customerDeliveryByName.get("Check Existing Customer Delivery").parameters.jsCode, /last_postbox_id/);
  assert.match(customerDeliveryByName.get("Prepare Customer Delivery Success").parameters.jsCode, /last_postbox_id/);
  assert.match(customerDeliveryByName.get("Prepare Customer Delivery Success").parameters.jsCode, /sent:true/);
  assert.equal(customerDeliveryByName.get("Complete Customer Delivery Job").onError, "stopWorkflow");
  assert.equal(customerDelivery.settings.errorWorkflow, "M4uG1HAtN9Zggxww");

  const source = customerDeliveryByName.get("Prepare Customer Delivery").parameters.jsCode;
  const run = (recipient, kind = "ORDER_CONFIRMATION_PROFORMA") => vm.runInNewContext(`(async()=>{${source}})()`, {
    $json: {
      body: {
        claimed: {
          job: {
            id: "delivery-test-job",
            lease_token: "delivery-test-lease",
            payload: {
              recipient,
              deliveryKind: kind,
              easybillDocumentId: "12345",
              documentNumber: "PF-NEONT9999",
              shopifyOrderName: "#NEONT9999",
              portalUrl: "https://rechnung.neontrip.de/test-token",
              projectNumber: "PROJ-E2E-9999",
            },
          },
          billingCase: {
            shopify_order_name: "#NEONT9999",
            project_number: "PROJ-E2E-9999",
          },
        },
      },
    },
  });

  const [prepared] = await run("rahim.hedayati@icloud.com");
  assert.equal(prepared.json.recipient, "rahim.hedayati@icloud.com");
  assert.equal(prepared.json.subject, "Auftragsbestätigung und Rechnung #NEONT9999");
  assert.doesNotMatch(prepared.json.message, /keine steuerliche Schlussrechnung/);
  assert.match(prepared.json.message, /Pro-forma-Rechnung PF-NEONT9999/);
  assert.match(prepared.json.message, /Zahlbar sofort/);
  assert.match(prepared.json.message, /Der Auftrag ist verbindlich/);
  assert.doesNotMatch(prepared.json.message, /Zahlungsart Vorkasse/);
  assert.match(prepared.json.message, /rechnung\.neontrip\.de\/test-token/);
  assert.match(prepared.json.message, /angebote\.neontrip\.de\/legal\/agb/);
  const [realRecipient] = await run("kunde@example.com");
  assert.equal(realRecipient.json.recipient, "kunde@example.com");
  await assert.rejects(() => run(""), /FATAL_billing_customer_delivery_recipient_missing_or_invalid/);
  await assert.rejects(() => run("keine-email"), /FATAL_billing_customer_delivery_recipient_missing_or_invalid/);
});

test("customer delivery cutover resolves invoice email first and never silently skips missing recipients", () => {
  const cutoverMigration = fs.readFileSync(path.join(root, "../../supabase/migrations/20260822130000_harden_billing_customer_delivery.sql"), "utf8");
  assert.match(cutoverMigration, /billing_address->>'invoiceEmail'/);
  assert.match(cutoverMigration, /customer->>'email'/);
  assert.match(cutoverMigration, /recipientSource/);
  assert.match(cutoverMigration, /else 'MISSING'/);
  assert.doesNotMatch(cutoverMigration, /rahim\.hedayati@icloud\.com/);
  assert.doesNotMatch(cutoverMigration, /v_recipient not in/);
  assert.match(cutoverMigration, /billing_preserve_customer_email_fallback/);
  assert.match(cutoverMigration, /'invoiceEmail', lower\(btrim\(new\.customer_email\)\)/);
  assert.match(cutoverMigration, /SEND_CUSTOMER_DOCUMENT/);
  assert.match(cutoverMigration, /send-customer-document:/);
  assert.match(customerDeliveryMigration, /SEND_CUSTOMER_DOCUMENT/);
  assert.match(customerDeliveryMigration, /customerEmailSuppressed/);
  assert.match(customerDeliveryMigration, /new\.document_type = 'INVOICE'/);
  assert.match(customerDeliveryMigration, /deliveryKind/);
  assert.match(customerDeliveryMigration, /ORDER_CONFIRMATION_PROFORMA/);
  assert.match(customerDeliveryMigration, /PROFORMA_UPDATE/);
  assert.match(customerDeliveryMigration, /billing_mark_document_sent_after_job/);
  assert.match(customerDeliveryMigration, /new\.status = 'DONE'/);
});
