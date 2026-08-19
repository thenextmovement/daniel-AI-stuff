export const CUSTOMER_SEGMENT_OPTIONS = [
  { segment: "NT-1", label: "Ladenbauer", defaultSKategorie: "S2" },
  { segment: "NT-2", label: "Gastronomie", defaultSKategorie: "S3" },
  { segment: "NT-3", label: "Event/Messe", defaultSKategorie: "S1" },
  { segment: "NT-4", label: "Werbeagentur", defaultSKategorie: "S2" },
  { segment: "NT-5", label: "Franchise", defaultSKategorie: "S2" },
  { segment: "NT-6", label: "Konzern", defaultSKategorie: "S2" },
  { segment: "NT-7", label: "Film/TV", defaultSKategorie: "S1" },
  { segment: "NT-8", label: "Privat", defaultSKategorie: "S3" },
  { segment: "NT-9", label: "Kleine Firma", defaultSKategorie: "S3" },
  { segment: "NT-10", label: "Behörde/öffentliche Hand", defaultSKategorie: "S4" },
  { segment: "NT-11", label: "Architekt/Innenarchitektur", defaultSKategorie: "S2" },
  { segment: "NT-12", label: "Creator/Influencer", defaultSKategorie: "S3" },
  { segment: "NT-13", label: "Praxen/Medical", defaultSKategorie: "S4" },
  { segment: "NT-14", label: "Immobilien", defaultSKategorie: "S2" },
  { segment: "NT-15", label: "Fitness", defaultSKategorie: "S3" },
  { segment: "NT-16", label: "Recruiting/Employer Branding", defaultSKategorie: "S2" },
  { segment: "NT-17", label: "Startup", defaultSKategorie: "S3" },
  { segment: "NT-18", label: "Luxus/Premium Retail", defaultSKategorie: "S4" },
] as const;

export type CustomerSegmentCode = (typeof CUSTOMER_SEGMENT_OPTIONS)[number]["segment"];

export const MANUAL_REQUEST_SEGMENT_SOURCE_PATTERN = /^manual_[a-z0-9_]+$/;

export function isManualRequestSegmentSource(source: string | null | undefined) {
  return MANUAL_REQUEST_SEGMENT_SOURCE_PATTERN.test(String(source || "").trim().toLowerCase());
}

export function getCustomerSegmentOption(segment: string | null | undefined) {
  const normalized = String(segment || "").trim().toUpperCase();
  return CUSTOMER_SEGMENT_OPTIONS.find((option) => option.segment === normalized) || null;
}

export function formatCustomerSegmentLabel(segment: string | null | undefined) {
  const option = getCustomerSegmentOption(segment);
  return option ? option.label : null;
}
