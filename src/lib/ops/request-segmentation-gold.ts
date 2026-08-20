import {
  CUSTOMER_SEGMENT_OPTIONS,
  CX8_TAXONOMY_VERSION,
  getCustomerSegmentOption,
  type CustomerSegmentCode,
} from "@/lib/ops/customer-segments";
import {
  safeExternalSegmentationEvidenceUrl,
  safeSegmentationModelEvidenceLinks,
} from "@/lib/ops/request-segmentation-evidence-url";
import { SupabaseRestError, supabaseRequest, supabaseRpc } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROMPT_VERSION = "segment_prompt_v4_20260819_cx8";
const PILOT_CLASSIFIER_VERSION = "segment_classifier_v3_20260819_cx8";
const PILOT_QUALITY_GATE_VERSION = "nt_quality_gate_v2_20260819_cx8";
const REQUIRED_RESEARCH_CLASSIFIER_VERSION = "segment_classifier_v4_20260820_cx8";
const REQUIRED_RESEARCH_QUALITY_GATE_VERSION = "nt_quality_gate_v3_20260820_cx8";
const SUPPORTED_EVALUATION_CONTRACTS = [
  {
    classifierVersion: PILOT_CLASSIFIER_VERSION,
    promptVersion: PROMPT_VERSION,
    qualityGateVersion: PILOT_QUALITY_GATE_VERSION,
  },
  {
    classifierVersion: REQUIRED_RESEARCH_CLASSIFIER_VERSION,
    promptVersion: PROMPT_VERSION,
    qualityGateVersion: REQUIRED_RESEARCH_QUALITY_GATE_VERSION,
  },
] as const;
type SupportedEvaluationContract = (typeof SUPPORTED_EVALUATION_CONTRACTS)[number];
const LABELING_VERSION = "gold_labeling_v2_20260819_cx8";
const PILOT_COHORT_CUTOFF = "2026-08-20T08:15:00.000Z";
const PILOT_COHORT_SIZE = 4;
export const REQUEST_SEGMENTATION_GOLD_PILOT_VERSION = "gold_pilot_v1_20260820_cx8_four_case";
const REVIEW_CONTEXT_KEYS = [
  "classifier_version",
  "current_gold_adjudication",
  "current_input_hash",
  "gold_eligibility",
  "latest_classification",
  "prompt_version",
  "public_request_id",
  "quality_gate_version",
  "request_id",
  "taxonomy_version",
];
const GOLD_ELIGIBILITY_KEYS = [
  "non_nt8_requires_external_evidence_url",
  "normalized_customer_type",
  "nt5_requires_nonnull_organization_scale",
  "nt6_required_organization_scale",
  "nt8_first_party_eligible",
  "nt8_requires_null_organization_scale",
  "nt9_first_party_eligible",
];
const LATEST_CLASSIFICATION_KEYS = [
  "classification_id",
  "classified_at",
  "confidence",
  "context_tags",
  "evidence_grade",
  "evidence_json",
  "evidence_provenance_valid",
  "input_hash",
  "input_hash_current",
  "mapping_integrity",
  "organization_scale",
  "proposed_segment",
  "reason_codes",
  "reasoning_short",
  "risk_flags",
  "s_kategorie",
  "status",
];
const CURRENT_GOLD_KEYS = [
  "context_tags",
  "created_at",
  "gold_adjudication_id",
  "input_hash",
  "labeled_s_kategorie",
  "labeled_segment",
  "labeling_version",
  "organization_scale",
];
const ADJUDICATION_RESPONSE_KEYS = [
  "context_tags",
  "created",
  "evaluation_job_id",
  "gold_adjudication_id",
  "idempotent_retry",
  "input_hash",
  "labeled_s_kategorie",
  "labeled_segment",
  "labeling_version",
  "master_segment_mutated",
  "organization_scale",
  "request_id",
  "taxonomy_version",
];
const EVIDENCE_TYPES = new Set([
  "request",
  "customer_declared",
  "related_history",
  "web_search",
  "research_cache",
]);
const EVIDENCE_USES = new Set([
  "private_use",
  "company_identity",
  "segment_role",
  "organization_scale",
  "institution_status",
  "context_tag",
  "conflict",
]);
const EVIDENCE_CODES = new Set([
  "verified_public_or_institutional_entity",
  "verified_physical_project_supplier",
  "verified_client_project_intermediary",
  "verified_event_or_media_operator",
  "verified_multisite_or_franchise",
  "verified_enterprise",
  "explicit_private_use",
  "verified_direct_business",
]);

export const SEGMENT_CONTEXT_TAGS = [
  "gastronomy_hospitality",
  "film_tv",
  "architecture_interior",
  "creator_influencer",
  "healthcare",
  "real_estate",
  "fitness_wellness",
  "recruiting_employer_branding",
  "startup_tech",
  "luxury_premium_retail",
] as const;
export const SEGMENT_ORGANIZATION_SCALES = [
  "solo",
  "micro",
  "small",
  "medium",
  "large",
  "enterprise",
] as const;

export type SegmentContextTag = (typeof SEGMENT_CONTEXT_TAGS)[number];
export type SegmentOrganizationScale = (typeof SEGMENT_ORGANIZATION_SCALES)[number];

export type RequestSegmentationReviewContext = {
  masterRequestId: string;
  publicRequestId: string;
  currentInputHash: string;
  taxonomyVersion: typeof CX8_TAXONOMY_VERSION;
  classifierVersion: SupportedEvaluationContract["classifierVersion"];
  promptVersion: typeof PROMPT_VERSION;
  qualityGateVersion: SupportedEvaluationContract["qualityGateVersion"];
  goldEligibility: {
    normalizedCustomerType: "privat" | "gewerblich" | "b2b" | null;
    nt8FirstPartyEligible: boolean;
    nt9FirstPartyEligible: boolean;
    nt8RequiresNullOrganizationScale: true;
    nt5RequiresNonnullOrganizationScale: true;
    nt6RequiredOrganizationScale: "enterprise";
    nonNt8RequiresExternalEvidenceUrl: true;
  };
  latestClassification: {
    classificationId: string;
    inputHash: string;
    inputHashCurrent: boolean;
    status: string;
    proposedSegment: CustomerSegmentCode | null;
    sKategorie: string | null;
    confidence: number | null;
    evidenceGrade: string | null;
    reasoningShort: string | null;
    reasonCodes: string[];
    evidenceJson: Array<Record<string, unknown>>;
    riskFlags: string[];
    contextTags: SegmentContextTag[];
    organizationScale: SegmentOrganizationScale | null;
    evidenceProvenanceValid: boolean;
    mappingIntegrity: boolean;
    classifiedAt: string;
  } | null;
  currentGoldAdjudication: {
    goldAdjudicationId: string;
    inputHash: string;
    labeledSegment: CustomerSegmentCode;
    labeledSKategorie: string;
    contextTags: SegmentContextTag[];
    organizationScale: SegmentOrganizationScale | null;
    labelingVersion: typeof LABELING_VERSION;
    createdAt: string;
  } | null;
};

export type RequestSegmentationBlindFacts = {
  requestId: string;
  contactName: string | null;
  company: string | null;
  email: string | null;
  emailDomain: string | null;
  customerType: "privat" | "gewerblich" | "b2b" | null;
  title: string | null;
  description: string | null;
  application: string | null;
  requestedSize: string | null;
  colors: string[];
  deliveryTime: string | null;
  country: string | null;
};

export type RequestSegmentationBlindReviewContext = RequestSegmentationReviewContext & {
  blindReviewFacts: RequestSegmentationBlindFacts;
};

type RequestSegmentationModelComparison = NonNullable<RequestSegmentationReviewContext["latestClassification"]>;

export type RequestSegmentationBlindReviewPayload = {
  currentInputHash: RequestSegmentationReviewContext["currentInputHash"];
  goldEligibility: RequestSegmentationReviewContext["goldEligibility"];
  latestClassification: (Omit<RequestSegmentationModelComparison, "evidenceJson"> & {
    evidenceLinks: ReturnType<typeof safeSegmentationModelEvidenceLinks>;
  }) | null;
  currentGoldAdjudication: RequestSegmentationReviewContext["currentGoldAdjudication"];
  blindReviewFacts: RequestSegmentationBlindFacts;
  goldLabelOptions: Array<{ code: CustomerSegmentCode; label: string }>;
};

export type RequestSegmentationGoldInput = {
  publicRequestId: string;
  inputHash: string;
  segment: string;
  contextTags?: string[] | null;
  organizationScale?: string | null;
  actor: string;
  reason: string;
  evidenceUrls?: string[] | null;
};

export type RequestSegmentationGoldResult = {
  goldAdjudicationId: string;
  masterRequestId: string;
  inputHash: string;
  taxonomyVersion: typeof CX8_TAXONOMY_VERSION;
  labelingVersion: typeof LABELING_VERSION;
  labeledSegment: CustomerSegmentCode;
  labeledSKategorie: string;
  contextTags: SegmentContextTag[];
  organizationScale: SegmentOrganizationScale | null;
  created: boolean;
  idempotentRetry: boolean;
  evaluationJobId: string | null;
  masterSegmentMutated: false;
};

export type RequestSegmentationGoldPilotNext = {
  requestId: string | null;
  position: number;
  total: typeof PILOT_COHORT_SIZE;
  complete: boolean;
};

export function redactRequestSegmentationModelUntilGold(
  context: RequestSegmentationReviewContext,
): RequestSegmentationReviewContext {
  return {
    ...context,
    latestClassification: context.currentGoldAdjudication
      && context.latestClassification?.inputHashCurrent === true
      ? context.latestClassification
      : null,
  };
}

export function toRequestSegmentationBlindReviewPayload(
  context: RequestSegmentationBlindReviewContext,
): RequestSegmentationBlindReviewPayload {
  const redacted = redactRequestSegmentationModelUntilGold(context);
  const latestClassification = redacted.latestClassification
    ? (() => {
      const { evidenceJson, ...comparison } = redacted.latestClassification;
      return {
        ...comparison,
        evidenceLinks: safeSegmentationModelEvidenceLinks(evidenceJson),
      };
    })()
    : null;
  return {
    currentInputHash: redacted.currentInputHash,
    goldEligibility: redacted.goldEligibility,
    latestClassification,
    currentGoldAdjudication: redacted.currentGoldAdjudication,
    blindReviewFacts: context.blindReviewFacts,
    goldLabelOptions: CUSTOMER_SEGMENT_OPTIONS.map(({ segment, label }) => ({
      code: segment,
      label,
    })),
  };
}

type MasterRequestIdentity = { id?: unknown; request_id?: unknown };
type PilotJobCandidateRow = { request_id?: unknown; created_at?: unknown };
type PilotGoldRow = { request_id?: unknown };
type BlindMasterRequestRow = {
  id?: unknown;
  request_id?: unknown;
  customer_id?: unknown;
  title?: unknown;
  description?: unknown;
  size?: unknown;
  color?: unknown;
  application?: unknown;
  delivery_time?: unknown;
  customer_type?: unknown;
  country?: unknown;
};
type BlindMasterCustomerRow = {
  id?: unknown;
  email?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  company?: unknown;
  company_name?: unknown;
  name?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function exactUuid(value: unknown) {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function optionalTrimmedString(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") blindReviewContractError();
  return value.trim() || null;
}

function normalizedBlindCustomerType(value: unknown) {
  const normalized = optionalTrimmedString(value)?.toLowerCase() || null;
  if (normalized === null || normalized === "privat" || normalized === "gewerblich" || normalized === "b2b") {
    return normalized;
  }
  return null;
}

function normalizedBlindColors(value: unknown) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    blindReviewContractError();
  }
  return [...new Set(value.map((entry) => entry.trim()).filter(Boolean))];
}

function emailDomain(value: string | null) {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  const separator = normalized.lastIndexOf("@");
  if (separator <= 0 || separator === normalized.length - 1) return null;
  const domain = normalized.slice(separator + 1);
  return domain.includes(" ") ? null : domain;
}

function finiteNumberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function evidenceArray(value: unknown): value is Array<Record<string, unknown>> {
  return Array.isArray(value) && value.every((entry) => {
    if (!isRecord(entry)) return false;
    if (
      !EVIDENCE_TYPES.has(String(entry.type || ""))
      || !EVIDENCE_USES.has(String(entry.used_for || ""))
      || !EVIDENCE_CODES.has(String(entry.evidence_code || ""))
      || !("url" in entry)
    ) return false;
    if (entry.url == null || entry.url === "") return true;
    if (typeof entry.url !== "string") return false;
    try {
      const parsed = new URL(entry.url);
      return parsed.protocol === "https:" || parsed.protocol === "http:";
    } catch {
      return false;
    }
  });
}

function canonicalContextTags(value: unknown): SegmentContextTag[] | null {
  if (!stringArray(value)) return null;
  const allowed = new Set<string>(SEGMENT_CONTEXT_TAGS);
  if (value.some((tag) => !allowed.has(tag))) return null;
  const normalized = [...new Set(value)].sort();
  if (normalized.length !== value.length || normalized.some((tag, index) => tag !== value[index])) return null;
  return normalized as SegmentContextTag[];
}

function goldInputError(message: string): never {
  throw new QuoteValidationError(message, [message], 422);
}

export function combineRequestSegmentationGoldActor(authenticatedActor: string, operatorName: string) {
  const authenticated = authenticatedActor.trim();
  const operator = operatorName.trim();
  if (!authenticated || operator.length < 3 || operator.length > 160) {
    goldInputError("Authentifizierte Ops-Identitaet und Bearbeitername sind fuer Gold erforderlich.");
  }
  const combined = `${authenticated}:${operator}`;
  if (combined.length > 320) {
    goldInputError("Authentifizierte Ops-Identitaet und Bearbeitername duerfen zusammen maximal 320 Zeichen lang sein.");
  }
  return combined;
}

function normalizeContextTags(value: string[] | null | undefined) {
  const normalized = [...new Set((value || []).map((tag) => tag.trim()).filter(Boolean))].sort();
  if (normalized.length > 10) goldInputError("Maximal 10 Kontext-Tags sind fuer Gold zulaessig.");
  if (normalized.some((tag) => tag.length > 80)) goldInputError("Ein Kontext-Tag darf maximal 80 Zeichen lang sein.");
  const allowed = new Set<string>(SEGMENT_CONTEXT_TAGS);
  if (normalized.some((tag) => !allowed.has(tag))) {
    goldInputError("Ungueltiger Kontext-Tag fuer die Gold-Adjudication.");
  }
  return normalized as SegmentContextTag[];
}

function normalizedOrganizationScale(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  if (!(SEGMENT_ORGANIZATION_SCALES as readonly string[]).includes(normalized)) {
    goldInputError("Ungueltige Organisationsgroesse fuer die Gold-Adjudication.");
  }
  return normalized as SegmentOrganizationScale;
}

function normalizeEvidenceUrls(value: string[] | null | undefined) {
  const candidates = [...new Set((value || []).map((url) => url.trim()).filter(Boolean))].sort();
  if (candidates.length > 12) goldInputError("Maximal 12 Evidence-URLs sind fuer Gold zulaessig.");
  const normalized: string[] = [];
  for (const entry of candidates) {
    if (entry.length > 2048) goldInputError("Eine Evidence-URL darf maximal 2048 Zeichen lang sein.");
    const safeUrl = safeExternalSegmentationEvidenceUrl(entry);
    if (!safeUrl) goldInputError("Evidence-URLs muessen externe HTTP- oder HTTPS-Links ohne Zugangsdaten sein.");
    normalized.push(safeUrl);
  }
  return [...new Set(normalized)].sort();
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validOrganizationScale(value: unknown): value is SegmentOrganizationScale | null {
  return value === null || (
    typeof value === "string"
    && (SEGMENT_ORGANIZATION_SCALES as readonly string[]).includes(value)
  );
}

function reviewContractError(result: unknown): never {
  throw new SupabaseRestError(
    "Der DB-Review-Kontext entspricht nicht dem erwarteten CX8-Vertrag.",
    502,
    result,
  );
}

function pilotContractError(message: string, details?: unknown): never {
  throw new SupabaseRestError(message, 503, details);
}

export async function getRequestSegmentationGoldPilotNext(): Promise<RequestSegmentationGoldPilotNext> {
  // Classification upserts refresh created_at. Job re-enqueues preserve created_at,
  // so the cutoff fixes this one-time cohort across Gold re-evaluations.
  const jobRows = await supabaseRequest<PilotJobCandidateRow[]>(
    "request_segmentation_jobs",
    undefined,
    {
      select: "request_id,created_at",
      taxonomy_version: `eq.${CX8_TAXONOMY_VERSION}`,
      classifier_version: `eq.${PILOT_CLASSIFIER_VERSION}`,
      prompt_version: `eq.${PROMPT_VERSION}`,
      created_at: `lte.${PILOT_COHORT_CUTOFF}`,
      order: "created_at.asc,request_id.asc",
      limit: 100,
    },
  );
  if (!Array.isArray(jobRows)) {
    pilotContractError("Die blinde Pilot-Kohorte entspricht nicht dem erwarteten Vertrag.");
  }
  const orderedCandidates = jobRows.map((row) => {
    if (!isRecord(row) || !hasExactKeys(row, ["created_at", "request_id"])) {
      pilotContractError("Die blinde Pilot-Kohorte entspricht nicht dem erwarteten Vertrag.");
    }
    const requestId = exactUuid(row.request_id);
    if (
      !requestId
      || !validTimestamp(row.created_at)
      || Date.parse(String(row.created_at)) > Date.parse(PILOT_COHORT_CUTOFF)
    ) {
      pilotContractError("Die blinde Pilot-Kohorte entspricht nicht dem erwarteten Vertrag.");
    }
    return { requestId, createdAt: String(row.created_at) };
  }).sort((left, right) => (
    Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.requestId.localeCompare(right.requestId)
  ));
  const cohortIds = [...new Set(orderedCandidates.map((candidate) => candidate.requestId))]
    .slice(0, PILOT_COHORT_SIZE);
  if (cohortIds.length !== PILOT_COHORT_SIZE) {
    pilotContractError("Der blinde Vier-Fall-Pilot ist noch nicht vollstaendig verfuegbar.", {
      code: "gold_pilot_cohort_not_ready",
      available: cohortIds.length,
    });
  }

  const cohortFilter = `in.(${cohortIds.join(",")})`;
  const [goldRows, identityRows] = await Promise.all([
    supabaseRequest<PilotGoldRow[]>("request_segmentation_gold_adjudications", undefined, {
      select: "request_id",
      taxonomy_version: `eq.${CX8_TAXONOMY_VERSION}`,
      labeling_version: `eq.${LABELING_VERSION}`,
      request_id: cohortFilter,
      limit: PILOT_COHORT_SIZE,
    }),
    supabaseRequest<MasterRequestIdentity[]>("master_requests", undefined, {
      select: "id,request_id",
      id: cohortFilter,
      limit: PILOT_COHORT_SIZE,
    }),
  ]);
  if (!Array.isArray(goldRows) || !Array.isArray(identityRows)) {
    pilotContractError("Der blinde Pilot konnte nicht eindeutig aufgeloest werden.");
  }

  const completedIds = new Set(goldRows.map((row) => {
    if (!isRecord(row) || !hasExactKeys(row, ["request_id"])) {
      pilotContractError("Der Gold-Fortschritt des blinden Piloten ist ungueltig.");
    }
    const requestId = exactUuid(row.request_id);
    if (!requestId || !cohortIds.includes(requestId)) {
      pilotContractError("Der Gold-Fortschritt des blinden Piloten ist ungueltig.");
    }
    return requestId;
  }));
  if (completedIds.size !== goldRows.length) {
    pilotContractError("Der Gold-Fortschritt des blinden Piloten ist nicht eindeutig.");
  }

  const publicRequestIds = new Map<string, string>();
  for (const row of identityRows) {
    if (!isRecord(row) || !hasExactKeys(row, ["id", "request_id"])) {
      pilotContractError("Die Request-Aufloesung des blinden Piloten ist ungueltig.");
    }
    const masterRequestId = exactUuid(row.id);
    const publicRequestId = nonEmptyString(row.request_id);
    if (
      !masterRequestId
      || !cohortIds.includes(masterRequestId)
      || !publicRequestId
      || publicRequestId.length > 300
    ) {
      pilotContractError("Die Request-Aufloesung des blinden Piloten ist ungueltig.");
    }
    publicRequestIds.set(masterRequestId, publicRequestId);
  }
  if (
    publicRequestIds.size !== PILOT_COHORT_SIZE
    || new Set(publicRequestIds.values()).size !== PILOT_COHORT_SIZE
  ) {
    pilotContractError("Die Request-Aufloesung des blinden Piloten ist nicht eindeutig.");
  }

  const nextIndex = cohortIds.findIndex((requestId) => !completedIds.has(requestId));
  if (nextIndex === -1) {
    return { requestId: null, position: PILOT_COHORT_SIZE, total: PILOT_COHORT_SIZE, complete: true };
  }
  return {
    requestId: publicRequestIds.get(cohortIds[nextIndex])!,
    position: nextIndex + 1,
    total: PILOT_COHORT_SIZE,
    complete: false,
  };
}

export async function assertCurrentRequestSegmentationGoldPilotCandidate(publicRequestId: string) {
  const normalized = publicRequestId.trim();
  if (!normalized || normalized.length > 300) {
    throw new QuoteValidationError("pilot_candidate_not_current", [], 409);
  }
  const pilot = await getRequestSegmentationGoldPilotNext();
  if (pilot.complete || pilot.requestId !== normalized) {
    throw new QuoteValidationError("pilot_candidate_not_current", [], 409);
  }
}

async function resolveMasterRequestIdentity(publicRequestId: string) {
  const normalized = publicRequestId.trim();
  if (!normalized || normalized.length > 300) {
    throw new QuoteValidationError("Gueltige Anfrage-ID fuer Segment-Review erforderlich.");
  }
  const rows = await supabaseRequest<MasterRequestIdentity[]>("master_requests", undefined, {
    select: "id,request_id",
    request_id: `eq.${normalized}`,
    limit: 2,
  });
  if (!rows.length) {
    throw new QuoteValidationError("Anfrage fuer Segment-Review nicht gefunden.", [], 404);
  }
  if (rows.length !== 1) {
    throw new QuoteValidationError("Anfrage-ID ist fuer Segment-Review nicht eindeutig.", [], 409);
  }
  const masterRequestId = exactUuid(rows[0]?.id);
  const resolvedPublicRequestId = nonEmptyString(rows[0]?.request_id);
  if (!masterRequestId || resolvedPublicRequestId !== normalized) reviewContractError(rows[0]);
  return { masterRequestId, publicRequestId: resolvedPublicRequestId };
}

function blindReviewContractError(): never {
  throw new SupabaseRestError(
    "Die kuratierten Fakten fuer das blinde Gold-Review entsprechen nicht dem erwarteten DB-Vertrag.",
    502,
    { code: "blind_review_contract_invalid" },
  );
}

async function loadRequestSegmentationBlindFacts(
  identity: { masterRequestId: string; publicRequestId: string },
  expectedCustomerType: RequestSegmentationReviewContext["goldEligibility"]["normalizedCustomerType"],
) {
  const requestRows = await supabaseRequest<BlindMasterRequestRow[]>("master_requests", undefined, {
    select: "id,request_id,customer_id,title,description,size,color,application,delivery_time,customer_type,country",
    id: `eq.${identity.masterRequestId}`,
    limit: 2,
  });
  if (requestRows.length !== 1) blindReviewContractError();
  const requestRow = requestRows[0];
  const customerId = exactUuid(requestRow?.customer_id);
  if (
    exactUuid(requestRow?.id) !== identity.masterRequestId
    || nonEmptyString(requestRow?.request_id) !== identity.publicRequestId
    || !customerId
  ) blindReviewContractError();

  const customerRows = await supabaseRequest<BlindMasterCustomerRow[]>("master_customers", undefined, {
    select: "id,email,first_name,last_name,company,company_name,name",
    id: `eq.${customerId}`,
    limit: 2,
  });
  if (customerRows.length !== 1) blindReviewContractError();
  const customerRow = customerRows[0];
  if (exactUuid(customerRow?.id) !== customerId) blindReviewContractError();

  const firstName = optionalTrimmedString(customerRow.first_name);
  const lastName = optionalTrimmedString(customerRow.last_name);
  const fallbackName = optionalTrimmedString(customerRow.name);
  const email = optionalTrimmedString(customerRow.email);
  const customerType = normalizedBlindCustomerType(requestRow.customer_type);
  if (customerType !== expectedCustomerType) blindReviewContractError();

  return {
    requestId: identity.publicRequestId,
    contactName: [firstName, lastName].filter(Boolean).join(" ") || fallbackName,
    company: optionalTrimmedString(customerRow.company)
      || optionalTrimmedString(customerRow.company_name),
    email,
    emailDomain: emailDomain(email),
    customerType,
    title: optionalTrimmedString(requestRow.title),
    description: optionalTrimmedString(requestRow.description),
    application: optionalTrimmedString(requestRow.application),
    requestedSize: optionalTrimmedString(requestRow.size),
    colors: normalizedBlindColors(requestRow.color),
    deliveryTime: optionalTrimmedString(requestRow.delivery_time),
    country: optionalTrimmedString(requestRow.country),
  } satisfies RequestSegmentationBlindFacts;
}

export function validateRequestSegmentationReviewContext(
  result: unknown,
  expected: { masterRequestId: string; publicRequestId: string },
): RequestSegmentationReviewContext {
  if (!isRecord(result)) reviewContractError(result);
  if ("payload_error" in result) {
    const payloadError = result.payload_error;
    if (
      !hasExactKeys(result, ["payload_error", "request_id"])
      || exactUuid(result.request_id) !== expected.masterRequestId
      || !isRecord(payloadError)
      || !hasExactKeys(payloadError, ["code", "message"])
      || typeof payloadError.code !== "string"
      || typeof payloadError.message !== "string"
    ) {
      reviewContractError(result);
    }
    throw new SupabaseRestError(payloadError.message, payloadError.code === "request_not_found" ? 404 : 503, payloadError);
  }
  if (!hasExactKeys(result, REVIEW_CONTEXT_KEYS)) reviewContractError(result);

  const latest = result.latest_classification;
  const currentGold = result.current_gold_adjudication;
  const goldEligibility = result.gold_eligibility;
  const currentInputHash = nonEmptyString(result.current_input_hash);
  const evaluationContract = SUPPORTED_EVALUATION_CONTRACTS.find((contract) => (
    result.classifier_version === contract.classifierVersion
    && result.prompt_version === contract.promptVersion
    && result.quality_gate_version === contract.qualityGateVersion
  ));
  if (
    exactUuid(result.request_id) !== expected.masterRequestId
    || result.public_request_id !== expected.publicRequestId
    || !currentInputHash
    || result.taxonomy_version !== CX8_TAXONOMY_VERSION
    || !evaluationContract
    || !isRecord(goldEligibility)
    || !hasExactKeys(goldEligibility, GOLD_ELIGIBILITY_KEYS)
    || !(
      goldEligibility.normalized_customer_type === null
      || goldEligibility.normalized_customer_type === "privat"
      || goldEligibility.normalized_customer_type === "gewerblich"
      || goldEligibility.normalized_customer_type === "b2b"
    )
    || typeof goldEligibility.nt8_first_party_eligible !== "boolean"
    || goldEligibility.nt8_first_party_eligible !== (goldEligibility.normalized_customer_type === "privat")
    || typeof goldEligibility.nt9_first_party_eligible !== "boolean"
    || goldEligibility.nt9_first_party_eligible !== (
      goldEligibility.normalized_customer_type === "gewerblich"
      || goldEligibility.normalized_customer_type === "b2b"
    )
    || goldEligibility.nt8_requires_null_organization_scale !== true
    || goldEligibility.nt5_requires_nonnull_organization_scale !== true
    || goldEligibility.nt6_required_organization_scale !== "enterprise"
    || goldEligibility.non_nt8_requires_external_evidence_url !== true
  ) reviewContractError(result);

  let latestClassification: RequestSegmentationReviewContext["latestClassification"] = null;
  if (latest !== null) {
    if (!isRecord(latest) || !hasExactKeys(latest, LATEST_CLASSIFICATION_KEYS)) reviewContractError(result);
    const proposedOption = latest.proposed_segment === null ? null : getCustomerSegmentOption(String(latest.proposed_segment));
    const contextTags = canonicalContextTags(latest.context_tags);
    if (
      !exactUuid(latest.classification_id)
      || !nonEmptyString(latest.input_hash)
      || typeof latest.input_hash_current !== "boolean"
      || latest.input_hash_current !== (latest.input_hash === currentInputHash)
      || !nonEmptyString(latest.status)
      || (latest.proposed_segment !== null && !proposedOption)
      || (latest.s_kategorie !== null && (typeof latest.s_kategorie !== "string" || !/^S[1-4]$/.test(latest.s_kategorie)))
      || !finiteNumberOrNull(latest.confidence)
      || (latest.confidence !== null && (latest.confidence < 0 || latest.confidence > 1))
      || (latest.evidence_grade !== null && typeof latest.evidence_grade !== "string")
      || (latest.reasoning_short !== null && typeof latest.reasoning_short !== "string")
      || !stringArray(latest.reason_codes)
      || !evidenceArray(latest.evidence_json)
      || !stringArray(latest.risk_flags)
      || !contextTags
      || !validOrganizationScale(latest.organization_scale)
      || typeof latest.evidence_provenance_valid !== "boolean"
      || typeof latest.mapping_integrity !== "boolean"
      || !validTimestamp(latest.classified_at)
    ) reviewContractError(result);
    latestClassification = {
      classificationId: exactUuid(latest.classification_id)!,
      inputHash: String(latest.input_hash),
      inputHashCurrent: latest.input_hash_current,
      status: String(latest.status),
      proposedSegment: proposedOption?.segment || null,
      sKategorie: latest.s_kategorie as string | null,
      confidence: latest.confidence as number | null,
      evidenceGrade: latest.evidence_grade as string | null,
      reasoningShort: latest.reasoning_short as string | null,
      reasonCodes: latest.reason_codes as string[],
      evidenceJson: latest.evidence_json,
      riskFlags: latest.risk_flags as string[],
      contextTags,
      organizationScale: latest.organization_scale as SegmentOrganizationScale | null,
      evidenceProvenanceValid: latest.evidence_provenance_valid,
      mappingIntegrity: latest.mapping_integrity,
      classifiedAt: latest.classified_at,
    };
  }

  let currentGoldAdjudication: RequestSegmentationReviewContext["currentGoldAdjudication"] = null;
  if (currentGold !== null) {
    if (!isRecord(currentGold) || !hasExactKeys(currentGold, CURRENT_GOLD_KEYS)) reviewContractError(result);
    const labeledOption = getCustomerSegmentOption(String(currentGold.labeled_segment || ""));
    const contextTags = canonicalContextTags(currentGold.context_tags);
    if (
      !exactUuid(currentGold.gold_adjudication_id)
      || currentGold.input_hash !== currentInputHash
      || !labeledOption
      || currentGold.labeled_s_kategorie !== labeledOption.defaultSKategorie
      || !contextTags
      || !validOrganizationScale(currentGold.organization_scale)
      || currentGold.labeling_version !== LABELING_VERSION
      || !validTimestamp(currentGold.created_at)
    ) reviewContractError(result);
    currentGoldAdjudication = {
      goldAdjudicationId: exactUuid(currentGold.gold_adjudication_id)!,
      inputHash: String(currentGold.input_hash),
      labeledSegment: labeledOption.segment,
      labeledSKategorie: String(currentGold.labeled_s_kategorie),
      contextTags,
      organizationScale: currentGold.organization_scale as SegmentOrganizationScale | null,
      labelingVersion: LABELING_VERSION,
      createdAt: currentGold.created_at,
    };
  }

  return {
    masterRequestId: expected.masterRequestId,
    publicRequestId: expected.publicRequestId,
    currentInputHash,
    taxonomyVersion: CX8_TAXONOMY_VERSION,
    classifierVersion: evaluationContract.classifierVersion,
    promptVersion: evaluationContract.promptVersion,
    qualityGateVersion: evaluationContract.qualityGateVersion,
    goldEligibility: {
      normalizedCustomerType: goldEligibility.normalized_customer_type,
      nt8FirstPartyEligible: goldEligibility.nt8_first_party_eligible,
      nt9FirstPartyEligible: goldEligibility.nt9_first_party_eligible,
      nt8RequiresNullOrganizationScale: true,
      nt5RequiresNonnullOrganizationScale: true,
      nt6RequiredOrganizationScale: "enterprise",
      nonNt8RequiresExternalEvidenceUrl: true,
    },
    latestClassification,
    currentGoldAdjudication,
  };
}

async function getRequestSegmentationReviewContextForIdentity(
  identity: { masterRequestId: string; publicRequestId: string },
) {
  const result = await supabaseRpc<unknown>("neontrip_get_request_segmentation_review_context", {
    p_request_id: identity.masterRequestId,
  });
  return validateRequestSegmentationReviewContext(result, identity);
}

export async function getRequestSegmentationReviewContext(publicRequestId: string) {
  const identity = await resolveMasterRequestIdentity(publicRequestId);
  return getRequestSegmentationReviewContextForIdentity(identity);
}

export async function getRequestSegmentationBlindReviewContext(publicRequestId: string) {
  const identity = await resolveMasterRequestIdentity(publicRequestId);
  const contextBeforeFacts = await getRequestSegmentationReviewContextForIdentity(identity);
  const blindReviewFacts = await loadRequestSegmentationBlindFacts(
    identity,
    contextBeforeFacts.goldEligibility.normalizedCustomerType,
  );
  const contextAfterFacts = await getRequestSegmentationReviewContextForIdentity(identity);
  if (contextBeforeFacts.currentInputHash !== contextAfterFacts.currentInputHash) {
    throw new QuoteValidationError(
      "Die Anfrage hat sich waehrend des blinden Reviews geaendert. Bitte Review neu laden.",
      ["Inkonsistente Fakten wurden nicht an den Browser ausgegeben."],
      409,
    );
  }
  if (blindReviewFacts.customerType !== contextAfterFacts.goldEligibility.normalizedCustomerType) {
    blindReviewContractError();
  }
  return {
    ...contextAfterFacts,
    blindReviewFacts,
  } satisfies RequestSegmentationBlindReviewContext;
}

function adjudicationContractError(result: unknown): never {
  throw new SupabaseRestError(
    "Die Gold-Adjudication lieferte keinen gueltigen unveraenderlichen DB-Vertrag.",
    502,
    result,
  );
}

export function validateRequestSegmentationGoldResult(
  result: unknown,
  expected: {
    masterRequestId: string;
    inputHash: string;
    segment: CustomerSegmentCode;
    contextTags: SegmentContextTag[];
    organizationScale: SegmentOrganizationScale | null;
  },
): RequestSegmentationGoldResult {
  if (!isRecord(result) || !hasExactKeys(result, ADJUDICATION_RESPONSE_KEYS)) adjudicationContractError(result);
  const option = getCustomerSegmentOption(expected.segment);
  const responseTags = canonicalContextTags(result.context_tags);
  const evaluationJobId = result.evaluation_job_id === null ? null : exactUuid(result.evaluation_job_id);
  if (
    !option
    || !exactUuid(result.gold_adjudication_id)
    || exactUuid(result.request_id) !== expected.masterRequestId
    || result.input_hash !== expected.inputHash
    || result.taxonomy_version !== CX8_TAXONOMY_VERSION
    || result.labeling_version !== LABELING_VERSION
    || result.labeled_segment !== expected.segment
    || result.labeled_s_kategorie !== option.defaultSKategorie
    || !responseTags
    || responseTags.length !== expected.contextTags.length
    || responseTags.some((tag, index) => tag !== expected.contextTags[index])
    || result.organization_scale !== expected.organizationScale
    || typeof result.created !== "boolean"
    || typeof result.idempotent_retry !== "boolean"
    || result.created === result.idempotent_retry
    || (result.evaluation_job_id !== null && !evaluationJobId)
    || result.master_segment_mutated !== false
  ) adjudicationContractError(result);
  return {
    goldAdjudicationId: exactUuid(result.gold_adjudication_id)!,
    masterRequestId: expected.masterRequestId,
    inputHash: expected.inputHash,
    taxonomyVersion: CX8_TAXONOMY_VERSION,
    labelingVersion: LABELING_VERSION,
    labeledSegment: expected.segment,
    labeledSKategorie: option.defaultSKategorie,
    contextTags: responseTags,
    organizationScale: expected.organizationScale,
    created: result.created,
    idempotentRetry: result.idempotent_retry,
    evaluationJobId,
    masterSegmentMutated: false,
  };
}

export async function adjudicateRequestSegmentationGold(input: RequestSegmentationGoldInput) {
  const segment = input.segment.trim().toUpperCase();
  const option = getCustomerSegmentOption(segment);
  const inputHash = input.inputHash.trim();
  const actor = input.actor.trim();
  const reason = input.reason.trim();
  const contextTags = normalizeContextTags(input.contextTags);
  const organizationScale = normalizedOrganizationScale(input.organizationScale);
  const evidenceUrls = normalizeEvidenceUrls(input.evidenceUrls);
  if (!option) goldInputError("Nur aktive CX8-Segmente duerfen als Gold bestaetigt werden.");
  if (!inputHash) goldInputError("Aktueller Input-Hash fuer die Gold-Adjudication fehlt.");
  if (actor.length < 3) goldInputError("Bearbeiter fuer die Gold-Adjudication fehlt.");
  if (actor.length > 320) goldInputError("Bearbeiter darf maximal 320 Zeichen lang sein.");
  if (reason.length < 20) goldInputError("Begruendung fuer Gold muss mindestens 20 Zeichen lang sein.");
  if (reason.length > 4000) goldInputError("Begruendung fuer Gold darf maximal 4000 Zeichen lang sein.");
  if (option.segment === "NT-8" && organizationScale !== null) {
    goldInputError("NT-8 Gold erfordert eine leere Organisationsgroesse.");
  }
  if (option.segment === "NT-5" && organizationScale === null) {
    goldInputError("NT-5 Gold erfordert eine gepruefte Organisationsgroesse.");
  }
  if (option.segment === "NT-6" && organizationScale !== "enterprise") {
    goldInputError("NT-6 Gold erfordert exakt die Organisationsgroesse Enterprise.");
  }
  if (option.segment !== "NT-8" && !evidenceUrls.length) {
    goldInputError("Fuer Business-Gold ist mindestens eine gueltige Evidence-URL erforderlich.");
  }

  const reviewContext = await getRequestSegmentationReviewContext(input.publicRequestId);
  if (reviewContext.currentInputHash !== inputHash) {
    throw new QuoteValidationError(
      "Die Anfrage hat sich seit dem Laden des Reviews geaendert. Bitte Review neu laden.",
      ["Stale Input-Hash: Es wurde kein Gold geschrieben."],
      409,
    );
  }
  try {
    const result = await supabaseRpc<unknown>("neontrip_adjudicate_request_segmentation_gold", {
      p_request_id: reviewContext.masterRequestId,
      p_input_hash: inputHash,
      p_taxonomy_version: CX8_TAXONOMY_VERSION,
      p_segment: option.segment,
      p_context_tags: contextTags,
      p_organization_scale: organizationScale,
      p_adjudicated_by: actor,
      p_adjudication_reason: reason,
      p_evidence_urls: evidenceUrls,
    });
    return validateRequestSegmentationGoldResult(result, {
      masterRequestId: reviewContext.masterRequestId,
      inputHash,
      segment: option.segment,
      contextTags,
      organizationScale,
    });
  } catch (error) {
    if (error instanceof SupabaseRestError) {
      const details = String(error.details || "");
      if (details.includes("gold_input_hash_not_current")) {
        throw new QuoteValidationError("Die Anfrage wurde parallel geaendert. Bitte Review neu laden.", [], 409);
      }
      if (details.includes("gold_adjudication_conflict_requires_explicit_superseding_revision")) {
        throw new QuoteValidationError("Fuer diesen Input existiert bereits abweichendes, unveraenderliches Gold.", [], 409);
      }
      if (details.includes("gold_private_organization_scale_must_be_null")) {
        throw new QuoteValidationError("NT-8 Gold erfordert eine leere Organisationsgroesse.", [], 409);
      }
      if (details.includes("gold_multisite_organization_scale_required")) {
        throw new QuoteValidationError("NT-5 Gold erfordert eine gepruefte Organisationsgroesse.", [], 409);
      }
      if (details.includes("gold_enterprise_scale_required")) {
        throw new QuoteValidationError("NT-6 Gold erfordert exakt die Organisationsgroesse Enterprise.", [], 409);
      }
    }
    throw error;
  }
}
