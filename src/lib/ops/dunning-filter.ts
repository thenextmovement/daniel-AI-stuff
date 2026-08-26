export type DunningOrderAgeFilter = "all" | "1" | "2" | "3";
export type DunningOrderYearFilter =
  | "all"
  | "2024"
  | "2025"
  | "2026"
  | "2027"
  | "2028"
  | "2029"
  | "2030"
  | "2031"
  | "2032"
  | "2033"
  | "2034";
export type DunningStageFilter =
  | "all"
  | `exact:${number}`
  | `minimum:${number}`;

function subtractCalendarMonths(value: Date, months: number) {
  const cutoff = new Date(value.getTime());
  const originalDay = cutoff.getUTCDate();
  cutoff.setUTCDate(1);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  const lastDayOfTargetMonth = new Date(
    Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0),
  ).getUTCDate();
  cutoff.setUTCDate(Math.min(originalDay, lastDayOfTargetMonth));
  return cutoff;
}

export function matchesDunningOrderAge(
  orderCreatedAt: string | null,
  filter: DunningOrderAgeFilter,
  now = new Date(),
) {
  if (filter === "all") return true;

  const createdAt = orderCreatedAt ? Date.parse(orderCreatedAt) : Number.NaN;
  if (!Number.isFinite(createdAt) || !Number.isFinite(now.getTime()))
    return false;

  const cutoff = subtractCalendarMonths(now, Number(filter));
  return createdAt < cutoff.getTime();
}

export function matchesDunningOrderYear(
  orderCreatedAt: string | null,
  filter: DunningOrderYearFilter,
) {
  if (filter === "all") return true;
  const createdAt = orderCreatedAt ? Date.parse(orderCreatedAt) : Number.NaN;
  if (!Number.isFinite(createdAt)) return false;
  return String(new Date(createdAt).getUTCFullYear()) === filter;
}

export function matchesDunningStage(
  currentStage: number,
  filter: DunningStageFilter,
) {
  if (filter === "all") return true;
  const [mode, rawStage] = filter.split(":");
  const selectedStage = Number(rawStage);
  if (!Number.isInteger(selectedStage) || selectedStage < 0) return false;
  if (mode === "exact") return currentStage === selectedStage;
  if (mode === "minimum") return currentStage >= selectedStage;
  return false;
}

export function hasCreatedDunningCourtApplication(
  courtEvents: ReadonlyArray<{ eventType: string }>,
) {
  return courtEvents.some((event) =>
    [
      "application_draft_created",
      "application_submitted",
      "court_order_served",
      "objection_received",
      "enforcement_order_requested",
      "enforcement_order_issued",
      "closed",
    ].includes(event.eventType),
  );
}
