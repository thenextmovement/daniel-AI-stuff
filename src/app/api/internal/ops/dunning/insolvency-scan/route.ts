import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { listDunningDashboard } from "@/lib/ops/dunning";
import { scanDunningInsolvencyCandidate } from "@/lib/ops/dunning-insolvency";
import { SupabaseRestError } from "@/lib/quotes/supabase-rest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
};

function jsonResponse(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...NO_STORE_HEADERS,
      ...(init?.headers || {}),
    },
  });
}

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
  return (
    match?.[1]?.trim() ||
    request.headers.get("x-neontrip-internal-key") ||
    ""
  );
}

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

function safeEqual(left: string, right: string) {
  return timingSafeEqual(digest(left), digest(right));
}

function isAuthorized(request: NextRequest) {
  const expectedKeys = configuredInternalKeys();
  const received = bearerToken(request);
  return Boolean(
    expectedKeys.length &&
      received &&
      expectedKeys.some((expected) => safeEqual(received, expected)),
  );
}

function validLimit(value: unknown) {
  if (value === undefined) return 3;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 3
  )
    return null;
  return value;
}

function isDueForScan(
  check: Awaited<
    ReturnType<typeof listDunningDashboard>
  >["cases"][number]["insolvencyCheck"],
) {
  if (!check) return true;
  if (check.status === "checking") return true;
  return Boolean(
    check.status === "retryable" &&
      check.nextAttemptAt &&
      Date.parse(check.nextAttemptAt) <= Date.now(),
  );
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request))
    return jsonResponse({ ok: false, error: "unauthorized" }, { status: 401 });

  if (
    !String(request.headers.get("content-type") || "")
      .toLowerCase()
      .startsWith("application/json")
  )
    return jsonResponse(
      { ok: false, error: "content_type_required" },
      { status: 415 },
    );
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > 2048)
    return jsonResponse({ ok: false, error: "body_too_large" }, { status: 413 });

  let body: Record<string, unknown>;
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > 2048)
      return jsonResponse(
        { ok: false, error: "body_too_large" },
        { status: 413 },
      );
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return jsonResponse({ ok: false, error: "invalid_json" }, { status: 400 });
  }
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => key !== "limit")
  )
    return jsonResponse({ ok: false, error: "invalid_body" }, { status: 400 });
  const limit = validLimit(body.limit);
  if (!limit)
    return jsonResponse({ ok: false, error: "invalid_limit" }, { status: 400 });

  try {
    const dashboard = await listDunningDashboard();
    const candidates = dashboard.cases
      .filter(
        (entry) =>
          entry.state === "court_review" &&
          Boolean(entry.legalReviewDueAt) &&
          isDueForScan(entry.insolvencyCheck),
      )
      .sort(
        (left, right) =>
          Date.parse(left.legalReviewDueAt || "") -
          Date.parse(right.legalReviewDueAt || ""),
      )
      .slice(0, limit);
    const outcomes = [];
    for (const candidate of candidates) {
      outcomes.push(
        await scanDunningInsolvencyCandidate({
          orderNumber: candidate.orderNumber,
          legalReviewDueAt: candidate.legalReviewDueAt!,
          identity: candidate.insolvencyIdentity,
        }),
      );
    }
    return jsonResponse({
      ok: true,
      source: "official_insolvency_publications",
      legalActionTriggered: false,
      customerCommunicationSent: false,
      candidateCount: candidates.length,
      checkedCount: outcomes.filter((entry) => entry.action === "checked")
        .length,
      outcomes,
    });
  } catch (error) {
    if (error instanceof SupabaseRestError)
      return jsonResponse(
        { ok: false, error: "storage_unavailable" },
        { status: error.status >= 400 && error.status < 600 ? error.status : 500 },
      );
    console.error("internal dunning insolvency scan failed", {
      errorCode: error instanceof Error ? error.name : "unknown_error",
    });
    return jsonResponse({ ok: false, error: "internal_error" }, { status: 500 });
  }
}
