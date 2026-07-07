import test from "node:test";
import assert from "node:assert/strict";
import {
  generateOfferSizeLadder,
  OFFER_SIZE_LADDER_CUSTOMER_FACTOR,
} from "../../src/lib/ops/offer-size-ladder";

test("offer size ladder uses the new 2.6 customer factor", async () => {
  const result = await generateOfferSizeLadder({
    trelloCardId: "https://trello.com/c/cardFactor1/example",
    productModel: "neonflex",
    anchors: [
      { role: "minimum", widthCm: 100, heightCm: 50, productionPrice: 100, shippingPrice: 100 },
      { role: "requested", widthCm: 150, heightCm: 75, productionPrice: 150, shippingPrice: 150 },
      { role: "max_250", widthCm: 250, heightCm: 125, productionPrice: 280, shippingPrice: 320 },
    ],
  });

  assert.equal(result.trelloCardId, "cardFactor1");
  const minimum = result.options.find((option) => option.isDefault);
  assert.equal(OFFER_SIZE_LADDER_CUSTOMER_FACTOR, 2.6);
  assert.equal(minimum?.supplierTotalEstimated, 200);
  assert.equal(minimum?.customerUnitPriceNet, 520);
});

test("offer size ladder reflects design area, not only one dimension", async () => {
  const narrow = await generateOfferSizeLadder({
    trelloCardId: "cardNarrow1",
    productModel: "neonflex",
    anchors: [
      { role: "minimum", widthCm: 100, heightCm: 10, productionPrice: 60, shippingPrice: 70 },
      { role: "requested", widthCm: 150, heightCm: 15, productionPrice: 85, shippingPrice: 90 },
      { role: "max_250", widthCm: 250, heightCm: 25, productionPrice: 130, shippingPrice: 160 },
    ],
  });
  const square = await generateOfferSizeLadder({
    trelloCardId: "cardSquare1",
    productModel: "neonflex",
    anchors: [
      { role: "minimum", widthCm: 100, heightCm: 100, productionPrice: 220, shippingPrice: 180 },
      { role: "requested", widthCm: 150, heightCm: 150, productionPrice: 390, shippingPrice: 330 },
      { role: "max_250", widthCm: 250, heightCm: 250, productionPrice: 880, shippingPrice: 780 },
    ],
  });

  const narrow100 = narrow.options.find((option) => option.longSideCm === 100);
  const square100 = square.options.find((option) => option.longSideCm === 100);
  assert.ok(narrow100);
  assert.ok(square100);
  assert.ok(square100!.customerUnitPriceNet > narrow100!.customerUnitPriceNet * 2);
});

test("offer size ladder blocks implausibly cheap 250cm anchors", async () => {
  const result = await generateOfferSizeLadder({
    trelloCardId: "cardBad250",
    productModel: "neonflex",
    anchors: [
      { role: "minimum", widthCm: 80, heightCm: 40, productionPrice: 100, shippingPrice: 100 },
      { role: "requested", widthCm: 120, heightCm: 60, productionPrice: 140, shippingPrice: 130 },
      { role: "max_250", widthCm: 250, heightCm: 125, productionPrice: 150, shippingPrice: 140 },
    ],
  });

  assert.equal(result.status, "blocked");
  assert.ok(result.issues.some((issue) => issue.includes("area_increase_price_increase_too_low")));
  assert.equal(result.options.at(-1)?.reviewStatus, "blocked");
});

test("offer size ladder routes UV print to manual review", async () => {
  const result = await generateOfferSizeLadder({
    trelloCardId: "cardUv123",
    sourceText: "LED Neonflex with UV-Print logo details",
    anchors: [
      { role: "minimum", widthCm: 80, heightCm: 40, productionPrice: 120, shippingPrice: 110 },
      { role: "requested", widthCm: 120, heightCm: 60, productionPrice: 190, shippingPrice: 170 },
      { role: "max_250", widthCm: 250, heightCm: 125, productionPrice: 540, shippingPrice: 520 },
    ],
  });

  assert.equal(result.productModel, "uv_print");
  assert.equal(result.status, "needs_review");
  assert.equal(result.options[0]?.reviewStatus, "needs_review");
});
