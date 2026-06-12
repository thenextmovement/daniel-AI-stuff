import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  defaultTrelloDescriptionSyncDeps,
  dryRunTrelloDescriptionBackfill,
  syncTrelloDescriptionFromStoredSegment,
  type TrelloDescriptionSyncDeps,
} from "@/lib/ops/trello-description-sync";
import type { UpdateActor } from "@/lib/ops/customer-records";
import { SupabaseRestError } from "@/lib/quotes/supabase-rest";
import { QuoteValidationError } from "@/lib/quotes/validation";

type TrelloDescriptionSyncRouteBody = {
  requestId?: string | null;
  trelloCardId?: string | null;
  dryRun?: boolean | null;
  backfill?: boolean | null;
  limit?: number | null;
  operatorName?: string | null;
};

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

function trimNullable(value: unknown) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function getOpsHost(request: NextRequest) {
  return request.headers.get("x-forwarded-host") || request.headers.get("host") || "internal";
}

function automationActor(request: NextRequest, operatorName?: string | null): UpdateActor {
  return {
    host: getOpsHost(request),
    mode: "automation",
    userAgent: request.headers.get("user-agent"),
    operatorName: trimNullable(operatorName) || "NEONTRIP n8n",
  };
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

  console.error("internal trello description sync route failed", error);
  return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
}

export async function handleTrelloDescriptionSyncPost(
  request: NextRequest,
  deps: TrelloDescriptionSyncDeps = defaultTrelloDescriptionSyncDeps,
) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: TrelloDescriptionSyncRouteBody;
  try {
    body = (await request.json()) as TrelloDescriptionSyncRouteBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const actor = automationActor(request, body.operatorName);

  try {
    if (body.backfill) {
      const result = await dryRunTrelloDescriptionBackfill(
        { dryRun: Boolean(body.dryRun), limit: body.limit },
        actor,
        deps,
      );
      return NextResponse.json(result);
    }

    const result = await syncTrelloDescriptionFromStoredSegment(
      {
        requestId: body.requestId,
        trelloCardId: body.trelloCardId,
        dryRun: Boolean(body.dryRun),
      },
      actor,
      deps,
    );

    return NextResponse.json(result, { status: result.status === "missing_segment" ? 202 : 200 });
  } catch (error) {
    return failureResponse(error);
  }
}
