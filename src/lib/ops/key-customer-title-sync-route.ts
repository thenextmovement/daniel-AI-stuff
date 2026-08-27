import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  defaultKeyCustomerTitleSyncDeps,
  syncKeyCustomerTrelloTitle,
  type KeyCustomerTitleSyncDeps,
  type KeyCustomerTitleSyncInput,
} from "@/lib/ops/key-customer-title-sync";
import { SupabaseRestError } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

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

function isAuthorized(request: NextRequest) {
  const expectedKeys = configuredInternalKeys();
  const received = bearerToken(request);
  return Boolean(
    expectedKeys.length
    && received
    && expectedKeys.some((expected) => timingSafeEqual(digest(received), digest(expected))),
  );
}

function failureResponse(error: unknown) {
  if (error instanceof QuoteValidationError) {
    return NextResponse.json(
      { ok: false, error: error.message, issues: error.issues },
      { status: error.status },
    );
  }
  if (error instanceof SupabaseRestError) {
    return NextResponse.json(
      { ok: false, error: error.message, details: error.details },
      { status: error.status },
    );
  }

  console.error("internal key customer title sync failed", error);
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}

export async function handleKeyCustomerTitleSyncPost(
  request: NextRequest,
  deps: KeyCustomerTitleSyncDeps = defaultKeyCustomerTitleSyncDeps,
) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: KeyCustomerTitleSyncInput;
  try {
    body = (await request.json()) as KeyCustomerTitleSyncInput;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  try {
    const result = await syncKeyCustomerTrelloTitle(body, deps);
    return NextResponse.json(result);
  } catch (error) {
    return failureResponse(error);
  }
}
