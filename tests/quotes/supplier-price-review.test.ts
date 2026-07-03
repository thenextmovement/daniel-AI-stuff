import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSupplierPricePredictionReviewDraftsFromAnchor,
  calculateSupplierEstimateOfferUnitPrice,
  checkSupplierEstimatePlausibility,
  isSupplierPricePredictionAutomationAction,
} from "../../src/lib/ops/supplier-price-review";
import { SUPPLIER_PRICE_TO_OFFER_FACTOR } from "../../src/lib/ops/supplier-price-review-constants";

const MODEL_VERSION_ID = "00000000-0000-4000-8000-000000000001";

test("buildSupplierPricePredictionReviewDraftsFromAnchor creates customer-review drafts up to 200cm", () => {
  const drafts = buildSupplierPricePredictionReviewDraftsFromAnchor({
    modelVersionId: MODEL_VERSION_ID,
    requestId: "REQ-1",
    trelloCardId: "card-1",
    sourceCode: "Design A",
    baseWidthCm: 80,
    baseHeightCm: 40,
    baseProductionPriceUsd: 80,
    baseShippingPriceUsd: 90,
    stepCm: 60,
  });

  assert.deepEqual(
    drafts.map((draft) => [draft.widthCm, draft.heightCm]),
    [
      [80, 40],
      [140, 70],
      [200, 100],
    ],
  );
  assert.ok(drafts.every((draft) => draft.predictionKey.startsWith("price_pred_")));
  assert.equal(new Set(drafts.map((draft) => draft.predictionKey)).size, drafts.length);
  assert.ok(drafts.every((draft) => draft.sourceCode === "Design A"));
  assert.ok(drafts.every((draft) => draft.customerAutoQuoteEligible === true));
  assert.ok(drafts.every((draft) => draft.decisionStatus === "shadow"));
});

test("buildSupplierPricePredictionReviewDraftsFromAnchor marks explicit large review sizes as supplier check", () => {
  const drafts = buildSupplierPricePredictionReviewDraftsFromAnchor({
    modelVersionId: MODEL_VERSION_ID,
    requestId: "REQ-1",
    sourceCode: "Design A",
    baseWidthCm: 80,
    baseHeightCm: 40,
    baseProductionPriceUsd: 80,
    baseShippingPriceUsd: 90,
    stepCm: 60,
    maxLongSideCm: 260,
  });
  const large = drafts.find((draft) => Math.max(draft.widthCm, draft.heightCm) > 200);

  assert.ok(large);
  assert.equal(large?.customerAutoQuoteEligible, false);
  assert.equal(large?.decisionStatus, "needs_supplier_check");
  assert.equal(large?.featureValues?.shipping_bucket, "220_plus");
});

test("supplier price review automation scope can only enqueue training-item predictions", () => {
  assert.equal(isSupplierPricePredictionAutomationAction("create_from_training_item"), true);
  assert.equal(isSupplierPricePredictionAutomationAction("create_from_anchor"), false);
  assert.equal(isSupplierPricePredictionAutomationAction("review_training_item_anchor"), false);
  assert.equal(isSupplierPricePredictionAutomationAction("estimate_from_trello"), false);
  assert.equal(isSupplierPricePredictionAutomationAction("import_trello_training_candidates"), false);
  assert.equal(isSupplierPricePredictionAutomationAction("review"), false);
  assert.equal(isSupplierPricePredictionAutomationAction(undefined), false);
});

test("calculateSupplierEstimateOfferUnitPrice uses the Schildpreis offer factor 2.3", () => {
  assert.equal(SUPPLIER_PRICE_TO_OFFER_FACTOR, 2.3);
  assert.equal(calculateSupplierEstimateOfferUnitPrice(297), 680);
});

test("checkSupplierEstimatePlausibility blocks large size jumps with tiny price change", () => {
  const result = checkSupplierEstimatePlausibility({
    anchorWidthCm: 100,
    anchorHeightCm: 50,
    anchorSupplierTotalCost: 300,
    targetWidthCm: 200,
    targetHeightCm: 100,
    targetSupplierTotalCost: 330,
  });

  assert.equal(result.status, "blocked");
  assert.ok(result.issues.includes("large_area_increase_has_too_small_price_increase"));
});

test("checkSupplierEstimatePlausibility blocks much smaller signs with almost unchanged price", () => {
  const result = checkSupplierEstimatePlausibility({
    anchorWidthCm: 200,
    anchorHeightCm: 100,
    anchorSupplierTotalCost: 900,
    targetWidthCm: 100,
    targetHeightCm: 50,
    targetSupplierTotalCost: 810,
  });

  assert.equal(result.status, "blocked");
  assert.ok(result.issues.includes("large_area_decrease_has_too_small_price_decrease"));
});
