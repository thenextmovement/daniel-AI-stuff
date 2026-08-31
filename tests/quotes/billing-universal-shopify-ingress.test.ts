import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const workflow = JSON.parse(fs.readFileSync(path.join(
  process.cwd(),
  "workflows/billing-v2/generated/shopify-order-intake-adapter-v2.inactive.json",
), "utf8")) as {
  active: boolean;
  name: string;
  nodes: Array<{ name: string; type: string; parameters?: { jsCode?: string; url?: string; authentication?: string }; credentials?: Record<string, { name?: string }> }>;
  connections: Record<string, unknown>;
};
const documentWorkflow = JSON.parse(fs.readFileSync(path.join(
  process.cwd(),
  "workflows/billing-v2/generated/easybill-document-worker-v2.inactive.json",
), "utf8")) as {
  nodes: Array<{ name: string; parameters?: { jsCode?: string } }>;
};
const migration = fs.readFileSync(path.join(
  process.cwd(),
  "supabase/migrations/20260824133000_universal_shopify_billing_intake.sql",
), "utf8");
const paidTransitionMigration = fs.readFileSync(path.join(
  process.cwd(),
  "supabase/migrations/20260831113000_observe_shopify_paid_transition.sql",
), "utf8");

test("universal Shopify billing ingress covers every production order source", () => {
  assert.equal(workflow.active, false);
  assert.match(workflow.name, /Universal Shopify Order Intake/);
  assert.ok(workflow.nodes.some((node) => node.type === "n8n-nodes-base.scheduleTrigger"));
  const fetch = workflow.nodes.find((node) => node.name === "Read Recent Shopify Orders");
  assert.equal(fetch?.parameters?.url,
    "https://galaxybuzzdk.myshopify.com/admin/api/2025-10/orders.json?status=any&limit=50&order=created_at%20desc");
  const normalize = workflow.nodes.find((node) => node.name === "Normalize Unseen Shopify Orders")?.parameters?.jsCode || "";
  assert.match(normalize, /shopify-universal/);
  assert.match(normalize, /financial_status/);
  assert.match(normalize, /transitionKey/);
  assert.match(normalize, /shopifyPaymentObserved/);
  assert.match(normalize, /order\.email \|\| order\.contact_email \|\| order\.customer\?\.email/);
  assert.match(normalize, /gid:\/\/shopify\/Order\//);
  assert.match(normalize, /state\.completed\[fingerprint\]/);
  const intake = workflow.nodes.find((node) => node.name === "Create or Replay BillingCase");
  assert.equal(intake?.parameters?.authentication, "genericCredentialType");
  assert.equal(intake?.credentials?.httpHeaderAuth?.name, "NEONTRIP Billing Worker");
  assert.doesNotMatch(JSON.stringify(workflow), /BILLING_WEBHOOK_SECRET/);
  assert.ok(workflow.connections["Create or Replay BillingCase"]);
});

test("initial document decision and replay are atomic and idempotent", () => {
  assert.match(migration, /v_initial_type text := upper/);
  assert.match(migration, /v_initial_type = 'INVOICE'/);
  assert.match(migration, /v_job_type := 'CREATE_INVOICE'/);
  assert.match(migration, /v_job_type := 'CREATE_PROFORMA'/);
  assert.match(migration, /where shopify_order_id = p_case->>'shopify_order_id'/);
  assert.match(migration, /v_universal_replay := p_case->>'source_system' = 'shopify-universal'/);
  assert.match(migration, /on conflict \(idempotency_key\) do nothing/);
  assert.match(migration, /job_type in \('CREATE_PROFORMA','CREATE_INVOICE'\)/);
});

test("paid Shopify transitions enqueue the existing idempotent Easybill finalization path", () => {
  assert.match(paidTransitionMigration, /billing_case_observe_shopify_paid/);
  assert.match(paidTransitionMigration, /SHOPIFY_PAYMENT_OBSERVED/);
  assert.match(paidTransitionMigration, /CREATE_INVOICE/);
  assert.match(paidTransitionMigration, /PROJECT_PAYMENT_EASYBILL/);
  assert.match(paidTransitionMigration, /on conflict \(idempotency_key\)/i);
  assert.doesNotMatch(paidTransitionMigration, /insert into public\.billing_payments/i);
});

test("Shopify billing address is authoritative for the Easybill invoice recipient", () => {
  const prepare = documentWorkflow.nodes.find((node) => node.name === "Prepare Easybill Command")?.parameters?.jsCode || "";
  const execute = new Function("$json", prepare);
  const result = execute({
    body: {
      claimed: {
        job: {
          id: "job-4662",
          idempotency_key: "billing:4662:invoice",
          job_type: "CREATE_INVOICE",
          payload: { documentNumber: "#NEONT4662" },
        },
        billingCase: {
          shopify_order_name: "#NEONT4662",
          customer_email: "rechnung@example.com",
          customer: { name: "Anna Kazantzis", company: "Unbeteiligter Kundenkontakt" },
          billing_address: {
            company: "Art of Events",
            name: "Danyela Breuer",
            firstName: "Danyela",
            lastName: "Breuer",
            street: "Klutestraße 1, LS20260355",
            zip: "59063",
            city: "Hamm",
            country: "DE",
          },
          delivery_address: {
            company: "B Logistik GmbH",
            firstName: "Hagen",
            lastName: "Bayer",
            street: "Steinkühlerstraße 1",
            zip: "59269",
            city: "Beckum",
            country: "DE",
          },
          line_items: [{ title: "Leuchtschild", section: "produkt", quantity: 1, unitPriceNet: 100 }],
          subtotal_net_cents: 10000,
          vat_cents: 1900,
          total_gross_cents: 11900,
          tax_treatment: "DE_STANDARD",
          tax_exempt: false,
          payment_method: "VORKASSE",
          currency: "EUR",
        },
      },
    },
  })[0].json;

  assert.equal(result.customerPayload.company_name, "Art of Events");
  assert.equal(result.customerPayload.first_name, "Danyela");
  assert.equal(result.customerPayload.last_name, "Breuer");
  assert.equal(result.customerPayload.street, "Klutestraße 1, LS20260355");
  assert.equal(result.customerPayload.zip_code, "59063");
  assert.equal(result.customerPayload.city, "Hamm");
  assert.equal(result.customerPayload.delivery_company_name, "B Logistik GmbH");
  assert.equal(result.customerPayload.delivery_first_name, "Hagen");
  assert.equal(result.customerPayload.delivery_last_name, "Bayer");
  assert.equal(result.customerPayload.delivery_city, "Beckum");
});

test("same Shopify items stay aggregated and only neon titles receive their size", () => {
  const normalize = workflow.nodes.find((node) => node.name === "Normalize Unseen Shopify Orders")?.parameters?.jsCode || "";
  const execute = new Function("$input", "$getWorkflowStaticData", normalize);
  const state = { completed: {} };
  const result = execute(
    { first: () => ({ json: { orders: [{
      id: "8486577963275",
      name: "#NEONT4659",
      financial_status: "pending",
      email: "rechnung@example.com",
      currency: "EUR",
      created_at: "2026-08-31T12:00:00+02:00",
      customer: { first_name: "Anna", last_name: "Kazantzis" },
      billing_address: {
        company: "Art of Events", first_name: "Danyela", last_name: "Breuer",
        address1: "Klutestraße 1", address2: "LS20260355", zip: "59063", city: "Hamm", country_code: "DE",
      },
      shipping_address: {
        company: "B Logistik GmbH", first_name: "Markus", last_name: "Mustermann",
        address1: "Steinkühlerstraße 1", zip: "59269", city: "Beckum", country_code: "DE",
      },
      line_items: [
        {
          title: "Leuchtschild Design 1", quantity: 2, price: "119.00", tax_lines: [{ price: "38.00" }],
          properties: [{ name: "Bereich", value: "LED-Leuchtschild" }, { name: "Beschreibung", value: "Größe: 180x46cm\nWarmweiß" }],
        },
        {
          title: "Wandmontage-Set", quantity: 5, price: "22.61", tax_lines: [{ price: "18.04" }],
          properties: [{ name: "Bereich", value: "Zubehör" }, { name: "Beschreibung", value: "Größe: 10x5cm" }],
        },
        {
          title: "Leuchtschild Design 1", quantity: 1, price: "119.00", tax_lines: [{ price: "19.00" }],
          properties: [{ name: "Bereich", value: "LED-Leuchtschild" }, { name: "Beschreibung", value: "Größe: 180x47cm" }],
        },
      ],
      shipping_lines: [],
      total_price: "470.05",
      total_tax: "75.04",
    }] } }) },
    () => state,
  )[0].json;

  assert.equal(result.billingAddress.company, "Art of Events");
  assert.equal(result.billingAddress.name, "Danyela Breuer");
  assert.equal(result.deliveryAddress.company, "B Logistik GmbH");

  const accessory = result.lineItems.find((item: { title: string }) => item.title === "Wandmontage-Set");
  assert.equal(accessory.quantity, 5);
  assert.equal(accessory.normalizedQuantity, 5);
  assert.equal(accessory.unitPriceNet, 19);
  assert.doesNotMatch(accessory.title, /cm\b/i);

  const size46 = result.lineItems.find((item: { title: string }) => item.title.endsWith("– 180 x 46 cm"));
  const size47 = result.lineItems.find((item: { title: string }) => item.title.endsWith("– 180 x 47 cm"));
  assert.equal(size46.quantity, 2);
  assert.equal(size47.quantity, 1);
  assert.equal(result.lineItems.length, 3);

  const normalizedNetCents = result.lineItems.reduce(
    (sum: number, item: { normalizedQuantity: number; unitPriceNet: number }) =>
      sum + Math.round(item.unitPriceNet * 100) * item.normalizedQuantity,
    0,
  );
  assert.equal(normalizedNetCents, 39501);
  assert.equal(result.totals.subtotalNet, 395.01);
});
