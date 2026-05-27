const GERMANY_VALUES = new Set(["deutschland", "germany", "de"]);

export function getTaxRate(country?: string | null) {
  const normalized = String(country || "").trim().toLowerCase();
  return GERMANY_VALUES.has(normalized) ? 19 : 0;
}
