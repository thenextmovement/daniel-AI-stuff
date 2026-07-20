import assert from "node:assert/strict";
import {
  buildFactsPackageCode,
  buildShopifyQueryCode,
  commerceResolverWorkflow,
  mainWorkflowPatches,
  patchMainWorkflow,
  resolveShopifyCode,
  shopifyGraphqlQuery,
  validateCaseCode,
} from "./build-workflows.mjs";

function runCode(code, input, nodeData = {}) {
  const execute = new Function("$input", "$", code);
  const dollarInput = {
    first: () => ({ json: input }),
    all: () => [{ json: input }],
  };
  const dollar = (name) => {
    if (!(name in nodeData)) throw new Error("Node not available: " + name);
    return {
      first: () => ({ json: nodeData[name] }),
      all: () => [{ json: nodeData[name] }],
    };
  };
  return execute(dollarInput, dollar)[0].json;
}

const triggerNodes = commerceResolverWorkflow.nodes.filter((node) => node.type.endsWith("Trigger"));
assert.equal(triggerNodes.length, 1);
assert.equal(commerceResolverWorkflow.nodes.length, 9);
assert.ok(commerceResolverWorkflow.nodes.length <= 30);
assert.doesNotMatch(JSON.stringify(commerceResolverWorkflow), /createReply|sendMail|replyAll|microsoftOutlook/i);
assert.match(shopifyGraphqlQuery, /\bnote\b/);
assert.match(shopifyGraphqlQuery, /customAttributes/);

for (const node of commerceResolverWorkflow.nodes.filter((entry) => entry.type === "n8n-nodes-base.httpRequest")) {
  assert.ok(node.retryOnFail);
  assert.equal(node.onError, "stopWorkflow");
}

const validated = runCode(validateCaseCode, {
  customerEmail: "anna@umdash.com",
  relatedEmails: ["alex@umdash.com", "ANNA@UMDASH.COM", "fabienne@neontrip.de", "bad"],
  organizationDomain: "umdash.com",
  organizationLookupEnabled: true,
  contextSince: "2025-05-01T00:00:00.000Z",
});
assert.equal(validated.customerEmail, "anna@umdash.com");
assert.deepEqual(validated.relatedEmails, ["anna@umdash.com", "alex@umdash.com"]);
assert.match(validated.shopifyIndexOrFilter, /email\.ilike\.\*@umdash\.com/);
assert.doesNotMatch(validated.shopifyIndexOrFilter, /neontrip\.de/);

const queryByOrganizationIndex = runCode(buildShopifyQueryCode, {
  body: [{ shopify_order_id: "gid://shopify/Order/12345" }],
}, {
  "Validate Case Input": {
    ...validated,
    subject: "Frage zum Projekt",
    currentText: "Könnt ihr das bitte prüfen?",
    threadMessages: [],
  },
});
assert.equal(queryByOrganizationIndex.shopifySearchBasis, "organization_index_ids");
assert.match(queryByOrganizationIndex.shopifySearchQuery, /id:12345/);

const queryByExplicitOrder = runCode(buildShopifyQueryCode, { body: [] }, {
  "Validate Case Input": {
    ...validated,
    subject: "Frage zu #NEONT1234",
    currentText: "",
    threadMessages: [],
  },
});
assert.equal(queryByExplicitOrder.explicitOrderNumber, "#NEONT1234");
assert.equal(queryByExplicitOrder.shopifySearchBasis, "explicit_order_number");

const liveOrder = {
  id: "gid://shopify/Order/12345",
  name: "#NEONT1234",
  createdAt: "2026-07-01T10:00:00Z",
  displayFinancialStatus: "PAID",
  note: "Snapshot: https://angebote.neontrip.de/offer/abcdefghijklmnop und A/N 14543",
  totalPriceSet: { shopMoney: { amount: "1190.00", currencyCode: "EUR" } },
  customAttributes: [],
};
const resolvedDirect = runCode(resolveShopifyCode, {
  body: { data: { orders: { nodes: [liveOrder] } } },
}, {
  "Build Shopify Query": {
    ...queryByExplicitOrder,
    customerEmail: "anna@umdash.com",
    indexOrders: [{
      shopify_order_id: "12345",
      name: "#NEONT1234",
      email: "anna@umdash.com",
      total_price: 1190,
      financial_status: "paid",
      created_at: "2026-07-01T10:00:00Z",
    }],
    explicitOrderNumber: "#NEONT1234",
    explicitOfferNumber: "A/N 14543",
    currentText: "Bitte #NEONT1234 prüfen.",
    threadMessages: [],
  },
});
assert.equal(resolvedDirect.selectionBasis, "explicit_order_number");
assert.equal(resolvedDirect.selectedShopifyOrder.offer_reference_source, "shopify_order_note");
assert.equal(resolvedDirect.offerToken, "abcdefghijklmnop");
assert.equal("note" in resolvedDirect.selectedShopifyOrder, false);

const unresolvedCrossContact = runCode(resolveShopifyCode, {
  body: { data: { orders: { nodes: [liveOrder] } } },
}, {
  "Build Shopify Query": {
    ...queryByOrganizationIndex,
    customerEmail: "alex@umdash.com",
    indexOrders: [{
      shopify_order_id: "12345",
      name: "#NEONT1234",
      email: "anna@umdash.com",
      total_price: 1190,
      financial_status: "paid",
    }],
    explicitOrderNumber: "",
    explicitOfferNumber: "",
    currentText: "Bitte prüfen.",
    threadMessages: [],
  },
});
assert.equal(unresolvedCrossContact.selectedShopifyOrder, null);
assert.equal(unresolvedCrossContact.commerceAmbiguous, true);

assert.throws(() => runCode(resolveShopifyCode, {
  body: { errors: [{ message: "scope missing" }] },
}, {
  "Build Shopify Query": queryByExplicitOrder,
}), /GraphQL returned errors/);

const selectedOrder = {
  ...resolvedDirect.selectedShopifyOrder,
  financial_status: "paid",
  total_price: 1190,
  offer_id: "offer-1",
};
const additionalOrder = {
  shopify_order_id: "99999",
  order_number: "#NEONT9999",
  financial_status: "pending",
  total_price: 238,
  offer_id: "offer-1",
};
const signedOffer = {
  id: "offer-1",
  offerNumber: "A/N 14543",
  status: "ACCEPTED",
  vatRate: 19,
  acceptance: {
    signedAt: "2026-06-30T12:00:00Z",
    finalPdfHash: "sha256:verified",
    totalsSnapshot: {
      subtotalNet: 1000,
      totalGross: 1190,
      vatRate: 19,
      taxExempt: false,
    },
    selectedItemsSnapshot: [
      {
        id: "main",
        selected: true,
        title: "LED-Neonschild",
        section: "Schild",
        normalizedQuantity: 1,
        lineNet: 800,
        lineGross: 952,
      },
      {
        id: "option",
        selected: true,
        title: "Dimmer",
        section: "Zusatzoption",
        normalizedQuantity: 1,
        lineNet: 200,
        lineGross: 238,
      },
    ],
  },
};
const facts = runCode(buildFactsPackageCode, {}, {
  "Resolve Shopify Evidence": {
    ...queryByExplicitOrder,
    selectedShopifyOrder: selectedOrder,
    shopifyOrders: [selectedOrder, additionalOrder],
    commerceAmbiguous: false,
    selectionBasis: "explicit_order_number",
    shopifySearchBasis: "explicit_order_number",
    organizationLookupEnabled: true,
    subject: "Preisfrage",
    currentText: "Der Preis kommt mir zu hoch vor.",
    threadMessages: [{
      from: { emailAddress: { address: "support@neontrip.de" } },
      body: { content: "Der korrekte Nettopreis beträgt 1.000,00 EUR netto. Die Rechnung beträgt 238,00 EUR." },
    }],
  },
  "Fetch Signed Offer": { body: { offer: signedOffer } },
});
assert.equal(facts.evidenceResolverVersion, "commerce-evidence-v2");
assert.equal(facts.financialReconciliation.status, "balanced");
assert.equal(facts.financialReconciliation.equation_verified, true);
assert.equal(facts.financialReconciliation.corrected_main_net_cents, 100000);
assert.equal(facts.financialReconciliation.corrected_gross_cents, 142800);
assert.equal(facts.financialReconciliation.difference_cents, 23800);
assert.equal(facts.factsPackage.risk_gates.financial_claims_allowed, true);
assert.equal(facts.factsPackage.risk_gates.automatic_send_allowed, false);
assert.ok(facts.factsPackage.facts.some((fact) => fact.id === "offer.signed_gross_cents"));
assert.ok(facts.factsPackage.facts.some((fact) => fact.id === "reconciliation.difference_cents" && fact.customer_safe));

const conflicting = runCode(buildFactsPackageCode, {}, {
  "Resolve Shopify Evidence": {
    selectedShopifyOrder: selectedOrder,
    shopifyOrders: [selectedOrder],
    commerceAmbiguous: false,
    selectionBasis: "explicit_order_number",
    subject: "Preisfrage",
    currentText: "Bitte prüfen.",
    threadMessages: [{
      from: { emailAddress: { address: "support@neontrip.de" } },
      body: { content: "Der korrekte Nettopreis beträgt 1.000,00 EUR netto. Später: Der korrekte Nettopreis beträgt 1.100,00 EUR netto." },
    }],
  },
  "Fetch Signed Offer": { body: { offer: signedOffer } },
});
assert.equal(conflicting.financialReconciliation.status, "not_applicable");
assert.ok(conflicting.factsPackage.conflicts.includes("multiple_corrected_net_prices"));
assert.equal(conflicting.factsPackage.risk_gates.financial_claims_allowed, true);
assert.equal(conflicting.factsPackage.risk_gates.reconciliation_claims_allowed, false);

const fixtureNodes = [];
function fixtureGet(object, path) {
  return path.split('.').reduce((value, key) => value?.[key], object);
}
function fixtureSet(object, path, value) {
  const keys = path.split('.');
  let cursor = object;
  for (const key of keys.slice(0, -1)) {
    if (!cursor[key]) cursor[key] = {};
    cursor = cursor[key];
  }
  cursor[keys.at(-1)] = value;
}
for (const operation of mainWorkflowPatches) {
  let node = fixtureNodes.find((entry) => entry.name === operation.node);
  if (!node) {
    node = { name: operation.node, parameters: {} };
    fixtureNodes.push(node);
  }
  const existing = fixtureGet(node, operation.fieldPath);
  fixtureSet(node, operation.fieldPath, [existing, operation.find].filter(Boolean).join('\n/* patch anchor */\n'));
}
const patchedMain = patchMainWorkflow({ nodes: fixtureNodes, connections: {}, settings: {} });
for (const operation of mainWorkflowPatches) {
  const node = patchedMain.nodes.find((entry) => entry.name === operation.node);
  assert.match(fixtureGet(node, operation.fieldPath), new RegExp(operation.replace.slice(0, 24).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}
assert.match(
  patchedMain.nodes.find((entry) => entry.name === 'Build Draft Prompt').parameters.jsCode,
  /email-facts-package-v2/,
);
assert.match(
  patchedMain.nodes.find((entry) => entry.name === 'Build Draft Prompt').parameters.jsCode,
  /signed_customer_contract/,
);
assert.match(
  patchedMain.nodes.find((entry) => entry.name === 'Validate and Render').parameters.jsCode,
  /invalid_fact_references/,
);
assert.match(
  patchedMain.nodes.find((entry) => entry.name === 'Log Success').parameters.jsonBody,
  /email-context-v3/,
);

console.log("Email facts package workflow tests passed.");
