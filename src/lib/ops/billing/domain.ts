import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type BillingPaymentMethod = "VORKASSE" | "KAUF_AUF_RECHNUNG";
export type BillingTaxTreatment = "DE_STANDARD" | "EU_B2C_OSS" | "EU_B2B_REVERSE_CHARGE" | "EXPORT_THIRD_COUNTRY";
export type BillingTaxReviewStatus = "NOT_REQUIRED" | "VERIFIED" | "REVIEW_REQUIRED";
export type BillingDocumentType = "PROFORMA" | "INVOICE" | "CREDIT" | "CANCELLATION";

export type BillingMoney = { subtotalNet: number; vatAmount: number; totalGross: number; currency: string };
export type BillingIntake = {
  source: string;
  sourceEventId: string;
  sourceOfferId?: string | null;
  sourceAcceptanceId?: string | null;
  shopifyOrderId: string;
  shopifyOrderName: string;
  invoiceEmail?: string | null;
  projectNumber?: string | null;
  customer: Record<string, unknown>;
  billingAddress: Record<string, unknown>;
  deliveryAddress: Record<string, unknown>;
  lineItems: unknown[];
  totals: BillingMoney;
  vatValidation?: Record<string, unknown> | null;
  acceptedAt?: string | null;
};

export type BillingTaxDecision = {
  treatment: BillingTaxTreatment;
  reviewStatus: BillingTaxReviewStatus;
  taxExempt: boolean;
  vatId: string | null;
  reason: string;
};

const EU_COUNTRIES = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES", "FI", "FR", "HR", "HU", "IE", "IT",
  "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
]);

const COUNTRY_ALIASES: Record<string, string> = {
  deutschland: "DE", germany: "DE", oesterreich: "AT", osterreich: "AT", österreich: "AT", austria: "AT",
  schweiz: "CH", switzerland: "CH", suisse: "CH", svizzera: "CH",
};

function text(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

export function countryCode(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return upper === "GR" ? "EL" : upper;
  const normalized = raw.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return COUNTRY_ALIASES[normalized] || null;
}

export function normalizedVatId(value: unknown) {
  return text(value).toUpperCase().replace(/[^A-Z0-9]/g, "") || null;
}

export function normalizeBillingEmail(value: unknown) {
  const normalized = text(value).toLowerCase();
  if (!normalized) return null;
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error("Rechnungs-E-Mail ist ungültig.");
  }
  return normalized;
}

export function normalizeProjectNumber(value: unknown) {
  const normalized = text(value);
  if (!normalized) return null;
  if (normalized.length > 100 || /[<>\u0000-\u001F\u007F]/u.test(normalized)) {
    throw new Error("Projektnummer ist ungültig.");
  }
  return normalized;
}

export function classifyBillingTax(input: {
  deliveryCountry: unknown;
  vatId?: unknown;
  vatValidation?: Record<string, unknown> | null;
}): BillingTaxDecision {
  const delivery = countryCode(input.deliveryCountry);
  if (!delivery) throw new Error("Lieferland fehlt oder ist nicht eindeutig.");
  const vatId = normalizedVatId(input.vatId);
  if (delivery === "DE") return {
    treatment: "DE_STANDARD", reviewStatus: "NOT_REQUIRED", taxExempt: false, vatId,
    reason: "Lieferung nach Deutschland ist steuerpflichtig.",
  };
  if (!EU_COUNTRIES.has(delivery)) return {
    treatment: "EXPORT_THIRD_COUNTRY", reviewStatus: "NOT_REQUIRED", taxExempt: true, vatId,
    reason: "Drittlandlieferung; die finale Steuerfreiheit benötigt den Ausfuhrnachweis.",
  };
  if (!vatId) return {
    treatment: "EU_B2C_OSS", reviewStatus: "NOT_REQUIRED", taxExempt: false, vatId: null,
    reason: "EU-Lieferung ohne USt-IdNr. wird steuerpflichtig behandelt.",
  };
  const validation = input.vatValidation || {};
  const checked = validation.checked === true;
  const valid = validation.valid === true;
  const validationCountry = countryCode(validation.countryCode);
  const countryMatches = !validationCountry || validationCountry === delivery;
  return {
    treatment: "EU_B2B_REVERSE_CHARGE",
    reviewStatus: checked && valid && countryMatches ? "VERIFIED" : "REVIEW_REQUIRED",
    taxExempt: true,
    vatId,
    reason: checked && valid && countryMatches
      ? "USt-IdNr. bestätigt; innergemeinschaftliche Lieferung wird netto vorbereitet."
      : "USt-IdNr. übernommen; finale Nettorechnung wartet auf interne Prüfung.",
  };
}

function cents(value: number) {
  if (!Number.isFinite(value)) throw new Error("Ungültiger Geldbetrag.");
  return Math.round((value + Number.EPSILON) * 100);
}

export function validateBillingMoney(input: BillingMoney) {
  if (!/^[A-Z]{3}$/.test(input.currency)) throw new Error("Währung muss ein ISO-4217-Code sein.");
  const subtotalNetCents = cents(input.subtotalNet);
  const vatCents = cents(input.vatAmount);
  const totalGrossCents = cents(input.totalGross);
  if (subtotalNetCents < 0 || vatCents < 0 || totalGrossCents < 0) throw new Error("Negative Auftragssummen sind nicht zulässig.");
  if (subtotalNetCents + vatCents !== totalGrossCents) throw new Error("Netto, Steuer und Brutto stimmen nicht centgenau überein.");
  return { subtotalNetCents, vatCents, totalGrossCents, currency: input.currency };
}

export function normalizeShopifyOrderName(value: unknown) {
  const raw = text(value).toUpperCase().replace(/\s+/g, "");
  const normalized = raw.startsWith("#") ? raw : `#${raw}`;
  if (!/^#NEONT\d+$/.test(normalized)) throw new Error("Shopify-Bestellname muss #NEONT{Nummer} entsprechen.");
  return normalized;
}

export function billingDocumentNumber(type: BillingDocumentType, shopifyOrderName: string, revision = 0) {
  const order = normalizeShopifyOrderName(shopifyOrderName).slice(1);
  if (!Number.isInteger(revision) || revision < 0) throw new Error("Dokumentrevision ist ungültig.");
  if (type === "INVOICE") {
    if (revision !== 0) throw new Error("Finalrechnungen werden nicht versioniert.");
    return `#${order}`;
  }
  const prefix = type === "PROFORMA" ? "PF" : type === "CREDIT" ? "GS" : "ST";
  return `${prefix}-${order}${revision === 0 ? "" : `-${revision}`}`;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]),
  );
  return value;
}

export function billingSnapshotHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export function derivePortalToken(input: { secret: string; shopifyOrderId: string; version?: number }) {
  const secret = input.secret.trim();
  if (secret.length < 32) throw new Error("BILLING_PORTAL_TOKEN_SECRET muss mindestens 32 Zeichen lang sein.");
  const version = input.version ?? 1;
  if (!Number.isInteger(version) || version < 1) throw new Error("Portal-Token-Version ist ungültig.");
  return createHmac("sha256", secret)
    .update(`neontrip:billing:${input.shopifyOrderId}:v${version}`)
    .digest("base64url");
}

export function portalTokenHash(token: string) {
  return createHash("sha256").update(`neontrip:billing-portal:${token}`).digest("hex");
}

export function safeTokenHashMatches(token: string, expectedHash: string) {
  const actual = Buffer.from(portalTokenHash(token));
  const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function buildBillingCaseInput(input: BillingIntake) {
  const shopifyOrderId = text(input.shopifyOrderId);
  if (!shopifyOrderId) throw new Error("Shopify-Order-ID fehlt.");
  const shopifyOrderName = normalizeShopifyOrderName(input.shopifyOrderName);
  const money = validateBillingMoney(input.totals);
  const requestedInvoiceEmail = normalizeBillingEmail(input.invoiceEmail || input.billingAddress.invoiceEmail);
  let customerEmail: string | null = null;
  try {
    customerEmail = normalizeBillingEmail(input.customer.email);
  } catch (error) {
    // A valid explicit invoice address remains usable even if stale source
    // customer data contains an invalid address. Without it, fail closed.
    if (!requestedInvoiceEmail) throw error;
  }
  const invoiceEmail = requestedInvoiceEmail || customerEmail;
  const projectNumber = normalizeProjectNumber(input.projectNumber || input.billingAddress.projectNumber);
  const billingAddress = {
    ...input.billingAddress,
    ...(requestedInvoiceEmail ? { invoiceEmail: requestedInvoiceEmail } : {}),
    ...(projectNumber ? { projectNumber } : {}),
  };
  const vatId = input.billingAddress.vatId || input.vatValidation?.normalizedVatId;
  const tax = classifyBillingTax({ deliveryCountry: input.deliveryAddress.country, vatId, vatValidation: input.vatValidation });
  if (tax.taxExempt && money.vatCents !== 0) throw new Error("Steuerfreier Auftrag enthält einen Steuerbetrag.");
  if (!tax.taxExempt && money.totalGrossCents === money.subtotalNetCents && money.totalGrossCents > 0) {
    throw new Error("Steuerpflichtiger Auftrag enthält keinen Steuerbetrag.");
  }
  const snapshot = {
    source: text(input.source) || "unknown", sourceOfferId: input.sourceOfferId || null,
    sourceAcceptanceId: input.sourceAcceptanceId || null, shopifyOrderId, shopifyOrderName,
    customer: {
      ...input.customer,
      ...(customerEmail ? { email: customerEmail } : {}),
      ...(invoiceEmail ? { invoiceEmail } : {}),
    },
    invoiceEmail, projectNumber, billingAddress, deliveryAddress: input.deliveryAddress,
    lineItems: input.lineItems, totals: input.totals, tax, vatValidation: input.vatValidation || null,
    acceptedAt: input.acceptedAt || null,
  };
  return {
    snapshot,
    snapshotHash: billingSnapshotHash(snapshot),
    caseRecord: {
      source_system: text(input.source) || "unknown", source_offer_id: input.sourceOfferId || null,
      source_acceptance_id: input.sourceAcceptanceId || null, shopify_order_id: shopifyOrderId,
      shopify_order_name: shopifyOrderName,
      customer: {
        ...input.customer,
        ...(customerEmail ? { email: customerEmail } : {}),
        ...(invoiceEmail ? { invoiceEmail } : {}),
      },
      customer_email: invoiceEmail, project_number: projectNumber, billing_address: billingAddress,
      delivery_address: input.deliveryAddress, line_items: input.lineItems, totals: input.totals,
      currency: money.currency, subtotal_net_cents: money.subtotalNetCents, vat_cents: money.vatCents,
      total_gross_cents: money.totalGrossCents, payment_method: "VORKASSE" satisfies BillingPaymentMethod,
      payment_terms_days: null, tax_treatment: tax.treatment, tax_review_status: tax.reviewStatus,
      tax_exempt: tax.taxExempt, vat_id: tax.vatId, vat_validation: input.vatValidation || null,
      accepted_at: input.acceptedAt || null,
      status: tax.reviewStatus === "REVIEW_REQUIRED" ? "MANUAL_REVIEW" : "PROFORMA_PENDING",
    },
  };
}
