import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { recordWorkflowAuditEvent, type WorkflowAuditEventInput } from "@/lib/ops/workflow-audit";
import { SupabaseRestError } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

export const dynamic = "force-dynamic";

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
  return match?.[1]?.trim() || request.headers.get("x-neontrip-internal-key") || "";
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
  return Boolean(expectedKeys.length && received && expectedKeys.some((expected) => safeEqual(received, expected)));
}

function failureResponse(error: unknown) {
  if (error instanceof QuoteValidationError) {
    return jsonResponse({ ok: false, error: error.message, issues: error.issues }, { status: error.status });
  }
  if (error instanceof SupabaseRestError) {
    return jsonResponse({ ok: false, error: error.message, code: "supabase_error" }, { status: error.status });
  }
  console.error("internal workflow audit route failed", error);
  return jsonResponse({ ok: false, error: "internal_error" }, { status: 500 });
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return jsonResponse({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: WorkflowAuditEventInput;
  try {
    body = (await request.json()) as WorkflowAuditEventInput;
  } catch {
    return jsonResponse({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  try {
    const result = await recordWorkflowAuditEvent(body);
    return jsonResponse({
      ok: true,
      mode: "audit_only",
      customerCommunicationSent: false,
      ...result,
    }, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    return failureResponse(error);
  }
}
