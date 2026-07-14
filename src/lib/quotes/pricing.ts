import type { CustomFieldMap } from "./types";

export const DEFAULT_PRICE_FACTOR = 2.3;

export function roundDownToFive(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value / 5) * 5;
}

export function parsePrice(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;

  const normalized = value
    .trim()
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");

  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getFactor(customFields: CustomFieldMap) {
  const raw =
    customFields["NT-Number"] ??
    customFields["NT_Number"] ??
    customFields["nt_number"] ??
    customFields["nt-number"];
  const parsed = parsePrice(raw);
  return parsed && parsed > 0 ? parsed : DEFAULT_PRICE_FACTOR;
}

export function calculateSalePrice(basePrice: number, factor: number) {
  return roundDownToFive(basePrice * factor);
}

export function calculateRgbPrice(basePrice: number, factor: number) {
  if (basePrice <= 152) return 100;
  return roundDownToFive(basePrice * factor * 0.2);
}

export function calculateExpressShipping(price1: number) {
  return roundDownToFive(Math.max(90, price1 * 0.15));
}

export function calculatePriorityShipping(price2: number | null, factor: number) {
  const base = price2 && price2 > 0 ? price2 : 0;
  return roundDownToFive(Math.max(380, base * factor * 0.3));
}
