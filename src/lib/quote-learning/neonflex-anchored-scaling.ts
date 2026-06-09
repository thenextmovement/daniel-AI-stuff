import { NEONFLEX_CUSTOMER_AUTO_QUOTE_MAX_LONG_SIDE_CM } from "./neonflex-size-policy";

export type NeonflexAnchoredScalingInput = {
  base_width_cm: number;
  base_height_cm: number;
  base_production_price_usd: number;
  base_shipping_price_usd: number;
  target_width_cm: number;
  target_height_cm: number;
};

export type NeonflexAnchoredSizeLadderInput = {
  base_width_cm: number;
  base_height_cm: number;
  base_production_price_usd: number;
  base_shipping_price_usd: number;
  step_cm?: number;
  max_long_side_cm?: number;
};

export type NeonflexAnchoredScalingPrediction = {
  base_width_cm: number;
  base_height_cm: number;
  target_width_cm: number;
  target_height_cm: number;
  base_area_cm2: number;
  target_area_cm2: number;
  area_ratio: number;
  shipping_bucket: string;
  shipping_strategy:
    | "target_bucket_area_delta"
    | "anchored_segmented_piecewise"
    | "anchored_large_base_hybrid_piecewise";
  shipping_used_global_fallback: boolean;
  shipping_training_rows: number;
  shipping_requires_review: boolean;
  review_reason: string | null;
  predicted_production_price_usd: number;
  predicted_shipping_price_usd: number;
  predicted_total_supplier_cost_usd: number;
  model_key: string;
  model_version: string;
  confidence: "shadow_anchored_scaling";
};

export type NeonflexAnchoredShippingBucketKey = "lt80" | "80_139" | "140_219" | "220_plus";

export type NeonflexAnchoredShippingBucketParameters = {
  train_rows: number;
  holdout_rows: number;
  area_intercept: number;
  area_slope: number;
  requires_review?: boolean;
};

export type NeonflexAnchoredShippingFitStrategy =
  | "least_squares"
  | "trimmed_least_squares"
  | "median_slope";

export type NeonflexAnchoredScalingModelLike = {
  model_key: string;
  version: string;
  production: {
    area_exponent: number;
  };
  shipping: {
    strategy: "anchored_segmented_piecewise";
    fit_strategy?: NeonflexAnchoredShippingFitStrategy;
    minimum_bucket_train_rows: number;
    standard_bucket_train_rows_target: number;
    global_fallback: {
      area_delta_slope: number;
    };
    buckets: Record<NeonflexAnchoredShippingBucketKey, NeonflexAnchoredShippingBucketParameters>;
    large_220_plus_base_anchor_hybrid?: {
      strategy: "use_exact_current_large_fit_when_base_max_side_lt";
      base_max_side_lt_cm: number;
      buckets: Record<NeonflexAnchoredShippingBucketKey, NeonflexAnchoredShippingBucketParameters>;
    };
  };
};

export const NEONFLEX_ANCHORED_SCALING_MODEL = {
  model_key: "neonflex_supplier_anchored_scaling",
  version: "2026_06_05_v5",
  status: "shadow" as const,
  training_rows: 405,
  holdout_rows: 99,
  scaling_rows: 504,
  scaling_designs: 212,
  scaling_cards: 212,
  train_designs: 165,
  train_cards: 165,
  holdout_designs: 47,
  holdout_cards: 47,
  training_filters: {
    min_width_cm: 20,
    max_width_cm: 300,
    min_height_cm: 10,
    max_height_cm: 300,
    max_longest_side_cm: 300,
    min_production_price_usd: 10,
    max_production_price_usd: 2500,
    min_shipping_price_usd: 20,
    max_shipping_price_usd: 3500,
  },
  grouping: {
    strategy: "trello_card_id_plus_model_code",
    reason: "Keeps multiple designs on the same Trello card from sharing the wrong anchor.",
  },
  production: {
    formula:
      "base_production_price_usd * power(target_area_cm2 / base_area_cm2, production_area_exponent)",
    area_exponent: 0.46581133,
    median_absolute_percentage_error: 0.0576,
    p90_absolute_percentage_error: 0.1803,
  },
  shipping: {
    formula:
      "base_shipping_price_usd + target_bucket_area_intercept + sum(segment_area_slope * segment_area_delta_cm2)",
    strategy: "anchored_segmented_piecewise" as const,
    reason:
      "Shipping is anchored at the supplier's smallest known quote, then area deltas are charged through each crossed longest-side bucket instead of applying the final bucket slope to the full delta.",
    minimum_bucket_train_rows: 8,
    standard_bucket_train_rows_target: 20,
    global_fallback: {
      area_delta_slope: 0.01693464,
    },
    buckets: {
      lt80: { train_rows: 116, holdout_rows: 38, area_intercept: 1.19031041, area_slope: 0.01756992 },
      "80_139": { train_rows: 167, holdout_rows: 49, area_intercept: 10.82999061, area_slope: 0.01906475 },
      "140_219": { train_rows: 104, holdout_rows: 15, area_intercept: 57.00549345, area_slope: 0.01388815 },
      "220_plus": {
        train_rows: 10,
        holdout_rows: 5,
        area_intercept: 113.06545808,
        area_slope: 0.01207484,
        requires_review: true,
      },
    } satisfies Record<NeonflexAnchoredShippingBucketKey, NeonflexAnchoredShippingBucketParameters>,
    large_220_plus_base_anchor_hybrid: {
      strategy: "use_exact_current_large_fit_when_base_max_side_lt" as const,
      base_max_side_lt_cm: 180,
      buckets: {
        lt80: { train_rows: 128, holdout_rows: 26, area_intercept: 2.65196361, area_slope: 0.01675748 },
        "80_139": { train_rows: 173, holdout_rows: 43, area_intercept: 10.45706823, area_slope: 0.01927899 },
        "140_219": { train_rows: 92, holdout_rows: 27, area_intercept: 67.28204982, area_slope: 0.01216903 },
        "220_plus": {
          train_rows: 12,
          holdout_rows: 3,
          area_intercept: 160.14439835,
          area_slope: 0.00939897,
          requires_review: true,
        },
      } satisfies Record<NeonflexAnchoredShippingBucketKey, NeonflexAnchoredShippingBucketParameters>,
    },
    median_absolute_percentage_error: 0.0578,
    p90_absolute_percentage_error: 0.1619,
    p90_absolute_error_usd: 40.37,
    large_220_plus: {
      validation_rows: 15,
      previous_segmented_piecewise_median_absolute_percentage_error: 0.0747,
      hybrid_segmented_piecewise_median_absolute_percentage_error: 0.0488,
      previous_segmented_piecewise_p90_absolute_percentage_error: 0.1277,
      hybrid_segmented_piecewise_p90_absolute_percentage_error: 0.1196,
      previous_segmented_piecewise_p90_absolute_error_usd: 88.73,
      hybrid_segmented_piecewise_p90_absolute_error_usd: 88.73,
    },
  },
  total: {
    median_absolute_percentage_error: 0.0512,
    p90_absolute_percentage_error: 0.1431,
    p90_absolute_error_usd: 48.01,
    large_220_plus: {
      holdout_rows: 5,
      median_absolute_percentage_error_before: 0.1312,
      median_absolute_percentage_error_after: 0.0573,
      p90_absolute_percentage_error_before: 0.1779,
      p90_absolute_percentage_error_after: 0.0778,
      p90_absolute_error_usd_before: 119.44,
      p90_absolute_error_usd_after: 89.79,
    },
  },
};

function assertPositiveNumber(name: string, value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function roundDimension(value: number) {
  return Math.round(value * 10) / 10;
}

function roundMetric(value: number) {
  return Math.round(value * 10000) / 10000;
}

export function getNeonflexAnchoredShippingBucket(maxSideCm: number): NeonflexAnchoredShippingBucketKey {
  if (maxSideCm < 80) return "lt80";
  if (maxSideCm < 140) return "80_139";
  if (maxSideCm < 220) return "140_219";
  return "220_plus";
}

const SHIPPING_SEGMENTS: Array<{
  bucket: NeonflexAnchoredShippingBucketKey;
  from_long_side_cm: number;
  to_long_side_cm: number;
}> = [
  { bucket: "lt80", from_long_side_cm: 0, to_long_side_cm: 80 },
  { bucket: "80_139", from_long_side_cm: 80, to_long_side_cm: 140 },
  { bucket: "140_219", from_long_side_cm: 140, to_long_side_cm: 220 },
  { bucket: "220_plus", from_long_side_cm: 220, to_long_side_cm: Number.POSITIVE_INFINITY },
];

function areaAtLongSide(targetAreaCm2: number, targetMaxSideCm: number, longSideCm: number) {
  if (longSideCm >= targetMaxSideCm) return targetAreaCm2;
  return targetAreaCm2 * (longSideCm / targetMaxSideCm) ** 2;
}

function calculateSegmentedShippingDelta(input: {
  model: NeonflexAnchoredScalingModelLike;
  base_area_cm2: number;
  base_max_side_cm: number;
  target_area_cm2: number;
  target_max_side_cm: number;
  target_bucket_params: NeonflexAnchoredShippingBucketParameters;
}) {
  if (input.target_area_cm2 === input.base_area_cm2) return 0;

  const buckets = input.model.shipping.buckets;
  const segmentSlopeDelta = SHIPPING_SEGMENTS.reduce((sum, segment) => {
    const segmentStart = Math.max(input.base_max_side_cm, segment.from_long_side_cm);
    const segmentEnd = Math.min(input.target_max_side_cm, segment.to_long_side_cm);
    if (segmentEnd <= segmentStart) return sum;

    const startArea = Math.max(
      input.base_area_cm2,
      areaAtLongSide(input.target_area_cm2, input.target_max_side_cm, segmentStart),
    );
    const endArea = Math.min(
      input.target_area_cm2,
      areaAtLongSide(input.target_area_cm2, input.target_max_side_cm, segmentEnd),
    );
    const areaDelta = Math.max(0, endArea - startArea);
    return sum + buckets[segment.bucket].area_slope * areaDelta;
  }, 0);

  return input.target_bucket_params.area_intercept + segmentSlopeDelta;
}

export function predictNeonflexAnchoredSupplierPrice(
  input: NeonflexAnchoredScalingInput,
): NeonflexAnchoredScalingPrediction {
  return predictNeonflexAnchoredSupplierPriceWithModel(input, NEONFLEX_ANCHORED_SCALING_MODEL);
}

export function predictNeonflexAnchoredSupplierPriceWithModel(
  input: NeonflexAnchoredScalingInput,
  model: NeonflexAnchoredScalingModelLike,
): NeonflexAnchoredScalingPrediction {
  assertPositiveNumber("base_width_cm", input.base_width_cm);
  assertPositiveNumber("base_height_cm", input.base_height_cm);
  assertPositiveNumber("base_production_price_usd", input.base_production_price_usd);
  assertPositiveNumber("base_shipping_price_usd", input.base_shipping_price_usd);
  assertPositiveNumber("target_width_cm", input.target_width_cm);
  assertPositiveNumber("target_height_cm", input.target_height_cm);

  const baseWidth = roundDimension(input.base_width_cm);
  const baseHeight = roundDimension(input.base_height_cm);
  const targetWidth = roundDimension(input.target_width_cm);
  const targetHeight = roundDimension(input.target_height_cm);
  const baseArea = roundDimension(baseWidth * baseHeight);
  const targetArea = roundDimension(targetWidth * targetHeight);
  const areaRatio = targetArea / baseArea;
  const areaDelta = targetArea - baseArea;
  if (areaDelta < 0) {
    throw new Error("target area must be greater than or equal to base area.");
  }
  const baseMaxSide = Math.max(baseWidth, baseHeight);
  const targetMaxSide = Math.max(targetWidth, targetHeight);
  const shippingBucket = getNeonflexAnchoredShippingBucket(targetMaxSide);
  const largeHybrid = model.shipping.large_220_plus_base_anchor_hybrid;
  const useLargeHybrid =
    Boolean(largeHybrid) &&
    shippingBucket === "220_plus" &&
    baseMaxSide < (largeHybrid?.base_max_side_lt_cm ?? 0);
  const shippingBuckets = useLargeHybrid ? largeHybrid!.buckets : model.shipping.buckets;
  const shippingBucketParams = shippingBuckets[shippingBucket];
  const shippingUsedGlobalFallback =
    !shippingBucketParams ||
    shippingBucketParams.train_rows < model.shipping.minimum_bucket_train_rows;
  const shippingRequiresReview =
    !shippingBucketParams ||
    shippingBucketParams?.requires_review === true ||
    shippingBucketParams?.train_rows < model.shipping.standard_bucket_train_rows_target;
  const production = Math.max(
    0,
    input.base_production_price_usd *
      areaRatio ** model.production.area_exponent,
  );
  const shippingDelta = (() => {
    if (areaDelta === 0) return 0;
    if (shippingUsedGlobalFallback) {
      return model.shipping.global_fallback.area_delta_slope * areaDelta;
    }
    return calculateSegmentedShippingDelta({
      base_area_cm2: baseArea,
      base_max_side_cm: baseMaxSide,
      model: {
        ...model,
        shipping: {
          ...model.shipping,
          buckets: shippingBuckets,
        },
      },
      target_area_cm2: targetArea,
      target_max_side_cm: targetMaxSide,
      target_bucket_params: shippingBucketParams,
    });
  })();
  const shipping = Math.max(
    0,
    input.base_shipping_price_usd + shippingDelta,
  );

  return {
    base_width_cm: baseWidth,
    base_height_cm: baseHeight,
    target_width_cm: targetWidth,
    target_height_cm: targetHeight,
    base_area_cm2: baseArea,
    target_area_cm2: targetArea,
    area_ratio: roundMetric(areaRatio),
    shipping_bucket: shippingBucket,
    shipping_strategy: shippingUsedGlobalFallback
      ? "target_bucket_area_delta"
      : useLargeHybrid
        ? "anchored_large_base_hybrid_piecewise"
        : "anchored_segmented_piecewise",
    shipping_used_global_fallback: shippingUsedGlobalFallback,
    shipping_training_rows: shippingBucketParams?.train_rows ?? 0,
    shipping_requires_review: shippingRequiresReview,
    review_reason: shippingRequiresReview ? "shipping_bucket_has_limited_training_data" : null,
    predicted_production_price_usd: roundMoney(production),
    predicted_shipping_price_usd: roundMoney(shipping),
    predicted_total_supplier_cost_usd: roundMoney(production + shipping),
    model_key: model.model_key,
    model_version: model.version,
    confidence: "shadow_anchored_scaling",
  };
}

export function buildNeonflexAnchoredSizeLadder(input: NeonflexAnchoredSizeLadderInput) {
  const step = input.step_cm ?? 20;
  const maxLongSide = input.max_long_side_cm ?? NEONFLEX_CUSTOMER_AUTO_QUOTE_MAX_LONG_SIDE_CM;

  assertPositiveNumber("base_width_cm", input.base_width_cm);
  assertPositiveNumber("base_height_cm", input.base_height_cm);
  assertPositiveNumber("base_production_price_usd", input.base_production_price_usd);
  assertPositiveNumber("base_shipping_price_usd", input.base_shipping_price_usd);
  assertPositiveNumber("step_cm", step);
  assertPositiveNumber("max_long_side_cm", maxLongSide);

  const baseLongSide = Math.max(input.base_width_cm, input.base_height_cm);
  const ratio = input.base_width_cm / input.base_height_cm;
  const sizes: NeonflexAnchoredScalingPrediction[] = [];
  const seen = new Set<string>();

  for (let longSide = baseLongSide; longSide <= maxLongSide; longSide += step) {
    const widthDominant = input.base_width_cm >= input.base_height_cm;
    const width = widthDominant ? longSide : longSide * ratio;
    const height = widthDominant ? longSide / ratio : longSide;
    const prediction = predictNeonflexAnchoredSupplierPrice({
      base_width_cm: input.base_width_cm,
      base_height_cm: input.base_height_cm,
      base_production_price_usd: input.base_production_price_usd,
      base_shipping_price_usd: input.base_shipping_price_usd,
      target_width_cm: width,
      target_height_cm: height,
    });
    const key = `${prediction.target_width_cm}x${prediction.target_height_cm}`;

    if (!seen.has(key)) {
      sizes.push(prediction);
      seen.add(key);
    }
  }

  return sizes;
}
