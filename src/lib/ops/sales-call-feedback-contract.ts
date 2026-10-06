export const FEEDBACK_PRESETS = ["callback", "needs-time", "needs-adjustment", "called-done", "not-reached", "not-interested", "do-not-call"] as const;
export type FeedbackPreset = typeof FEEDBACK_PRESETS[number];
export function feedbackToday(now = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(now);
}
export function feedbackRetryDate(attempts: number, now = new Date()) {
  const date = new Date(feedbackToday(now) + "T12:00:00Z");
  const days = attempts === 0 ? 1 : 2;
  for (let i = 0; i < days;) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (![0, 6].includes(date.getUTCDay())) i++;
  }
  return date.toISOString().slice(0, 10);
}
export function validFeedbackDate(value: unknown, now = new Date()): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T12:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && value >= feedbackToday(now);
}
