import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSupplierPricePredictionReviewDraftsFromAnchor,
  buildSupplierEstimateTargetSizes,
  calculateSupplierEstimateOfferUnitPrice,
  checkSupplierEstimatePlausibility,
  estimateSupplierPriceFromAnchors,
  extractSupplierQuoteMultiAnchors,
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

test("buildSupplierEstimateTargetSizes creates an automatic 10cm ladder to 250cm", () => {
  const targets = buildSupplierEstimateTargetSizes("", { widthCm: 80, heightCm: 40 });

  assert.equal(targets[0]?.requestedInput, "80cm");
  assert.equal(targets[0]?.widthCm, 80);
  assert.equal(targets[0]?.heightCm, 40);
  assert.equal(targets.at(-1)?.requestedInput, "250cm");
  assert.equal(targets.at(-1)?.widthCm, 250);
  assert.equal(targets.at(-1)?.heightCm, 125);
  assert.deepEqual(targets.map((target) => target.requestedInput).slice(0, 4), ["80cm", "90cm", "100cm", "110cm"]);
});

test("buildSupplierEstimateTargetSizes keeps explicit extra sizes and dedupes automatic sizes", () => {
  const targets = buildSupplierEstimateTargetSizes("75x50,100", { widthCm: 80, heightCm: 40 });
  const explicit = targets.find((target) => target.requestedInput === "75x50");
  const hundredTargets = targets.filter((target) => Math.max(target.widthCm, target.heightCm) === 100);

  assert.ok(explicit);
  assert.equal(explicit?.widthCm, 75);
  assert.equal(explicit?.heightCm, 50);
  assert.equal(hundredTargets.length, 1);
});

test("extractSupplierQuoteMultiAnchors reads column supplier prices from OCR text", () => {
  const anchors = extractSupplierQuoteMultiAnchors(
    [
      "Size 75/100/120/150cm",
      "Production price 70 95 118 145",
      "Shipping cost 90 105 126 150",
    ].join("\n"),
    { widthCm: 75, heightCm: 75 },
  );

  assert.equal(anchors.length, 4);
  assert.deepEqual(anchors.map((anchor) => anchor.maxSideCm), [75, 100, 120, 150]);
  assert.equal(anchors[1]?.productionPrice, 95);
  assert.equal(anchors[3]?.shippingPrice, 150);
});

test("estimateSupplierPriceFromAnchors interpolates between real supplier anchors", () => {
  const estimate = estimateSupplierPriceFromAnchors({
    target: { requestedInput: "110cm", widthCm: 110, heightCm: 110 },
    modelFamily: "neonflex",
    anchors: [
      {
        widthCm: 100,
        heightCm: 100,
        maxSideCm: 100,
        productionPrice: 95,
        shippingPrice: 105,
        totalSupplierCost: 200,
        currency: "USD",
        source: "ocr_multi_anchor",
        confidence: 0.82,
      },
      {
        widthCm: 150,
        heightCm: 150,
        maxSideCm: 150,
        productionPrice: 145,
        shippingPrice: 150,
        totalSupplierCost: 295,
        currency: "USD",
        source: "ocr_multi_anchor",
        confidence: 0.82,
      },
    ],
  });

  assert.ok(estimate);
  assert.equal(estimate?.shippingStrategy, "piecewise_supplier_anchor_interpolation");
  assert.ok(estimate!.production > 95 && estimate!.production < 145);
  assert.ok(estimate!.shipping > 105 && estimate!.shipping < 150);
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
