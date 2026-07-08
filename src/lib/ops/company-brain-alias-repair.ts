import { createHash } from "node:crypto";
import { extractCompanyBrainLooseRequestIds } from "@/lib/ops/company-brain";
import { recordWorkflowAuditEvent } from "@/lib/ops/workflow-audit";
import { supabaseRequest } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

type TrelloCardAliasRow = {
  id?: string | null;
  request_id?: string | null;
  alias_trello_card_id?: string | null;
  alias_trello_card_url?: string | null;
  canonical_trello_card_id?: string | null;
  alias_type?: string | null;
  source?: string | null;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type MasterRequestAliasRow = {
  id?: string | null;
  request_id?: string | null;
  trello_card_id?: string | null;
  trello_card_url?: string | null;
  title?: string | null;
  email?: string | null;
  company?: string | null;
  company_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type CompanyBrainAliasRepairIssue =
  | "missing_request_id"
  | "multiple_request_ids"
  | "missing_canonical";

export type CompanyBrainAliasRepairCandidate = {
  requestId: string;
  rowId: string | null;
  trelloCardId: string | null;
  trelloCardUrl: string | null;
  title: string | null;
  confidence: "high" | "medium" | "low";
  reason: string;
};

export type CompanyBrainAliasRepairItem = {
  id: string;
  issue: CompanyBrainAliasRepairIssue;
  issueLabel: string;
  requestId: string | null;
  requestIds: string[];
  aliasId: string | null;
  aliasTrelloCardId: string;
  aliasTrelloCardUrl: string | null;
  canonicalTrelloCardId: string | null;
  source: string | null;
  notes: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  candidates: CompanyBrainAliasRepairCandidate[];
  safeFixAvailable: boolean;
  recommendedFix: string;
};

export type CompanyBrainAliasRepairResult = {
  action: "updated" | "created";
  row: TrelloCardAliasRow;
  audit: {
    inserted: boolean;
    duplicate: boolean;
    rowId: string | null;
    auditEventKey: string;
  };
};

export type CompanyBrainAliasRepairInput = {
  aliasId?: string | null;
  aliasTrelloCardId?: string | null;
  aliasTrelloCardUrl?: string | null;
  requestId?: string | null;
  canonicalTrelloCardId?: string | null;
  operatorName?: string | null;
  note?: string | null;
};

const MAX_ALIAS_ROWS = 1000;

function cleanText(value: unknown, maxLength = 1000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => cleanText(value)).filter(Boolean))];
}

function postgrestEq(column: string, value: string) {
  return `${column}.eq.${encodeURIComponent(value)}`;
}

function postgrestIlike(column: string, value: string) {
  return `${column}.ilike.*${encodeURIComponent(value)}*`;
}

function looksLikeUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function trelloCardLookupFromValue(value: unknown) {
  const text = cleanText(value, 500);
  if (!text) return null;
  const urlMatch = text.match(/trello\.com\/c\/([A-Za-z0-9]+)/i);
  if (urlMatch?.[1]) return urlMatch[1];
  const explicitMatch = text.match(/\btrello:([A-Za-z0-9]{8}|[a-f0-9]{24})\b/i);
  if (explicitMatch?.[1]) return explicitMatch[1];
  const longId = text.match(/\b[a-f0-9]{24}\b/i);
  if (longId?.[0]) return longId[0];
  const shortLink = text.match(/^[A-Za-z0-9]{8}$/)?.[0];
  return shortLink || null;
}

function aliasIssue(row: TrelloCardAliasRow, requestIds: string[]): CompanyBrainAliasRepairIssue | null {
  if (!requestIds.length) return "missing_request_id";
  if (requestIds.length > 1) return "multiple_request_ids";
  if (!cleanText(row.canonical_trello_card_id)) return "missing_canonical";
  return null;
}

function issueLabel(issue: CompanyBrainAliasRepairIssue) {
  if (issue === "missing_request_id") return "Request-ID fehlt";
  if (issue === "multiple_request_ids") return "Mehrere Request-IDs";
  return "Canonical Trello fehlt";
}

function candidateTitle(row: MasterRequestAliasRow) {
  const title = cleanText(row.title, 180);
  const company = cleanText(row.company || row.company_name, 120);
  const name = cleanText([row.first_name, row.last_name].filter(Boolean).join(" "), 120);
  return title || company || name || cleanText(row.email, 160) || null;
}

function confidenceFor(row: MasterRequestAliasRow, alias: TrelloCardAliasRow, requestIds: string[]) {
  const rowRequestId = cleanText(row.request_id || row.id);
  const rowTrello = cleanText(row.trello_card_id);
  const aliasCard = cleanText(alias.alias_trello_card_id) || trelloCardLookupFromValue(alias.alias_trello_card_url) || "";
  if (requestIds.includes(rowRequestId) && rowTrello) return "high";
  if (rowTrello && aliasCard && rowTrello === aliasCard) return "medium";
  if (requestIds.includes(rowRequestId)) return "medium";
  return "low";
}

function mapCandidate(row: MasterRequestAliasRow, alias: TrelloCardAliasRow, requestIds: string[]): CompanyBrainAliasRepairCandidate {
  const requestId = cleanText(row.request_id || row.id);
  const trelloCardId = cleanText(row.trello_card_id) || null;
  const confidence = confidenceFor(row, alias, requestIds);
  return {
    requestId,
    rowId: cleanText(row.id) || null,
    trelloCardId,
    trelloCardUrl: cleanText(row.trello_card_url, 500) || null,
    title: candidateTitle(row),
    confidence,
    reason: confidence === "high"
      ? "Request-ID passt zur Kundenakte; Canonical-Karte ist vorhanden."
      : confidence === "medium"
        ? "Kundenakte passt teilweise; vor Freigabe kurz prüfen."
        : "Nur schwacher Treffer; manuelle Zuordnung nötig.",
  };
}

function repairItemId(row: TrelloCardAliasRow) {
  const raw = [
    cleanText(row.id),
    cleanText(row.alias_trello_card_id),
    cleanText(row.alias_trello_card_url),
    cleanText(row.request_id),
  ].filter(Boolean).join("|");
  return createHash("sha256").update(raw || "alias-repair").digest("hex").slice(0, 16);
}

function recommendedFix(issue: CompanyBrainAliasRepairIssue, candidates: CompanyBrainAliasRepairCandidate[]) {
  if (!candidates.length) return "Request-ID oder Canonical Trello manuell aus Kundenakte eintragen.";
  const candidate = candidates[0];
  if (issue === "missing_request_id") return `Alias mit Request ${candidate.requestId} verknüpfen.`;
  if (issue === "multiple_request_ids") return `Auf eindeutige Request ${candidate.requestId} bereinigen.`;
  return `Canonical Trello auf ${candidate.trelloCardId || "Kundenakte"} setzen.`;
}

function appendRepairNote(existing: string | null | undefined, operatorName: string | null, note: string | null) {
  const base = cleanText(existing, 1800);
  const repair = [
    `Company Brain Alias Repair ${new Date().toISOString()}`,
    operatorName ? `Operator: ${operatorName}` : null,
    note ? `Notiz: ${note}` : null,
  ].filter(Boolean).join(" · ");
  return [base, repair].filter(Boolean).join("\n").slice(0, 2400);
}

async function fetchAllAliasRows() {
  return supabaseRequest<TrelloCardAliasRow[]>("trello_card_aliases", undefined, {
    select: "id,request_id,alias_trello_card_id,alias_trello_card_url,canonical_trello_card_id,alias_type,source,notes,created_at,updated_at",
    order: "updated_at.desc",
    limit: MAX_ALIAS_ROWS,
  });
}

async function fetchCandidateRows(requestIds: string[], trelloValues: string[]) {
  const filters = uniqueStrings([
    ...requestIds.filter(looksLikeUuid).map((requestId) => postgrestEq("id", requestId)),
    ...requestIds.map((requestId) => postgrestEq("request_id", requestId)),
    ...trelloValues.map((value) => postgrestEq("trello_card_id", value)),
    ...trelloValues.map((value) => postgrestIlike("trello_card_url", value)),
  ]);
  if (!filters.length) return [];
  return supabaseRequest<MasterRequestAliasRow[]>("master_requests", undefined, {
    select: "id,request_id,trello_card_id,trello_card_url,title,email,company,company_name,first_name,last_name,created_at,updated_at",
    or: `(${filters.join(",")})`,
    order: "updated_at.desc",
    limit: 200,
  });
}

async function fetchMasterRequestForRepair(requestId: string) {
  const filters = uniqueStrings([
    looksLikeUuid(requestId) ? postgrestEq("id", requestId) : null,
    postgrestEq("request_id", requestId),
  ]);
  const rows = await supabaseRequest<MasterRequestAliasRow[]>("master_requests", undefined, {
    select: "id,request_id,trello_card_id,trello_card_url,title,email,company,company_name,first_name,last_name,created_at,updated_at",
    or: `(${filters.join(",")})`,
    order: "updated_at.desc",
    limit: 1,
  });
  return rows[0] || null;
}

async function fetchAliasForRepair(input: { aliasId: string | null; aliasTrelloCardId: string | null; aliasTrelloCardUrl: string | null }) {
  if (input.aliasId) {
    const rows = await supabaseRequest<TrelloCardAliasRow[]>("trello_card_aliases", undefined, {
      select: "id,request_id,alias_trello_card_id,alias_trello_card_url,canonical_trello_card_id,alias_type,source,notes,created_at,updated_at",
      id: `eq.${input.aliasId}`,
      limit: 1,
    });
    return rows[0] || null;
  }
  const filters = uniqueStrings([
    input.aliasTrelloCardId ? postgrestEq("alias_trello_card_id", input.aliasTrelloCardId) : null,
    input.aliasTrelloCardId ? postgrestIlike("alias_trello_card_url", input.aliasTrelloCardId) : null,
    input.aliasTrelloCardUrl ? postgrestEq("alias_trello_card_url", input.aliasTrelloCardUrl) : null,
  ]);
  if (!filters.length) return null;
  const rows = await supabaseRequest<TrelloCardAliasRow[]>("trello_card_aliases", undefined, {
    select: "id,request_id,alias_trello_card_id,alias_trello_card_url,canonical_trello_card_id,alias_type,source,notes,created_at,updated_at",
    or: `(${filters.join(",")})`,
    order: "updated_at.desc",
    limit: 1,
  });
  return rows[0] || null;
}

export async function listCompanyBrainTrelloAliasRepairs(limit = 50): Promise<CompanyBrainAliasRepairItem[]> {
  const rows = await fetchAllAliasRows();
  const candidatesSeed = rows
    .map((row) => {
      const requestIds = extractCompanyBrainLooseRequestIds(row.request_id);
      const issue = aliasIssue(row, requestIds);
      return issue ? { row, requestIds, issue } : null;
    })
    .filter((entry): entry is { row: TrelloCardAliasRow; requestIds: string[]; issue: CompanyBrainAliasRepairIssue } => Boolean(entry))
    .slice(0, Math.max(1, Math.min(limit, 100)));

  const requestIds = uniqueStrings(candidatesSeed.flatMap((entry) => [
    ...entry.requestIds,
    ...extractCompanyBrainLooseRequestIds(entry.row.notes),
  ]));
  const trelloValues = uniqueStrings(candidatesSeed.flatMap((entry) => [
    entry.row.alias_trello_card_id,
    entry.row.canonical_trello_card_id,
    trelloCardLookupFromValue(entry.row.alias_trello_card_url),
  ]));
  const masterRows = await fetchCandidateRows(requestIds, trelloValues);

  return candidatesSeed.map(({ row, requestIds, issue }) => {
    const aliasCard = cleanText(row.alias_trello_card_id) || trelloCardLookupFromValue(row.alias_trello_card_url) || "unknown";
    const candidates = masterRows
      .filter((master) => {
        const masterRequest = cleanText(master.request_id || master.id);
        const masterTrello = cleanText(master.trello_card_id);
        const masterUrl = cleanText(master.trello_card_url);
        return requestIds.includes(masterRequest) ||
          Boolean(masterTrello && [aliasCard, cleanText(row.canonical_trello_card_id)].includes(masterTrello)) ||
          Boolean(masterUrl && aliasCard && masterUrl.includes(aliasCard));
      })
      .map((master) => mapCandidate(master, row, requestIds))
      .sort((left, right) => {
        const score = { high: 0, medium: 1, low: 2 };
        return score[left.confidence] - score[right.confidence];
      })
      .slice(0, 3);
    const safeFixAvailable = Boolean(candidates[0]?.requestId && candidates[0]?.trelloCardId && candidates[0]?.confidence !== "low");
    return {
      id: repairItemId(row),
      issue,
      issueLabel: issueLabel(issue),
      requestId: requestIds[0] || null,
      requestIds,
      aliasId: cleanText(row.id) || null,
      aliasTrelloCardId: aliasCard,
      aliasTrelloCardUrl: cleanText(row.alias_trello_card_url, 500) || null,
      canonicalTrelloCardId: cleanText(row.canonical_trello_card_id) || null,
      source: cleanText(row.source, 120) || null,
      notes: cleanText(row.notes, 500) || null,
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null,
      candidates,
      safeFixAvailable,
      recommendedFix: recommendedFix(issue, candidates),
    };
  });
}

export async function repairCompanyBrainTrelloAlias(input: CompanyBrainAliasRepairInput): Promise<CompanyBrainAliasRepairResult> {
  const requestIdInput = cleanText(input.requestId, 180);
  const aliasId = cleanText(input.aliasId, 180) || null;
  const aliasTrelloCardUrl = cleanText(input.aliasTrelloCardUrl, 500) || null;
  const aliasTrelloCardId = trelloCardLookupFromValue(input.aliasTrelloCardId) ||
    cleanText(input.aliasTrelloCardId, 180) ||
    trelloCardLookupFromValue(aliasTrelloCardUrl);
  const operatorName = cleanText(input.operatorName, 120) || null;
  const note = cleanText(input.note, 500) || null;

  if (!requestIdInput) {
    throw new QuoteValidationError("Request-ID fehlt.", ["Alias-Reparatur braucht eine eindeutige Request-ID."], 422);
  }
  if (!aliasId && !aliasTrelloCardId && !aliasTrelloCardUrl) {
    throw new QuoteValidationError("Trello-Alias fehlt.", ["Alias-Reparatur braucht Trello Card-ID, URL oder Alias-Zeilen-ID."], 422);
  }

  const master = await fetchMasterRequestForRepair(requestIdInput);
  if (!master) {
    throw new QuoteValidationError("Kundenakte nicht gefunden.", ["Die Request-ID existiert nicht in master_requests."], 404);
  }
  const resolvedRequestId = cleanText(master.request_id || master.id);
  const canonicalTrelloCardId = cleanText(input.canonicalTrelloCardId, 180) || cleanText(master.trello_card_id, 180);
  if (!canonicalTrelloCardId) {
    throw new QuoteValidationError("Canonical Trello-Karte fehlt.", ["Kundenakte hat keine Canonical Trello Card-ID. Bitte manuell eintragen."], 422);
  }

  const existing = await fetchAliasForRepair({ aliasId, aliasTrelloCardId, aliasTrelloCardUrl });
  const now = new Date().toISOString();
  const body = {
    request_id: resolvedRequestId,
    alias_trello_card_id: aliasTrelloCardId || cleanText(existing?.alias_trello_card_id) || canonicalTrelloCardId,
    alias_trello_card_url: aliasTrelloCardUrl || cleanText(existing?.alias_trello_card_url, 500) || null,
    canonical_trello_card_id: canonicalTrelloCardId,
    alias_type: cleanText(existing?.alias_type, 80) || "company_brain_repair",
    source: cleanText(existing?.source, 120) || "company_brain_alias_repair",
    notes: appendRepairNote(existing?.notes, operatorName, note),
    updated_at: now,
  };

  const rows = existing?.id
    ? await supabaseRequest<TrelloCardAliasRow[]>("trello_card_aliases", {
        method: "PATCH",
        body: JSON.stringify(body),
        headers: { Prefer: "return=representation" },
      }, {
        id: `eq.${existing.id}`,
      })
    : await supabaseRequest<TrelloCardAliasRow[]>("trello_card_aliases", {
        method: "POST",
        body: JSON.stringify({
          ...body,
          created_at: now,
        }),
        headers: { Prefer: "return=representation" },
      });
  const row = rows[0];
  if (!row) {
    throw new QuoteValidationError("Alias-Reparatur fehlgeschlagen.", ["Supabase hat keine reparierte Alias-Zeile zurückgegeben."], 500);
  }

  const audit = await recordWorkflowAuditEvent({
    workflowName: "company_brain_fix_center",
    action: "repair_trello_alias",
    status: "success",
    requestId: resolvedRequestId,
    trelloCardId: body.alias_trello_card_id,
    sourceEventId: cleanText(row.id) || null,
    targetRecordId: cleanText(row.id) || null,
    idempotencyKey: `company-brain:repair_trello_alias:${body.alias_trello_card_id}:${resolvedRequestId}:v1`,
    retrySafety: "safe_after_review",
    customer_communication_sent: false,
    metadata: {
      internal_only: true,
      alias_id: cleanText(row.id) || null,
      alias_trello_card_id: body.alias_trello_card_id,
      alias_trello_card_url: body.alias_trello_card_url,
      canonical_trello_card_id: canonicalTrelloCardId,
      previous_request_id: cleanText(existing?.request_id) || null,
      previous_canonical_trello_card_id: cleanText(existing?.canonical_trello_card_id) || null,
      operator_name: operatorName,
    },
  });

  return {
    action: existing ? "updated" : "created",
    row,
    audit,
  };
}
