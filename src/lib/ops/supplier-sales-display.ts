import type { SupplierSaleItem } from "./supplier-sales";

const DAY_MS = 24 * 60 * 60 * 1000;
const BERLIN_TIME_ZONE = "Europe/Berlin";

type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

function mountingKey(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

function mountingOption(value: string): "wall" | "hanging" | null {
  const key = mountingKey(value);
  if (/^(wandmontage|wallmount)/.test(key)) return "wall";
  if (/^(drahtseil|deckenabhang|deckenabhaeng|abhangeset|abhaengeset|hangeset|haengeset|hangingset|hangingkit)/.test(key)) return "hanging";
  return null;
}

function mountingDeselected(value: string) {
  return /^(nein|no|false|0|none|nichtgewahlt|nichtgewaehlt|nichtausgewahlt|nichtausgewaehlt|notselected)$|^(ohne|kein)/.test(mountingKey(value));
}

/** Read the purchased options only; descriptions may merely advertise available accessories. */
export function supplierSaleMountingSelection(items: Pick<SupplierSaleItem, "title" | "variantTitle" | "selectionDetails" | "quantity">[]) {
  const selected = { wall: false, hanging: false };
  for (const item of items) {
    if (item.quantity <= 0) continue;
    const details = item.selectionDetails.map((detail) => {
      const [label, ...rest] = detail.split(":");
      return { label, value: rest.join(":").trim() };
    });
    const titleOption = mountingOption(item.title);
    if (titleOption && !mountingDeselected(item.variantTitle || "") && !details.some(({ label, value }) => (
      mountingOption(label) === titleOption && mountingDeselected(value)
    ))) {
      selected[titleOption] = true;
    }
    for (const { label, value } of details) {
      if (!value || mountingDeselected(value)) continue;
      const option = mountingOption(label);
      if (option) selected[option] = true;
      if (/^(montage|mounting|installation)$/.test(mountingKey(label))) {
        const mounting = mountingOption(value);
        if (mounting) selected[mounting] = true;
      }
    }
  }
  return selected;
}

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
