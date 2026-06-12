import { supabaseRequest } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";
import {
  syncCustomerTrelloMockupDescription,
  type CustomerTrelloMockupDescriptionSyncResult,
  type UpdateActor,
} from "@/lib/ops/customer-records";

type RequestLookupRow = {
  request_id?: string | null;
  trello_card_id?: string | null;
  segment?: string | null;
  s_kategorie?: string | null;
  segment_source?: string | null;
  updated_at?: string | null;
};

export type TrelloDescriptionSyncInput = {
  requestId?: string | null;
  trelloCardId?: string | null;
  dryRun?: boolean | null;
};

export type TrelloDescriptionBackfillInput = {
  dryRun?: boolean | null;
  limit?: number | null;
};

export type TrelloDescriptionSyncStatus =
  | "updated"
  | "would_update"
  | "skipped"
  | "missing_segment";

export type TrelloDescriptionSyncResponse = {
  ok: true;
  status: TrelloDescriptionSyncStatus;
  requestId: string;
  trelloCardId: string | null;
  dryRun: boolean;
  reason?: "missing_segment" | "manual_description" | "already_current" | "missing_card" | "card_filter";
  result?: CustomerTrelloMockupDescriptionSyncResult;
};

export type TrelloDescriptionBackfillEntry = {
  requestId: string;
  trelloCardId: string | null;
  status: TrelloDescriptionSyncStatus | "skip_manual" | "already_current" | "missing_card" | "error";
  reason?: string;
  error?: string;
  result?: CustomerTrelloMockupDescriptionSyncResult;
};

export type TrelloDescriptionBackfillResponse = {
  ok: true;
  dryRun: true;
  limit: number;
  scanned: number;
  counts: Record<string, number>;
  entries: TrelloDescriptionBackfillEntry[];
};

export type TrelloDescriptionSyncDeps = {
  findRequestByRequestId: (requestId: string) => Promise<RequestLookupRow | null>;
  findRequestByTrelloCardId: (trelloCardId: string) => Promise<RequestLookupRow | null>;
  listBackfillCandidates: (limit: number) => Promise<RequestLookupRow[]>;
  syncDescription: typeof syncCustomerTrelloMockupDescription;
  trelloConfigured: () => boolean;
};

function cleanText(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function normalizeLimit(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 25;
  return Math.max(1, Math.min(100, Math.floor(parsed)));
}

function hasUsableStoredSegment(row: RequestLookupRow | null) {
  if (!row) return false;
  const source = cleanText(row.segment_source)?.toLowerCase() || "";
  if (source.includes("fallback")) return false;
  return Boolean(cleanText(row.segment) || cleanText(row.s_kategorie));
}

function normalizeSyncStatus(result: CustomerTrelloMockupDescriptionSyncResult): Pick<TrelloDescriptionSyncResponse, "status" | "reason"> {
  if (result.updated.length) {
    return { status: result.dryRun ? "would_update" : "updated" };
  }

  const reasons = result.skipped.map((entry) => entry.reason);
  if (reasons.includes("manual_description")) return { status: "skipped", reason: "manual_description" };
  if (reasons.includes("already_current")) return { status: "skipped", reason: "already_current" };
  if (reasons.includes("missing_card_id")) return { status: "skipped", reason: "missing_card" };
  if (reasons.includes("card_filter")) return { status: "skipped", reason: "card_filter" };
  return { status: "skipped" };
}

function backfillStatusFromSync(result: CustomerTrelloMockupDescriptionSyncResult): TrelloDescriptionBackfillEntry["status"] {
  if (result.updated.length) return result.dryRun ? "would_update" : "updated";
  const reasons = result.skipped.map((entry) => entry.reason);
  if (reasons.includes("manual_description")) return "skip_manual";
  if (reasons.includes("already_current")) return "already_current";
  if (reasons.includes("missing_card_id") || reasons.includes("card_filter")) return "missing_card";
  return "skipped";
}

export const defaultTrelloDescriptionSyncDeps: TrelloDescriptionSyncDeps = {
  async findRequestByRequestId(requestId) {
    const rows = await supabaseRequest<RequestLookupRow[]>("master_requests", undefined, {
      select: "request_id,trello_card_id,segment,s_kategorie,segment_source,updated_at",
      request_id: `eq.${encodeURIComponent(requestId)}`,
      order: "updated_at.desc",
      limit: 1,
    });
    return rows[0] || null;
  },
  async findRequestByTrelloCardId(trelloCardId) {
    const rows = await supabaseRequest<RequestLookupRow[]>("master_requests", undefined, {
      select: "request_id,trello_card_id,segment,s_kategorie,segment_source,updated_at",
      or: `(trello_card_id.eq.${encodeURIComponent(trelloCardId)},trello_card_url.ilike.*${encodeURIComponent(trelloCardId)}*)`,
      order: "updated_at.desc",
      limit: 1,
    });
    return rows[0] || null;
  },
  async listBackfillCandidates(limit) {
    return supabaseRequest<RequestLookupRow[]>("master_requests", undefined, {
      select: "request_id,trello_card_id,segment,s_kategorie,segment_source,updated_at",
      trello_card_id: "not.is.null",
      order: "updated_at.desc",
      limit,
    });
  },
  syncDescription: syncCustomerTrelloMockupDescription,
  trelloConfigured() {
    return Boolean(process.env.TRELLO_API_KEY && process.env.TRELLO_TOKEN);
  },
};

export async function syncTrelloDescriptionFromStoredSegment(
  input: TrelloDescriptionSyncInput,
  actor?: UpdateActor,
  deps: TrelloDescriptionSyncDeps = defaultTrelloDescriptionSyncDeps,
): Promise<TrelloDescriptionSyncResponse> {
  const requestIdInput = cleanText(input.requestId);
  const trelloCardIdInput = cleanText(input.trelloCardId);
  if (!requestIdInput && !trelloCardIdInput) {
    throw new QuoteValidationError("requestId oder trelloCardId ist erforderlich.", [], 400);
  }

  const row = requestIdInput
    ? await deps.findRequestByRequestId(requestIdInput)
    : await deps.findRequestByTrelloCardId(trelloCardIdInput as string);

  if (!row?.request_id) {
    throw new QuoteValidationError("Kein master_requests-Datensatz gefunden.", [], 404);
  }

  const trelloCardId = trelloCardIdInput || cleanText(row.trello_card_id);
  if (!hasUsableStoredSegment(row)) {
    return {
      ok: true,
      status: "missing_segment",
      requestId: row.request_id,
      trelloCardId,
      dryRun: Boolean(input.dryRun),
      reason: "missing_segment",
    };
  }

  if (!deps.trelloConfigured()) {
    throw new QuoteValidationError("Trello API-Konfiguration fehlt: TRELLO_API_KEY/TRELLO_TOKEN.", [], 503);
  }

  const result = await deps.syncDescription(
    row.request_id,
    actor,
    {
      cardId: trelloCardId,
      dryRun: Boolean(input.dryRun),
      auditSkipped: false,
    },
  );
  const normalized = normalizeSyncStatus(result);
  return {
    ok: true,
    ...normalized,
    requestId: row.request_id,
    trelloCardId,
    dryRun: result.dryRun,
    result,
  };
}

export async function dryRunTrelloDescriptionBackfill(
  input: TrelloDescriptionBackfillInput,
  actor?: UpdateActor,
  deps: TrelloDescriptionSyncDeps = defaultTrelloDescriptionSyncDeps,
): Promise<TrelloDescriptionBackfillResponse> {
  if (!input.dryRun) {
    throw new QuoteValidationError("Backfill ist nur mit dryRun=true erlaubt.", [], 400);
  }
  if (!deps.trelloConfigured()) {
    throw new QuoteValidationError("Trello API-Konfiguration fehlt: TRELLO_API_KEY/TRELLO_TOKEN.", [], 503);
  }

  const limit = normalizeLimit(input.limit);
  const rows = await deps.listBackfillCandidates(limit);
  const entries: TrelloDescriptionBackfillEntry[] = [];
  const counts: Record<string, number> = {};

  function add(entry: TrelloDescriptionBackfillEntry) {
    entries.push(entry);
    counts[entry.status] = (counts[entry.status] || 0) + 1;
  }

  for (const row of rows) {
    const requestId = cleanText(row.request_id);
    if (!requestId) continue;
    const trelloCardId = cleanText(row.trello_card_id);

    if (!hasUsableStoredSegment(row)) {
      add({ requestId, trelloCardId, status: "missing_segment", reason: "missing_segment" });
      continue;
    }

    try {
      const result = await deps.syncDescription(requestId, actor, {
        cardId: trelloCardId,
        dryRun: true,
        auditSkipped: false,
      });
      add({
        requestId,
        trelloCardId,
        status: backfillStatusFromSync(result),
        result,
      });
    } catch (error) {
      add({
        requestId,
        trelloCardId,
        status: "error",
        error: error instanceof Error ? error.message : "unknown_error",
      });
    }
  }

  return {
    ok: true,
    dryRun: true,
    limit,
    scanned: rows.length,
    counts,
    entries,
  };
}
