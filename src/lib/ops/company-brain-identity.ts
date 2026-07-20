import { createHash } from "node:crypto";
import type {
  CompanyBrainIdentifier,
  CompanyBrainResolveResult,
} from "@/lib/ops/company-brain";
import { supabaseRequest } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

export type CompanyBrainCanonicalCase = {
  status: "matched" | "ambiguous" | "unmatched";
  entityId: string | null;
  canonicalKey: string | null;
  requestId: string | null;
  confidence: number | null;
  resolverVersion: string;
  aliasesCreated: number;
  reviewId: string | null;
  summary: string;
};

export type CompanyIdentityReviewItem = {
  id: string;
  status: "open" | "confirmed" | "rejected" | "superseded";
  sourceKey: string;
  aliasType: string;
  candidateEntityIds: string[];
  proposedEntityId: string | null;
  confidence: number | null;
  reasonCode: string;
  summary: string;
  evidenceRefs: unknown[];
  proposedResolution: Record<string, unknown>;
  correlationId: string | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

type EntityRow = {
  id: string;
  entity_type: string;
  canonical_key: string;
  display_label?: string | null;
};

type AliasRow = {
  id: string;
  entity_id: string;
  source_key: string;
  alias_type: string;
  alias_value: string;
  confidence: number | string;
};

type TrelloProjectionAliasRow = {
  id: string;
  request_id: string;
  alias_trello_card_id: string;
  alias_trello_card_url?: string | null;
  canonical_trello_card_id?: string | null;
};

type ReviewRow = {
  id: string;
  status: CompanyIdentityReviewItem["status"];
  source_key: string;
  alias_type: string;
  candidate_entity_ids?: string[] | null;
  proposed_entity_id?: string | null;
  confidence?: number | string | null;
  reason_code: string;
  summary: string;
  evidence_refs?: unknown;
  proposed_resolution?: Record<string, unknown> | null;
  correlation_id?: string | null;
  reviewed_by?: string | null;
  review_note?: string | null;
  reviewed_at?: string | null;
  created_at: string;
};

const RESOLVER_VERSION = "company-case-v1";

function cleanText(value: unknown, maxLength = 1000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, maxLength);
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => cleanText(value)).filter(Boolean))];
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function mapReview(row: ReviewRow): CompanyIdentityReviewItem {
  return {
    id: row.id,
    status: row.status,
    sourceKey: row.source_key,
    aliasType: row.alias_type,
    candidateEntityIds: row.candidate_entity_ids || [],
    proposedEntityId: row.proposed_entity_id || null,
    confidence: row.confidence == null ? null : Number(row.confidence),
    reasonCode: row.reason_code,
    summary: row.summary,
    evidenceRefs: Array.isArray(row.evidence_refs) ? row.evidence_refs : [],
    proposedResolution: row.proposed_resolution || {},
    correlationId: row.correlation_id || null,
    reviewedBy: row.reviewed_by || null,
    reviewNote: row.review_note || null,
    reviewedAt: row.reviewed_at || null,
    createdAt: row.created_at,
  };
}

function identifierSource(identifier: CompanyBrainIdentifier) {
  if (identifier.type === "trello_card_id") return "trello";
  if (identifier.type === "offer_id" || identifier.type === "offer_number") return "offers";
  if (identifier.type === "shopify_order") return "shopify";
  return "supabase";
}

function deterministicAliases(result: CompanyBrainResolveResult, requestId: string): Array<{
  sourceKey: string;
  aliasType: string;
  aliasValue: string;
  confidence: number;
  sourceRef: string | null;
}> {
  const aliases: Array<{
    sourceKey: string;
    aliasType: string;
    aliasValue: string;
    confidence: number;
    sourceRef: string | null;
  }> = result.identifiers
    .filter((entry) => entry.type !== "email" && entry.type !== "free_text")
    .map((entry) => ({
      sourceKey: identifierSource(entry),
      aliasType: entry.type,
      aliasValue: entry.value,
      confidence: entry.confidence === "high" ? 1 : entry.confidence === "medium" ? 0.9 : 0.75,
      sourceRef: entry.href,
    }));
  aliases.push({
    sourceKey: "supabase",
    aliasType: "request_id",
    aliasValue: requestId,
    confidence: 1,
    sourceRef: `/ops/customer-records?query=${encodeURIComponent(requestId)}`,
  });
  for (const run of result.automationRuns) {
    if (!run.executionId) continue;
    aliases.push({
      sourceKey: "n8n",
      aliasType: "execution_id",
      aliasValue: run.executionId,
      confidence: 1,
      sourceRef: run.executionUrl || null,
    });
  }
  return aliases.filter((entry, index, entries) =>
    entries.findIndex((candidate) =>
      candidate.sourceKey === entry.sourceKey &&
      candidate.aliasType === entry.aliasType &&
      candidate.aliasValue.toLowerCase() === entry.aliasValue.toLowerCase()
    ) === index,
  );
}

async function getOrCreateRequestEntity(result: CompanyBrainResolveResult, requestId: string) {
  const canonicalKey = `request:${requestId}`;
  const rows = await supabaseRequest<EntityRow[]>("company_entity_registry", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      entity_type: "request",
      canonical_key: canonicalKey,
      display_label: result.records[0]?.displayName || result.records[0]?.company || requestId,
      source_key: "supabase",
      source_ref: requestId,
      lifecycle_status: "active",
      sensitivity: "personal",
      metadata: {
        request_id: requestId,
        last_resolved_at: new Date().toISOString(),
        resolver_version: RESOLVER_VERSION,
      },
    }),
  }, {
    on_conflict: "entity_type,canonical_key",
  });
  if (!rows[0]) throw new QuoteValidationError("Kanonischer Fall konnte nicht gespeichert werden.", ["entity_upsert_failed"], 409);
  return rows[0];
}

async function insertResolutionLog(input: {
  sourceKey: string;
  aliasType: string;
  aliasValue: string;
  entityId?: string | null;
  outcome: "matched" | "unmatched" | "ambiguous" | "rejected";
  confidence?: number | null;
  candidateEntityIds?: string[];
  correlationId: string;
  reasonCode: string;
  metadata?: Record<string, unknown>;
}) {
  await supabaseRequest("company_identity_resolution_log", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      source_key: input.sourceKey,
      alias_type: input.aliasType,
      alias_value_hash: hash(input.aliasValue.toLowerCase()),
      resolved_entity_id: input.entityId || null,
      outcome: input.outcome,
      confidence: input.confidence ?? null,
      candidate_entity_ids: input.candidateEntityIds || [],
      resolver_version: RESOLVER_VERSION,
      correlation_id: input.correlationId,
      reason_code: input.reasonCode,
      metadata: input.metadata || {},
    }),
  });
}

async function upsertDeterministicAlias(input: {
  entityId: string;
  sourceKey: string;
  aliasType: string;
  aliasValue: string;
  confidence: number;
  sourceRef: string | null;
  actor: string;
  correlationId: string;
}) {
  const rows = await supabaseRequest<AliasRow[]>("company_entity_aliases", undefined, {
    select: "id,entity_id,source_key,alias_type,alias_value,confidence",
    source_key: `eq.${input.sourceKey}`,
    alias_type: `eq.${input.aliasType}`,
    normalized_alias_value: `eq.${input.aliasValue.toLowerCase()}`,
    active: "eq.true",
    limit: 1,
  });
  const existing = rows[0];
  if (existing && existing.entity_id !== input.entityId) {
    return { created: false, conflictEntityId: existing.entity_id };
  }
  if (existing) {
    await supabaseRequest("company_entity_aliases", {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ last_seen_at: new Date().toISOString() }),
    }, { id: `eq.${existing.id}` });
    return { created: false, conflictEntityId: null };
  }
  await supabaseRequest("company_entity_aliases", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      entity_id: input.entityId,
      source_key: input.sourceKey,
      alias_type: input.aliasType,
      alias_value: input.aliasValue,
      confidence: input.confidence,
      resolution_method: "deterministic",
      source_ref: input.sourceRef,
      created_by: input.actor,
      reviewed_by: input.actor,
      reviewed_at: new Date().toISOString(),
      metadata: { correlation_id: input.correlationId, resolver_version: RESOLVER_VERSION },
    }),
  });
  return { created: true, conflictEntityId: null };
}

async function learnTrelloProjectionAlias(result: CompanyBrainResolveResult, requestId: string) {
  const card = result.trelloFailureDiagnosis.card;
  if (!card?.id) return { created: false, conflictRequestId: null };
  const existing = await supabaseRequest<TrelloProjectionAliasRow[]>("trello_card_aliases", undefined, {
    select: "id,request_id,alias_trello_card_id,alias_trello_card_url,canonical_trello_card_id",
    alias_trello_card_id: `eq.${card.id}`,
    limit: 1,
  });
  if (existing[0]) {
    return existing[0].request_id === requestId
      ? { created: false, conflictRequestId: null }
      : { created: false, conflictRequestId: existing[0].request_id };
  }
  const canonicalTrelloCardId = result.records
    .map((record) => record.trelloCardId)
    .find((value): value is string => Boolean(value && value !== card.id)) || null;
  try {
    await supabaseRequest("trello_card_aliases", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        request_id: requestId,
        alias_trello_card_id: card.id,
        alias_trello_card_url: card.url || null,
        canonical_trello_card_id: canonicalTrelloCardId,
        alias_type: "copied_card",
        source: "company_brain_deterministic",
        notes: "Automatisch gelernt: eindeutige Request-ID aus Kundenakte/Angebot und Trello-Karte.",
      }),
    });
    return { created: true, conflictRequestId: null };
  } catch {
    const raced = await supabaseRequest<TrelloProjectionAliasRow[]>("trello_card_aliases", undefined, {
      select: "id,request_id,alias_trello_card_id,alias_trello_card_url,canonical_trello_card_id",
      alias_trello_card_id: `eq.${card.id}`,
      limit: 1,
    });
    if (raced[0]?.request_id === requestId) return { created: false, conflictRequestId: null };
    if (raced[0]?.request_id) return { created: false, conflictRequestId: raced[0].request_id };
    throw new QuoteValidationError("Trello-Alias konnte nicht sicher gespeichert werden.", ["trello_alias_learning_failed"], 409);
  }
}

async function createIdentityReview(input: {
  sourceKey: string;
  aliasType: string;
  aliasValue: string;
  candidateEntityIds?: string[];
  proposedEntityId?: string | null;
  confidence?: number | null;
  reasonCode: string;
  summary: string;
  evidenceRefs: unknown[];
  proposedResolution?: Record<string, unknown>;
  correlationId: string;
}) {
  const reviewKey = hash([
    RESOLVER_VERSION,
    input.sourceKey,
    input.aliasType,
    input.aliasValue.toLowerCase(),
    input.reasonCode,
    ...(input.candidateEntityIds || []).sort(),
  ].join("|"));
  const rows = await supabaseRequest<ReviewRow[]>("company_identity_review_queue", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({
      review_key: reviewKey,
      status: "open",
      source_key: input.sourceKey,
      alias_type: input.aliasType,
      alias_value_hash: hash(input.aliasValue.toLowerCase()),
      candidate_entity_ids: input.candidateEntityIds || [],
      proposed_entity_id: input.proposedEntityId || null,
      confidence: input.confidence ?? null,
      reason_code: input.reasonCode,
      summary: input.summary,
      evidence_refs: input.evidenceRefs,
      proposed_resolution: input.proposedResolution || {},
      resolver_version: RESOLVER_VERSION,
      correlation_id: input.correlationId,
    }),
  }, { on_conflict: "review_key" });
  return rows[0] ? mapReview(rows[0]) : null;
}

export async function correlateCompanyBrainResult(
  result: CompanyBrainResolveResult,
  actor = "company-brain-resolver",
): Promise<CompanyBrainCanonicalCase> {
  const requestIds = uniqueStrings([
    ...result.records.map((record) => record.requestId),
    ...result.offers.map((offer) => offer.requestId),
    ...result.identifiers.filter((entry) => entry.type === "request_id").map((entry) => entry.value),
  ]);
  const correlationId = `company-brain:${hash(`${result.query}|${result.generatedAt}`).slice(0, 24)}`;

  if (requestIds.length !== 1) {
    const reasonCode = requestIds.length ? "multiple_request_ids" : "missing_request_id";
    const review = await createIdentityReview({
      sourceKey: result.trelloFailureDiagnosis.card ? "trello" : "supabase",
      aliasType: result.trelloFailureDiagnosis.card ? "trello_card_id" : "case_query",
      aliasValue: result.trelloFailureDiagnosis.card?.id || result.query,
      confidence: requestIds.length ? 0.5 : null,
      reasonCode,
      summary: requestIds.length
        ? `Mehrere Request-IDs im Fall: ${requestIds.join(", ")}. Keine automatische Zusammenführung.`
        : "Keine eindeutige Request-ID. Der Fall bleibt in der Identitätsprüfung.",
      evidenceRefs: result.identifiers.map((entry) => ({ type: entry.type, valueHash: hash(entry.value).slice(0, 16) })),
      correlationId,
    });
    await insertResolutionLog({
      sourceKey: result.trelloFailureDiagnosis.card ? "trello" : "supabase",
      aliasType: result.trelloFailureDiagnosis.card ? "trello_card_id" : "case_query",
      aliasValue: result.trelloFailureDiagnosis.card?.id || result.query,
      outcome: requestIds.length ? "ambiguous" : "unmatched",
      candidateEntityIds: [],
      correlationId,
      reasonCode,
    });
    return {
      status: requestIds.length ? "ambiguous" : "unmatched",
      entityId: null,
      canonicalKey: null,
      requestId: null,
      confidence: requestIds.length ? 0.5 : null,
      resolverVersion: RESOLVER_VERSION,
      aliasesCreated: 0,
      reviewId: review?.id || null,
      summary: review?.summary || "Identität konnte nicht eindeutig aufgelöst werden.",
    };
  }

  const requestId = requestIds[0]!;
  const entity = await getOrCreateRequestEntity(result, requestId);
  let aliasesCreated = 0;
  const conflicts: Array<{
    entityId: string;
    sourceKey: string;
    aliasType: string;
    aliasValue: string;
  }> = [];
  const deterministicAliasInputs = deterministicAliases(result, requestId);
  const deterministicAliasOutcomes = await Promise.all(deterministicAliasInputs.map(async (alias) => ({
    alias,
    outcome: await upsertDeterministicAlias({
      entityId: entity.id,
      sourceKey: alias.sourceKey,
      aliasType: alias.aliasType,
      aliasValue: alias.aliasValue,
      confidence: alias.confidence,
      sourceRef: alias.sourceRef,
      actor,
      correlationId,
    }),
  })));
  for (const { alias, outcome } of deterministicAliasOutcomes) {
    if (outcome.created) aliasesCreated += 1;
    if (outcome.conflictEntityId) {
      conflicts.push({
        entityId: outcome.conflictEntityId,
        sourceKey: alias.sourceKey,
        aliasType: alias.aliasType,
        aliasValue: alias.aliasValue,
      });
    }
  }

  if (conflicts.length) {
    const primaryConflict = conflicts[0]!;
    const review = await createIdentityReview({
      sourceKey: primaryConflict.sourceKey,
      aliasType: primaryConflict.aliasType,
      aliasValue: primaryConflict.aliasValue,
      candidateEntityIds: uniqueStrings([entity.id, ...conflicts.map((entry) => entry.entityId)]),
      proposedEntityId: entity.id,
      confidence: 0.5,
      reasonCode: "alias_points_to_different_entity",
      summary: "Mindestens ein harter Alias zeigt auf einen anderen kanonischen Fall. Keine automatische Überschreibung.",
      evidenceRefs: result.identifiers.map((entry) => ({ type: entry.type, valueHash: hash(entry.value).slice(0, 16) })),
      proposedResolution: {
        operation: "reassign_alias",
        sourceKey: primaryConflict.sourceKey,
        aliasType: primaryConflict.aliasType,
        aliasValue: primaryConflict.aliasValue,
        fromEntityId: primaryConflict.entityId,
        toEntityId: entity.id,
      },
      correlationId,
    });
    await insertResolutionLog({
      sourceKey: primaryConflict.sourceKey,
      aliasType: primaryConflict.aliasType,
      aliasValue: primaryConflict.aliasValue,
      outcome: "ambiguous",
      candidateEntityIds: uniqueStrings([entity.id, ...conflicts.map((entry) => entry.entityId)]),
      confidence: 0.5,
      correlationId,
      reasonCode: "alias_points_to_different_entity",
    });
    return {
      status: "ambiguous",
      entityId: entity.id,
      canonicalKey: entity.canonical_key,
      requestId,
      confidence: 0.5,
      resolverVersion: RESOLVER_VERSION,
      aliasesCreated,
      reviewId: review?.id || null,
      summary: review?.summary || "Alias-Konflikt muss geprüft werden.",
    };
  }

  const projectionAlias = await learnTrelloProjectionAlias(result, requestId);
  if (projectionAlias.conflictRequestId) {
    const cardId = result.trelloFailureDiagnosis.card?.id || result.query;
    const review = await createIdentityReview({
      sourceKey: "trello",
      aliasType: "trello_card_id",
      aliasValue: cardId,
      candidateEntityIds: [entity.id],
      proposedEntityId: entity.id,
      confidence: 0.5,
      reasonCode: "trello_projection_alias_conflict",
      summary: `Die Trello-Karte ist im alten Aliasregister mit einer anderen Request-ID verknüpft (${projectionAlias.conflictRequestId}). Keine automatische Überschreibung.`,
      evidenceRefs: result.identifiers.map((entry) => ({ type: entry.type, valueHash: hash(entry.value).slice(0, 16) })),
      proposedResolution: {
        operation: "review_trello_projection_alias",
        aliasValue: cardId,
        currentRequestId: projectionAlias.conflictRequestId,
        proposedRequestId: requestId,
      },
      correlationId,
    });
    await insertResolutionLog({
      sourceKey: "trello",
      aliasType: "trello_card_id",
      aliasValue: cardId,
      entityId: entity.id,
      outcome: "ambiguous",
      candidateEntityIds: [entity.id],
      confidence: 0.5,
      correlationId,
      reasonCode: "trello_projection_alias_conflict",
      metadata: {
        current_request_id_hash: hash(projectionAlias.conflictRequestId).slice(0, 16),
        proposed_request_id_hash: hash(requestId).slice(0, 16),
      },
    });
    return {
      status: "ambiguous",
      entityId: entity.id,
      canonicalKey: entity.canonical_key,
      requestId,
      confidence: 0.5,
      resolverVersion: RESOLVER_VERSION,
      aliasesCreated,
      reviewId: review?.id || null,
      summary: review?.summary || "Trello-Alias-Konflikt muss geprüft werden.",
    };
  }
  if (projectionAlias.created) aliasesCreated += 1;

  await insertResolutionLog({
    sourceKey: "supabase",
    aliasType: "request_id",
    aliasValue: requestId,
    entityId: entity.id,
    outcome: "matched",
    confidence: 1,
    correlationId,
    reasonCode: "single_deterministic_request_id",
    metadata: { aliases_created: aliasesCreated },
  });
  return {
    status: "matched",
    entityId: entity.id,
    canonicalKey: entity.canonical_key,
    requestId,
    confidence: 1,
    resolverVersion: RESOLVER_VERSION,
    aliasesCreated,
    reviewId: null,
    summary: `Fall eindeutig als ${entity.canonical_key} aufgelöst.`,
  };
}

export async function listCompanyIdentityReviews(statusInput?: unknown, limitInput?: unknown) {
  const status = cleanText(statusInput, 30) || "open";
  if (!["open", "confirmed", "rejected", "superseded"].includes(status)) {
    throw new QuoteValidationError("Review-Status ist ungültig.", ["invalid_review_status"], 422);
  }
  const limit = Math.max(1, Math.min(Number(limitInput) || 50, 100));
  const rows = await supabaseRequest<ReviewRow[]>("company_identity_review_queue", undefined, {
    select: "id,status,source_key,alias_type,candidate_entity_ids,proposed_entity_id,confidence,reason_code,summary,evidence_refs,proposed_resolution,correlation_id,reviewed_by,review_note,reviewed_at,created_at",
    status: `eq.${status}`,
    order: "created_at.asc",
    limit,
  });
  return rows.map(mapReview);
}

export async function reviewCompanyIdentity(input: {
  reviewId: unknown;
  decision: unknown;
  actor: string;
  note?: unknown;
}) {
  const reviewId = cleanText(input.reviewId, 60);
  const decision = cleanText(input.decision, 20);
  if (!["confirmed", "rejected"].includes(decision)) {
    throw new QuoteValidationError("Review-Entscheidung ist ungültig.", ["invalid_review_decision"], 422);
  }
  const openRows = await supabaseRequest<ReviewRow[]>("company_identity_review_queue", undefined, {
    select: "id,status,source_key,alias_type,candidate_entity_ids,proposed_entity_id,confidence,reason_code,summary,evidence_refs,proposed_resolution,correlation_id,reviewed_by,review_note,reviewed_at,created_at",
    id: `eq.${reviewId}`,
    status: "eq.open",
    limit: 1,
  });
  const openReview = openRows[0];
  if (!openReview) throw new QuoteValidationError("Identitätsprüfung ist nicht mehr offen.", ["identity_review_conflict"], 409);

  if (decision === "confirmed") {
    const resolution = openReview.proposed_resolution || {};
    const operation = cleanText(resolution.operation, 80);
    const sourceKey = cleanText(resolution.sourceKey, 80);
    const aliasType = cleanText(resolution.aliasType, 80);
    const aliasValue = cleanText(resolution.aliasValue, 500);
    const fromEntityId = cleanText(resolution.fromEntityId, 60);
    const toEntityId = cleanText(resolution.toEntityId || openReview.proposed_entity_id, 60);
    if (operation !== "reassign_alias" || !sourceKey || !aliasType || !aliasValue || !fromEntityId || !toEntityId) {
      throw new QuoteValidationError("Für diese Prüfung gibt es keinen sicheren automatischen Fix.", ["identity_review_manual_only"], 409);
    }
    const aliasRows = await supabaseRequest<AliasRow[]>("company_entity_aliases", undefined, {
      select: "id,entity_id,source_key,alias_type,alias_value,confidence",
      source_key: `eq.${sourceKey}`,
      alias_type: `eq.${aliasType}`,
      normalized_alias_value: `eq.${aliasValue.toLowerCase()}`,
      active: "eq.true",
      limit: 1,
    });
    const alias = aliasRows[0];
    if (!alias || alias.entity_id !== fromEntityId) {
      throw new QuoteValidationError("Alias-Zustand hat sich seit der Diagnose geändert.", ["identity_alias_state_changed"], 409);
    }
    await supabaseRequest("company_entity_aliases", {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({
        entity_id: toEntityId,
        confidence: 1,
        resolution_method: "manual",
        reviewed_by: input.actor,
        reviewed_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        metadata: {
          review_id: reviewId,
          previous_entity_id: fromEntityId,
          resolver_version: RESOLVER_VERSION,
        },
      }),
    }, { id: `eq.${alias.id}`, entity_id: `eq.${fromEntityId}` });
    await insertResolutionLog({
      sourceKey,
      aliasType,
      aliasValue,
      entityId: toEntityId,
      outcome: "matched",
      confidence: 1,
      correlationId: openReview.correlation_id || `identity-review:${reviewId}`,
      reasonCode: "manual_alias_reassignment",
      metadata: { review_id: reviewId, previous_entity_id: fromEntityId, reviewed_by: input.actor },
    });
  }

  const rows = await supabaseRequest<ReviewRow[]>("company_identity_review_queue", {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      status: decision,
      reviewed_by: input.actor,
      review_note: cleanText(input.note, 2000) || null,
      reviewed_at: new Date().toISOString(),
    }),
  }, {
    id: `eq.${reviewId}`,
    status: "eq.open",
  });
  if (!rows[0]) throw new QuoteValidationError("Identitätsprüfung ist nicht mehr offen.", ["identity_review_conflict"], 409);
  return mapReview(rows[0]);
}
