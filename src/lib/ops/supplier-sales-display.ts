const DAY_MS = 24 * 60 * 60 * 1000;
const BERLIN_TIME_ZONE = "Europe/Berlin";

type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

function calendarDateFromTimestamp(value: string | number | Date): CalendarDate | null {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BERLIN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  return year && month && day ? { year, month, day } : null;
}

function calendarDateFromIsoDate(value: string): CalendarDate | null {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const verified = new Date(Date.UTC(year, month - 1, day));
  if (
    verified.getUTCFullYear() !== year ||
    verified.getUTCMonth() !== month - 1 ||
    verified.getUTCDate() !== day
  ) return null;
  return { year, month, day };
}

function calendarDayNumber(value: CalendarDate) {
  return Math.floor(Date.UTC(value.year, value.month - 1, value.day) / DAY_MS);
}

export function orderAgeDays(orderedAt: string | null | undefined, now: string | number | Date = Date.now()) {
  if (!orderedAt) return null;
  const orderedDate = calendarDateFromTimestamp(orderedAt);
  const currentDate = calendarDateFromTimestamp(now);
  if (!orderedDate || !currentDate) return null;
  return calendarDayNumber(currentDate) - calendarDayNumber(orderedDate);
}

export function orderAgeLabel(orderedAt: string | null | undefined, now: string | number | Date = Date.now()) {
  const days = orderAgeDays(orderedAt, now);
  if (days === null) return null;
  if (days < 0) return "Bestelldatum liegt in der Zukunft";
  if (days === 0) return "heute bestellt";
  if (days === 1) return "vor 1 Tag";
  return `vor ${days} Tagen`;
}

export function deliveryDaysRemaining(deliveryDate: string | null | undefined, now: string | number | Date = Date.now()) {
  if (!deliveryDate) return null;
  const dueDate = calendarDateFromIsoDate(deliveryDate);
  const currentDate = calendarDateFromTimestamp(now);
  if (!dueDate || !currentDate) return null;
  return calendarDayNumber(dueDate) - calendarDayNumber(currentDate);
}

export function deliveryCountdownLabel(deliveryDate: string | null | undefined, now: string | number | Date = Date.now()) {
  const days = deliveryDaysRemaining(deliveryDate, now);
  if (days === null) return null;
  if (days === 0) return "heute";
  if (days === 1) return "noch 1 Tag";
  if (days > 1) return `noch ${days} Tage`;
  if (days === -1) return "1 Tag überfällig";
  return `${Math.abs(days)} Tage überfällig`;
}
