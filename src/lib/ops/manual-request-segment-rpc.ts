import { SupabaseRestError, supabaseRpc } from "@/lib/quotes/supabase-rest";
import {
  CX8_TAXONOMY_VERSION,
  getCustomerSegmentOption,
  isManualRequestSegmentSource,
  type CustomerSegmentCode,
} from "@/lib/ops/customer-segments";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MANUAL_SEGMENT_POLICY_VERSION = "manual_override_v1_20260819";
const SEGMENT_CONTEXT_TAGS = new Set([
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
]);
const ORGANIZATION_SCALES = new Set(["solo", "micro", "small", "medium", "large", "enterprise"]);

export type ManualRequestSegmentRpcResult = {
  request_id: string;
  public_request_id: string;
  segment: CustomerSegmentCode;
  s_kategorie: string;
  segment_status: "accepted";
  segment_confidence: null;
  segment_source: string;
  segment_classified_at: string;
  segment_policy_version: typeof MANUAL_SEGMENT_POLICY_VERSION;
  segment_taxonomy_version: typeof CX8_TAXONOMY_VERSION;
  context_tags: string[];
  organization_scale: "solo" | "micro" | "small" | "medium" | "large" | "enterprise" | null;
  authoritative: true;
  gold_label_created: false;
  audit_id: string;
};

type ManualRequestSegmentRpcInput = {
  requestId: string;
  segment: CustomerSegmentCode;
  source: string;
  actor?: Record<string, unknown>;
  reason?: string | null;
};

function rpcContractError(result: unknown): never {
  throw new SupabaseRestError(
    "Manueller Segment-Override lieferte keinen gueltigen autoritativen DB-Vertrag.",
    502,
    result,
  );
}

export function validateManualRequestSegmentRpcResult(
  result: unknown,
  expected: Pick<ManualRequestSegmentRpcInput, "requestId" | "segment" | "source">,
): ManualRequestSegmentRpcResult {
  if (!result || typeof result !== "object" || Array.isArray(result)) rpcContractError(result);
  const row = result as Record<string, unknown>;
  const option = getCustomerSegmentOption(expected.segment);
  const classifiedAt = String(row.segment_classified_at || "");
  const contextTags = row.context_tags;
  const organizationScale = row.organization_scale;
  const normalizedContextTags = Array.isArray(contextTags)
    ? [...new Set(contextTags)].sort((left, right) => String(left).localeCompare(String(right)))
    : [];

  if (
    !option
    || row.request_id !== expected.requestId
    || !UUID_PATTERN.test(String(row.request_id || ""))
    || !String(row.public_request_id || "").trim()
    || row.segment !== expected.segment
    || typeof row.s_kategorie !== "string"
    || !row.s_kategorie.trim()
    || row.segment_status !== "accepted"
    || row.segment_confidence !== null
    || row.segment_source !== expected.source
    || !isManualRequestSegmentSource(String(row.segment_source || ""))
    || row.segment_policy_version !== MANUAL_SEGMENT_POLICY_VERSION
    || row.segment_taxonomy_version !== CX8_TAXONOMY_VERSION
    || !Array.isArray(contextTags)
    || contextTags.some((tag) => typeof tag !== "string" || !SEGMENT_CONTEXT_TAGS.has(tag))
    || normalizedContextTags.length !== contextTags.length
    || normalizedContextTags.some((tag, index) => tag !== contextTags[index])
    || (organizationScale !== null && !ORGANIZATION_SCALES.has(String(organizationScale)))
    || row.authoritative !== true
    || row.gold_label_created !== false
    || !UUID_PATTERN.test(String(row.audit_id || ""))
    || !classifiedAt
    || !Number.isFinite(Date.parse(classifiedAt))
  ) {
    rpcContractError(result);
  }

  return row as ManualRequestSegmentRpcResult;
}

export async function setAuthoritativeManualRequestSegment(
  input: ManualRequestSegmentRpcInput,
): Promise<ManualRequestSegmentRpcResult> {
  if (!isManualRequestSegmentSource(input.source)) {
    throw new SupabaseRestError("Ungueltige manuelle Segment-Quelle.", 500, input.source);
  }

  const result = await supabaseRpc<unknown>("neontrip_set_manual_request_segment", {
    p_request_id: input.requestId,
    p_segment: input.segment,
    p_source: input.source,
    p_actor: {
      ...(input.actor || {}),
      segmentTaxonomyVersion: CX8_TAXONOMY_VERSION,
    },
    p_reason: input.reason || null,
  });

  return validateManualRequestSegmentRpcResult(result, input);
}
