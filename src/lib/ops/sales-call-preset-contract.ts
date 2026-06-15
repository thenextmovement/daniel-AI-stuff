export const CALLBACK_DATE_SALES_CALL_PRESETS = ["callback", "not-reached", "needs-time"] as const;

export function salesCallPresetRequiresCallbackDate(preset: string | null | undefined) {
  return CALLBACK_DATE_SALES_CALL_PRESETS.includes(preset as (typeof CALLBACK_DATE_SALES_CALL_PRESETS)[number]);
}
