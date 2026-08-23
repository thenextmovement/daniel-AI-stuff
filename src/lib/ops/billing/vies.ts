const EU_COUNTRIES = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR",
  "HU", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
]);

export type VatValidationEvidence = {
  checked: true;
  valid: boolean;
  countryCode: string;
  normalizedVatId: string;
  name: string | null;
  address: string | null;
  identityComparison: "MATCH" | "MISMATCH" | "NOT_AVAILABLE";
  checkedAt: string;
  requestDate: string | null;
  source: "EU_VIES";
};

export class VatValidationError extends Error {
  constructor(public readonly code: "vat_id_format_invalid" | "vat_id_country_mismatch" | "vat_validation_unavailable") {
    super(code);
  }
}

export function normalizeCountryCode(value: unknown) {
  const upper = String(value || "").trim().toUpperCase();
  const aliases: Record<string, string> = {
    DEUTSCHLAND: "DE", GERMANY: "DE", ÖSTERREICH: "AT", OESTERREICH: "AT", AUSTRIA: "AT",
    SCHWEIZ: "CH", SWITZERLAND: "CH",
  };
  return aliases[upper] || (upper.length === 2 ? upper : "");
}

export function requiresEuVatValidation(deliveryCountry: unknown, vatId: unknown) {
  const countryCode = normalizeCountryCode(deliveryCountry);
  return Boolean(String(vatId || "").trim()) && countryCode !== "DE" && EU_COUNTRIES.has(countryCode);
}

export function normalizeVatId(deliveryCountry: unknown, value: unknown) {
  const countryCode = normalizeCountryCode(deliveryCountry);
  const normalized = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!countryCode || !EU_COUNTRIES.has(countryCode) || countryCode === "DE") throw new VatValidationError("vat_id_country_mismatch");
  if (!normalized.startsWith(countryCode)) throw new VatValidationError("vat_id_country_mismatch");
  if (!/^[A-Z]{2}[A-Z0-9]{2,12}$/.test(normalized)) throw new VatValidationError("vat_id_format_invalid");
  if (countryCode === "AT" && !/^ATU\d{8}$/.test(normalized)) throw new VatValidationError("vat_id_format_invalid");
  return { countryCode, normalizedVatId: normalized, vatNumber: normalized.slice(2) };
}

function comparable(value: unknown) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function identityComparison(company: unknown, listedName: unknown): VatValidationEvidence["identityComparison"] {
  const expected = comparable(company);
  const listed = comparable(listedName);
  if (!expected || !listed || listed === "---") return "NOT_AVAILABLE";
  return expected === listed || expected.includes(listed) || listed.includes(expected) ? "MATCH" : "MISMATCH";
}

export async function validateVatIdWithVies(input: {
  deliveryCountry: unknown;
  vatId: unknown;
  company?: unknown;
  signal?: AbortSignal;
}): Promise<VatValidationEvidence> {
  const parsed = normalizeVatId(input.deliveryCountry, input.vatId);
  const controller = input.signal ? null : new AbortController();
  const timeout = controller ? setTimeout(() => controller.abort(), 8_000) : null;
  try {
    const response = await fetch(
      `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${encodeURIComponent(parsed.countryCode)}/vat/${encodeURIComponent(parsed.vatNumber)}`,
      { headers: { Accept: "application/json" }, cache: "no-store", signal: input.signal || controller?.signal },
    );
    if (!response.ok) throw new VatValidationError("vat_validation_unavailable");
    const payload = await response.json() as Record<string, unknown>;
    if (typeof payload.isValid !== "boolean") throw new VatValidationError("vat_validation_unavailable");
    const name = typeof payload.name === "string" && payload.name !== "---" ? payload.name.trim() : null;
    const address = typeof payload.address === "string" && payload.address !== "---" ? payload.address.trim() : null;
    return {
      checked: true,
      valid: payload.isValid,
      countryCode: parsed.countryCode,
      normalizedVatId: parsed.normalizedVatId,
      name,
      address,
      identityComparison: identityComparison(input.company, name),
      checkedAt: new Date().toISOString(),
      requestDate: typeof payload.requestDate === "string" ? payload.requestDate : null,
      source: "EU_VIES",
    };
  } catch (error) {
    if (error instanceof VatValidationError) throw error;
    throw new VatValidationError("vat_validation_unavailable");
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
