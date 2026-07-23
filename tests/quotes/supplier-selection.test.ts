import assert from "node:assert/strict";
import test from "node:test";
import { defaultSupplierSelection, isConfiguratorSale, shouldSuggestSaeid } from "../../src/lib/ops/supplier-selection";

function sale(overrides: Record<string, unknown> = {}) {
  return {
    assignedSupplier: null,
    recommendedSupplier: "said",
    totalPrice: 1190,
    productSummary: "LED Neon Sign",
    items: [
      {
        title: "LED Neon Sign",
        sku: "LED-QA",
        variantTitle: "75cm",
        description: null,
        selectionDetails: ["Color: Warm white"],
      },
    ],
    ...overrides,
  } as Parameters<typeof defaultSupplierSelection>[0];
}

test("all unassigned sales start with Quentin, including configurator sales", () => {
  const configurator = sale({
    productSummary: "Neon Schriftzug Konfigurator",
    items: [
      {
        title: "Neon Schriftzug Konfigurator",
        sku: "Default_cpc_QA",
        variantTitle: "75cm",
        description: null,
        selectionDetails: ["Color: Warm white"],
      },
    ],
  });

  assert.equal(isConfiguratorSale(configurator), true);
  assert.equal(defaultSupplierSelection(configurator), "quentin");
});

test("existing assignments remain unchanged while normal sale defaults use Quentin", () => {
  assert.equal(defaultSupplierSelection(sale({ assignedSupplier: "quentin" })), "quentin");
  assert.equal(defaultSupplierSelection(sale({ assignedSupplier: "said" })), "said");
  assert.equal(defaultSupplierSelection(sale()), "quentin");
});

test("Saeid suggestion requires expensive single-color indoor Neon Flex", () => {
  const eligible = sale({
    totalPrice: 1000.01,
    productSummary: "Neon Schriftzug Konfigurator",
    items: [{
      title: "LED Neon Flex",
      sku: "Default_cpc_QA",
      variantTitle: "75cm",
      description: null,
      selectionDetails: ["Product Type: LED Neon Flex", "Color: Warm white", "Use: Indoor"],
    }],
  });

  assert.equal(shouldSuggestSaeid(eligible), true);
  assert.equal(shouldSuggestSaeid({ ...eligible, totalPrice: 1000 }), false);
  assert.equal(shouldSuggestSaeid({ ...eligible, items: [{ ...eligible.items[0], selectionDetails: ["Product Type: LED Neon Flex", "Color: RGB", "Use: Indoor"] }] }), false);
  assert.equal(shouldSuggestSaeid({ ...eligible, items: [{ ...eligible.items[0], selectionDetails: ["Product Type: LED Neon Flex", "Use: Indoor"] }] }), false);
  assert.equal(shouldSuggestSaeid({ ...eligible, items: [{ ...eligible.items[0], selectionDetails: ["Product Type: LED Neon Flex", "Color: Warm white", "Use: Outdoor"] }] }), false);
  assert.equal(shouldSuggestSaeid({ ...eligible, items: [{ ...eligible.items[0], title: "3D Backlit", selectionDetails: ["Product Type: 3D Backlit", "Color: Warm white", "Use: Indoor"] }] }), false);
});

test("Saeid suggestion evaluates every production item and ignores only accessories and shipping", () => {
  const neonItem = {
    ...sale().items[0],
    title: "LED Neon Flex",
    sku: "LED-QA",
    variantTitle: "75cm",
    productType: "LED Neon Flex",
    description: null,
    selectionDetails: ["Product Type: LED Neon Flex", "Color: Warm white", "Use: Indoor"],
  };
  const eligibleMultiple = sale({
    totalPrice: 1600,
    items: [
      neonItem,
      { ...neonItem, sku: "LED-QB", selectionDetails: ["Product Type: LED Neon Flex", "Color: Red", "Use: Indoor"] },
      { ...neonItem, title: "Klebe-Set", sku: "ACCESSORY-ADHESIVE", productType: "Klebe-Set", selectionDetails: [] },
      { ...neonItem, title: "Standardversand", sku: "SHIPPING", productType: "Shipping", selectionDetails: [] },
    ],
  });

  assert.equal(shouldSuggestSaeid(eligibleMultiple), true);
  assert.equal(shouldSuggestSaeid({
    ...eligibleMultiple,
    items: eligibleMultiple.items.map((item, index) => index === 0
      ? { ...item, description: "LED Neon Flex with cut to shape and power supply" }
      : item),
  }), true, "production details must not make a real Neon Flex sign look like an accessory");
  assert.equal(shouldSuggestSaeid({
    ...eligibleMultiple,
    items: [...eligibleMultiple.items, { ...neonItem, title: "3D Backlit", productType: "3D Backlit", selectionDetails: ["Color: Warm white", "Use: Indoor"] }],
  }), false);
  assert.equal(shouldSuggestSaeid({
    ...eligibleMultiple,
    items: [...eligibleMultiple.items, { ...neonItem, title: "3D Backlit", productType: "3D Backlit", description: "Power supply included", selectionDetails: ["Color: Warm white", "Use: Indoor"] }],
  }), false, "an excluded sign must never be ignored because its description mentions an accessory");
  assert.equal(shouldSuggestSaeid({
    ...eligibleMultiple,
    items: eligibleMultiple.items.map((item, index) => index === 1
      ? { ...item, selectionDetails: ["Product Type: LED Neon Flex", "Color: RGB", "Use: Indoor"] }
      : item),
  }), false);
  assert.equal(shouldSuggestSaeid({
    ...eligibleMultiple,
    items: [...eligibleMultiple.items, { ...neonItem, title: "Outdoor/IP67 wasserfeste Ausfuehrung", productType: "Outdoor option", selectionDetails: [] }],
  }), false);
});

test("Saeid remains only a suggestion while Quentin stays selected", () => {
  const eligible = sale({
    totalPrice: 1500,
    items: [{
      title: "LED Neon Flex",
      sku: "LED-QA",
      variantTitle: "75cm",
      productType: "LED Neon Flex",
      description: null,
      selectionDetails: ["Color: Warm white", "Use: Indoor"],
    }],
  });

  assert.equal(shouldSuggestSaeid(eligible), true);
  assert.equal(defaultSupplierSelection(eligible), "quentin");
});
