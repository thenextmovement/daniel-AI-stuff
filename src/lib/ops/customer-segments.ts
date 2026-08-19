export const CUSTOMER_SEGMENT_REGISTRY = [
  { segment: "NT-1", legacyLabel: "Ladenbauer", cx8Label: "Laden-/Messebau-Produktionspartner", defaultSKategorie: "S2", active: true },
  { segment: "NT-2", legacyLabel: "Gastronomie", cx8Label: null, defaultSKategorie: "S3", active: false },
  { segment: "NT-3", legacyLabel: "Event/Messe", cx8Label: "Event-/Medienproduktion", defaultSKategorie: "S1", active: true },
  { segment: "NT-4", legacyLabel: "Werbeagentur", cx8Label: "Agentur/Planer/Wiederverkäufer", defaultSKategorie: "S2", active: true },
  { segment: "NT-5", legacyLabel: "Franchise", cx8Label: "Franchise/Filialorganisation", defaultSKategorie: "S2", active: true },
  { segment: "NT-6", legacyLabel: "Konzern", cx8Label: "Enterprise/Konzern", defaultSKategorie: "S2", active: true },
  { segment: "NT-7", legacyLabel: "Film/TV", cx8Label: null, defaultSKategorie: "S1", active: false },
  { segment: "NT-8", legacyLabel: "Privat", cx8Label: "Privatkunde", defaultSKategorie: "S3", active: true },
  { segment: "NT-9", legacyLabel: "Kleine Firma", cx8Label: "Direktbetrieb/KMU", defaultSKategorie: "S3", active: true },
  { segment: "NT-10", legacyLabel: "Behörde/öffentliche Hand", cx8Label: "Institution/öffentliche Hand", defaultSKategorie: "S4", active: true },
  { segment: "NT-11", legacyLabel: "Architekt/Innenarchitektur", cx8Label: null, defaultSKategorie: "S2", active: false },
  { segment: "NT-12", legacyLabel: "Creator/Influencer", cx8Label: null, defaultSKategorie: "S3", active: false },
  { segment: "NT-13", legacyLabel: "Praxen/Medical", cx8Label: null, defaultSKategorie: "S4", active: false },
  { segment: "NT-14", legacyLabel: "Immobilien", cx8Label: null, defaultSKategorie: "S2", active: false },
  { segment: "NT-15", legacyLabel: "Fitness", cx8Label: null, defaultSKategorie: "S3", active: false },
  { segment: "NT-16", legacyLabel: "Recruiting/Employer Branding", cx8Label: null, defaultSKategorie: "S2", active: false },
  { segment: "NT-17", legacyLabel: "Startup", cx8Label: null, defaultSKategorie: "S3", active: false },
  { segment: "NT-18", legacyLabel: "Luxus/Premium Retail", cx8Label: null, defaultSKategorie: "S4", active: false },
] as const;

export const CX8_TAXONOMY_VERSION = "nt_taxonomy_v2_20260819_cx8" as const;

export type KnownCustomerSegmentCode = (typeof CUSTOMER_SEGMENT_REGISTRY)[number]["segment"];
export type CustomerSegmentCode = Extract<(typeof CUSTOMER_SEGMENT_REGISTRY)[number], { active: true }>["segment"];
export type ActiveCustomerSegmentOption = Extract<(typeof CUSTOMER_SEGMENT_REGISTRY)[number], { active: true }>;

export const CUSTOMER_SEGMENT_OPTIONS = CUSTOMER_SEGMENT_REGISTRY
  .filter((option): option is ActiveCustomerSegmentOption => option.active)
  .map((option) => ({
    segment: option.segment,
    label: option.cx8Label,
    defaultSKategorie: option.defaultSKategorie,
    taxonomyVersion: CX8_TAXONOMY_VERSION,
  }));

export const MANUAL_REQUEST_SEGMENT_SOURCE_PATTERN = /^manual_[a-z0-9_]+$/;

export function isManualRequestSegmentSource(source: string | null | undefined) {
  return MANUAL_REQUEST_SEGMENT_SOURCE_PATTERN.test(String(source || "").trim().toLowerCase());
}

export function getKnownCustomerSegmentOption(segment: string | null | undefined) {
  const normalized = String(segment || "").trim().toUpperCase();
  return CUSTOMER_SEGMENT_REGISTRY.find((option) => option.segment === normalized) || null;
}

export function getCustomerSegmentOption(segment: string | null | undefined) {
  const normalized = String(segment || "").trim().toUpperCase();
  return CUSTOMER_SEGMENT_OPTIONS.find((option) => option.segment === normalized) || null;
}

export function isCx8TaxonomyVersion(taxonomyVersion: string | null | undefined) {
  return taxonomyVersion === CX8_TAXONOMY_VERSION;
}

export function isLegacyCustomerSegment(
  segment: string | null | undefined,
  taxonomyVersion: string | null | undefined,
) {
  return Boolean(String(segment || "").trim())
    && (!getCustomerSegmentOption(segment) || !isCx8TaxonomyVersion(taxonomyVersion));
}

export function isConfirmedCustomerSegmentAuthority(input: {
  segment?: string | null;
  status?: string | null;
  source?: string | null;
  taxonomyVersion?: string | null;
}) {
  if (!getCustomerSegmentOption(input.segment)) return false;
  if (!isCx8TaxonomyVersion(input.taxonomyVersion)) return false;
  if (String(input.status || "").trim().toLowerCase() !== "accepted") return false;
  return input.source === "request_segmenter" || isManualRequestSegmentSource(input.source);
}

export function formatCustomerSegmentLabel(
  segment: string | null | undefined,
  taxonomyVersion?: string | null,
) {
  const option = getKnownCustomerSegmentOption(segment);
  if (!option) return null;
  if (option.active && isCx8TaxonomyVersion(taxonomyVersion)) return option.cx8Label;
  return option.legacyLabel;
}
