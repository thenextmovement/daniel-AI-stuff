export type DunningOrderAgeFilter = "all" | "1" | "2" | "3";

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
