export const NEONFLEX_CUSTOMER_AUTO_QUOTE_MAX_LONG_SIDE_CM = 200;
export const NEONFLEX_INTERNAL_REVIEW_MAX_LONG_SIDE_CM = 300;

export function getNeonflexLongSideCm(input: { width_cm: number; height_cm: number }) {
  return Math.max(input.width_cm, input.height_cm);
}

export function requiresNeonflexCustomerSizeRequest(input: { width_cm: number; height_cm: number }) {
  return getNeonflexLongSideCm(input) > NEONFLEX_CUSTOMER_AUTO_QUOTE_MAX_LONG_SIDE_CM;
}
