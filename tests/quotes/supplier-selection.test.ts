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
