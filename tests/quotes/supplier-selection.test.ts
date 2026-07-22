import assert from "node:assert/strict";
import test from "node:test";
import { defaultSupplierSelection, isConfiguratorSale } from "../../src/lib/ops/supplier-selection";

function sale(overrides: Record<string, unknown> = {}) {
  return {
    assignedSupplier: null,
    recommendedSupplier: "said",
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

test("unassigned configurator sales start without a supplier", () => {
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
  assert.equal(defaultSupplierSelection(configurator), "");
});

test("existing assignments and normal sale defaults remain unchanged", () => {
  assert.equal(defaultSupplierSelection(sale({ assignedSupplier: "quentin" })), "quentin");
  assert.equal(defaultSupplierSelection(sale()), "said");
});
