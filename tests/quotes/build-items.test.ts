import test from "node:test";
import assert from "node:assert/strict";
import { buildAddonItems, buildProductItems, buildShippingItems } from "../../src/lib/quotes/build-items";
import { buildQuoteProductItemsFromSizeLadderDraft } from "../../src/lib/quotes/create-quote-from-trello";
import { assertQuoteCreationInput, QuoteValidationError } from "../../src/lib/quotes/validation";

test("buildProductItems creates up to four product variants and ignores Price_5", () => {
  const fields = {
    Price_1: 282,
    Size_1: "75x50cm",
    Price_2: 300,
    Size_2: "100x60cm",
    Price_3: 400,
    Size_3: "120x70cm",
    Price_4: 500,
    Size_4: "140x80cm",
    Price_5: 600,
    Size_5: "160x90cm",
    Usage: "Innen",
  };
  const items = buildProductItems(fields, { factor: 2.3, taxRate: 19 });
  assert.equal(items.length, 4);
  assert.equal(items[0].unit_price, 645);
  assert.equal(items[0].selected_default, true);
});

test("buildProductItems reflects available Price_x and Size_x values", () => {
  assert.equal(buildProductItems({ Price_1: 100, Size_1: "A" }, { factor: 2.3, taxRate: 19 }).length, 1);
  assert.equal(
    buildProductItems({ Price_1: 100, Size_1: "A", Price_2: 120, Size_2: "B" }, { factor: 2.3, taxRate: 19 }).length,
    2,
  );
});

test("buildAddonItems calculates RGB price from Price_1", () => {
  const addons = buildAddonItems({ Price_1: 282 }, { factor: 2.3, taxRate: 19 });
  const rgb = addons.find((item) => item.id === "addon_rgb");
  assert.equal(rgb?.unit_price, 125);
});

test("buildShippingItems hides express options for Type 3D", () => {
  const regular = buildShippingItems({ Price_1: 282, Price_2: 300, Type: "Neon" }, { factor: 2.3, taxRate: 19 });
  const threeD = buildShippingItems({ Price_1: 282, Price_2: 300, Type: "3D" }, { factor: 2.3, taxRate: 19 });
  assert.equal(regular.length, 3);
  assert.equal(threeD.length, 1);
});

test("buildQuoteProductItemsFromSizeLadderDraft creates single-select size options", () => {
  const draft = {
    anchorSetId: "set-1",
    setKey: "set-key",
    trelloCardId: "card-1",
    trelloCardUrl: null,
    offerId: null,
    offerItemId: null,
    designId: null,
    productModel: "neonflex" as const,
    pricingBasis: "legacy_supplier_2_3" as const,
    customerFactor: 2.3,
    status: "draft" as const,
    confidence: 0.88,
    issues: [],
    warnings: [],
    options: [
      {
        sizeLabel: "80 x 40cm",
        widthCm: 80,
        heightCm: 40,
        longSideCm: 80,
        areaCm2: 3200,
        productionPriceEstimated: 100,
        shippingPriceEstimated: 100,
        supplierTotalEstimated: 200,
        customerFactor: 2.3,
        customerUnitPriceNet: 460,
        currency: "USD",
        customerCurrency: "EUR" as const,
        modelKey: "anchored_offer_size_ladder" as const,
        modelVersion: "anchored_offer_size_ladder_v1" as const,
        confidence: 0.88,
        reviewStatus: "auto_ok" as const,
        reviewReason: null,
        issues: [],
        isDefault: true,
        sortOrder: 0,
        metadata: {},
      },
      {
        sizeLabel: "90 x 45cm",
        widthCm: 90,
        heightCm: 45,
        longSideCm: 90,
        areaCm2: 4050,
        productionPriceEstimated: 120,
        shippingPriceEstimated: 120,
        supplierTotalEstimated: 240,
        customerFactor: 2.3,
        customerUnitPriceNet: 550,
        currency: "USD",
        customerCurrency: "EUR" as const,
        modelKey: "anchored_offer_size_ladder" as const,
        modelVersion: "anchored_offer_size_ladder_v1" as const,
        confidence: 0.86,
        reviewStatus: "needs_review" as const,
        reviewReason: "long_side_over_200cm_requires_review",
        issues: ["long_side_over_200cm_requires_review"],
        isDefault: false,
        sortOrder: 1,
        metadata: {},
      },
    ],
    createdBy: "Ops",
    createdAt: "2026-07-09T08:00:00.000Z",
    updatedAt: "2026-07-09T08:01:00.000Z",
  };

  const items = buildQuoteProductItemsFromSizeLadderDraft({
    draft,
    taxRate: 19,
    baseProduct: {
      section: "products",
      name: "LED-Leuchtschild",
      description: "Größe: 80x40cm\nLeuchtfarbe: Warmweiß",
      quantity: 1,
      unit_price: 500,
      tax_rate: 19,
      optional: true,
      selected_default: true,
      quantity_editable: true,
      sort_order: 10,
    },
  });

  assert.equal(items.length, 2);
  assert.equal(items[0]?.selected_default, true);
  assert.equal(items[1]?.selected_default, false);
  assert.equal(items[0]?.unit_price, 460);
  assert.equal(items[0]?.quantity_editable, false);
  assert.equal(items[0]?.metadata?.selection_mode, "single");
  assert.equal(items[0]?.metadata?.selection_group, "size_ladder");
  assert.match(items[0]?.description || "", /Größe: 80 x 40cm/);
  assert.match(items[0]?.description || "", /Leuchtfarbe: Warmweiß/);
});

test("quote creation validation allows many products only for size ladder mode", () => {
  assert.throws(
    () => assertQuoteCreationInput({ requestId: "REQ-1", email: "kunde@example.com", productCount: 8 }),
    QuoteValidationError,
  );
  assert.doesNotThrow(() =>
    assertQuoteCreationInput({
      requestId: "REQ-1",
      email: "kunde@example.com",
      productCount: 8,
      allowManyProducts: true,
    }),
  );
});
