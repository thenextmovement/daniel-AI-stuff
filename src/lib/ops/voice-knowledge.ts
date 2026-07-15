import { createHash, randomUUID } from "node:crypto";
import { getCustomerRecordByRequestId, searchCustomerRecords, type CustomerSearchResult } from "@/lib/ops/customer-records";
import { getOfferById, getOfferByTrelloCardId, type OpsOfferSnapshot } from "@/lib/ops/offers";
import { fetchOutlookGraphEvidenceForBoundCustomer } from "@/lib/ops/company-brain";
import { supabaseRequest, supabaseRpc } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";
import type { VoiceCopilotInteractionMode, VoiceCopilotMode } from "@/lib/ops/voice-copilot";

export type VoiceKnowledgeStatus = "draft" | "review" | "approved" | "retired";
export type VoiceKnowledgeRiskClass = "standard" | "sensitive" | "restricted";
export type VoiceKnowledgeReviewDecision = "approve" | "request_changes" | "retire";
export type VoiceKnowledgeCandidateDecision = "promote" | "rejected";

export type VoiceKnowledgeSourceRef = {
  label: string;
  url?: string | null;
};

export type VoiceKnowledgeEntry = {
  articleId: string;
  versionId: string;
  slug: string;
  versionNumber: number;
  title: string;
  content: string;
  status: VoiceKnowledgeStatus;
  allowedModes: VoiceCopilotMode[];
  riskClass: VoiceKnowledgeRiskClass;
  sourceRefs: VoiceKnowledgeSourceRef[];
  authoredBy: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  updatedAt: string;
};

export type VoiceKnowledgeMatch = {
  articleId: string;
  versionId: string;
  chunkId: string;
  title: string;
  content: string;
  sourceRefs: VoiceKnowledgeSourceRef[];
  rank: number;
};

export type VoiceKnowledgeCandidate = {
  id: string;
  sourceType: "call_summary" | "operator_note" | "email_pattern";
  sourceRef: string | null;
  requestId: string | null;
  proposedStatement: string;
  evidenceRefs: VoiceKnowledgeSourceRef[];
  confidence: number | null;
  status: "pending" | "approved" | "rejected" | "merged";
  proposedBy: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
};

export type VoiceCustomerContext = {
  requestId: string;
  customer: {
    displayName: string | null;
    company: string | null;
  };
  request: {
    title: string | null;
    description: string | null;
    status: string | null;
    segment: string | null;
    size: string | null;
    colors: string[];
    application: string | null;
    deliveryTime: string | null;
  };
  offer: {
    source: "offers" | "pandadoc";
    offerId: string | null;
    offerNumber: string | null;
    label: string;
    status: string;
    viewedAt: string | null;
    acceptedAt: string | null;
    projectTitle: string | null;
    items: Array<{ title: string; description: string | null; quantity: number }>;
  } | null;
  outlook: Array<{
    direction: string | null;
    subject: string;
    preview: string | null;
    occurredAt: string | null;
  }>;
  outlookMatchCount?: number;
  sourceStatus: {
    customerRecord: "ok";
    offer: "ok" | "not_linked" | "unavailable";
    outlook: "ok" | "empty" | "unavailable";
  };
};

type VoiceKnowledgeVersionRow = {
  id: string;
  article_id: string;
  version_number: number;
  title: string;
  content: string;
  status: VoiceKnowledgeStatus;
  allowed_modes: VoiceCopilotMode[];
  risk_class: VoiceKnowledgeRiskClass;
  source_refs: unknown;
  authored_by: string;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  updated_at: string;
  article?: { id: string; slug: string } | Array<{ id: string; slug: string }>;
};

type VoiceKnowledgeCandidateRow = {
  id: string;
  source_type: VoiceKnowledgeCandidate["sourceType"];
  source_ref?: string | null;
  request_id?: string | null;
  proposed_statement: string;
  evidence_refs: unknown;
  confidence?: number | string | null;
  status: VoiceKnowledgeCandidate["status"];
  proposed_by: string;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  review_note?: string | null;
  created_at: string;
};

const ALLOWED_MODES = new Set<VoiceCopilotMode>(["internal_test", "lead_qualification", "follow_up"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanText(value: unknown, maxLength = 500) {
  return String(value || "").replace(/\u0000/g, "").trim().slice(0, maxLength);
}

function requiredText(value: unknown, label: string, maxLength: number, minLength = 1) {
  const text = cleanText(value, maxLength);
  if (text.length < minLength) {
    throw new QuoteValidationError(`${label} fehlt oder ist zu kurz.`, [`invalid_${label.toLowerCase()}`], 422);
  }
  return text;
}

function requireUuid(value: unknown, label: string) {
  const id = cleanText(value, 60);
  if (!UUID_PATTERN.test(id)) throw new QuoteValidationError(`${label} ist ungueltig.`, [`invalid_${label.toLowerCase()}`], 422);
  return id;
}

function normalizeModes(value: unknown): VoiceCopilotMode[] {
  const values = Array.isArray(value) ? value : [];
  const modes = Array.from(new Set(values.map((entry) => cleanText(entry, 40) as VoiceCopilotMode))).filter((mode) => ALLOWED_MODES.has(mode));
  if (!modes.length) throw new QuoteValidationError("Mindestens ein erlaubter Modus ist erforderlich.", ["invalid_allowed_modes"], 422);
  return modes;
}

function normalizeSourceRefs(value: unknown): VoiceKnowledgeSourceRef[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).map((entry) => {
    const record = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    const label = requiredText(record.label, "Quelle", 160);
    const url = cleanText(record.url, 500) || null;
    if (url && !/^https:\/\//i.test(url)) {
      throw new QuoteValidationError("Quellen-URLs muessen HTTPS verwenden.", ["invalid_source_url"], 422);
    }
    return { label, url };
  });
}

function parseSourceRefs(value: unknown): VoiceKnowledgeSourceRef[] {
  try {
    return normalizeSourceRefs(value);
  } catch {
    return [];
  }
}

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function isVoiceKnowledgeEnabled() {
  return String(process.env.VOICE_COPILOT_KNOWLEDGE_ENABLED || "").trim().toLowerCase() === "true";
}

export function chunkVoiceKnowledge(contentInput: unknown) {
  const content = requiredText(contentInput, "Inhalt", 12000, 20);
  const paragraphs = content.split(/\n{2,}/).map((entry) => entry.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const parts: string[] = [];
    let offset = 0;
    while (offset < paragraph.length) {
      let end = Math.min(offset + 1600, paragraph.length);
      if (end < paragraph.length) {
        const wordBoundary = paragraph.lastIndexOf(" ", end);
        if (wordBoundary > offset + 800) end = wordBoundary;
      }
      const part = paragraph.slice(offset, end).trim();
      if (part) parts.push(part);
      offset = end;
      while (paragraph[offset] === " ") offset += 1;
    }
    for (const part of parts) {
      const candidate = current ? `${current}\n\n${part}` : part;
      if (candidate.length <= 1800) {
        current = candidate;
      } else {
        if (current) chunks.push(current);
        current = part.slice(0, 1800);
      }
    }
  }
  if (current) chunks.push(current);
  return chunks.slice(0, 20);
}

function mapKnowledgeVersion(row: VoiceKnowledgeVersionRow): VoiceKnowledgeEntry {
  const article = Array.isArray(row.article) ? row.article[0] : row.article;
  return {
    articleId: row.article_id,
    versionId: row.id,
    slug: article?.slug || "unknown",
    versionNumber: Number(row.version_number),
    title: row.title,
    content: row.content,
    status: row.status,
    allowedModes: row.allowed_modes || [],
    riskClass: row.risk_class,
    sourceRefs: parseSourceRefs(row.source_refs),
    authoredBy: row.authored_by,
    reviewedBy: row.reviewed_by || null,
    reviewedAt: row.reviewed_at || null,
    updatedAt: row.updated_at,
  };
}

export async function listVoiceKnowledge(status?: VoiceKnowledgeStatus) {
  const rows = await supabaseRequest<VoiceKnowledgeVersionRow[]>("voice_knowledge_versions", undefined, {
    select: "id,article_id,version_number,title,content,status,allowed_modes,risk_class,source_refs,authored_by,reviewed_by,reviewed_at,updated_at,article:voice_knowledge_articles(id,slug)",
    ...(status ? { status: `eq.${status}` } : {}),
    order: "updated_at.desc",
    limit: 100,
  });
  return rows.map(mapKnowledgeVersion);
}

export async function createVoiceKnowledgeDraft(input: {
  title?: unknown;
  content?: unknown;
  slug?: unknown;
  allowedModes?: unknown;
  riskClass?: unknown;
  sourceRefs?: unknown;
  author?: unknown;
}) {
  const title = requiredText(input.title, "Titel", 180, 4);
  const content = requiredText(input.content, "Inhalt", 12000, 20);
  const slug = cleanText(input.slug, 80) || slugify(title);
  if (!/^[a-z0-9][a-z0-9-]{2,79}$/.test(slug)) {
    throw new QuoteValidationError("Der Wissens-Slug ist ungueltig.", ["invalid_slug"], 422);
  }
  const allowedModes = normalizeModes(input.allowedModes);
  const riskClass = cleanText(input.riskClass, 20) as VoiceKnowledgeRiskClass;
  if (!["standard", "sensitive", "restricted"].includes(riskClass)) {
    throw new QuoteValidationError("Risikoklasse ist ungueltig.", ["invalid_risk_class"], 422);
  }
  const sourceRefs = normalizeSourceRefs(input.sourceRefs);
  const author = requiredText(input.author, "Autor", 120, 2);
  const contentHash = createHash("sha256").update(JSON.stringify({ title, content, allowedModes, riskClass, sourceRefs })).digest("hex");
  const chunks = chunkVoiceKnowledge(content);

  const rows = await supabaseRpc<Array<{ article_id: string; version_id: string; version_number: number }>>(
    "create_voice_knowledge_draft",
    {
      p_slug: slug,
      p_title: title,
      p_content: content,
      p_allowed_modes: allowedModes,
      p_risk_class: riskClass,
      p_source_refs: sourceRefs,
      p_author: author,
      p_content_hash: contentHash,
      p_chunks: chunks,
    },
  );
  const result = rows[0];
  if (!result) throw new Error("Voice knowledge draft RPC returned no result.");
  return { articleId: result.article_id, versionId: result.version_id, versionNumber: Number(result.version_number) };
}

export async function reviewVoiceKnowledgeVersion(input: {
  versionId?: unknown;
  decision?: unknown;
  reviewer?: unknown;
}) {
  const versionId = requireUuid(input.versionId, "Version-ID");
  const decision = cleanText(input.decision, 40) as VoiceKnowledgeReviewDecision;
  if (!["approve", "request_changes", "retire"].includes(decision)) {
    throw new QuoteValidationError("Review-Entscheidung ist ungueltig.", ["invalid_review_decision"], 422);
  }
  const reviewer = requiredText(input.reviewer, "Reviewer", 120, 2);
  const rows = await supabaseRpc<Array<{ version_id: string; article_id: string; status: VoiceKnowledgeStatus }>>(
    "review_voice_knowledge_version",
    { p_version_id: versionId, p_decision: decision, p_reviewer: reviewer },
  );
  const result = rows[0];
  if (!result) throw new QuoteValidationError("Wissensversion wurde nicht gefunden.", ["version_not_found"], 404);
  return { versionId: result.version_id, articleId: result.article_id, status: result.status };
}

export async function searchApprovedVoiceKnowledge(query: unknown, mode: unknown, limit = 4) {
  const searchQuery = requiredText(query, "Suchbegriff", 240, 2);
  const normalizedMode = cleanText(mode, 40) as VoiceCopilotMode;
  if (!ALLOWED_MODES.has(normalizedMode)) throw new QuoteValidationError("Voice-Modus ist ungueltig.", ["invalid_mode"], 422);
  const rows = await supabaseRpc<Array<{
    article_id: string;
    version_id: string;
    chunk_id: string;
    title: string;
    content: string;
    source_refs: unknown;
    rank: number | string;
  }>>("search_approved_voice_knowledge", {
    p_query: searchQuery,
    p_mode: normalizedMode,
    p_limit: Math.max(1, Math.min(Number(limit) || 4, 8)),
  });
  return rows.map((row) => ({
    articleId: row.article_id,
    versionId: row.version_id,
    chunkId: row.chunk_id,
    title: row.title,
    content: cleanText(row.content, 1800),
    sourceRefs: parseSourceRefs(row.source_refs),
    rank: Number(row.rank || 0),
  } satisfies VoiceKnowledgeMatch));
}

function mapCandidate(row: VoiceKnowledgeCandidateRow): VoiceKnowledgeCandidate {
  return {
    id: row.id,
    sourceType: row.source_type,
    sourceRef: row.source_ref || null,
    requestId: row.request_id || null,
    proposedStatement: row.proposed_statement,
    evidenceRefs: parseSourceRefs(row.evidence_refs),
    confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
    status: row.status,
    proposedBy: row.proposed_by,
    reviewedBy: row.reviewed_by || null,
    reviewedAt: row.reviewed_at || null,
    reviewNote: row.review_note || null,
    createdAt: row.created_at,
  };
}

export async function listVoiceKnowledgeCandidates(status: VoiceKnowledgeCandidate["status"] = "pending") {
  const rows = await supabaseRequest<VoiceKnowledgeCandidateRow[]>("voice_knowledge_candidates", undefined, {
    select: "id,source_type,source_ref,request_id,proposed_statement,evidence_refs,confidence,status,proposed_by,reviewed_by,reviewed_at,review_note,created_at",
    status: `eq.${status}`,
    order: "created_at.desc",
    limit: 100,
  });
  return rows.map(mapCandidate);
}

export async function createVoiceKnowledgeCandidate(input: {
  sourceType?: unknown;
  sourceRef?: unknown;
  requestId?: unknown;
  proposedStatement?: unknown;
  evidenceRefs?: unknown;
  confidence?: unknown;
  proposedBy?: unknown;
}) {
  const sourceType = cleanText(input.sourceType, 30) as VoiceKnowledgeCandidate["sourceType"];
  if (!["call_summary", "operator_note", "email_pattern"].includes(sourceType)) {
    throw new QuoteValidationError("Kandidatenquelle ist ungueltig.", ["invalid_candidate_source"], 422);
  }
  const sourceRef = cleanText(input.sourceRef, 200) || null;
  const requestId = cleanText(input.requestId, 160) || null;
  const proposedStatement = requiredText(input.proposedStatement, "Vorschlag", 2000, 20);
  const evidenceRefs = normalizeSourceRefs(input.evidenceRefs);
  const proposedBy = requiredText(input.proposedBy, "Autor", 120, 2);
  const confidenceValue = input.confidence === null || input.confidence === undefined ? null : Number(input.confidence);
  if (confidenceValue !== null && (!Number.isFinite(confidenceValue) || confidenceValue < 0 || confidenceValue > 1)) {
    throw new QuoteValidationError("Konfidenz ist ungueltig.", ["invalid_confidence"], 422);
  }
  const idempotencyKey = createHash("sha256")
    .update(JSON.stringify({ sourceType, sourceRef, requestId, proposedStatement }))
    .digest("hex");
  const rows = await supabaseRequest<VoiceKnowledgeCandidateRow[]>("voice_knowledge_candidates", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify({
      source_type: sourceType,
      source_ref: sourceRef,
      request_id: requestId,
      proposed_statement: proposedStatement,
      evidence_refs: evidenceRefs,
      confidence: confidenceValue,
      idempotency_key: idempotencyKey,
      proposed_by: proposedBy,
    }),
  });
  return rows[0] ? mapCandidate(rows[0]) : { duplicate: true as const, idempotencyKey };
}

export async function decideVoiceKnowledgeCandidate(input: {
  candidateId?: unknown;
  decision?: unknown;
  reviewer?: unknown;
  reviewNote?: unknown;
}) {
  const candidateId = requireUuid(input.candidateId, "Kandidat-ID");
  const decision = cleanText(input.decision, 20) as VoiceKnowledgeCandidateDecision;
  if (!["promote", "rejected"].includes(decision)) {
    throw new QuoteValidationError("Kandidatenentscheidung ist ungueltig.", ["invalid_candidate_decision"], 422);
  }
  const reviewer = requiredText(input.reviewer, "Reviewer", 120, 2);
  const reviewNote = cleanText(input.reviewNote, 800) || null;
  if (decision === "promote") {
    const [candidate] = await supabaseRequest<VoiceKnowledgeCandidateRow[]>("voice_knowledge_candidates", undefined, {
      select: "id,source_type,source_ref,request_id,proposed_statement,evidence_refs,confidence,status,proposed_by,reviewed_by,reviewed_at,review_note,created_at",
      id: `eq.${candidateId}`,
      status: "eq.pending",
      limit: 1,
    });
    if (!candidate) throw new QuoteValidationError("Kandidat wurde bereits bearbeitet oder nicht gefunden.", ["candidate_not_pending"], 409);
    const title = cleanText(candidate.proposed_statement, 160);
    const slug = `candidate-${candidateId.slice(0, 8)}`;
    const contentHash = createHash("sha256").update(candidate.proposed_statement).digest("hex");
    const rows = await supabaseRpc<Array<{ candidate_id: string; article_id: string; version_id: string }>>(
      "promote_voice_knowledge_candidate",
      {
        p_candidate_id: candidateId,
        p_slug: slug,
        p_title: title,
        p_reviewer: reviewer,
        p_content_hash: contentHash,
      },
    );
    if (!rows[0]) throw new QuoteValidationError("Kandidat konnte nicht uebernommen werden.", ["candidate_promote_failed"], 409);
    return { ...rows[0], status: "merged" as const };
  }
  const rows = await supabaseRequest<VoiceKnowledgeCandidateRow[]>("voice_knowledge_candidates", {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ status: "rejected", reviewed_by: reviewer, reviewed_at: new Date().toISOString(), review_note: reviewNote }),
  }, {
    id: `eq.${candidateId}`,
    status: "eq.pending",
  });
  if (!rows[0]) throw new QuoteValidationError("Kandidat wurde bereits bearbeitet oder nicht gefunden.", ["candidate_not_pending"], 409);
  return mapCandidate(rows[0]);
}

function mapCustomerSummary(record: CustomerSearchResult) {
  return {
    requestId: record.requestId,
    displayName: record.displayName,
    company: record.company,
    requestTitle: record.request?.title || null,
    requestStatus: record.request?.status || null,
    offerId: record.offerTracking?.offerId || record.quote?.quoteId || null,
  };
}

export async function searchVoiceCustomerContexts(query: unknown) {
  const normalized = requiredText(query, "Suche", 160, 2);
  const records = await searchCustomerRecords(normalized);
  return records.slice(0, 8).map(mapCustomerSummary);
}

function mapOfferForVoice(offer: OpsOfferSnapshot | null): VoiceCustomerContext["offer"] {
  if (!offer) return null;
  return {
    source: "offers",
    offerId: offer.offerId,
    offerNumber: offer.offerNumber,
    label: offer.offerNumber || offer.documentReference || "Angebot",
    status: offer.status,
    viewedAt: offer.viewedAt,
    acceptedAt: offer.acceptedAt,
    projectTitle: offer.offer.projectTitle,
    items: offer.items.slice(0, 12).map((item) => ({
      title: cleanText(item.title, 180),
      description: cleanText(item.description, 500) || null,
      quantity: Number(item.quantity || 0),
    })),
  };
}

type VoiceOfferRecord = {
  requestId: string;
  request: Pick<NonNullable<CustomerSearchResult["request"]>, "title" | "trelloCardId"> | null;
  offerTracking: Pick<NonNullable<CustomerSearchResult["offerTracking"]>, "offerId"> | null;
  quote: CustomerSearchResult["quote"];
};
type VoiceOfferLoaders = {
  byId: (offerId: string) => Promise<OpsOfferSnapshot>;
  byTrelloCardId: (trelloCardId: string) => Promise<OpsOfferSnapshot>;
};

export function isVoiceOfferBoundToRecord(record: Pick<VoiceOfferRecord, "requestId" | "request">, offer: OpsOfferSnapshot) {
  const offerRequestId = cleanText(offer.requestId || offer.request_id, 160);
  const requestTrelloCardId = cleanText(record.request?.trelloCardId, 160);
  const offerTrelloCardId = cleanText(offer.trelloCardId, 160);
  return Boolean(
    (offerRequestId && offerRequestId === record.requestId) ||
    (requestTrelloCardId && offerTrelloCardId && requestTrelloCardId === offerTrelloCardId),
  );
}

export function mapLegacyQuoteForVoice(record: Pick<VoiceOfferRecord, "requestId" | "request" | "quote">): VoiceCustomerContext["offer"] {
  if (!record.quote) return null;
  return {
    source: "pandadoc",
    offerId: record.quote.quoteId || null,
    offerNumber: null,
    label: "PandaDoc-Angebot",
    status: record.quote.status || "unknown",
    viewedAt: record.quote.viewedAt,
    acceptedAt: record.quote.signedAt,
    projectTitle: record.request?.title || null,
    items: [],
  };
}

export async function resolveVoiceOffer(
  record: VoiceOfferRecord,
  loaders: VoiceOfferLoaders = { byId: getOfferById, byTrelloCardId: getOfferByTrelloCardId },
): Promise<{ offer: VoiceCustomerContext["offer"]; status: VoiceCustomerContext["sourceStatus"]["offer"] }> {
  let modernOfferUnavailable = false;
  const offerId = record.offerTracking?.offerId || null;
  if (offerId) {
    try {
      const offer = await loaders.byId(offerId);
      if (isVoiceOfferBoundToRecord(record, offer)) return { offer: mapOfferForVoice(offer), status: "ok" };
      modernOfferUnavailable = true;
      console.warn("voice copilot rejected mismatched offer binding", { requestId: record.requestId, offerId });
    } catch (error) {
      modernOfferUnavailable = true;
      console.warn("voice copilot bound offer unavailable", { requestId: record.requestId, offerId, error });
    }
  }

  const trelloCardId = cleanText(record.request?.trelloCardId, 160);
  if (trelloCardId) {
    try {
      const offer = await loaders.byTrelloCardId(trelloCardId);
      if (isVoiceOfferBoundToRecord(record, offer)) return { offer: mapOfferForVoice(offer), status: "ok" };
      modernOfferUnavailable = true;
      console.warn("voice copilot rejected mismatched Trello offer binding", { requestId: record.requestId, trelloCardId });
    } catch (error) {
      modernOfferUnavailable = true;
      console.warn("voice copilot Trello-bound offer unavailable", { requestId: record.requestId, trelloCardId, error });
    }
  }

  const legacyOffer = mapLegacyQuoteForVoice(record);
  if (legacyOffer) return { offer: legacyOffer, status: "ok" };
  return { offer: null, status: modernOfferUnavailable ? "unavailable" : "not_linked" };
}

export function selectVoiceMirrorOutlook(
  record: Pick<CustomerSearchResult, "communications" | "outlookCommunications">,
): VoiceCustomerContext["outlook"] {
  const entries = record.outlookCommunications?.length
    ? record.outlookCommunications
    : record.communications.filter((entry) => entry.source === "customer_email_messages");
  return entries.slice(0, 30).map((entry) => ({
    direction: cleanText(entry.direction, 30) || null,
    subject: cleanText(entry.title, 240),
    preview: cleanText(entry.body || entry.preview, 600) || null,
    occurredAt: entry.occurredAt || null,
  }));
}

function mergeVoiceOutlookMessages(messages: VoiceCustomerContext["outlook"]) {
  const seen = new Set<string>();
  return messages
    .sort((left, right) => new Date(right.occurredAt || 0).getTime() - new Date(left.occurredAt || 0).getTime())
    .filter((message) => {
      const key = [message.direction, message.subject.toLowerCase(), message.occurredAt || ""].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export async function getVoiceCustomerContext(requestIdInput: unknown): Promise<VoiceCustomerContext> {
  const requestId = requiredText(requestIdInput, "Request-ID", 160, 3);
  const record = await getCustomerRecordByRequestId(requestId, { includeTrello: false });
  if (record.requestId !== requestId) {
    throw new QuoteValidationError("Request-ID konnte nicht eindeutig gebunden werden.", ["request_binding_mismatch"], 409);
  }
  const boundOffer = await resolveVoiceOffer(record);
  const mirrorOutlook = selectVoiceMirrorOutlook(record);
  const liveOutlook = await fetchOutlookGraphEvidenceForBoundCustomer({
    requestId: record.requestId,
    customerEmail: record.email || null,
    offerNumber: boundOffer.offer?.offerNumber || null,
  });
  const outlookMatches = mergeVoiceOutlookMessages([
    ...liveOutlook.evidence.map((entry) => ({
      direction: entry.direction,
      subject: cleanText(entry.title.replace(/^Live-Outlook(?: Treffer)?:\s*/i, ""), 240),
      preview: cleanText(entry.detail, 600) || null,
      occurredAt: entry.occurredAt,
    })),
    ...mirrorOutlook,
  ]);
  const outlook = outlookMatches.slice(0, 6);

  return {
    requestId: record.requestId,
    customer: { displayName: record.displayName, company: record.company },
    request: {
      title: record.request?.title || null,
      description: cleanText(record.request?.description, 1200) || null,
      status: record.request?.status || null,
      segment: record.request?.segment || null,
      size: record.request?.size || null,
      colors: record.request?.colors.slice(0, 8) || [],
      application: record.request?.application || null,
      deliveryTime: record.request?.deliveryTime || null,
    },
    offer: boundOffer.offer,
    outlook,
    outlookMatchCount: outlookMatches.length,
    sourceStatus: {
      customerRecord: "ok",
      offer: boundOffer.status,
      outlook: outlook.length ? "ok" : liveOutlook.diagnostic?.ok === true ? "empty" : "unavailable",
    },
  };
}

export function buildVoiceKnowledgeQuery(context: VoiceCustomerContext | null, mode: VoiceCopilotMode) {
  return [
    mode === "lead_qualification" ? "Lead Qualifikation Produkt Einsatz Montage" : null,
    mode === "follow_up" ? "Angebot Follow-up Einwand naechster Schritt" : null,
    context?.request.title,
    context?.request.application,
    context?.request.size,
    context?.offer?.items.map((item) => item.title).join(" "),
  ].filter(Boolean).join(" ").slice(0, 240) || "NEONTRIP Produkt Beratung";
}

export async function createVoiceCallSession(input: {
  operatorName?: unknown;
  mode: VoiceCopilotMode;
  context: VoiceCustomerContext | null;
  knowledgeMatches: VoiceKnowledgeMatch[];
  consentStatus?: unknown;
  interactionMode?: VoiceCopilotInteractionMode;
  consentEvidence?: {
    method: "operator_attestation";
    wordingVersion: string;
    confirmedAt: string;
  } | null;
}) {
  const operatorName = requiredText(input.operatorName, "Operator", 120, 2);
  const consentStatus = input.mode === "internal_test"
    ? "not_required_internal"
    : cleanText(input.consentStatus, 30);
  if (!["not_required_internal", "pending", "confirmed", "declined"].includes(consentStatus)) {
    throw new QuoteValidationError("Ein gueltiger Einwilligungsstatus ist erforderlich.", ["invalid_consent_status"], 422);
  }
  if (input.mode !== "internal_test" && !input.context) {
    throw new QuoteValidationError("Kundenmodi benoetigen eine gebundene Request-ID.", ["missing_bound_request"], 422);
  }

  const idempotencyKey = `voice-session:${randomUUID()}`;
  const rows = await supabaseRequest<Array<{ id: string }>>("voice_call_sessions", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      idempotency_key: idempotencyKey,
      operator_name: operatorName,
      mode: input.mode,
      bound_request_id: input.context?.requestId || null,
      bound_offer_id: input.context?.offer?.offerId || null,
      consent_status: consentStatus,
      transcript_storage_enabled: false,
      status: "created",
      knowledge_version_ids: Array.from(new Set(input.knowledgeMatches.map((match) => match.versionId))),
      context_snapshot: {
        interaction_mode: input.interactionMode || "voice_agent",
        consent_evidence: input.consentEvidence || null,
        request_id: input.context?.requestId || null,
        offer_id: input.context?.offer?.offerId || null,
        source_status: input.context?.sourceStatus || null,
        knowledge_chunk_ids: input.knowledgeMatches.map((match) => match.chunkId),
      },
    }),
  });
  if (!rows[0]) throw new Error("Voice call session could not be created.");
  return rows[0].id;
}

export async function getVoiceCallSessionBinding(sessionIdInput: unknown) {
  const sessionId = requireUuid(sessionIdInput, "Session-ID");
  const rows = await supabaseRequest<Array<{
    id: string;
    operator_name: string;
    mode: VoiceCopilotMode;
    bound_request_id?: string | null;
    consent_status: string;
    status: string;
    context_snapshot: Record<string, unknown>;
  }>>("voice_call_sessions", undefined, {
    select: "id,operator_name,mode,bound_request_id,consent_status,status,context_snapshot",
    id: `eq.${sessionId}`,
    limit: 1,
  });
  const row = rows[0];
  if (!row) throw new QuoteValidationError("Voice-Session wurde nicht gefunden.", ["voice_session_not_found"], 404);
  if (row.status !== "live") {
    throw new QuoteValidationError("Voice-Session ist nicht live.", ["voice_session_not_live"], 409);
  }
  if (row.context_snapshot?.interaction_mode !== "live_copilot") {
    throw new QuoteValidationError("Voice-Session ist kein Live-Copilot.", ["invalid_voice_session_type"], 409);
  }
  if (row.mode !== "internal_test" && row.consent_status !== "confirmed") {
    throw new QuoteValidationError("Einwilligung fuer Live-Transkription fehlt.", ["live_transcription_consent_required"], 409);
  }
  return {
    id: row.id,
    operatorName: row.operator_name,
    mode: row.mode,
    requestId: row.bound_request_id || null,
    consentStatus: row.consent_status,
  };
}

export async function updateVoiceCallSessionStatus(
  sessionIdInput: unknown,
  status: "live" | "completed" | "failed" | "cancelled",
) {
  const sessionId = requireUuid(sessionIdInput, "Session-ID");
  const timestamp = new Date().toISOString();
  await supabaseRequest("voice_call_sessions", {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      status,
      ...(status === "live" ? { started_at: timestamp } : { ended_at: timestamp }),
    }),
  }, { id: `eq.${sessionId}` });
}
