import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { listCustomerRecordsByOfferBridge, searchCustomerRecords, type CustomerSearchResult } from "@/lib/ops/customer-records";

export const dynamic = "force-dynamic";

type OfferCallContextRequestEntry = {
  offerId?: string;
  offerNumber?: string | null;
  documentReference?: string | null;
  trelloCardId?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
};

type MatchType = "offer" | "trello" | "email" | "phone" | "none";

const MAX_ENTRIES = 40;
const SEARCH_TIMEOUT_MS = 12_000;

function configuredInternalKeys() {
  return [
    process.env.OPS_INTERNAL_API_KEY,
    process.env.QUOTE_INTERNAL_API_TOKEN,
    process.env.INTERNAL_API_KEY,
  ].filter((value): value is string => Boolean(value && value.length >= 24));
}

function bearerToken(request: NextRequest) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || request.headers.get("x-neontrip-internal-key") || "";
}

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

function safeEqual(left: string, right: string) {
  const leftDigest = digest(left);
  const rightDigest = digest(right);
  return timingSafeEqual(leftDigest, rightDigest);
}

function isAuthorized(request: NextRequest) {
  const expectedKeys = configuredInternalKeys();
  const received = bearerToken(request);
  return Boolean(expectedKeys.length && received && expectedKeys.some((expected) => safeEqual(received, expected)));
}

function cleanText(value: unknown) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function normalizeEmail(value: unknown) {
  const normalized = cleanText(value)?.toLowerCase() || null;
  return normalized && normalized.includes("@") ? normalized : null;
}

function normalizePhone(value: unknown) {
  const normalized = cleanText(value);
  if (!normalized) return null;
  const digits = normalized.replace(/\D/g, "");
  return digits.length >= 6 ? normalized : null;
}

function searchQueries(entry: OfferCallContextRequestEntry): Array<{ query: string; matchType: MatchType }> {
  const queries: Array<{ query: string; matchType: MatchType }> = [];

  const trelloCardId = cleanText(entry.trelloCardId);
  if (trelloCardId) queries.push({ query: `trello:${trelloCardId}`, matchType: "trello" });

  const offerNumber = cleanText(entry.offerNumber);
  if (offerNumber) queries.push({ query: offerNumber, matchType: "offer" });

  const documentReference = cleanText(entry.documentReference);
  if (documentReference && documentReference !== offerNumber) queries.push({ query: documentReference, matchType: "offer" });

  const email = normalizeEmail(entry.customerEmail);
  if (email) queries.push({ query: email, matchType: "email" });

  const phone = normalizePhone(entry.customerPhone);
  if (phone) queries.push({ query: phone, matchType: "phone" });

  return queries;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await mapper(items[index]!, index);
      }
    }),
  );

  return results;
}

function customerRecordUrl(record: CustomerSearchResult) {
  return `/ops/customer-records?query=${encodeURIComponent(record.requestId)}`;
}

function pendingOfferCallTask(record: CustomerSearchResult) {
  const candidates = record.internalTasks
    .filter((task) => (
      task.status === "open" &&
      task.category === "call" &&
      (
        task.sourceType === "neontrip_offer_call" ||
        task.sourceType === "neontrip_inquiry_call" ||
        /angebot|anfrage|anruf/i.test(task.title)
      )
    ))
    .sort((left, right) => {
      const leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.POSITIVE_INFINITY;
      const rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.POSITIVE_INFINITY;
      if (leftDue !== rightDue) return leftDue - rightDue;
      return new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime();
    });

  const task = candidates[0] || null;
  if (!task) return null;
  return {
    id: task.id,
    title: task.title,
    dueAt: task.dueAt,
    assigneeName: task.assigneeName,
    sourceType: task.sourceType,
    sourceId: task.sourceId,
  };
}

function summarizeRecord(record: CustomerSearchResult, matchType: MatchType) {
  return {
    matched: true,
    matchedBy: matchType,
    requestId: record.requestId,
    customerRecordUrl: customerRecordUrl(record),
    customerName: record.displayName,
    customerEmail: record.email || record.originalEmail || null,
    customerPhone: record.phone || record.originalPhone || null,
    company: record.company,
    opsStatus: record.opsState.status,
    opsLabel: record.opsState.label,
    nextCallbackAt: record.callOps.nextCallbackAt,
    planningReason: record.callOps.planningReason,
    contactabilityStatus: record.callOps.contactabilityStatus,
    latestCallAt: record.callOps.latestLoggedCallAt || record.callOps.latestVoiceCallAt,
    latestCallSummary: record.callOps.latestLoggedCallSummary || record.callOps.latestVoiceCallSummary,
    totalCallCount: record.callOps.totalCallCount,
    recentCalls: record.callOps.recentCalls.slice(0, 3),
    pendingFollowups: record.affectedRows.pendingFollowups,
    nextFollowupAt: record.affectedRows.nextPendingFollowupAt,
    lastTouchAt: record.relatedRequests[0]?.lastTouchAt || record.updatedAt,
    lastTouchLabel: record.relatedRequests[0]?.lastTouchLabel || null,
    pendingOfferCallTask: pendingOfferCallTask(record),
  };
}

async function resolveEntry(entry: OfferCallContextRequestEntry) {
  const offerId = cleanText(entry.offerId);
  if (!offerId) return { offerId: null, matched: false, matchedBy: "none" as const, error: "missing_offer_id" };

  try {
    const bridgeRecords = await withTimeout(
      listCustomerRecordsByOfferBridge(
        { offerId, offerNumber: entry.offerNumber, documentReference: entry.documentReference },
        { includeTrello: true, includeOfferTracking: true },
      ),
      SEARCH_TIMEOUT_MS,
      "ops_context_offer_bridge_timeout",
    );
    const bridgeRecord = bridgeRecords[0] || null;
    if (bridgeRecord) return { offerId, ...summarizeRecord(bridgeRecord, "offer") };
  } catch (error) {
    console.warn("offer call context bridge lookup failed", { offerId, error });
  }

  const queries = searchQueries(entry);
  if (!queries.length) return { offerId, matched: false, matchedBy: "none" as const, error: "missing_contact_keys" };

  let lastError: string | null = null;
  for (const query of queries) {
    try {
      const records = await withTimeout(searchCustomerRecords(query.query), SEARCH_TIMEOUT_MS, "ops_context_search_timeout");
      const record = records[0] || null;
      if (record) return { offerId, ...summarizeRecord(record, query.matchType) };
    } catch (error) {
      console.warn("offer call context lookup failed", { offerId, matchType: query.matchType, error });
      lastError = error instanceof Error ? error.message : "lookup_failed";
    }
  }

  return {
    offerId,
    matched: false,
    matchedBy: "none" as const,
    ...(lastError ? { error: lastError } : {}),
  };
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: { offers?: OfferCallContextRequestEntry[] };
  try {
    body = (await request.json()) as { offers?: OfferCallContextRequestEntry[] };
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const offers = Array.isArray(body.offers) ? body.offers.slice(0, MAX_ENTRIES) : [];
  if (!offers.length) return NextResponse.json({ ok: true, contexts: [] });

  const contexts = await mapWithConcurrency(offers, 3, resolveEntry);
  return NextResponse.json({ ok: true, contexts });
}
