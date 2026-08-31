import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  defaultEmailBounceRecoveryDeps,
  processOutlookBounce,
  type EmailBounceRecoveryDeps,
  type OutlookBounceIntakeInput,
} from "@/lib/ops/email-bounce-recovery";
import { SupabaseRestError } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

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

function digest(value: string) {
  return createHash("sha256").update(value).digest();
}

function isAuthorized(request: NextRequest) {
  const authorization = request.headers.get("authorization") || "";
  const received = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
    || request.headers.get("x-neontrip-internal-key")
    || "";
  return Boolean(
    received
    && configuredInternalKeys().some((expected) => timingSafeEqual(digest(received), digest(expected))),
  );
}

function failureResponse(error: unknown) {
  if (error instanceof QuoteValidationError) {
    return jsonResponse({ ok: false, error: error.message, issues: error.issues }, { status: error.status });
  }
  if (error instanceof SupabaseRestError) {
    return jsonResponse({ ok: false, error: error.message, code: "supabase_error" }, { status: error.status });
  }
  console.error("internal email bounce recovery failed", error);
  return jsonResponse({ ok: false, error: "internal_error" }, { status: 500 });
}

export async function handleEmailBouncePost(
  request: NextRequest,
  deps: EmailBounceRecoveryDeps = defaultEmailBounceRecoveryDeps,
) {
  if (!isAuthorized(request)) {
    return jsonResponse({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: OutlookBounceIntakeInput;
  try {
    body = (await request.json()) as OutlookBounceIntakeInput;
  } catch {
    return jsonResponse({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  try {
    const result = await processOutlookBounce(body, deps);
    return jsonResponse(result, { status: 200 });
  } catch (error) {
    return failureResponse(error);
  }
}
